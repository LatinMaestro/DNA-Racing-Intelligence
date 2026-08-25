import { describe, expect, it } from "vitest";

import {
  spillExactSortedRaceArchiveRecords,
  type RaceArchiveExternalSortedRunStore,
} from "../lib/race-archive-external-sort";

function asyncValues<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

describe("Race archive external-sort failure cleanup", () => {
  it("removes already-written scratch runs when the bounded input limit is exceeded", async () => {
    const runs = new Map<string, readonly number[]>();
    const deletedRunIds: string[] = [];
    const store: RaceArchiveExternalSortedRunStore<number> = Object.freeze({
      async writeRun(input) {
        runs.set(input.runId, Object.freeze(await collect(input.records)));
      },
      readRun(input) {
        const records = runs.get(input.runId);
        if (records === undefined) throw new Error("run is missing");
        return asyncValues(records);
      },
      async deleteRun(input) {
        deletedRunIds.push(input.runId);
        runs.delete(input.runId);
      },
    });

    await expect(
      spillExactSortedRaceArchiveRecords({
        records: asyncValues([3, 2, 1]),
        store,
        compare: (left, right) => left - right,
        runPrefix: "refresh-failure/input-bound",
        maximumRecordsInMemory: 2,
        mergeFanIn: 2,
        maximumInputRecords: 2,
        maximumRunObjects: 10,
      }),
    ).rejects.toThrow("Race archive external-sort input bound was exceeded.");

    expect(runs.size).toBe(0);
    expect(deletedRunIds).toEqual(["refresh-failure/input-bound/run-00000001"]);
  });
});
