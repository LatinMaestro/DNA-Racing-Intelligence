import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import { corePayoutFormatProfilesFromRaceArchive } from "../lib/race-archive-core-payout-format-profiles";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import { spillableCorePayoutFormatProfilesFromRaceArchive } from "../lib/race-archive-spillable-payout-format-profiles";

function observation(input: {
  event: string;
  core: string;
  eventAt: string;
  finish: number;
  payout: string | null;
  mode?: "bike" | "car" | "horse";
  distance?: number;
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
    eventAt: input.eventAt,
    mode: input.mode ?? "bike",
    distance: input.distance ?? 1000,
    gateCount: 8,
    goldStarEligible: true,
    goldStar: false,
    blueStar: false,
    starDataStatus: "complete",
    finishPosition: input.finish,
    elapsedMilliseconds: 10_000 + input.row,
    payoutMechanismSourceValue: input.payout,
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

async function collect<T>(source: AsyncIterable<T>): Promise<readonly T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

const FIXTURE = Object.freeze([
  observation({
    event: "event-8",
    core: "core-2",
    eventAt: "2026-08-08T00:00:00Z",
    finish: 4,
    payout: "Winner Take All",
    mode: "horse",
    distance: 1800,
    row: 8,
  }),
  observation({
    event: "event-3",
    core: "core-1",
    eventAt: "2026-08-03T00:00:00Z",
    finish: 4,
    payout: "Top 3",
    distance: 1000,
    row: 3,
  }),
  observation({
    event: "event-1",
    core: "core-1",
    eventAt: "2026-08-02T00:00:00Z",
    finish: 2,
    payout: " Top   3 ",
    distance: 1000,
    row: 1,
  }),
  observation({
    event: "event-6",
    core: "core-1",
    eventAt: "2026-08-06T00:00:00Z",
    finish: 1,
    payout: "Winner Take All",
    mode: "car",
    distance: 1200,
    row: 6,
  }),
  observation({
    event: "event-4",
    core: "core-1",
    eventAt: "2026-08-04T00:00:00Z",
    finish: 3,
    payout: null,
    distance: 2000,
    row: 4,
  }),
  observation({
    event: "event-2",
    core: "core-1",
    eventAt: "2026-08-01T00:00:00Z",
    finish: 1,
    payout: "top 3",
    distance: 1500,
    row: 2,
  }),
  observation({
    event: "event-7",
    core: "core-2",
    eventAt: "2026-08-07T00:00:00Z",
    finish: 1,
    payout: "winner take all",
    mode: "horse",
    distance: 1600,
    row: 7,
  }),
  observation({
    event: "event-5",
    core: "core-1",
    eventAt: "2026-08-05T00:00:00Z",
    finish: 2,
    payout: "Winner Take All",
    mode: "car",
    distance: 1200,
    row: 5,
  }),
]);

describe("spillable Race archive payout-format profiles", () => {
  it("matches resident normalized identity, chronology, results and exact-distance diversity", async () => {
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const refreshedAt = "2026-08-25T00:00:00Z";
    const spillable = await spillableCorePayoutFormatProfilesFromRaceArchive({
      observations: records(FIXTURE),
      store: scratch.store,
      runPrefix: "test/payout-format",
      refreshedAt,
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumObservations: 100,
      maximumRunObjects: 100,
      maximumProfiles: 20,
    });
    const resident = corePayoutFormatProfilesFromRaceArchive({
      observations: FIXTURE,
      refreshedAt,
      maximumObservations: 100,
      maximumProfiles: 20,
    });

    expect(spillable.inputObservationCount).toBe(FIXTURE.length);
    expect(spillable.acceptedFormatEntryCount).toBe(
      resident.acceptedFormatEntryCount,
    );
    expect(spillable.initialRunCount).toBeGreaterThan(1);
    expect(await collect(spillable.readProfiles())).toEqual(resident.profiles);
    expect(scratch.runs.size).toBe(0);
  });

  it("counts distinct distances exactly across payout-label case variants", async () => {
    const fixture = Object.freeze([
      observation({
        event: "event-1",
        core: "core-1",
        eventAt: "2026-08-01T00:00:00Z",
        finish: 1,
        payout: "TOP 3",
        distance: 1000,
        row: 1,
      }),
      observation({
        event: "event-2",
        core: "core-1",
        eventAt: "2026-08-02T00:00:00Z",
        finish: 2,
        payout: "Top 3",
        distance: 900,
        row: 2,
      }),
      observation({
        event: "event-3",
        core: "core-1",
        eventAt: "2026-08-03T00:00:00Z",
        finish: 3,
        payout: "top 3",
        distance: 1000,
        row: 3,
      }),
    ]);
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const spillable = await spillableCorePayoutFormatProfilesFromRaceArchive({
      observations: records(fixture),
      store: scratch.store,
      runPrefix: "test/payout-distance",
      refreshedAt: "2026-08-25T00:00:00Z",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumObservations: 10,
      maximumRunObjects: 20,
      maximumProfiles: 10,
    });
    const [profile] = await collect(spillable.readProfiles());

    expect(profile?.payoutFormatKey).toBe("top 3");
    expect(profile?.payoutFormatLabel).toBe("TOP 3");
    expect(profile?.exactDistanceCount).toBe(2);
    expect(scratch.runs.size).toBe(0);
  });

  it("returns zero accepted entries without creating scratch when every payout is null", async () => {
    const fixture = Object.freeze([
      observation({
        event: "event-1",
        core: "core-1",
        eventAt: "2026-08-01T00:00:00Z",
        finish: 1,
        payout: null,
        row: 1,
      }),
    ]);
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const spillable = await spillableCorePayoutFormatProfilesFromRaceArchive({
      observations: records(fixture),
      store: scratch.store,
      runPrefix: "test/payout-none",
      refreshedAt: "2026-08-25T00:00:00Z",
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumObservations: 10,
      maximumRunObjects: 20,
      maximumProfiles: 10,
    });

    expect(spillable.inputObservationCount).toBe(1);
    expect(spillable.acceptedFormatEntryCount).toBe(0);
    expect(await collect(spillable.readProfiles())).toEqual([]);
    expect(scratch.runs.size).toBe(0);
  });

  it("fails closed on the observation bound before sorting additional accepted evidence", async () => {
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    await expect(
      spillableCorePayoutFormatProfilesFromRaceArchive({
        observations: records(FIXTURE.slice(0, 3)),
        store: scratch.store,
        runPrefix: "test/payout-observation-bound",
        refreshedAt: "2026-08-25T00:00:00Z",
        maximumRecordsInMemory: 1,
        mergeFanIn: 2,
        maximumObservations: 2,
        maximumRunObjects: 20,
        maximumProfiles: 10,
      }),
    ).rejects.toThrow("Archive payout-format observation bound was exceeded.");
    expect(scratch.runs.size).toBe(0);
  });

  it("fails closed on the profile bound and cleans external-sort scratch", async () => {
    const fixture = Object.freeze([
      observation({
        event: "event-1",
        core: "core-1",
        eventAt: "2026-08-01T00:00:00Z",
        finish: 1,
        payout: "Top 3",
        row: 1,
      }),
      observation({
        event: "event-2",
        core: "core-2",
        eventAt: "2026-08-02T00:00:00Z",
        finish: 1,
        payout: "Winner Take All",
        row: 2,
      }),
    ]);
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const spillable = await spillableCorePayoutFormatProfilesFromRaceArchive({
      observations: records(fixture),
      store: scratch.store,
      runPrefix: "test/payout-profile-bound",
      refreshedAt: "2026-08-25T00:00:00Z",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumObservations: 10,
      maximumRunObjects: 20,
      maximumProfiles: 1,
    });

    await expect(collect(spillable.readProfiles())).rejects.toThrow(
      "Archive payout-format profile bound was exceeded.",
    );
    expect(scratch.runs.size).toBe(0);
  });
});
