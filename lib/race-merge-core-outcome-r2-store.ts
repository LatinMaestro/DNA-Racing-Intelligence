import { createHash } from "node:crypto";

import type { DnaCompactCoreOutcomeEvidence } from "./dna-population-core-outcome-gap-plan";
import type { RaceMergeOutcomeEvidenceRow } from "./race-merge-outcome-ingestion-service";
import type { PrivateDatasetEvidenceObjectReadableStoragePort } from "./private-dataset-evidence-object-reader";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";

const CONTENT_TYPE = "application/json";
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export const RACE_MERGE_CORE_OUTCOME_R2_MAXIMUM_BYTES = 8 * 1024 * 1024;
export const RACE_MERGE_CORE_OUTCOME_R2_MAXIMUM_OUTCOMES = 50_000;
export const RACE_MERGE_CORE_OUTCOME_R2_MAXIMUM_SOURCE_OBSERVATIONS =
  RACE_MERGE_CORE_OUTCOME_R2_MAXIMUM_OUTCOMES * 24;
export const RACE_MERGE_CORE_OUTCOME_R2_VERSION = 1 as const;

export type RaceMergeCoreOutcomeR2StoragePort = Pick<
  PrivateDatasetEvidenceObjectStoragePort,
  "readBucketPrivacy" | "putObjectIfAbsent" | "headObject"
> &
  Pick<PrivateDatasetEvidenceObjectReadableStoragePort, "getObject">;

export type RaceMergeCoreOutcomeR2Receipt = Readonly<{
  version: typeof RACE_MERGE_CORE_OUTCOME_R2_VERSION;
  generationId: string;
  sourceCoreId: number;
  objectKey: string;
  bodySha256: string;
  byteLength: number;
  uniqueOutcomeCount: number;
  sourceObservationCount: number;
  firstSourceRaceId: string;
  lastSourceRaceId: string;
}>;

export type RaceMergeCoreOutcomeR2Write = Readonly<{
  receipt: RaceMergeCoreOutcomeR2Receipt;
  storageStatus: "created" | "existing";
}>;

export type RaceMergeCoreOutcomeR2PreparedWrite = Readonly<{
  receipt: RaceMergeCoreOutcomeR2Receipt;
  body: Uint8Array;
}>;

export type RaceMergeCoreOutcomeR2Store = Readonly<{
  prepare: (request: {
    generationId: string;
    sourceCoreId: number;
    observations: readonly RaceMergeOutcomeEvidenceRow[];
  }) => RaceMergeCoreOutcomeR2PreparedWrite;
  commit: (
    prepared: RaceMergeCoreOutcomeR2PreparedWrite,
  ) => Promise<RaceMergeCoreOutcomeR2Write>;
  write: (request: {
    generationId: string;
    sourceCoreId: number;
    observations: readonly RaceMergeOutcomeEvidenceRow[];
  }) => Promise<RaceMergeCoreOutcomeR2Write>;
  read: (
    receipt: RaceMergeCoreOutcomeR2Receipt,
  ) => Promise<readonly DnaCompactCoreOutcomeEvidence[]>;
}>;

type Provenance = Readonly<{
  sourceObjectSha256: string;
  sourceRowNumber: number;
}>;

type NormalizedOutcome = Readonly<{
  sourceRaceId: string;
  finishPosition: number;
  elapsedMilliseconds: number;
  provenance: readonly Provenance[];
}>;

function fail(message: string): never {
  throw new Error(`Race Merge Core outcome R2: ${message}`);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("body contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value !== "object") fail("body contains a non-JSON value");
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeText(value: unknown, field: string, maximum: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 1 || text.length > maximum || CONTROL_PATTERN.test(text)) {
    fail(`${field} is invalid`);
  }
  return text;
}

function generationId(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 128 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(normalized)
  ) {
    fail("generationId is invalid");
  }
  return normalized;
}

function positiveInteger(
  value: unknown,
  field: string,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    fail(`${field} is invalid`);
  }
  return value;
}

function exactSha256(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!SHA_256_PATTERN.test(text)) fail(`${field} is invalid`);
  return text;
}

function ownerPrefix(ownerId: string): string {
  return sha256(`race-merge-core-outcomes-owner\u0000${ownerId}`);
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
    fail("R2 bucket is not private");
  }
}

function oneChunk(body: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield body;
  })();
}

function normalizedOutcomes(
  sourceCoreId: number,
  observations: readonly RaceMergeOutcomeEvidenceRow[],
): readonly NormalizedOutcome[] {
  if (
    observations.length < 1 ||
    observations.length > RACE_MERGE_CORE_OUTCOME_R2_MAXIMUM_SOURCE_OBSERVATIONS
  ) {
    fail("source observation count is invalid");
  }
  const byRace = new Map<
    string,
    {
      finishPosition: number;
      elapsedMilliseconds: number;
      provenance: Map<string, Provenance>;
    }
  >();

  for (const observation of observations) {
    if (observation.source !== "race_merge")
      fail("source authority is invalid");
    if (observation.sourceCoreId !== sourceCoreId) {
      fail("source Core identity changed within one object");
    }
    const sourceRaceId = safeText(
      observation.sourceRaceId,
      "sourceRaceId",
      512,
    );
    const finishPosition = positiveInteger(
      observation.finishPosition,
      "finishPosition",
      2_147_483_647,
    );
    const elapsedMilliseconds = positiveInteger(
      observation.elapsedMilliseconds,
      "elapsedMilliseconds",
      Number.MAX_SAFE_INTEGER,
    );
    const sourceObjectSha256 = exactSha256(
      observation.sourceObjectSha256,
      "sourceObjectSha256",
    );
    const sourceRowNumber = positiveInteger(
      observation.sourceRowNumber,
      "sourceRowNumber",
      100_000_000,
    );
    const previous = byRace.get(sourceRaceId);
    if (previous !== undefined) {
      if (
        previous.finishPosition !== finishPosition ||
        previous.elapsedMilliseconds !== elapsedMilliseconds
      ) {
        fail("Race/Core outcome conflict");
      }
      previous.provenance.set(
        `${sourceObjectSha256}\u0000${sourceRowNumber}`,
        Object.freeze({ sourceObjectSha256, sourceRowNumber }),
      );
      continue;
    }
    byRace.set(sourceRaceId, {
      finishPosition,
      elapsedMilliseconds,
      provenance: new Map([
        [
          `${sourceObjectSha256}\u0000${sourceRowNumber}`,
          Object.freeze({ sourceObjectSha256, sourceRowNumber }),
        ],
      ]),
    });
  }

  if (
    byRace.size < 1 ||
    byRace.size > RACE_MERGE_CORE_OUTCOME_R2_MAXIMUM_OUTCOMES
  ) {
    fail("unique outcome count is invalid");
  }

  return Object.freeze(
    [...byRace.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([sourceRaceId, value]) =>
        Object.freeze({
          sourceRaceId,
          finishPosition: value.finishPosition,
          elapsedMilliseconds: value.elapsedMilliseconds,
          provenance: Object.freeze(
            [...value.provenance.values()].sort(
              (left, right) =>
                left.sourceObjectSha256.localeCompare(
                  right.sourceObjectSha256,
                ) || left.sourceRowNumber - right.sourceRowNumber,
            ),
          ),
        }),
      ),
  );
}

function bodyFor(input: {
  generationId: string;
  sourceCoreId: number;
  observations: readonly RaceMergeOutcomeEvidenceRow[];
}): Readonly<{
  canonical: string;
  body: Uint8Array;
  outcomes: readonly NormalizedOutcome[];
  sourceObservationCount: number;
}> {
  const outcomes = normalizedOutcomes(input.sourceCoreId, input.observations);
  const sourceObjects = Object.freeze(
    [
      ...new Set(
        outcomes.flatMap((outcome) =>
          outcome.provenance.map((entry) => entry.sourceObjectSha256),
        ),
      ),
    ].sort(),
  );
  const sourceObjectIndex = new Map(
    sourceObjects.map((value, index) => [value, index] as const),
  );
  const sourceObservationCount = outcomes.reduce(
    (total, outcome) => total + outcome.provenance.length,
    0,
  );
  const envelope = Object.freeze({
    version: RACE_MERGE_CORE_OUTCOME_R2_VERSION,
    source: "race_merge",
    sourceVersion: "race-merge-core-outcomes-r2-v1",
    generationId: input.generationId,
    sourceCoreId: input.sourceCoreId,
    sourceObjects,
    outcomes: outcomes.map((outcome) => [
      outcome.sourceRaceId,
      outcome.finishPosition,
      outcome.elapsedMilliseconds,
      outcome.provenance.map((entry) => [
        sourceObjectIndex.get(entry.sourceObjectSha256)!,
        entry.sourceRowNumber,
      ]),
    ]),
  });
  const canonical = canonicalJson(envelope);
  return Object.freeze({
    canonical,
    body: new TextEncoder().encode(canonical),
    outcomes,
    sourceObservationCount,
  });
}

function expectedObjectKey(
  prefix: string,
  receipt: Pick<
    RaceMergeCoreOutcomeR2Receipt,
    "generationId" | "sourceCoreId" | "bodySha256"
  >,
): string {
  return [
    "dna-open-lab",
    "v1",
    prefix,
    "race-merge-core-outcomes",
    "generations",
    receipt.generationId,
    "cores",
    `${receipt.sourceCoreId}-${receipt.bodySha256}.json`,
  ].join("/");
}

function exactMetadata(receipt: RaceMergeCoreOutcomeR2Receipt) {
  return Object.freeze({
    "dna-source": "race_merge",
    "dna-version": "race-merge-core-outcomes-r2-v1",
    "dna-generation": receipt.generationId,
    "dna-core": String(receipt.sourceCoreId),
    "dna-outcomes": String(receipt.uniqueOutcomeCount),
    "dna-observations": String(receipt.sourceObservationCount),
  });
}

async function collectExactBody(input: {
  body: AsyncIterable<Uint8Array>;
  byteLength: number;
  checksumSha256: string;
}): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 1 ||
    input.byteLength > RACE_MERGE_CORE_OUTCOME_R2_MAXIMUM_BYTES
  ) {
    fail("stored body byte length is invalid");
  }
  const output = new Uint8Array(input.byteLength);
  const digest = createHash("sha256");
  let offset = 0;
  for await (const chunk of input.body) {
    if (
      !(chunk instanceof Uint8Array) ||
      offset + chunk.byteLength > input.byteLength
    ) {
      fail("stored body is invalid");
    }
    output.set(chunk, offset);
    digest.update(chunk);
    offset += chunk.byteLength;
  }
  if (
    offset !== input.byteLength ||
    digest.digest("hex") !== input.checksumSha256
  ) {
    fail("stored body checksum disagrees");
  }
  return output;
}

function validateReceipt(receipt: RaceMergeCoreOutcomeR2Receipt) {
  const accepted = Object.freeze({
    version: receipt.version,
    generationId: generationId(receipt.generationId),
    sourceCoreId: positiveInteger(
      receipt.sourceCoreId,
      "sourceCoreId",
      Number.MAX_SAFE_INTEGER,
    ),
    objectKey: safeText(receipt.objectKey, "objectKey", 2048),
    bodySha256: exactSha256(receipt.bodySha256, "bodySha256"),
    byteLength: positiveInteger(
      receipt.byteLength,
      "byteLength",
      RACE_MERGE_CORE_OUTCOME_R2_MAXIMUM_BYTES,
    ),
    uniqueOutcomeCount: positiveInteger(
      receipt.uniqueOutcomeCount,
      "uniqueOutcomeCount",
      RACE_MERGE_CORE_OUTCOME_R2_MAXIMUM_OUTCOMES,
    ),
    sourceObservationCount: positiveInteger(
      receipt.sourceObservationCount,
      "sourceObservationCount",
      RACE_MERGE_CORE_OUTCOME_R2_MAXIMUM_SOURCE_OBSERVATIONS,
    ),
    firstSourceRaceId: safeText(
      receipt.firstSourceRaceId,
      "firstSourceRaceId",
      512,
    ),
    lastSourceRaceId: safeText(
      receipt.lastSourceRaceId,
      "lastSourceRaceId",
      512,
    ),
  });
  if (accepted.version !== RACE_MERGE_CORE_OUTCOME_R2_VERSION) {
    fail("receipt version is invalid");
  }
  return accepted;
}

export function createRaceMergeCoreOutcomeR2Store(input: {
  ownerId: string;
  bucketName: string;
  storage: RaceMergeCoreOutcomeR2StoragePort;
}): RaceMergeCoreOutcomeR2Store {
  const ownerId = safeText(input.ownerId, "ownerId", 512);
  const bucketName = safeText(input.bucketName, "bucketName", 255);
  const prefix = ownerPrefix(ownerId);
  let privacy: Promise<void> | null = null;

  async function privateStorage(): Promise<void> {
    privacy ??= input.storage
      .readBucketPrivacy({ bucketName })
      .then(assertPrivateBucket);
    await privacy;
  }

  const store: RaceMergeCoreOutcomeR2Store = {
    prepare(request) {
      const generation = generationId(request.generationId);
      const sourceCoreId = positiveInteger(
        request.sourceCoreId,
        "sourceCoreId",
        Number.MAX_SAFE_INTEGER,
      );
      const prepared = bodyFor({
        generationId: generation,
        sourceCoreId,
        observations: request.observations,
      });
      if (
        prepared.body.byteLength < 1 ||
        prepared.body.byteLength > RACE_MERGE_CORE_OUTCOME_R2_MAXIMUM_BYTES
      ) {
        fail("Core outcome object exceeds bounded byte capacity");
      }
      const bodySha256 = sha256(prepared.canonical);
      const receipt = Object.freeze({
        version: RACE_MERGE_CORE_OUTCOME_R2_VERSION,
        generationId: generation,
        sourceCoreId,
        objectKey: expectedObjectKey(prefix, {
          generationId: generation,
          sourceCoreId,
          bodySha256,
        }),
        bodySha256,
        byteLength: prepared.body.byteLength,
        uniqueOutcomeCount: prepared.outcomes.length,
        sourceObservationCount: prepared.sourceObservationCount,
        firstSourceRaceId: prepared.outcomes[0]!.sourceRaceId,
        lastSourceRaceId: prepared.outcomes.at(-1)!.sourceRaceId,
      });
      return Object.freeze({
        receipt,
        body: prepared.body,
      });
    },

    async commit(preparedInput) {
      const receipt = validateReceipt(preparedInput.receipt);
      if (
        !(preparedInput.body instanceof Uint8Array) ||
        preparedInput.body.byteLength !== receipt.byteLength ||
        sha256(preparedInput.body) !== receipt.bodySha256 ||
        receipt.objectKey !== expectedObjectKey(prefix, receipt)
      ) {
        fail("prepared Core outcome object conflicts with its receipt");
      }
      const metadata = exactMetadata(receipt);
      await privateStorage();
      const stored = await input.storage.putObjectIfAbsent({
        bucketName,
        key: receipt.objectKey,
        body: oneChunk(preparedInput.body),
        contentType: CONTENT_TYPE,
        byteLength: receipt.byteLength,
        checksumSha256: receipt.bodySha256,
        metadata,
      });
      const head = await input.storage.headObject({
        bucketName,
        key: receipt.objectKey,
      });
      if (
        head.status !== "ready" ||
        head.contentType !== CONTENT_TYPE ||
        head.byteLength !== receipt.byteLength ||
        head.checksumSha256 !== receipt.bodySha256 ||
        Object.entries(metadata).some(
          ([key, value]) => head.metadata[key] !== value,
        )
      ) {
        fail("stored Core outcome object conflicts with its receipt");
      }
      return Object.freeze({ receipt, storageStatus: stored.status });
    },

    async write(request) {
      return store.commit(store.prepare(request));
    },

    async read(receiptInput) {
      const receipt = validateReceipt(receiptInput);
      if (
        receipt.objectKey !== expectedObjectKey(prefix, receipt) ||
        receipt.sourceObservationCount < receipt.uniqueOutcomeCount ||
        receipt.firstSourceRaceId > receipt.lastSourceRaceId
      ) {
        fail("receipt counters are inconsistent");
      }
      await privateStorage();
      const metadata = exactMetadata(receipt);
      const head = await input.storage.headObject({
        bucketName,
        key: receipt.objectKey,
      });
      if (
        head.status !== "ready" ||
        head.contentType !== CONTENT_TYPE ||
        head.byteLength !== receipt.byteLength ||
        head.checksumSha256 !== receipt.bodySha256 ||
        Object.entries(metadata).some(
          ([key, value]) => head.metadata[key] !== value,
        )
      ) {
        fail("stored Core outcome head conflicts with its receipt");
      }
      const stored = await input.storage.getObject({
        bucketName,
        key: receipt.objectKey,
      });
      if (stored.status !== "ready")
        fail("stored Core outcome body is unavailable");
      const bytes = await collectExactBody({
        body: stored.body,
        byteLength: receipt.byteLength,
        checksumSha256: receipt.bodySha256,
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        fail("stored Core outcome body is not valid UTF-8 JSON");
      }
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        canonicalJson(parsed) !== new TextDecoder().decode(bytes)
      ) {
        fail("stored Core outcome envelope is invalid");
      }
      const envelope = parsed as Record<string, unknown>;
      if (
        envelope.version !== RACE_MERGE_CORE_OUTCOME_R2_VERSION ||
        envelope.source !== "race_merge" ||
        envelope.sourceVersion !== "race-merge-core-outcomes-r2-v1" ||
        envelope.generationId !== receipt.generationId ||
        envelope.sourceCoreId !== receipt.sourceCoreId ||
        !Array.isArray(envelope.sourceObjects) ||
        !Array.isArray(envelope.outcomes)
      ) {
        fail("stored Core outcome authority conflicts with its receipt");
      }
      const sourceObjects = envelope.sourceObjects.map((value) =>
        exactSha256(value, "stored source object"),
      );
      if (
        new Set(sourceObjects).size !== sourceObjects.length ||
        sourceObjects.some(
          (value, index) => index > 0 && sourceObjects[index - 1]! >= value,
        )
      ) {
        fail("stored source object index is invalid");
      }
      const outcomes: DnaCompactCoreOutcomeEvidence[] = [];
      let sourceObservationCount = 0;
      let previousRaceId = "";
      for (const raw of envelope.outcomes) {
        if (!Array.isArray(raw) || raw.length !== 4 || !Array.isArray(raw[3])) {
          fail("stored outcome row is invalid");
        }
        const sourceRaceId = safeText(raw[0], "stored sourceRaceId", 512);
        if (previousRaceId !== "" && previousRaceId >= sourceRaceId) {
          fail("stored outcome ordering is invalid");
        }
        previousRaceId = sourceRaceId;
        const finishPosition = positiveInteger(
          raw[1],
          "stored finishPosition",
          2_147_483_647,
        );
        const elapsedMilliseconds = positiveInteger(
          raw[2],
          "stored elapsedMilliseconds",
          Number.MAX_SAFE_INTEGER,
        );
        const provenance = raw[3] as unknown[];
        if (provenance.length < 1) fail("stored provenance is empty");
        const seen = new Set<string>();
        for (const entry of provenance) {
          if (!Array.isArray(entry) || entry.length !== 2) {
            fail("stored provenance row is invalid");
          }
          const sourceIndex = entry[0];
          const sourceRowNumber = entry[1];
          if (
            typeof sourceIndex !== "number" ||
            !Number.isSafeInteger(sourceIndex) ||
            sourceIndex < 0 ||
            sourceIndex >= sourceObjects.length
          ) {
            fail("stored provenance source index is invalid");
          }
          const rowNumber = positiveInteger(
            sourceRowNumber,
            "stored sourceRowNumber",
            100_000_000,
          );
          const key = `${sourceIndex}\u0000${rowNumber}`;
          if (seen.has(key)) fail("stored provenance contains a duplicate");
          seen.add(key);
        }
        sourceObservationCount += provenance.length;
        outcomes.push(
          Object.freeze({
            source: "race_merge" as const,
            sourceCoreId: receipt.sourceCoreId,
            sourceRaceId,
            finishPosition,
            elapsedMilliseconds,
          }),
        );
      }
      if (
        outcomes.length !== receipt.uniqueOutcomeCount ||
        sourceObservationCount !== receipt.sourceObservationCount ||
        outcomes[0]?.sourceRaceId !== receipt.firstSourceRaceId ||
        outcomes.at(-1)?.sourceRaceId !== receipt.lastSourceRaceId
      ) {
        fail("stored Core outcome totals conflict with its receipt");
      }
      return Object.freeze(outcomes);
    },
  };
  return Object.freeze(store);
}
