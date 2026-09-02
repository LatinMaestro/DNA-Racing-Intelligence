import { createHash } from "node:crypto";

import type { DnaOpenLabP5FirstBackfillApprovalPacket } from "./dna-open-lab-p5-first-backfill-approval";
import { DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY } from "./dna-open-lab-p5-first-backfill-projection-policy";
import type { DnaOpenLabP5FirstBackfillSourceFamily } from "./dna-open-lab-p5-first-backfill-measurement";
import type { DnaOpenLabResponse } from "./dna-open-lab-v1-client";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const JSON_CONTENT_TYPE = "application/json";

export type DnaOpenLabP5FirstBackfillR2EvidenceStoragePort = Pick<
  PrivateDatasetEvidenceObjectStoragePort,
  "readBucketPrivacy" | "putObjectIfAbsent" | "headObject"
>;

export type DnaOpenLabP5FirstBackfillEvidenceReceipt = Readonly<{
  family: DnaOpenLabP5FirstBackfillSourceFamily;
  requestOrdinal: number;
  observedAt: string;
  contentSha256: string;
  byteLength: number;
  evidenceObjectKey: string;
}>;

export type DnaOpenLabP5FirstBackfillEvidenceUsage = Readonly<{
  logicalRequestCount: number;
  retainedR2Bytes: number;
  logicalRequestLimit: number;
  retainedR2BytesLimit: number;
}>;

export type DnaOpenLabP5FirstBackfillEvidenceWriter = Readonly<{
  write: (input: {
    family: DnaOpenLabP5FirstBackfillSourceFamily;
    requestOrdinal: number;
    endpoint: string;
    request: unknown;
    response: DnaOpenLabResponse<unknown>;
    observedAt: string;
  }) => Promise<DnaOpenLabP5FirstBackfillEvidenceReceipt>;
  usage: () => DnaOpenLabP5FirstBackfillEvidenceUsage;
}>;

const SOURCE_FAMILIES = new Set<DnaOpenLabP5FirstBackfillSourceFamily>([
  "finished_races",
  "race_activity",
  "token_prices",
  "vault_identity",
  "core_current_state",
  "splice_arena",
]);

function evidenceError(message: string): never {
  throw new Error(`DNA Open Lab P5 first backfill R2 evidence: ${message}`);
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

function timestamp(value: string, field: string): string {
  const normalized = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    ) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    evidenceError(`${field} must be a timezone-qualified ISO timestamp`);
  }
  return new Date(normalized).toISOString();
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    evidenceError(`${field} must be a positive safe integer`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      evidenceError("evidence contains a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return evidenceError("evidence contains a non-JSON value");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function ownerPrefix(ownerId: string): string {
  return createHash("sha256")
    .update(`dna-open-lab-owner\u0000${ownerId}`, "utf8")
    .digest("hex");
}

function oneChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield bytes;
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
  key: string,
): string {
  const value = metadata[key];
  if (typeof value !== "string" || value.trim() === "") {
    evidenceError(`evidence object metadata ${key} is unavailable`);
  }
  return value;
}

function approvedLimits(packet: DnaOpenLabP5FirstBackfillApprovalPacket): {
  measurementEvidenceSha256: string;
  logicalRequestLimit: number;
  retainedR2BytesLimit: number;
} {
  if (
    packet.status !== "approved_for_first_private_preview_backfill" ||
    packet.firstPersistentPrivatePreviewBackfillAllowed !== true ||
    packet.productionChangesAllowed !== false ||
    packet.measuredUpperBound === null ||
    packet.identityOmissionAuthority === null ||
    packet.ownerAuthorization === null ||
    packet.ownerAuthorization.maximumAuthorizedMicroUsd <
      packet.measuredUpperBound.projectedCostMicroUsd
  ) {
    evidenceError("bounded private Preview approval is unavailable");
  }
  const policy = DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY;
  if (
    packet.measuredUpperBound.classBOperationsUpperBound %
      policy.r2ClassBOperationsPerLogicalRequest !==
    0
  ) {
    evidenceError("measured Class B bound cannot identify logical requests");
  }
  const logicalRequestLimit =
    packet.measuredUpperBound.classBOperationsUpperBound /
    policy.r2ClassBOperationsPerLogicalRequest;
  if (
    logicalRequestLimit * policy.apiRequestAttemptsPerLogicalRequest !==
    packet.measuredUpperBound.apiRequestUpperBound
  ) {
    evidenceError("measured API and evidence-object bounds disagree");
  }
  return {
    measurementEvidenceSha256:
      packet.identityOmissionAuthority.measurementEvidenceSha256,
    logicalRequestLimit,
    retainedR2BytesLimit: packet.measuredUpperBound.retainedR2BytesUpperBound,
  };
}

function objectKey(input: {
  ownerPrefix: string;
  measurementEvidenceSha256: string;
  requestOrdinal: number;
}): string {
  return [
    "dna-open-lab",
    "v1",
    input.ownerPrefix,
    "first-private-preview-backfill",
    input.measurementEvidenceSha256,
    "requests",
    `${String(input.requestOrdinal).padStart(6, "0")}.json`,
  ].join("/");
}

function validateReceipt(input: {
  receipt: DnaOpenLabP5FirstBackfillEvidenceReceipt;
  ownerPrefix: string;
  measurementEvidenceSha256: string;
  logicalRequestLimit: number;
}): DnaOpenLabP5FirstBackfillEvidenceReceipt {
  if (!SOURCE_FAMILIES.has(input.receipt.family)) {
    evidenceError("prior receipt family is invalid");
  }
  const requestOrdinal = positiveSafeInteger(
    input.receipt.requestOrdinal,
    "prior receipt requestOrdinal",
  );
  if (requestOrdinal > input.logicalRequestLimit) {
    evidenceError("prior receipt exceeds the measured logical-request bound");
  }
  if (!SHA_256_PATTERN.test(input.receipt.contentSha256)) {
    evidenceError("prior receipt contentSha256 is invalid");
  }
  const byteLength = positiveSafeInteger(
    input.receipt.byteLength,
    "prior receipt byteLength",
  );
  if (
    byteLength >
    DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY.r2MaximumEvidenceObjectBytes
  ) {
    evidenceError("prior receipt exceeds the measured object-byte bound");
  }
  const expectedKey = objectKey({
    ownerPrefix: input.ownerPrefix,
    measurementEvidenceSha256: input.measurementEvidenceSha256,
    requestOrdinal,
  });
  if (input.receipt.evidenceObjectKey !== expectedKey) {
    evidenceError("prior receipt object key does not match its identity");
  }
  return Object.freeze({
    ...input.receipt,
    requestOrdinal,
    observedAt: timestamp(input.receipt.observedAt, "prior receipt observedAt"),
    byteLength,
  });
}

/**
 * Persists exactly one immutable private R2 object per measured logical API
 * request. This is the cost boundary priced by run 33574168582: the complete
 * response remains recoverable from R2, while per-race object expansion is
 * deliberately prohibited.
 */
export function createDnaOpenLabP5FirstBackfillR2EvidenceWriter(input: {
  ownerId: string;
  bucketName: string;
  storage: DnaOpenLabP5FirstBackfillR2EvidenceStoragePort;
  approvalPacket: DnaOpenLabP5FirstBackfillApprovalPacket;
  priorReceipts?: readonly DnaOpenLabP5FirstBackfillEvidenceReceipt[];
}): DnaOpenLabP5FirstBackfillEvidenceWriter {
  const ownerId = safeText(input.ownerId, "ownerId", 512);
  const bucketName = safeText(input.bucketName, "bucketName", 255);
  const prefix = ownerPrefix(ownerId);
  const limits = approvedLimits(input.approvalPacket);
  const receipts = new Map<number, DnaOpenLabP5FirstBackfillEvidenceReceipt>();
  let retainedR2Bytes = 0;
  for (const candidate of input.priorReceipts ?? []) {
    const receipt = validateReceipt({
      receipt: candidate,
      ownerPrefix: prefix,
      measurementEvidenceSha256: limits.measurementEvidenceSha256,
      logicalRequestLimit: limits.logicalRequestLimit,
    });
    if (receipts.has(receipt.requestOrdinal)) {
      evidenceError("prior receipts repeat a logical request ordinal");
    }
    receipts.set(receipt.requestOrdinal, receipt);
    retainedR2Bytes += receipt.byteLength;
    if (
      !Number.isSafeInteger(retainedR2Bytes) ||
      retainedR2Bytes > limits.retainedR2BytesLimit
    ) {
      evidenceError("prior receipts exceed the measured retained-byte bound");
    }
  }
  let bucketPrivacy: Promise<void> | null = null;

  async function write(value: {
    family: DnaOpenLabP5FirstBackfillSourceFamily;
    requestOrdinal: number;
    endpoint: string;
    request: unknown;
    response: DnaOpenLabResponse<unknown>;
    observedAt: string;
  }): Promise<DnaOpenLabP5FirstBackfillEvidenceReceipt> {
    bucketPrivacy ??= input.storage
      .readBucketPrivacy({ bucketName })
      .then(assertPrivateBucket);
    await bucketPrivacy;

    if (!SOURCE_FAMILIES.has(value.family)) evidenceError("family is invalid");
    const requestOrdinal = positiveSafeInteger(
      value.requestOrdinal,
      "requestOrdinal",
    );
    if (requestOrdinal > limits.logicalRequestLimit) {
      evidenceError("logical request exceeds the measured request bound");
    }
    const endpoint = safeText(value.endpoint, "endpoint", 128);
    const observedAt = timestamp(value.observedAt, "observedAt");
    const document = Object.freeze({
      version: 1,
      source: "dna_open_lab",
      sourceVersion: "v1",
      measurementEvidenceSha256: limits.measurementEvidenceSha256,
      requestOrdinal,
      family: value.family,
      endpoint,
      observedAt,
      request: value.request,
      response: value.response,
    });
    const canonical = canonicalJson(document);
    const responseResult = canonicalJson(value.response.result);
    const body = new TextEncoder().encode(canonical);
    const resultBytes = Buffer.byteLength(responseResult, "utf8");
    const policy = DNA_OPEN_LAB_P5_FIRST_BACKFILL_PROJECTION_POLICY;
    if (
      body.byteLength < 1 ||
      body.byteLength > policy.r2MaximumEvidenceObjectBytes
    ) {
      evidenceError("evidence object exceeds its bounded byte capacity");
    }
    if (
      body.byteLength - resultBytes >
      policy.r2EvidenceEnvelopeBytesPerLogicalRequest
    ) {
      evidenceError("evidence envelope exceeds the measured allowance");
    }
    const contentSha256 = sha256(canonical);
    const key = objectKey({
      ownerPrefix: prefix,
      measurementEvidenceSha256: limits.measurementEvidenceSha256,
      requestOrdinal,
    });
    const metadata = Object.freeze({
      "dna-source": "dna_open_lab",
      "dna-version": "v1",
      "dna-kind": "first_private_preview_backfill_request",
      "dna-measurement-sha256": limits.measurementEvidenceSha256,
      "dna-request-ordinal": String(requestOrdinal),
      "dna-family": value.family,
      "dna-endpoint": endpoint,
      "dna-observed-at": observedAt,
      "dna-body-sha256": contentSha256,
    });
    const prior = receipts.get(requestOrdinal);
    if (
      prior !== undefined &&
      (prior.family !== value.family ||
        prior.observedAt !== observedAt ||
        prior.contentSha256 !== contentSha256 ||
        prior.byteLength !== body.byteLength ||
        prior.evidenceObjectKey !== key)
    ) {
      evidenceError("logical request conflicts with its prior receipt");
    }
    if (
      prior === undefined &&
      retainedR2Bytes + body.byteLength > limits.retainedR2BytesLimit
    ) {
      evidenceError("write would exceed the measured retained-byte bound");
    }

    let head = await input.storage.headObject({ bucketName, key });
    if (head.status === "missing") {
      await input.storage.putObjectIfAbsent({
        bucketName,
        key,
        body: oneChunk(body),
        contentType: JSON_CONTENT_TYPE,
        byteLength: body.byteLength,
        checksumSha256: contentSha256,
        metadata,
      });
      head = await input.storage.headObject({ bucketName, key });
    }
    if (
      head.status !== "ready" ||
      head.contentType !== JSON_CONTENT_TYPE ||
      head.byteLength !== body.byteLength ||
      head.checksumSha256 !== contentSha256 ||
      Object.entries(metadata).some(
        ([name, expected]) => metadataValue(head.metadata, name) !== expected,
      )
    ) {
      evidenceError("evidence object conflicts with immutable publication");
    }
    const receipt = Object.freeze({
      family: value.family,
      requestOrdinal,
      observedAt,
      contentSha256,
      byteLength: body.byteLength,
      evidenceObjectKey: key,
    });
    if (prior === undefined) {
      receipts.set(requestOrdinal, receipt);
      retainedR2Bytes += body.byteLength;
    }
    return receipt;
  }

  return Object.freeze({
    write,
    usage: () =>
      Object.freeze({
        logicalRequestCount: receipts.size,
        retainedR2Bytes,
        logicalRequestLimit: limits.logicalRequestLimit,
        retainedR2BytesLimit: limits.retainedR2BytesLimit,
      }),
  });
}
