import { describe, expect, it, vi } from "vitest";

import {
  prepareImportUploadFiles,
  type IncrementalSha256,
  type SelectedImportUploadFile,
} from "../lib/import-file-preparation-client";

const CHUNK_BYTES = 64 * 1024;

function selection(
  overrides: Partial<SelectedImportUploadFile> = {},
): SelectedImportUploadFile {
  return {
    clientFileId: "client-file-1",
    sourceFamily: "race_merge",
    originalFileName: "synthetic-race.csv",
    contentType: "text/csv",
    body: new Blob([new Uint8Array(CHUNK_BYTES * 2 + 7)]),
    ...overrides,
  };
}

function hasher(digest = "a".repeat(64)) {
  const update = vi.fn<IncrementalSha256["update"]>(async () => undefined);
  const digestHex = vi.fn<IncrementalSha256["digestHex"]>(async () => digest);
  return {
    value: { update, digestHex } satisfies IncrementalSha256,
    update,
    digestHex,
  };
}

describe("import file preparation client", () => {
  it("hashes one selected Blob in bounded sequential chunks", async () => {
    const hash = hasher();
    const onProgress = vi.fn();
    const selected = selection();

    await expect(
      prepareImportUploadFiles({
        selections: [selected],
        chunkByteLength: CHUNK_BYTES,
        createSha256: () => hash.value,
        onProgress,
      }),
    ).resolves.toEqual({
      candidates: [
        {
          clientFileId: "client-file-1",
          sourceFamily: "race_merge",
          originalFileName: "synthetic-race.csv",
          contentType: "text/csv",
          byteLength: CHUNK_BYTES * 2 + 7,
          sha256: "a".repeat(64),
        },
      ],
      files: [{ clientFileId: "client-file-1", body: selected.body }],
    });

    expect(hash.update).toHaveBeenCalledTimes(3);
    expect(hash.update.mock.calls.map(([chunk]) => chunk.byteLength)).toEqual([
      CHUNK_BYTES,
      CHUNK_BYTES,
      7,
    ]);
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      {
        clientFileId: "client-file-1",
        processedByteLength: CHUNK_BYTES,
        totalByteLength: CHUNK_BYTES * 2 + 7,
      },
      {
        clientFileId: "client-file-1",
        processedByteLength: CHUNK_BYTES * 2,
        totalByteLength: CHUNK_BYTES * 2 + 7,
      },
      {
        clientFileId: "client-file-1",
        processedByteLength: CHUNK_BYTES * 2 + 7,
        totalByteLength: CHUNK_BYTES * 2 + 7,
      },
    ]);
    expect(hash.digestHex).toHaveBeenCalledOnce();
  });

  it("creates a separate incremental hash state for each selected file", async () => {
    const first = hasher("a".repeat(64));
    const second = hasher("b".repeat(64));
    const states = [first.value, second.value];
    const createSha256 = vi.fn(() => states.shift()!);

    const result = await prepareImportUploadFiles({
      selections: [
        selection({ body: new Blob(["one"]) }),
        selection({
          clientFileId: "client-file-2",
          originalFileName: "synthetic-race-2.csv",
          body: new Blob(["two"]),
        }),
      ],
      chunkByteLength: CHUNK_BYTES,
      createSha256,
    });

    expect(createSha256).toHaveBeenCalledTimes(2);
    expect(result.candidates.map(({ sha256 }) => sha256)).toEqual([
      "a".repeat(64),
      "b".repeat(64),
    ]);
  });

  it("normalizes private filename and content-type metadata", async () => {
    const hash = hasher("A".repeat(64));

    const result = await prepareImportUploadFiles({
      selections: [
        selection({
          originalFileName: "  synthetic-core.csv  ",
          contentType: " TEXT/CSV; charset=windows-1252 ",
          sourceFamily: "core_details",
          body: new Blob(["core"]),
        }),
      ],
      chunkByteLength: CHUNK_BYTES,
      createSha256: () => hash.value,
    });

    expect(result.candidates[0]).toMatchObject({
      originalFileName: "synthetic-core.csv",
      contentType: "text/csv",
      sha256: "a".repeat(64),
    });
  });

  it("rejects duplicate file IDs and competing replacement snapshots before reading", async () => {
    const hash = hasher();
    const createSha256 = vi.fn(() => hash.value);

    await expect(
      prepareImportUploadFiles({
        selections: [
          selection({ sourceFamily: "current_arena" }),
          selection({
            clientFileId: "client-file-2",
            originalFileName: "synthetic-arena-2.csv",
            sourceFamily: "current_arena",
          }),
        ],
        chunkByteLength: CHUNK_BYTES,
        createSha256,
      }),
    ).rejects.toThrow("one replacement candidate");

    expect(createSha256).not.toHaveBeenCalled();
  });

  it("rejects the retired Current Vault source and more than eight files before reading", async () => {
    const hash = hasher();
    const createSha256 = vi.fn(() => hash.value);

    await expect(
      prepareImportUploadFiles({
        selections: [selection({ sourceFamily: "current_vault" as never })],
        chunkByteLength: CHUNK_BYTES,
        createSha256,
      }),
    ).rejects.toThrow("sourceFamily is invalid");

    await expect(
      prepareImportUploadFiles({
        selections: Array.from({ length: 9 }, (_, index) =>
          selection({
            clientFileId: `race-${index + 1}`,
            originalFileName: `synthetic-race-${index + 1}.csv`,
          }),
        ),
        chunkByteLength: CHUNK_BYTES,
        createSha256,
      }),
    ).rejects.toThrow("between 1 and 8 selections");
    expect(createSha256).not.toHaveBeenCalled();
  });

  it("rejects empty files and unsafe chunk boundaries", async () => {
    const hash = hasher();

    await expect(
      prepareImportUploadFiles({
        selections: [selection({ body: new Blob([]) })],
        chunkByteLength: CHUNK_BYTES,
        createSha256: () => hash.value,
      }),
    ).rejects.toThrow("file size");

    await expect(
      prepareImportUploadFiles({
        selections: [selection()],
        chunkByteLength: CHUNK_BYTES - 1,
        createSha256: () => hash.value,
      }),
    ).rejects.toThrow("chunkByteLength");
  });

  it("rejects an invalid digest from the incremental implementation", async () => {
    const hash = hasher("not-a-digest");

    await expect(
      prepareImportUploadFiles({
        selections: [selection({ body: new Blob(["data"]) })],
        chunkByteLength: CHUNK_BYTES,
        createSha256: () => hash.value,
      }),
    ).rejects.toThrow("digest is invalid");
  });

  it("stops before reading the next chunk after cancellation", async () => {
    const controller = new AbortController();
    const hash = hasher();
    hash.update.mockImplementationOnce(async () => {
      controller.abort();
    });

    await expect(
      prepareImportUploadFiles({
        selections: [selection()],
        chunkByteLength: CHUNK_BYTES,
        createSha256: () => hash.value,
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");

    expect(hash.update).toHaveBeenCalledOnce();
    expect(hash.digestHex).not.toHaveBeenCalled();
  });

  it("does not digest when cancellation occurs during the final chunk", async () => {
    const controller = new AbortController();
    const hash = hasher();
    hash.update.mockImplementationOnce(async () => {
      controller.abort();
    });

    await expect(
      prepareImportUploadFiles({
        selections: [selection({ body: new Blob(["final"]) })],
        chunkByteLength: CHUNK_BYTES,
        createSha256: () => hash.value,
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");

    expect(hash.update).toHaveBeenCalledOnce();
    expect(hash.digestHex).not.toHaveBeenCalled();
  });

  it("does not return prepared files when cancellation occurs during digest", async () => {
    const controller = new AbortController();
    const hash = hasher();
    hash.digestHex.mockImplementationOnce(async () => {
      controller.abort();
      return "a".repeat(64);
    });

    await expect(
      prepareImportUploadFiles({
        selections: [selection({ body: new Blob(["final"]) })],
        chunkByteLength: CHUNK_BYTES,
        createSha256: () => hash.value,
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");

    expect(hash.digestHex).toHaveBeenCalledOnce();
  });
});
