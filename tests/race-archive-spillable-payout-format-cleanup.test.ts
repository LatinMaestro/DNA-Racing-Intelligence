import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import { spillableCorePayoutFormatProfilesFromRaceArchive } from "../lib/race-archive-spillable-payout-format-profiles";

function observation(input: {
  event: string;
  core: string;
  row: number;
}): RaceArchiveCoreAnalyticalObservation {
  return Object.freeze({
    datasetVersionId: "11111111-1111-1111-1111-111111111111",
    importBatchId: "22222222-2222-2222-2222-222222222222",
    versionNumber: 1,
    partitionNumber: 0,
    sourceRowNumber: input.row,
    naturalKey: `${input.event}:${input.core}`,
    fingerprintSha256: "c".repeat(64),
    sourceEventId: input.event,
    sourceCoreId: input.core,
    eventAt: `2026-08-${String(input.row).padStart(2, "0")}T00:00:00Z`,
    mode: "bike",
    distance: 1000 + input.row,
    gateCount: 8,
    goldStarEligible: true,
    goldStar: false,
    blueStar: false,
    starDataStatus: "complete",
    finishPosition: input.row,
    elapsedMilliseconds: 10_000 + input.row,
    payoutMechanismSourceValue: input.row === 1 ? "Top 3" : "Winner Take All",
    sourceFormat: "Sprint",
    sourceRaceClass: "A",
  });
}

function records<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

function memoryStore<T>() {
  const runs = new Map<string, readonly T[]>();
  const store: RaceArchiveExternalSortedRunStore<T> = Object.freeze({
    async writeRun({ runId, records: source }) {
      const values: T[] = [];
      for await (const value of source) values.push(value);
      runs.set(runId, Object.freeze(values));
    },
    readRun({ runId }) {
      const values = runs.get(runId);
      if (values === undefined) throw new Error("run unavailable");
      return records(values);
    },
    async deleteRun({ runId }) {
      runs.delete(runId);
    },
  });
  return { store, runs };
}

describe("spillable Race archive payout-format scratch lifecycle", () => {
  it("cleans external-sort scratch when the profile consumer stops early", async () => {
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const spillable = await spillableCorePayoutFormatProfilesFromRaceArchive({
      observations: records([
        observation({ event: "event-1", core: "core-1", row: 1 }),
        observation({ event: "event-2", core: "core-2", row: 2 }),
      ]),
      store: scratch.store,
      runPrefix: "test/payout-early-stop",
      refreshedAt: "2026-08-25T00:00:00Z",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumObservations: 10,
      maximumRunObjects: 20,
      maximumProfiles: 10,
    });

    const iterator = spillable.readProfiles()[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    expect(scratch.runs.size).toBeGreaterThan(0);
    await iterator.return?.();
    expect(scratch.runs.size).toBe(0);
  });
});
