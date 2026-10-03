import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

import {
  beginPrivateImportUpload,
  type ImportUploadIntakeCapabilities,
} from "./import-upload-intake-service";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const NONCE_PATTERN = /^[a-f0-9]{64}$/u;
const MAXIMUM_ENCRYPTED_PAYLOAD_CHARACTERS = 4096;
const MAXIMUM_FILE_BYTES = 100_000_000;
const SOURCE_COUNT = 8;
const TARGET_LIFETIME_MILLISECONDS = 15 * 60 * 1000;
const DOMAIN = "dna-race-merge-source-evidence-bridge/v1";

type BridgePayload = Readonly<{
  head: string;
  ordinal: number;
  byteLength: number;
  sha256: string;
}>;

export type RaceMergeSourceEvidenceBridgeResult =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      objectId: string;
      targetToken: string;
      expiresAt: string;
    }>;

function bridgeError(message: string): never {
  throw new Error(`Race Merge source evidence bridge: ${message}`);
}

function decodeBase64Url(value: string): Buffer {
  if (
    value.length < 40 ||
    value.length > MAXIMUM_ENCRYPTED_PAYLOAD_CHARACTERS ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    bridgeError("encrypted payload is invalid");
  }
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return bridgeError("encrypted payload is invalid");
  }
}

function parsePayload(input: {
  encryptedPayload: string;
  bridgeNonce: string;
  exactDeploymentSha: string;
}): BridgePayload {
  const nonce = input.bridgeNonce.trim().toLowerCase();
  const exactDeploymentSha = input.exactDeploymentSha.trim().toLowerCase();
  if (!NONCE_PATTERN.test(nonce) || !GIT_SHA_PATTERN.test(exactDeploymentSha)) {
    bridgeError("authority is invalid");
  }
  const encrypted = decodeBase64Url(input.encryptedPayload);
  if (encrypted.byteLength <= 28) bridgeError("encrypted payload is invalid");
  const iv = encrypted.subarray(0, 12);
  const tag = encrypted.subarray(encrypted.byteLength - 16);
  const ciphertext = encrypted.subarray(12, encrypted.byteLength - 16);
  const key = createHash("sha256")
    .update(`${DOMAIN}\u0000${nonce}`)
    .digest();
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
  } catch {
    return bridgeError("encrypted payload authentication failed");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString("utf8"));
  } catch {
    return bridgeError("payload is invalid");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    bridgeError("payload is invalid");
  }
  const value = parsed as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !==
    "byteLength,head,ordinal,sha256"
  ) {
    bridgeError("payload shape is invalid");
  }
  const head =
    typeof value.head === "string" ? value.head.trim().toLowerCase() : "";
  const sha256 =
    typeof value.sha256 === "string" ? value.sha256.trim().toLowerCase() : "";
  if (
    !GIT_SHA_PATTERN.test(head) ||
    !timingSafeEqual(Buffer.from(head), Buffer.from(exactDeploymentSha)) ||
    !Number.isSafeInteger(value.ordinal) ||
    (value.ordinal as number) < 1 ||
    (value.ordinal as number) > SOURCE_COUNT ||
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) < 1 ||
    (value.byteLength as number) > MAXIMUM_FILE_BYTES ||
    !SHA_256_PATTERN.test(sha256)
  ) {
    bridgeError("payload authority is invalid");
  }
  return Object.freeze({
    head,
    ordinal: value.ordinal as number,
    byteLength: value.byteLength as number,
    sha256,
  });
}

export async function createRaceMergeSourceEvidenceUploadTarget(input: Readonly<{
  encryptedPayload: string;
  bridgeNonce: string;
  exactDeploymentSha: string;
  ownerId: string;
  now: Date;
  capabilities: ImportUploadIntakeCapabilities;
}>): Promise<RaceMergeSourceEvidenceBridgeResult> {
  const ownerId = input.ownerId.trim();
  if (ownerId.length < 1 || ownerId.length > 512) {
    bridgeError("owner authority is invalid");
  }
  if (input.capabilities.status === "not_configured") {
    return Object.freeze({ status: "not_configured" as const });
  }
  const payload = parsePayload(input);
  const ordinal = String(payload.ordinal).padStart(2, "0");
  const prefix = "race-merge-outcome-source-v1";
  const result = await beginPrivateImportUpload({
    authenticatedOwnerId: ownerId,
    configuredOwnerId: ownerId,
    idempotencyKey: `${prefix}-${ordinal}-${payload.sha256.slice(0, 32)}`,
    files: [
      {
        clientFileId: `${prefix}-${ordinal}-${payload.sha256.slice(0, 16)}`,
        sourceFamily: "race_merge",
        originalFileName: `race-merge-source-${ordinal}.csv`,
        contentType: "text/csv",
        byteLength: payload.byteLength,
        sha256: payload.sha256,
      },
    ],
    now: input.now,
    targetLifetimeMilliseconds: TARGET_LIFETIME_MILLISECONDS,
    capabilities: input.capabilities,
  });
  if (result.status !== "ready") {
    return Object.freeze({ status: "not_configured" as const });
  }
  if (result.targets.length !== 1 || result.targets[0] === undefined) {
    bridgeError("private target set is inconsistent");
  }
  return Object.freeze({
    status: "ready" as const,
    objectId: result.targets[0].uploadFileId,
    targetToken: result.targets[0].targetToken,
    expiresAt: result.expiresAt,
  });
}
