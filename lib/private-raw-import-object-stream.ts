import { createHash } from "node:crypto";

export const privateRawImportSourceFamilies = [
  "race_merge",
  "core_details",
  "current_vault",
  "current_arena",
] as const;

export type PrivateRawImportSourceFamily =
  (typeof privateRawImportSourceFamilies)[number];

export type PrivateRawImportObjectReference = Readonly<{
  objectId: string;
  sourceFamily: PrivateRawImportSourceFamily;
  expectedByteLength: number;
  expectedSha256: string;
}>;

export type PrivateRawImportObjectStore = Readonly<{
  openObject: (input: { ownerId: string; objectId: string }) => Promise<
    Readonly<{
      advertisedByteLength: number;
      body: AsyncIterable<Uint8Array>;
    }>
  >;
}>;

export type TransactionalRawImportSink<T> = Readonly<{
  beginObject: (input: {
    ownerId: string;
    updateSessionId: string;
    objectId: string;
    sourceFamily: PrivateRawImportSourceFamily;
    expectedByteLength: number;
    expectedSha256: string;
  }) => Promise<
    Readonly<{
      write: (chunk: Uint8Array) => Promise<void>;
      commitVerified: (input: {
        byteLength: number;
        sha256: string;
        chunkCount: number;
      }) => Promise<T>;
      abort: (input: { reason: RawImportObjectFailureCode }) => Promise<void>;
    }>
  >;
}>;

export const rawImportObjectFailureCodes = [
  "advertised_size_mismatch",
  "stream_size_mismatch",
  "checksum_mismatch",
  "chunk_too_large",
  "capacity_exceeded",
  "invalid_chunk",
  "sink_failed",
] as const;

export type RawImportObjectFailureCode =
  (typeof rawImportObjectFailureCodes)[number];

export class RawImportObjectError extends Error {
  readonly code: RawImportObjectFailureCode;

  constructor(code: RawImportObjectFailureCode) {
    super(`Private raw import object failed integrity check: ${code}`);
    this.name = "RawImportObjectError";
    this.code = code;
  }
}

export type VerifiedRawImportObject<T> = Readonly<{
  result: T;
  byteLength: number;
  sha256: string;
  chunkCount: number;
}>;

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const sourceFamilySet = new Set<PrivateRawImportSourceFamily>(
  privateRawImportSourceFamilies,
);

function requireSafeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function requirePositiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function assertObjectReference(
  reference: PrivateRawImportObjectReference,
): void {
  requireSafeIdentifier(reference.objectId, "objectId");
  if (!sourceFamilySet.has(reference.sourceFamily)) {
    throw new Error("sourceFamily is unsupported");
  }
  requirePositiveSafeInteger(
    reference.expectedByteLength,
    "expectedByteLength",
  );
  if (!SHA_256_PATTERN.test(reference.expectedSha256)) {
    throw new Error("expectedSha256 is invalid");
  }
}

function failureCode(error: unknown): RawImportObjectFailureCode {
  return error instanceof RawImportObjectError ? error.code : "sink_failed";
}

export async function streamVerifiedPrivateRawImportObject<T>(
  input: Readonly<{
    ownerId: string;
    updateSessionId: string;
    reference: PrivateRawImportObjectReference;
    maximumObjectBytes: number;
    maximumChunkBytes: number;
    store: PrivateRawImportObjectStore;
    sink: TransactionalRawImportSink<T>;
  }>,
): Promise<VerifiedRawImportObject<T>> {
  const ownerId = requireSafeIdentifier(input.ownerId, "ownerId");
  const updateSessionId = requireSafeIdentifier(
    input.updateSessionId,
    "updateSessionId",
  );
  assertObjectReference(input.reference);
  const maximumObjectBytes = requirePositiveSafeInteger(
    input.maximumObjectBytes,
    "maximumObjectBytes",
  );
  const maximumChunkBytes = requirePositiveSafeInteger(
    input.maximumChunkBytes,
    "maximumChunkBytes",
  );
  if (maximumChunkBytes > maximumObjectBytes) {
    throw new Error("maximumChunkBytes cannot exceed maximumObjectBytes");
  }
  if (input.reference.expectedByteLength > maximumObjectBytes) {
    throw new RawImportObjectError("capacity_exceeded");
  }

  const opened = await input.store.openObject({
    ownerId,
    objectId: input.reference.objectId,
  });
  if (
    !Number.isSafeInteger(opened.advertisedByteLength) ||
    opened.advertisedByteLength < 0 ||
    opened.advertisedByteLength !== input.reference.expectedByteLength
  ) {
    throw new RawImportObjectError("advertised_size_mismatch");
  }

  const activeSink = await input.sink.beginObject({
    ownerId,
    updateSessionId,
    objectId: input.reference.objectId,
    sourceFamily: input.reference.sourceFamily,
    expectedByteLength: input.reference.expectedByteLength,
    expectedSha256: input.reference.expectedSha256,
  });

  const hash = createHash("sha256");
  let byteLength = 0;
  let chunkCount = 0;

  try {
    for await (const chunk of opened.body) {
      if (!(chunk instanceof Uint8Array)) {
        throw new RawImportObjectError("invalid_chunk");
      }
      if (chunk.byteLength === 0) continue;
      if (chunk.byteLength > maximumChunkBytes) {
        throw new RawImportObjectError("chunk_too_large");
      }
      byteLength += chunk.byteLength;
      if (
        !Number.isSafeInteger(byteLength) ||
        byteLength > maximumObjectBytes
      ) {
        throw new RawImportObjectError("capacity_exceeded");
      }
      if (byteLength > input.reference.expectedByteLength) {
        throw new RawImportObjectError("stream_size_mismatch");
      }

      hash.update(chunk);
      await activeSink.write(chunk);
      chunkCount += 1;
    }

    if (byteLength !== input.reference.expectedByteLength) {
      throw new RawImportObjectError("stream_size_mismatch");
    }
    const sha256 = hash.digest("hex");
    if (sha256 !== input.reference.expectedSha256) {
      throw new RawImportObjectError("checksum_mismatch");
    }

    const result = await activeSink.commitVerified({
      byteLength,
      sha256,
      chunkCount,
    });
    return { result, byteLength, sha256, chunkCount };
  } catch (error) {
    try {
      await activeSink.abort({ reason: failureCode(error) });
    } catch {
      // Preserve the original integrity or staging failure.
    }
    throw error;
  }
}
