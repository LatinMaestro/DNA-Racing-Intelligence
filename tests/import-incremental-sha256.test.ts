import { describe, expect, it } from "vitest";

import { prepareImportUploadFiles } from "../lib/import-file-preparation-client";
import { createImportIncrementalSha256 } from "../lib/import-incremental-sha256";

const encoder = new TextEncoder();

function digestText(text: string, chunkSize = Number.MAX_SAFE_INTEGER): string {
  const bytes = encoder.encode(text);
  const hash = createImportIncrementalSha256();
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    hash.update(bytes.subarray(offset, offset + chunkSize));
  }
  return hash.digestHex();
}

describe("incremental import SHA-256", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ])("matches a published SHA-256 vector", (message, expected) => {
    expect(digestText(message)).toBe(expected);
  });

  it("produces the same digest across one-byte and boundary-spanning chunks", () => {
    const message = "synthetic-race-row\n".repeat(8193);
    const expected =
      "75e4c7904ce2af2e031b98768262524f37cc75eab1cf912882feafe02ae75108";

    expect(digestText(message, 1)).toBe(expected);
    expect(digestText(message, 63)).toBe(expected);
    expect(digestText(message, 64)).toBe(expected);
    expect(digestText(message, 65)).toBe(expected);
  });

  it("matches the million-a standard vector with bounded updates", () => {
    const hash = createImportIncrementalSha256();
    const chunk = encoder.encode("a".repeat(10_000));
    for (let index = 0; index < 100; index += 1) hash.update(chunk);

    expect(hash.digestHex()).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  it("finalizes idempotently and rejects later mutation", () => {
    const hash = createImportIncrementalSha256();
    hash.update(encoder.encode("abc"));

    const first = hash.digestHex();
    expect(hash.digestHex()).toBe(first);
    expect(() => hash.update(encoder.encode("later"))).toThrow(
      "already finalized",
    );
  });

  it("integrates with bounded private file preparation", async () => {
    const body = new Blob(["abc"]);
    const result = await prepareImportUploadFiles({
      selections: [
        {
          clientFileId: "synthetic-1",
          sourceFamily: "core_details",
          originalFileName: "synthetic-core.csv",
          contentType: "text/csv",
          body,
        },
      ],
      chunkByteLength: 64 * 1024,
      createSha256: createImportIncrementalSha256,
    });

    expect(result.candidates[0]).toMatchObject({
      byteLength: 3,
      sha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    expect(result.files[0]?.body).toBe(body);
  });
});
