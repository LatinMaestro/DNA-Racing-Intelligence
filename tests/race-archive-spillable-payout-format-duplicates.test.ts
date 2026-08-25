import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import { corePayoutFormatProfilesFromRaceArchive } from "../lib/race-archive-core-payout-format-profiles";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import { spillableCorePayoutFormatProfilesFromRaceArchive } from "../lib/race-archive-spillable-payout-format-profiles";

function records<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

function memoryStore<T>() {
  const runs = new Map<string, readonly T[]>();
  const store: RaceArchiveExternalSortedRunStore<T> = Object.freeze({
    async writeRun({ runId, records: source }) {
      if (runs.has(runId)) throw new Error("run conflict");
      const values: T[] = [];
      for await (const value of source) values.push(value);
      if (values.length < 1) throw new Error("test run cannot be empty");
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

function observation(input: {
  row: number;
  naturalKey: string;
  payout: string | null;
}): RaceArchiveCoreAnalyticalObservation {
  return Object.freeze({
    datasetVersionId: "11111111-1111-1111-1111-111111111111",
    importBatchId: "22222222-2222-2222-2222-222222222222",
    versionNumber: 1,
    partitionNumber: 0,
    sourceRowNumber: input.row,
    naturalKey: input.naturalKey,
    fingerprintSha256: "d".repeat(64),
    sourceEventId: "event-1",
    sourceCoreId: "core-1",
    eventAt: "2026-08-01T00:00:00Z",
    mode: "bike",
    distance: 1000,
    gateCount: 8,
    goldStarEligible: true,
    goldStar: false,
    blueStar: false,
    starDataStatus: "complete",
    finishPosition: 1,
    elapsedMilliseconds: 10_000,
    payoutMechanismSourceValue: input.payout,
    sourceFormat: "Sprint",
    sourceRaceClass: "A",
  });
}

describe("spillable Race archive payout-format duplicate evidence", () => {
  it("rejects duplicate normalized natural keys even when payout-format evidence is null", async () => {
    const fixture = Object.freeze([
      observation({ row: 1, naturalKey: "event-1:core-1", payout: null }),
      observation({ row: 2, naturalKey: " event-1:core-1 ", payout: null }),
    ]);
    expect(() =>
      corePayoutFormatProfilesFromRaceArchive({
        observations: fixture,
        refreshedAt: "2026-08-25T00:00:00Z",
        maximumObservations: 10,
        maximumProfiles: 10,
      }),
    ).toThrow(
      "Archive payout-format profiles contain duplicate Race evidence.",
    );

    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    await expect(
      spillableCorePayoutFormatProfilesFromRaceArchive({
        observations: records(fixture),
        store: scratch.store,
        runPrefix: "test/payout-duplicate-null",
        refreshedAt: "2026-08-25T00:00:00Z",
        maximumRecordsInMemory: 1,
        mergeFanIn: 2,
        maximumObservations: 10,
        maximumRunObjects: 20,
        maximumProfiles: 10,
      }),
    ).rejects.toThrow(
      "Archive payout-format profiles contain duplicate Race evidence.",
    );
    expect(scratch.runs.size).toBe(0);
  });

  it("rejects duplicate normalized natural keys before differing payout formats can separate them", async () => {
    const fixture = Object.freeze([
      observation({ row: 1, naturalKey: "event-1:core-1", payout: "Top 3" }),
      observation({
        row: 2,
        naturalKey: "event-1:core-1",
        payout: "Winner Take All",
      }),
    ]);
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();

    await expect(
      spillableCorePayoutFormatProfilesFromRaceArchive({
        observations: records(fixture),
        store: scratch.store,
        runPrefix: "test/payout-duplicate-format",
        refreshedAt: "2026-08-25T00:00:00Z",
        maximumRecordsInMemory: 1,
        mergeFanIn: 2,
        maximumObservations: 10,
        maximumRunObjects: 20,
        maximumProfiles: 10,
      }),
    ).rejects.toThrow(
      "Archive payout-format profiles contain duplicate Race evidence.",
    );
    expect(scratch.runs.size).toBe(0);
  });
});
