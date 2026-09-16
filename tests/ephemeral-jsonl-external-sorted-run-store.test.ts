import { appendFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createEphemeralJsonlExternalSortedRunStore } from "@/lib/ephemeral-jsonl-external-sorted-run-store";

function records<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

async function collect<T>(source: AsyncIterable<T>): Promise<readonly T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

describe("ephemeral JSONL external-sort store", () => {
  it("round-trips, verifies and removes process-local scratch", async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "dna-sort-test-"));
    try {
      const store = createEphemeralJsonlExternalSortedRunStore<{
        id: number;
      }>({ rootDirectory, namespace: "test" });
      await store.writeRun({
        runId: "run-1",
        records: records([{ id: 1 }, { id: 2 }]),
      });
      await expect(collect(store.readRun({ runId: "run-1" }))).resolves.toEqual(
        [{ id: 1 }, { id: 2 }],
      );
      const [path] = await readdir(rootDirectory);
      expect(path).toMatch(/^[a-f0-9]{64}\.jsonl$/u);
      await appendFile(join(rootDirectory, path!), "{}\n", "utf8");
      await expect(collect(store.readRun({ runId: "run-1" }))).rejects.toThrow(
        "failed exact verification",
      );
      await store.deleteRun({ runId: "run-1" });
      await expect(readdir(rootDirectory)).resolves.toEqual([]);
    } finally {
      await rm(rootDirectory, { recursive: true, force: true });
    }
  });

  it("allows a bounded reader to return early before run cleanup", async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "dna-sort-test-"));
    try {
      const store = createEphemeralJsonlExternalSortedRunStore<number>({
        rootDirectory,
        namespace: "partial",
      });
      await store.writeRun({ runId: "run-1", records: records([1, 2, 3]) });
      for await (const value of store.readRun({ runId: "run-1" })) {
        expect(value).toBe(1);
        break;
      }
      await store.deleteRun({ runId: "run-1" });
    } finally {
      await rm(rootDirectory, { recursive: true, force: true });
    }
  });
});
