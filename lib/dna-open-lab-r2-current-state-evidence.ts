import { createHash } from "node:crypto";

import {
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  type DnaCurrentStateAcquisitionGroup,
} from "./dna-open-lab-current-state-acquisition-cadence";
import type { DnaCurrentStateAcquisitionEvidenceReceipt } from "./dna-open-lab-current-state-acquisition-runner";
import type { DnaCurrentStateRequest } from "./dna-open-lab-current-state-sync-plan";
import type { DnaOpenLabResponse } from "./dna-open-lab-v1-client";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const JSON_CONTENT_TYPE = "application/json";
const DEFAULT_MAXIMUM_OBJECT_BYTES = 8 * 1024 * 1024;

export type DnaOpenLabR2CurrentStateEvidenceStoragePort = Pick<
  PrivateDatasetEvidenceObjectStoragePort,
  "readBucketPrivacy" | "putObjectIfAbsent" | "headObject"
>;

export type DnaOpenLabR2CurrentStateEvidenceConfiguration = Readonly<{
  ownerId: string;
  bucketName: string;
  storage: DnaOpenLabR2CurrentStateEvidenceStoragePort;
  maximumObjectBytes?: number;
}>;

function evidenceError(message: string): never {
  throw new Error(`DNA Open Lab R2 current-state evidence: ${message}`);
}

function safeText(value: string, field: string, maximum = 4096): string {
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

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    evidenceError(`${field} must be a positive safe integer`);
  }
  return value;
}

function cycleId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) evidenceError("cycleId is invalid");
  return normalized;
}

function sha256Text(value: string, field: string): string {
  const normalized = value.trim();
  if (!SHA_256_PATTERN.test(normalized)) evidenceError(`${field} is invalid`);
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
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
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

function objectKey(input: {
  ownerPrefix: string;
  cycleId: string;
  requestKey: string;
}): string {
  return [
    "dna-open-lab",
    "v1",
    input.ownerPrefix,
    "current-state",
    "cycles",
    input.cycleId,
    `${input.requestKey}.json`,
  ].join("/");
}

/**
 * Builds an idempotent private evidence callback for the bounded acquisition
 * runner. The object identity is cycle + logical request, not response bytes:
 * if a crash causes the request to replay, the first immutable observation is
 * returned from object metadata instead of silently replacing it.
 */
export function createDnaOpenLabR2CurrentStateEvidenceSink(
  configuration: DnaOpenLabR2CurrentStateEvidenceConfiguration,
): (input: {
  cycleId: string;
  group: DnaCurrentStateAcquisitionGroup;
  requestKey: string;
  request: DnaCurrentStateRequest;
  response: DnaOpenLabResponse<unknown>;
  observedAt: string;
}) => Promise<DnaCurrentStateAcquisitionEvidenceReceipt> {
  const ownerId = safeText(configuration.ownerId, "ownerId", 512);
  const bucketName = safeText(configuration.bucketName, "bucketName", 255);
  const maximumObjectBytes = positiveSafeInteger(
    configuration.maximumObjectBytes ?? DEFAULT_MAXIMUM_OBJECT_BYTES,
    "maximumObjectBytes",
  );
  const prefix = ownerPrefix(ownerId);
  let bucketPrivacy: Promise<void> | null = null;

  return async (input) => {
    bucketPrivacy ??= configuration.storage
      .readBucketPrivacy({ bucketName })
      .then(assertPrivateBucket);
    await bucketPrivacy;

    const normalizedCycleId = cycleId(input.cycleId);
    const requestKey = sha256Text(input.requestKey, "requestKey");
    const observedAt = timestamp(input.observedAt, "observedAt");
    if (!DNA_CURRENT_STATE_ACQUISITION_GROUPS.includes(input.group)) {
      evidenceError("group is invalid");
    }
    const endpoint = safeText(input.request.endpoint, "endpoint", 128);
    const scope = safeText(input.request.scope, "scope", 64);
    const bodyDocument = Object.freeze({
      version: 1,
      source: "dna_open_lab",
      sourceVersion: "v1",
      cycleId: normalizedCycleId,
      group: input.group,
      requestKey,
      observedAt,
      request: input.request,
      response: input.response,
    });
    const canonical = canonicalJson(bodyDocument);
    const body = new TextEncoder().encode(canonical);
    if (body.byteLength < 1 || body.byteLength > maximumObjectBytes) {
      evidenceError("evidence object exceeds its bounded byte capacity");
    }
    const bodySha256 = sha256(canonical);
    const key = objectKey({
      ownerPrefix: prefix,
      cycleId: normalizedCycleId,
      requestKey,
    });
    const metadata = Object.freeze({
      "dna-source": "dna_open_lab",
      "dna-version": "v1",
      "dna-kind": "current_state_request",
      "dna-cycle-id": normalizedCycleId,
      "dna-request-key": requestKey,
      "dna-group": input.group,
      "dna-endpoint": endpoint,
      "dna-scope": scope,
      "dna-observed-at": observedAt,
      "dna-body-sha256": bodySha256,
    });

    const put = await configuration.storage.putObjectIfAbsent({
      bucketName,
      key,
      body: oneChunk(body),
      contentType: JSON_CONTENT_TYPE,
      byteLength: body.byteLength,
      checksumSha256: bodySha256,
      metadata,
    });
    const head = await configuration.storage.headObject({ bucketName, key });
    if (head.status !== "ready" || head.contentType !== JSON_CONTENT_TYPE) {
      evidenceError("evidence object is unavailable after publication");
    }
    const storedCycleId = metadataValue(head.metadata, "dna-cycle-id");
    const storedRequestKey = metadataValue(head.metadata, "dna-request-key");
    const storedObservedAt = timestamp(
      metadataValue(head.metadata, "dna-observed-at"),
      "stored observedAt",
    );
    const storedBodySha256 = sha256Text(
      metadataValue(head.metadata, "dna-body-sha256"),
      "stored body checksum",
    );
    const identityMetadata = {
      "dna-source": metadata["dna-source"],
      "dna-version": metadata["dna-version"],
      "dna-kind": metadata["dna-kind"],
      "dna-cycle-id": metadata["dna-cycle-id"],
      "dna-request-key": metadata["dna-request-key"],
      "dna-group": metadata["dna-group"],
      "dna-endpoint": metadata["dna-endpoint"],
      "dna-scope": metadata["dna-scope"],
    };
    if (
      storedCycleId !== normalizedCycleId ||
      storedRequestKey !== requestKey ||
      head.checksumSha256 !== storedBodySha256 ||
      head.byteLength < 1 ||
      head.byteLength > maximumObjectBytes ||
      Object.entries(identityMetadata).some(
        ([name, value]) => metadataValue(head.metadata, name) !== value,
      ) ||
      (put.status === "created" &&
        (head.byteLength !== body.byteLength ||
          storedBodySha256 !== bodySha256 ||
          Object.entries(metadata).some(
            ([name, value]) => metadataValue(head.metadata, name) !== value,
          )))
    ) {
      evidenceError("evidence object integrity does not match publication");
    }
    return Object.freeze({
      requestKey,
      observedAt: storedObservedAt,
      contentSha256: storedBodySha256,
      evidenceObjectKey: key,
    });
  };
}
