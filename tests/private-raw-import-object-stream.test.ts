import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  RawImportObjectError,
  streamVerifiedPrivateRawImportObject,
  type PrivateRawImportObjectReference,
  type PrivateRawImportObjectStore,
  type RawImportObjectFailureCode,
  type TransactionalRawImportSink,
} from "@/lib/private-raw-import-object-stream";

const encoder = new TextEncoder();

function sha256(...chunks: readonly Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest("hex");
}

async function* chunks(
  ...values: readonly (Uint8Array | unknown)[]
): AsyncIterable<Uint8Array> {
  for (const value of values) yield value as Uint8Array;
}

function services(
  bodyChunks: readonly (Uint8Array | unknown)[],
  advertisedByteLength: number,
) {
  const store: PrivateRawImportObjectStore = {
    openObject: vi.fn(async () => ({
      advertisedByteLength,
      body: chunks(...bodyChunks),
    })),
  };
  const write = vi
    .fn<(chunk: Uint8Array) => Promise<void>>()
    .mockResolvedValue(undefined);
  const commitVerified = vi
    .fn<
      (input: {
        byteLength: number;
        sha256: string;
        chunkCount: number;
      }) => Promise<string>
    >()
    .mockResolvedValue("synthetic-prepared-file");
  const abort = vi
    .fn<(input: { reason: RawImportObjectFailureCode }) => Promise<void>>()
    .mockResolvedValue(undefined);
  const sink: TransactionalRawImportSink<string> = {
    beginObject: vi.fn(async () => ({
      write,
      commitVerified,
      abort,
    })),
  };
  return { store, sink, write, commitVerified, abort };
}

function reference(
  bodyChunks: readonly Uint8Array[],
  overrides: Partial<PrivateRawImportObjectReference> = {},
): PrivateRawImportObjectReference {
  return {
    objectId: "synthetic-object",
    sourceFamily: "race_merge",
    expectedByteLength: bodyChunks.reduce(
      (total, chunk) => total + chunk.byteLength,
      0,
    ),
    expectedSha256: sha256(...bodyChunks),
    ...overrides,
  };
}

function input(
  servicesValue: ReturnType<typeof services>,
  objectReference: PrivateRawImportObjectReference,
) {
  return {
    ownerId: "synthetic-owner",
    updateSessionId: "synthetic-session",
    reference: objectReference,
    maximumObjectBytes: 1_024,
    maximumChunkBytes: 64,
    store: servicesValue.store,
    sink: servicesValue.sink,
  };
}

describe("private raw import object streaming", () => {
  it("streams with backpressure and commits only an exact verified object", async () => {
    const bodyChunks = [
      encoder.encode("event_id,core_id\n"),
      encoder.encode("event-1,core-1\n"),
    ];
    const objectReference = reference(bodyChunks);
    const service = services(bodyChunks, objectReference.expectedByteLength);

    await expect(
      streamVerifiedPrivateRawImportObject(input(service, objectReference)),
    ).resolves.toEqual({
      result: "synthetic-prepared-file",
      byteLength: objectReference.expectedByteLength,
      sha256: objectReference.expectedSha256,
      chunkCount: 2,
    });
    expect(service.store.openObject).toHaveBeenCalledWith({
      ownerId: "synthetic-owner",
      objectId: "synthetic-object",
    });
    expect(service.sink.beginObject).toHaveBeenCalledWith({
      ownerId: "synthetic-owner",
      updateSessionId: "synthetic-session",
      objectId: "synthetic-object",
      sourceFamily: "race_merge",
      expectedByteLength: objectReference.expectedByteLength,
      expectedSha256: objectReference.expectedSha256,
    });
    expect(service.write.mock.calls.map(([chunk]) => chunk)).toEqual(
      bodyChunks,
    );
    expect(service.commitVerified).toHaveBeenCalledWith({
      byteLength: objectReference.expectedByteLength,
      sha256: objectReference.expectedSha256,
      chunkCount: 2,
    });
    expect(service.abort).not.toHaveBeenCalled();
  });

  it("rejects an advertised-size mismatch before staging begins", async () => {
    const bodyChunks = [encoder.encode("synthetic")];
    const objectReference = reference(bodyChunks);
    const service = services(
      bodyChunks,
      objectReference.expectedByteLength + 1,
    );

    await expect(
      streamVerifiedPrivateRawImportObject(input(service, objectReference)),
    ).rejects.toMatchObject({ code: "advertised_size_mismatch" });
    expect(service.sink.beginObject).not.toHaveBeenCalled();
  });

  it("aborts staging when the streamed byte length is incomplete", async () => {
    const expectedChunks = [encoder.encode("complete source")];
    const actualChunks = [encoder.encode("short")];
    const objectReference = reference(expectedChunks);
    const service = services(actualChunks, objectReference.expectedByteLength);

    await expect(
      streamVerifiedPrivateRawImportObject(input(service, objectReference)),
    ).rejects.toMatchObject({ code: "stream_size_mismatch" });
    expect(service.abort).toHaveBeenCalledWith({
      reason: "stream_size_mismatch",
    });
    expect(service.commitVerified).not.toHaveBeenCalled();
  });

  it("aborts staging when the exact checksum does not match", async () => {
    const actualChunks = [encoder.encode("same bytes")];
    const objectReference = reference(actualChunks, {
      expectedSha256: "a".repeat(64),
    });
    const service = services(actualChunks, objectReference.expectedByteLength);

    await expect(
      streamVerifiedPrivateRawImportObject(input(service, objectReference)),
    ).rejects.toMatchObject({ code: "checksum_mismatch" });
    expect(service.abort).toHaveBeenCalledWith({
      reason: "checksum_mismatch",
    });
    expect(service.commitVerified).not.toHaveBeenCalled();
  });

  it("enforces per-chunk and total object capacity limits", async () => {
    const oversizedChunk = new Uint8Array(65);
    const oversizedReference = reference([oversizedChunk]);
    const oversizedService = services(
      [oversizedChunk],
      oversizedReference.expectedByteLength,
    );
    await expect(
      streamVerifiedPrivateRawImportObject(
        input(oversizedService, oversizedReference),
      ),
    ).rejects.toMatchObject({ code: "chunk_too_large" });
    expect(oversizedService.abort).toHaveBeenCalledWith({
      reason: "chunk_too_large",
    });

    const withinChunkLimit = new Uint8Array(16);
    const capacityReference = reference([withinChunkLimit], {
      expectedByteLength: 2_048,
    });
    const capacityService = services([withinChunkLimit], 2_048);
    await expect(
      streamVerifiedPrivateRawImportObject(
        input(capacityService, capacityReference),
      ),
    ).rejects.toMatchObject({ code: "capacity_exceeded" });
    expect(capacityService.store.openObject).not.toHaveBeenCalled();
  });

  it("rejects non-byte chunks and never verifies them", async () => {
    const expected = [encoder.encode("synthetic")];
    const objectReference = reference(expected);
    const service = services(["not-bytes"], objectReference.expectedByteLength);

    await expect(
      streamVerifiedPrivateRawImportObject(input(service, objectReference)),
    ).rejects.toMatchObject({ code: "invalid_chunk" });
    expect(service.abort).toHaveBeenCalledWith({ reason: "invalid_chunk" });
    expect(service.commitVerified).not.toHaveBeenCalled();
  });

  it("aborts prepared staging when the transactional sink fails", async () => {
    const bodyChunks = [encoder.encode("synthetic")];
    const objectReference = reference(bodyChunks);
    const service = services(bodyChunks, objectReference.expectedByteLength);
    service.write.mockRejectedValueOnce(new Error("synthetic sink failure"));

    await expect(
      streamVerifiedPrivateRawImportObject(input(service, objectReference)),
    ).rejects.toMatchObject({
      code: "sink_failed",
      message: expect.not.stringContaining("synthetic sink failure"),
    });
    expect(service.abort).toHaveBeenCalledWith({ reason: "sink_failed" });
    expect(service.commitVerified).not.toHaveBeenCalled();
  });

  it("canonicalizes the persisted object identity before provider use", async () => {
    const bodyChunks = [encoder.encode("synthetic")];
    const objectReference = reference(bodyChunks, {
      objectId: " synthetic-object ",
    });
    const service = services(bodyChunks, objectReference.expectedByteLength);

    await streamVerifiedPrivateRawImportObject(input(service, objectReference));

    expect(service.store.openObject).toHaveBeenCalledWith({
      ownerId: "synthetic-owner",
      objectId: "synthetic-object",
    });
    expect(service.sink.beginObject).toHaveBeenCalledWith(
      expect.objectContaining({ objectId: "synthetic-object" }),
    );
  });

  it("redacts storage failures before staging begins", async () => {
    const bodyChunks = [encoder.encode("synthetic")];
    const objectReference = reference(bodyChunks);
    const service = services(bodyChunks, objectReference.expectedByteLength);
    vi.mocked(service.store.openObject).mockRejectedValueOnce(
      new Error("private provider detail"),
    );

    await expect(
      streamVerifiedPrivateRawImportObject(input(service, objectReference)),
    ).rejects.toMatchObject({
      code: "store_failed",
      message: expect.not.stringContaining("private provider detail"),
    });
    expect(service.sink.beginObject).not.toHaveBeenCalled();
  });

  it("rejects a malformed storage stream before staging begins", async () => {
    const bodyChunks = [encoder.encode("synthetic")];
    const objectReference = reference(bodyChunks);
    const service = services(bodyChunks, objectReference.expectedByteLength);
    vi.mocked(service.store.openObject).mockResolvedValueOnce({
      advertisedByteLength: objectReference.expectedByteLength,
      body: null as unknown as AsyncIterable<Uint8Array>,
    });

    await expect(
      streamVerifiedPrivateRawImportObject(input(service, objectReference)),
    ).rejects.toMatchObject({ code: "invalid_stream" });
    expect(service.sink.beginObject).not.toHaveBeenCalled();
  });

  it("fails closed on unsafe identities and invalid manifest evidence", async () => {
    const bodyChunks = [encoder.encode("synthetic")];
    const objectReference = reference(bodyChunks);
    const service = services(bodyChunks, objectReference.expectedByteLength);

    await expect(
      streamVerifiedPrivateRawImportObject({
        ...input(service, objectReference),
        ownerId: "../unsafe",
      }),
    ).rejects.toThrow("ownerId");
    await expect(
      streamVerifiedPrivateRawImportObject(
        input(service, {
          ...objectReference,
          expectedSha256: objectReference.expectedSha256.toUpperCase(),
        }),
      ),
    ).rejects.toThrow("expectedSha256");
    await expect(
      streamVerifiedPrivateRawImportObject({
        ...input(service, objectReference),
        maximumChunkBytes: 2_048,
      }),
    ).rejects.toThrow("maximumChunkBytes");

    expect(new RawImportObjectError("checksum_mismatch").message).not.toContain(
      "synthetic",
    );
  });
});
