import { createHash } from "node:crypto";

import type { RaceArchiveExternalSortedRunStore } from "./race-archive-external-sort";
import type { PrivateDatasetEvidenceObjectReadableStoragePort } from "./private-dataset-evidence-object-reader";
import type { PrivateDatasetEvidenceObjectDeletionPort } from "./private-dataset-evidence-object-writer";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const BUCKET_NAME_PATTERN =
  /^(?!.*\.\.)(?!.*--)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;
const SCRATCH_CONTENT_TYPE = "application/x-ndjson";
const MANIFEST_CONTENT_TYPE = "application/json";

export type PrivateR2ExternalSortedRunStoragePort =
  PrivateDatasetEvidenceObjectReadableStoragePort &
    PrivateDatasetEvidenceObjectDeletionPort;

type ScratchPart = Readonly<{
  key: string;
  byteLength: number;
  checksumSha256: string;
  recordCount: number;
}>;

type ScratchManifest = Readonly<{
  version: 1;
  runHash: string;
  recordCount: number;
  parts: readonly ScratchPart[];
}>;

function safeText(value: unknown, field: string, maximumLength = 512): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function positiveBound(value: unknown, field: string, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bytes(values: readonly Uint8Array[], byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== byteLength) {
    throw new Error("Race archive scratch byte accounting changed.");
  }
  return output;
}

function body(value: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield value;
  })();
}

function assertPrivateBucket(input: {
  publicAccessDisabled: boolean;
  r2DevDisabled: boolean;
  customDomainCount: number;
}): void {
  if (
    input.publicAccessDisabled !== true ||
    input.r2DevDisabled !== true ||
    input.customDomainCount !== 0
  ) {
    throw new Error("Race archive scratch bucket is not private.");
  }
}

async function collectExactBody(input: {
  source: AsyncIterable<Uint8Array>;
  expectedByteLength: number;
  maximumBytes: number;
}): Promise<Uint8Array> {
  if (
    input.expectedByteLength < 1 ||
    input.expectedByteLength > input.maximumBytes
  ) {
    throw new Error("Race archive scratch object exceeds its read bound.");
  }
  const output = new Uint8Array(input.expectedByteLength);
  let offset = 0;
  for await (const chunk of input.source) {
    if (
      !(chunk instanceof Uint8Array) ||
      chunk.byteLength < 1 ||
      offset + chunk.byteLength > output.byteLength
    ) {
      throw new Error("Race archive scratch object length is invalid.");
    }
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== output.byteLength) {
    throw new Error("Race archive scratch object length is invalid.");
  }
  return output;
}

function partMetadata(input: {
  sessionHash: string;
  runHash: string;
  partNumber: number;
  recordCount: number;
}): Readonly<Record<string, string>> {
  return Object.freeze({
    scope: "race-archive-scratch",
    session: input.sessionHash,
    run: input.runHash,
    part: String(input.partNumber),
    records: String(input.recordCount),
  });
}

function manifestMetadata(input: {
  sessionHash: string;
  runHash: string;
  recordCount: number;
  partCount: number;
}): Readonly<Record<string, string>> {
  return Object.freeze({
    scope: "race-archive-scratch-manifest",
    session: input.sessionHash,
    run: input.runHash,
    records: String(input.recordCount),
    parts: String(input.partCount),
  });
}

function exactMetadata(
  actual: Readonly<Record<string, string | undefined>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => actual[key] === value,
  );
}

function parseManifest(
  value: Uint8Array,
  expectedRunHash: string,
): ScratchManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(value),
    );
  } catch {
    throw new Error("Race archive scratch manifest is invalid.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Race archive scratch manifest is invalid.");
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    candidate.runHash !== expectedRunHash ||
    !Number.isSafeInteger(candidate.recordCount) ||
    (candidate.recordCount as number) < 0 ||
    !Array.isArray(candidate.parts)
  ) {
    throw new Error("Race archive scratch manifest is invalid.");
  }
  const parts = candidate.parts.map((value, index): ScratchPart => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Race archive scratch manifest part is invalid.");
    }
    const part = value as Record<string, unknown>;
    const key = safeText(part.key, `parts[${index}].key`, 1024);
    const byteLength = positiveBound(
      part.byteLength,
      `parts[${index}].byteLength`,
      Number.MAX_SAFE_INTEGER,
    );
    const checksumSha256 = safeText(
      part.checksumSha256,
      `parts[${index}].checksumSha256`,
      64,
    );
    if (!SHA_256_PATTERN.test(checksumSha256)) {
      throw new Error("Race archive scratch manifest checksum is invalid.");
    }
    const recordCount = positiveBound(
      part.recordCount,
      `parts[${index}].recordCount`,
      Number.MAX_SAFE_INTEGER,
    );
    return Object.freeze({ key, byteLength, checksumSha256, recordCount });
  });
  const recordCount = candidate.recordCount as number;
  const manifestRecordCount = parts.reduce(
    (total, part) => total + part.recordCount,
    0,
  );
  if (
    !Number.isSafeInteger(manifestRecordCount) ||
    manifestRecordCount !== recordCount
  ) {
    throw new Error("Race archive scratch manifest record coverage changed.");
  }
  return Object.freeze({
    version: 1 as const,
    runHash: expectedRunHash,
    recordCount,
    parts: Object.freeze(parts),
  });
}

export function createPrivateR2ExternalSortedRunStore<T>(input: {
  ownerId: string;
  sessionId: string;
  bucketName: string;
  storage: PrivateR2ExternalSortedRunStoragePort;
  maximumPartBytes: number;
  maximumPartsPerRun: number;
  maximumManifestBytes?: number;
  encodeRecord: (record: T) => Uint8Array;
  decodeRecordLine: (line: string) => T;
}): RaceArchiveExternalSortedRunStore<T> {
  const ownerId = safeText(input.ownerId, "ownerId");
  const sessionId = safeText(input.sessionId, "sessionId", 256);
  const bucketName = input.bucketName.trim();
  if (!BUCKET_NAME_PATTERN.test(bucketName)) {
    throw new Error("bucketName is invalid");
  }
  const maximumPartBytes = positiveBound(
    input.maximumPartBytes,
    "maximumPartBytes",
    64 * 1024 * 1024,
  );
  const maximumPartsPerRun = positiveBound(
    input.maximumPartsPerRun,
    "maximumPartsPerRun",
    10_000,
  );
  const maximumManifestBytes = positiveBound(
    input.maximumManifestBytes ?? maximumPartBytes,
    "maximumManifestBytes",
    64 * 1024 * 1024,
  );
  const ownerHash = sha256(`race-archive-scratch-owner\u0000${ownerId}`);
  const sessionHash = sha256(`race-archive-scratch-session\u0000${sessionId}`);
  const basePrefix = `scratch/race-archive/${ownerHash}/${sessionHash}`;
  let privacyPromise: Promise<void> | null = null;
  const knownRunKeys = new Map<string, readonly string[]>();

  async function assertPrivate(): Promise<void> {
    if (privacyPromise === null) {
      privacyPromise = input.storage
        .readBucketPrivacy({ bucketName })
        .then(assertPrivateBucket);
    }
    await privacyPromise;
  }

  function keys(runId: string): Readonly<{
    runHash: string;
    manifestKey: string;
    partKey: (partNumber: number) => string;
  }> {
    const normalizedRunId = safeText(runId, "runId", 512);
    const runHash = sha256(`race-archive-scratch-run\u0000${normalizedRunId}`);
    const runPrefix = `${basePrefix}/${runHash}`;
    return Object.freeze({
      runHash,
      manifestKey: `${runPrefix}/manifest.json`,
      partKey: (partNumber: number) =>
        `${runPrefix}/part-${String(partNumber).padStart(8, "0")}.ndjson`,
    });
  }

  async function putExact(inputObject: {
    key: string;
    contentType: string;
    value: Uint8Array;
    metadata: Readonly<Record<string, string>>;
  }): Promise<"created" | "existing"> {
    const checksumSha256 = sha256(inputObject.value);
    const write = await input.storage.putObjectIfAbsent({
      bucketName,
      key: inputObject.key,
      body: body(inputObject.value),
      contentType: inputObject.contentType,
      byteLength: inputObject.value.byteLength,
      checksumSha256,
      metadata: inputObject.metadata,
    });
    const head = await input.storage.headObject({
      bucketName,
      key: inputObject.key,
    });
    if (
      head.status !== "ready" ||
      head.contentType.trim().toLowerCase() !== inputObject.contentType ||
      head.byteLength !== inputObject.value.byteLength ||
      head.checksumSha256 !== checksumSha256 ||
      !exactMetadata(head.metadata, inputObject.metadata)
    ) {
      throw new Error("Race archive scratch object failed exact verification.");
    }
    return write.status;
  }

  async function readExact(inputObject: {
    key: string;
    contentType: string;
    byteLength: number;
    checksumSha256: string;
    metadata: Readonly<Record<string, string>>;
    maximumBytes: number;
  }): Promise<Uint8Array> {
    const head = await input.storage.headObject({
      bucketName,
      key: inputObject.key,
    });
    if (
      head.status !== "ready" ||
      head.contentType.trim().toLowerCase() !== inputObject.contentType ||
      head.byteLength !== inputObject.byteLength ||
      head.checksumSha256 !== inputObject.checksumSha256 ||
      !exactMetadata(head.metadata, inputObject.metadata)
    ) {
      throw new Error("Race archive scratch object failed exact verification.");
    }
    const opened = await input.storage.getObject({
      bucketName,
      key: inputObject.key,
    });
    if (opened.status !== "ready") {
      throw new Error("Race archive scratch object is unavailable.");
    }
    const value = await collectExactBody({
      source: opened.body,
      expectedByteLength: inputObject.byteLength,
      maximumBytes: inputObject.maximumBytes,
    });
    if (sha256(value) !== inputObject.checksumSha256) {
      throw new Error("Race archive scratch object checksum changed.");
    }
    return value;
  }

  async function readManifest(runId: string): Promise<ScratchManifest> {
    await assertPrivate();
    const runKeys = keys(runId);
    const head = await input.storage.headObject({
      bucketName,
      key: runKeys.manifestKey,
    });
    if (head.status !== "ready") {
      throw new Error("Race archive scratch manifest is unavailable.");
    }
    const recordCount = Number(head.metadata.records);
    const partCount = Number(head.metadata.parts);
    const metadata = manifestMetadata({
      sessionHash,
      runHash: runKeys.runHash,
      recordCount,
      partCount,
    });
    if (
      head.contentType.trim().toLowerCase() !== MANIFEST_CONTENT_TYPE ||
      !Number.isSafeInteger(recordCount) ||
      recordCount < 0 ||
      !Number.isSafeInteger(partCount) ||
      partCount < 1 ||
      partCount > maximumPartsPerRun ||
      !exactMetadata(head.metadata, metadata) ||
      head.byteLength < 1 ||
      head.byteLength > maximumManifestBytes ||
      !SHA_256_PATTERN.test(head.checksumSha256)
    ) {
      throw new Error(
        "Race archive scratch manifest failed exact verification.",
      );
    }
    const value = await readExact({
      key: runKeys.manifestKey,
      contentType: MANIFEST_CONTENT_TYPE,
      byteLength: head.byteLength,
      checksumSha256: head.checksumSha256,
      metadata,
      maximumBytes: maximumManifestBytes,
    });
    const manifest = parseManifest(value, runKeys.runHash);
    if (
      manifest.recordCount !== recordCount ||
      manifest.parts.length !== partCount ||
      manifest.parts.length > maximumPartsPerRun
    ) {
      throw new Error("Race archive scratch manifest coverage changed.");
    }
    for (const [partNumber, part] of manifest.parts.entries()) {
      if (part.key !== runKeys.partKey(partNumber)) {
        throw new Error(
          "Race archive scratch manifest part ownership changed.",
        );
      }
    }
    return manifest;
  }

  return Object.freeze({
    async writeRun({ runId, records }) {
      await assertPrivate();
      const runKeys = keys(runId);
      const parts: ScratchPart[] = [];
      const allKeys: string[] = [];
      const newlyCreatedKeys: string[] = [];
      let partValues: Uint8Array[] = [];
      let partByteLength = 0;
      let partRecordCount = 0;
      let recordCount = 0;

      const flushPart = async (): Promise<void> => {
        if (partRecordCount === 0) return;
        if (parts.length >= maximumPartsPerRun) {
          throw new Error("Race archive scratch part bound was exceeded.");
        }
        const value = bytes(partValues, partByteLength);
        const partNumber = parts.length;
        const key = runKeys.partKey(partNumber);
        const checksumSha256 = sha256(value);
        const metadata = partMetadata({
          sessionHash,
          runHash: runKeys.runHash,
          partNumber,
          recordCount: partRecordCount,
        });
        const status = await putExact({
          key,
          contentType: SCRATCH_CONTENT_TYPE,
          value,
          metadata,
        });
        allKeys.push(key);
        if (status === "created") newlyCreatedKeys.push(key);
        parts.push(
          Object.freeze({
            key,
            byteLength: value.byteLength,
            checksumSha256,
            recordCount: partRecordCount,
          }),
        );
        partValues = [];
        partByteLength = 0;
        partRecordCount = 0;
      };

      try {
        for await (const record of records) {
          const encoded = input.encodeRecord(record);
          if (!(encoded instanceof Uint8Array) || encoded.byteLength < 1) {
            throw new Error("Race archive scratch encoded record is invalid.");
          }
          let lineFeedCount = 0;
          for (const byte of encoded) {
            if (byte === 10) lineFeedCount += 1;
          }
          if (lineFeedCount !== 1 || encoded.at(-1) !== 10) {
            throw new Error(
              "Race archive scratch encoded record must be one line.",
            );
          }
          if (encoded.byteLength > maximumPartBytes) {
            throw new Error(
              "Race archive scratch observation exceeds the part bound.",
            );
          }
          if (
            partRecordCount > 0 &&
            partByteLength + encoded.byteLength > maximumPartBytes
          ) {
            await flushPart();
          }
          partValues.push(encoded);
          partByteLength += encoded.byteLength;
          partRecordCount += 1;
          recordCount += 1;
          if (!Number.isSafeInteger(recordCount)) {
            throw new Error("Race archive scratch record count overflowed.");
          }
        }
        await flushPart();
        if (recordCount === 0 || parts.length === 0) {
          throw new Error("Race archive scratch run cannot be empty.");
        }
        const manifest: ScratchManifest = Object.freeze({
          version: 1 as const,
          runHash: runKeys.runHash,
          recordCount,
          parts: Object.freeze(parts),
        });
        const manifestValue = new TextEncoder().encode(
          JSON.stringify(manifest),
        );
        if (manifestValue.byteLength > maximumManifestBytes) {
          throw new Error("Race archive scratch manifest exceeds its bound.");
        }
        const manifestStatus = await putExact({
          key: runKeys.manifestKey,
          contentType: MANIFEST_CONTENT_TYPE,
          value: manifestValue,
          metadata: manifestMetadata({
            sessionHash,
            runHash: runKeys.runHash,
            recordCount,
            partCount: parts.length,
          }),
        });
        allKeys.push(runKeys.manifestKey);
        if (manifestStatus === "created") {
          newlyCreatedKeys.push(runKeys.manifestKey);
        }
        knownRunKeys.set(runId, Object.freeze([...allKeys]));
      } catch (error) {
        const failures: unknown[] = [];
        for (const key of newlyCreatedKeys.reverse()) {
          try {
            await input.storage.deleteObject({ bucketName, key });
          } catch (cleanupError) {
            failures.push(cleanupError);
          }
        }
        if (failures.length > 0) {
          throw new Error(
            "Race archive scratch write failed and cleanup was incomplete.",
            { cause: error },
          );
        }
        throw error;
      }
    },

    readRun({ runId }) {
      return (async function* () {
        const manifest = await readManifest(runId);
        const runKeys = keys(runId);
        let recordCount = 0;
        for (const [partNumber, part] of manifest.parts.entries()) {
          if (part.key !== runKeys.partKey(partNumber)) {
            throw new Error("Race archive scratch part ordering changed.");
          }
          const value = await readExact({
            key: part.key,
            contentType: SCRATCH_CONTENT_TYPE,
            byteLength: part.byteLength,
            checksumSha256: part.checksumSha256,
            metadata: partMetadata({
              sessionHash,
              runHash: runKeys.runHash,
              partNumber,
              recordCount: part.recordCount,
            }),
            maximumBytes: maximumPartBytes,
          });
          let decoded: string;
          try {
            decoded = new TextDecoder("utf-8", { fatal: true }).decode(value);
          } catch {
            throw new Error("Race archive scratch part is not valid UTF-8.");
          }
          const lines = decoded.split("\n");
          if (lines.at(-1) !== "") {
            throw new Error(
              "Race archive scratch part is not line terminated.",
            );
          }
          lines.pop();
          if (lines.length !== part.recordCount) {
            throw new Error(
              "Race archive scratch part record coverage changed.",
            );
          }
          for (const line of lines) {
            recordCount += 1;
            yield input.decodeRecordLine(line);
          }
        }
        if (recordCount !== manifest.recordCount) {
          throw new Error("Race archive scratch run record coverage changed.");
        }
      })();
    },

    async deleteRun({ runId }) {
      await assertPrivate();
      const runKeys = keys(runId);
      let keysToDelete = knownRunKeys.get(runId);
      if (keysToDelete === undefined) {
        try {
          const manifest = await readManifest(runId);
          keysToDelete = Object.freeze([
            ...manifest.parts.map((part) => part.key),
            runKeys.manifestKey,
          ]);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Race archive scratch manifest is unavailable."
          ) {
            return;
          }
          throw error;
        }
      }
      const failures: unknown[] = [];
      for (const key of [...keysToDelete].reverse()) {
        try {
          await input.storage.deleteObject({ bucketName, key });
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new Error("Race archive scratch cleanup failed.");
      }
      knownRunKeys.delete(runId);
    },
  });
}
