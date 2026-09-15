import { createHash } from "node:crypto";

import {
  createDnaCoreRaceHistoryPageReceipt,
  DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE,
  DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE,
  validateDnaCoreRaceHistoryAcquisitionCycle,
  type DnaCoreRaceHistoryAcquisitionCycle,
  type DnaCoreRaceHistoryPageReceipt,
} from "./dna-core-race-history-acquisition-cycle";
import { adaptDnaCoreRaceHistoryPage } from "./dna-core-race-history-adapter";
import type { DnaCoreRaceHistoryRow } from "./dna-core-race-history-client";
import type { DnaOpenLabResponse } from "./dna-open-lab-v1-client";
import type { PrivateDatasetEvidenceObjectReadableStoragePort } from "./private-dataset-evidence-object-reader";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";

const JSON_CONTENT_TYPE = "application/json";
export const DNA_CORE_RACE_HISTORY_MAXIMUM_EVIDENCE_OBJECT_BYTES =
  8 * 1024 * 1024;
const DEFAULT_MAXIMUM_OBJECT_BYTES =
  DNA_CORE_RACE_HISTORY_MAXIMUM_EVIDENCE_OBJECT_BYTES;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaCoreRaceHistoryR2EvidenceStoragePort = Pick<
  PrivateDatasetEvidenceObjectStoragePort,
  "readBucketPrivacy" | "putObjectIfAbsent" | "headObject"
> &
  Pick<PrivateDatasetEvidenceObjectReadableStoragePort, "getObject">;

type ReadyObjectHead = Extract<
  Awaited<ReturnType<DnaCoreRaceHistoryR2EvidenceStoragePort["headObject"]>>,
  { status: "ready" }
>;

export type DnaCoreRaceHistoryHeldPageEvidence = Readonly<{
  status: "held_conflict";
  cycleId: string;
  attemptNumber: number;
  coreId: number;
  pageNumber: number;
  observedAt: string;
  conflictCount: number;
  pageObjectKey: string;
  pageBodySha256: string;
  pageByteLength: number;
  quarantineObjectKey: string;
  quarantineBodySha256: string;
  quarantineByteLength: number;
}>;

export type DnaCoreRaceHistoryStoredPageEvidence =
  | Readonly<{
      status: "ready";
      receipt: DnaCoreRaceHistoryPageReceipt;
    }>
  | DnaCoreRaceHistoryHeldPageEvidence;

export type DnaCoreRaceHistoryR2EvidenceStore = Readonly<{
  read: (input: {
    cycle: DnaCoreRaceHistoryAcquisitionCycle;
    coreId: number;
    pageNumber: number;
  }) => Promise<DnaCoreRaceHistoryStoredPageEvidence | null>;
  recover: (input: {
    cycle: DnaCoreRaceHistoryAcquisitionCycle;
    coreId: number;
    pageNumber: number;
  }) => Promise<DnaCoreRaceHistoryStoredPageEvidence | null>;
  write: (input: {
    cycle: DnaCoreRaceHistoryAcquisitionCycle;
    coreId: number;
    pageNumber: number;
    observedAt: string;
    response: DnaOpenLabResponse<readonly DnaCoreRaceHistoryRow[]>;
  }) => Promise<DnaCoreRaceHistoryStoredPageEvidence>;
}>;

type StoredPageDocument = Readonly<{
  version: 1;
  source: "dna_open_lab";
  sourceVersion: "core-history-v1";
  cycleId: string;
  attemptNumber: number;
  coreId: number;
  pageNumber: number;
  observedAt: string;
  response: DnaOpenLabResponse<readonly DnaCoreRaceHistoryRow[]>;
}>;

type StoredQuarantineDocument = Readonly<{
  version: 1;
  source: "dna_open_lab";
  sourceVersion: "core-history-v1";
  cycleId: string;
  attemptNumber: number;
  coreId: number;
  pageNumber: number;
  observedAt: string;
  pageBodySha256: string;
  quarantined: readonly Readonly<{
    rowIndex: number;
    diagnostic: string;
    rawEvidenceSha256: string;
  }>[];
  conflictCount: number;
}>;

type StoredObject = Readonly<{
  key: string;
  body: Uint8Array;
  bodySha256: string;
  byteLength: number;
  metadata: Readonly<Record<string, string>>;
}>;

function evidenceError(message: string): never {
  throw new Error(`DNA Core race history R2 evidence: ${message}`);
}

function safeText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    CONTROL_PATTERN.test(normalized)
  ) {
    evidenceError(`${field} is invalid`);
  }
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    evidenceError(`${field} must be a positive safe integer`);
  }
  return value;
}

function boundedPositiveInteger(
  value: number,
  field: string,
  maximum: number,
): number {
  const normalized = positiveInteger(value, field);
  if (normalized > maximum) evidenceError(`${field} exceeds its safe bound`);
  return normalized;
}

function nullableNonNegativeInteger(
  value: unknown,
  field: string,
): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    evidenceError(`${field} is invalid`);
  }
  return value as number;
}

function nullableRateClass(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    CONTROL_PATTERN.test(value)
  ) {
    evidenceError("stored rate-limit class is invalid");
  }
  return value;
}

function canonicalTimestamp(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) ||
    Number.isNaN(Date.parse(value))
  ) {
    evidenceError(`${field} must be a timezone-qualified timestamp`);
  }
  return new Date(value).toISOString();
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) evidenceError("body has a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return evidenceError("body contains a non-JSON value");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Value(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    evidenceError(`${field} is invalid`);
  }
  return normalized;
}

function ownerPrefix(ownerId: string): string {
  return sha256(`dna-open-lab-owner\u0000${ownerId}`);
}

function corePrefix(coreId: number): string {
  return sha256(`dna-core-race-history\u0000${coreId}`);
}

function pageObjectKey(input: {
  ownerPrefix: string;
  cycleId: string;
  attemptNumber: number;
  coreId: number;
  pageNumber: number;
}): string {
  return [
    "dna-open-lab",
    "v1",
    input.ownerPrefix,
    "core-race-history",
    "cycles",
    input.cycleId,
    "attempts",
    String(input.attemptNumber),
    "cores",
    corePrefix(input.coreId),
    "pages",
    `${input.pageNumber}.json`,
  ].join("/");
}

function quarantineObjectKey(pageKey: string): string {
  return pageKey.replace(/\.json$/u, ".quarantine.json");
}

function oneChunk(body: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield body;
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
    evidenceError("evidence bucket is not private");
  }
}

function metadataValue(
  metadata: Readonly<Record<string, string | undefined>>,
  field: string,
): string {
  const value = metadata[field];
  if (typeof value !== "string" || value.trim() === "") {
    evidenceError(`metadata ${field} is unavailable`);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    evidenceError(`${field} shape is invalid`);
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    evidenceError(`${field} is invalid`);
  }
  return value as Record<string, unknown>;
}

function normalizedResponse(
  value: unknown,
): DnaOpenLabResponse<readonly DnaCoreRaceHistoryRow[]> {
  const response = record(value, "stored response");
  exactKeys(response, ["result", "httpStatus", "rateLimit"], "stored response");
  if (
    !Array.isArray(response.result) ||
    response.result.length > DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE ||
    response.result.some(
      (row) => row === null || typeof row !== "object" || Array.isArray(row),
    ) ||
    !Number.isInteger(response.httpStatus) ||
    (response.httpStatus as number) < 100 ||
    (response.httpStatus as number) > 599
  ) {
    evidenceError("stored response is invalid");
  }
  const rateLimit = record(response.rateLimit, "stored rate-limit evidence");
  exactKeys(
    rateLimit,
    ["limit", "remaining", "resetSeconds", "rateClass", "retryAfterSeconds"],
    "stored rate-limit evidence",
  );
  return Object.freeze({
    result: Object.freeze(
      response.result.map((row) =>
        Object.freeze({ ...(row as Record<string, unknown>) }),
      ),
    ),
    httpStatus: response.httpStatus as number,
    rateLimit: Object.freeze({
      limit: nullableNonNegativeInteger(rateLimit.limit, "stored rate limit"),
      remaining: nullableNonNegativeInteger(
        rateLimit.remaining,
        "stored rate remaining",
      ),
      resetSeconds: nullableNonNegativeInteger(
        rateLimit.resetSeconds,
        "stored rate reset",
      ),
      rateClass: nullableRateClass(rateLimit.rateClass),
      retryAfterSeconds: nullableNonNegativeInteger(
        rateLimit.retryAfterSeconds,
        "stored retry-after",
      ),
    }),
  });
}

async function collectBody(input: {
  body: AsyncIterable<Uint8Array>;
  byteLength: number;
  checksumSha256: string;
  maximumObjectBytes: number;
}): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 1 ||
    input.byteLength > input.maximumObjectBytes
  ) {
    evidenceError("stored body length is invalid");
  }
  const body = new Uint8Array(input.byteLength);
  const digest = createHash("sha256");
  let offset = 0;
  for await (const chunk of input.body) {
    if (
      !(chunk instanceof Uint8Array) ||
      offset + chunk.byteLength > input.byteLength
    ) {
      evidenceError("stored body stream is invalid");
    }
    body.set(chunk, offset);
    digest.update(chunk);
    offset += chunk.byteLength;
  }
  if (
    offset !== input.byteLength ||
    digest.digest("hex") !== input.checksumSha256
  ) {
    evidenceError("stored body integrity is invalid");
  }
  return body;
}

function encodeObject(input: {
  key: string;
  document: unknown;
  metadata: Readonly<Record<string, string>>;
  maximumObjectBytes: number;
}): StoredObject {
  const canonical = canonicalJson(input.document);
  const body = new TextEncoder().encode(canonical);
  if (body.byteLength < 1 || body.byteLength > input.maximumObjectBytes) {
    evidenceError("evidence object exceeds its bounded byte capacity");
  }
  return Object.freeze({
    key: input.key,
    body,
    bodySha256: sha256(canonical),
    byteLength: body.byteLength,
    metadata: input.metadata,
  });
}

function validateIdentity(input: {
  cycle: DnaCoreRaceHistoryAcquisitionCycle;
  coreId: number;
  pageNumber: number;
}) {
  const cycle = validateDnaCoreRaceHistoryAcquisitionCycle(input.cycle);
  const coreId = positiveInteger(input.coreId, "coreId");
  const pageNumber = boundedPositiveInteger(
    input.pageNumber,
    "pageNumber",
    DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE,
  );
  if (!cycle.coreIds.includes(coreId)) {
    evidenceError("Core is outside the cycle authority");
  }
  return Object.freeze({ cycle, coreId, pageNumber });
}

export function createDnaCoreRaceHistoryR2EvidenceStore(input: {
  ownerId: string;
  bucketName: string;
  storage: DnaCoreRaceHistoryR2EvidenceStoragePort;
  maximumObjectBytes?: number;
}): DnaCoreRaceHistoryR2EvidenceStore {
  const ownerId = safeText(input.ownerId, "ownerId", 512);
  const bucketName = safeText(input.bucketName, "bucketName", 255);
  const maximumObjectBytes = boundedPositiveInteger(
    input.maximumObjectBytes ?? DEFAULT_MAXIMUM_OBJECT_BYTES,
    "maximumObjectBytes",
    DEFAULT_MAXIMUM_OBJECT_BYTES,
  );
  const prefix = ownerPrefix(ownerId);
  let privacy: Promise<void> | null = null;

  async function privateStorage(): Promise<void> {
    privacy ??= input.storage
      .readBucketPrivacy({ bucketName })
      .then(assertPrivateBucket);
    await privacy;
  }

  async function putObject(object: StoredObject): Promise<void> {
    await input.storage.putObjectIfAbsent({
      bucketName,
      key: object.key,
      body: oneChunk(object.body),
      contentType: JSON_CONTENT_TYPE,
      byteLength: object.byteLength,
      checksumSha256: object.bodySha256,
      metadata: object.metadata,
    });
    const head = await input.storage.headObject({
      bucketName,
      key: object.key,
    });
    if (
      head.status !== "ready" ||
      head.contentType !== JSON_CONTENT_TYPE ||
      head.byteLength !== object.byteLength ||
      head.checksumSha256 !== object.bodySha256 ||
      Object.entries(object.metadata).some(
        ([key, value]) => metadataValue(head.metadata, key) !== value,
      )
    ) {
      evidenceError("immutable evidence object conflicts with its identity");
    }
  }

  async function readObject(key: string): Promise<{
    head: ReadyObjectHead;
    document: Record<string, unknown>;
  } | null> {
    const head = await input.storage.headObject({ bucketName, key });
    if (head.status === "missing") return null;
    if (
      head.contentType !== JSON_CONTENT_TYPE ||
      head.checksumSha256 !==
        sha256Value(head.checksumSha256, "stored checksum")
    ) {
      evidenceError("stored object head is invalid");
    }
    const object = await input.storage.getObject({ bucketName, key });
    if (object.status !== "ready")
      evidenceError("stored object is unavailable");
    const body = await collectBody({
      body: object.body,
      byteLength: head.byteLength,
      checksumSha256: head.checksumSha256,
      maximumObjectBytes,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(body),
      );
    } catch {
      evidenceError("stored object is not valid UTF-8 JSON");
    }
    return { head, document: record(parsed, "stored document") };
  }

  function pageDocument(input: {
    document: Record<string, unknown>;
    expected: ReturnType<typeof validateIdentity>;
  }): StoredPageDocument {
    exactKeys(
      input.document,
      [
        "version",
        "source",
        "sourceVersion",
        "cycleId",
        "attemptNumber",
        "coreId",
        "pageNumber",
        "observedAt",
        "response",
      ],
      "stored page document",
    );
    const observedAt = canonicalTimestamp(
      String(input.document.observedAt),
      "stored observedAt",
    );
    if (
      input.document.version !== 1 ||
      input.document.source !== "dna_open_lab" ||
      input.document.sourceVersion !== "core-history-v1" ||
      input.document.cycleId !== input.expected.cycle.cycleId ||
      input.document.attemptNumber !== input.expected.cycle.attemptNumber ||
      input.document.coreId !== input.expected.coreId ||
      input.document.pageNumber !== input.expected.pageNumber ||
      Date.parse(observedAt) < Date.parse(input.expected.cycle.evaluatedAt)
    ) {
      evidenceError("stored page identity is invalid");
    }
    return Object.freeze({
      version: 1,
      source: "dna_open_lab",
      sourceVersion: "core-history-v1",
      cycleId: input.expected.cycle.cycleId,
      attemptNumber: input.expected.cycle.attemptNumber,
      coreId: input.expected.coreId,
      pageNumber: input.expected.pageNumber,
      observedAt,
      response: normalizedResponse(input.document.response),
    });
  }

  async function persistQuarantine(input: {
    page: StoredPageDocument;
    pageKey: string;
    pageBodySha256: string;
    allowWrite: boolean;
  }): Promise<StoredObject | null> {
    const adaptation = adaptDnaCoreRaceHistoryPage({
      requestedCoreId: input.page.coreId,
      rows: input.page.response.result,
      observedAt: input.page.observedAt,
    });
    if (adaptation.quarantined.length === 0 && adaptation.conflictCount === 0) {
      return null;
    }
    const key = quarantineObjectKey(input.pageKey);
    const document: StoredQuarantineDocument = Object.freeze({
      version: 1,
      source: "dna_open_lab",
      sourceVersion: "core-history-v1",
      cycleId: input.page.cycleId,
      attemptNumber: input.page.attemptNumber,
      coreId: input.page.coreId,
      pageNumber: input.page.pageNumber,
      observedAt: input.page.observedAt,
      pageBodySha256: input.pageBodySha256,
      quarantined: adaptation.quarantined,
      conflictCount: adaptation.conflictCount,
    });
    const object = encodeObject({
      key,
      document,
      maximumObjectBytes,
      metadata: Object.freeze({
        "dna-source": "dna_open_lab",
        "dna-version": "core-history-v1",
        "dna-kind": "core_history_quarantine",
        "dna-cycle-id": input.page.cycleId,
        "dna-attempt": String(input.page.attemptNumber),
        "dna-core-sha256": corePrefix(input.page.coreId),
        "dna-page": String(input.page.pageNumber),
        "dna-page-body-sha256": input.pageBodySha256,
        "dna-quarantine-count": String(adaptation.quarantined.length),
        "dna-conflict-count": String(adaptation.conflictCount),
      }),
    });
    const existing = await readObject(key);
    if (existing === null) {
      if (!input.allowWrite) {
        evidenceError("quarantine receipt is unavailable");
      }
      await putObject(object);
    } else if (
      existing.head.checksumSha256 !== object.bodySha256 ||
      existing.head.byteLength !== object.byteLength ||
      existing.head.contentType !== JSON_CONTENT_TYPE ||
      Object.entries(object.metadata).some(
        ([metadataKey, metadataEntry]) =>
          metadataValue(existing.head.metadata, metadataKey) !== metadataEntry,
      )
    ) {
      evidenceError("quarantine receipt conflicts with stored evidence");
    }
    return object;
  }

  async function assembleStoredPage(input: {
    identity: ReturnType<typeof validateIdentity>;
    key: string;
    pageHead: ReadyObjectHead;
    page: StoredPageDocument;
    allowQuarantineWrite: boolean;
  }): Promise<DnaCoreRaceHistoryStoredPageEvidence> {
    const expectedMetadata = Object.freeze({
      "dna-source": "dna_open_lab",
      "dna-version": "core-history-v1",
      "dna-kind": "core_history_page",
      "dna-cycle-id": input.page.cycleId,
      "dna-attempt": String(input.page.attemptNumber),
      "dna-core-sha256": corePrefix(input.page.coreId),
      "dna-page": String(input.page.pageNumber),
      "dna-observed-at": input.page.observedAt,
      "dna-row-count": String(input.page.response.result.length),
    });
    if (
      Object.entries(expectedMetadata).some(
        ([key, value]) => metadataValue(input.pageHead.metadata, key) !== value,
      )
    ) {
      evidenceError("stored page metadata is invalid");
    }
    const adaptation = adaptDnaCoreRaceHistoryPage({
      requestedCoreId: input.page.coreId,
      rows: input.page.response.result,
      observedAt: input.page.observedAt,
    });
    const quarantine = await persistQuarantine({
      page: input.page,
      pageKey: input.key,
      pageBodySha256: input.pageHead.checksumSha256,
      allowWrite: input.allowQuarantineWrite,
    });
    if (adaptation.conflictCount > 0) {
      if (quarantine === null) evidenceError("conflict receipt is unavailable");
      return Object.freeze({
        status: "held_conflict",
        cycleId: input.identity.cycle.cycleId,
        attemptNumber: input.identity.cycle.attemptNumber,
        coreId: input.identity.coreId,
        pageNumber: input.identity.pageNumber,
        observedAt: input.page.observedAt,
        conflictCount: adaptation.conflictCount,
        pageObjectKey: input.key,
        pageBodySha256: input.pageHead.checksumSha256,
        pageByteLength: input.pageHead.byteLength,
        quarantineObjectKey: quarantine.key,
        quarantineBodySha256: quarantine.bodySha256,
        quarantineByteLength: quarantine.byteLength,
      });
    }
    return Object.freeze({
      status: "ready",
      receipt: createDnaCoreRaceHistoryPageReceipt({
        cycleId: input.identity.cycle.cycleId,
        attemptNumber: input.identity.cycle.attemptNumber,
        coreId: input.identity.coreId,
        pageNumber: input.identity.pageNumber,
        observedAt: input.page.observedAt,
        sourceRowCount: input.page.response.result.length,
        acceptedResultCount: adaptation.accepted.length,
        quarantineCount: adaptation.quarantined.length,
        replayDuplicateCount: adaptation.replayDuplicateCount,
        pageObjectKey: input.key,
        pageBodySha256: input.pageHead.checksumSha256,
        pageByteLength: input.pageHead.byteLength,
        quarantineObjectKey: quarantine?.key ?? null,
        quarantineBodySha256: quarantine?.bodySha256 ?? null,
        quarantineByteLength: quarantine?.byteLength ?? null,
      }),
    });
  }

  async function readStored(input: {
    cycle: DnaCoreRaceHistoryAcquisitionCycle;
    coreId: number;
    pageNumber: number;
    allowQuarantineWrite: boolean;
  }): Promise<DnaCoreRaceHistoryStoredPageEvidence | null> {
    await privateStorage();
    const identity = validateIdentity(input);
    const key = pageObjectKey({
      ownerPrefix: prefix,
      cycleId: identity.cycle.cycleId,
      attemptNumber: identity.cycle.attemptNumber,
      coreId: identity.coreId,
      pageNumber: identity.pageNumber,
    });
    const stored = await readObject(key);
    if (stored === null) return null;
    return assembleStoredPage({
      identity,
      key,
      pageHead: stored.head,
      page: pageDocument({ document: stored.document, expected: identity }),
      allowQuarantineWrite: input.allowQuarantineWrite,
    });
  }

  return Object.freeze({
    read: (request) => readStored({ ...request, allowQuarantineWrite: false }),
    recover: (request) =>
      readStored({ ...request, allowQuarantineWrite: true }),
    async write(request) {
      const identity = validateIdentity(request);
      if (identity.cycle.status !== "running") {
        evidenceError("new evidence requires a running attempt");
      }
      const recovered = await readStored({
        ...identity,
        allowQuarantineWrite: true,
      });
      if (recovered !== null) return recovered;
      const observedAt = canonicalTimestamp(request.observedAt, "observedAt");
      if (Date.parse(observedAt) < Date.parse(identity.cycle.evaluatedAt)) {
        evidenceError("observation predates cycle evaluation");
      }
      const response = normalizedResponse(request.response);
      const key = pageObjectKey({
        ownerPrefix: prefix,
        cycleId: identity.cycle.cycleId,
        attemptNumber: identity.cycle.attemptNumber,
        coreId: identity.coreId,
        pageNumber: identity.pageNumber,
      });
      const page: StoredPageDocument = Object.freeze({
        version: 1,
        source: "dna_open_lab",
        sourceVersion: "core-history-v1",
        cycleId: identity.cycle.cycleId,
        attemptNumber: identity.cycle.attemptNumber,
        coreId: identity.coreId,
        pageNumber: identity.pageNumber,
        observedAt,
        response,
      });
      const object = encodeObject({
        key,
        document: page,
        maximumObjectBytes,
        metadata: Object.freeze({
          "dna-source": "dna_open_lab",
          "dna-version": "core-history-v1",
          "dna-kind": "core_history_page",
          "dna-cycle-id": identity.cycle.cycleId,
          "dna-attempt": String(identity.cycle.attemptNumber),
          "dna-core-sha256": corePrefix(identity.coreId),
          "dna-page": String(identity.pageNumber),
          "dna-observed-at": observedAt,
          "dna-row-count": String(response.result.length),
        }),
      });
      await putObject(object);
      const stored = await readObject(key);
      if (stored === null) evidenceError("page disappeared after publication");
      return assembleStoredPage({
        identity,
        key,
        pageHead: stored.head,
        page: pageDocument({ document: stored.document, expected: identity }),
        allowQuarantineWrite: true,
      });
    },
  });
}
