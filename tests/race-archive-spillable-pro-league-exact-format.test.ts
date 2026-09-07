import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import { proLeagueExactFormatEvidenceFromRaceArchive } from "../lib/race-archive-pro-league-exact-format";
import {
  spillableProLeagueExactFormatEvidenceFromRaceArchive,
  type AcceptedProLeagueExactFormatObservation,
} from "../lib/race-archive-spillable-pro-league-exact-format";

function observation(input: {
  event: string;
  core: string;
  elapsed: number;
  finish: number;
  eventAt: string;
  row: number;
  distance?: number;
  gateCount?: number;
  payout?: string | null;
  mode?: "bike" | "car" | "horse";
}): RaceArchiveCoreAnalyticalObservation {
  return Object.freeze({
    datasetVersionId: "11111111-1111-1111-1111-111111111111",
    importBatchId: "22222222-2222-2222-2222-222222222222",
    versionNumber: 1,
    partitionNumber: 0,
    sourceRowNumber: input.row,
    naturalKey: `${input.event}:${input.core}`,
    fingerprintSha256: "b".repeat(64),
    sourceEventId: input.event,
    sourceCoreId: input.core,
    eventAt: input.eventAt,
    mode: input.mode ?? "bike",
    distance: input.distance ?? 1_200,
    gateCount: input.gateCount ?? 12,
    goldStarEligible: true,
    goldStar: false,
    blueStar: false,
    starDataStatus: "complete",
    finishPosition: input.finish,
    elapsedMilliseconds: input.elapsed,
    payoutMechanismSourceValue:
      input.payout === undefined ? "Winner Take All" : input.payout,
    sourceFormat: "standard",
    sourceRaceClass: "open",
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

function inputRows(): readonly RaceArchiveCoreAnalyticalObservation[] {
  return Object.freeze([
    observation({
      event: "event-7",
      core: "core-b",
      elapsed: 52_000,
      finish: 2,
      eventAt: "2026-04-07T00:00:00Z",
      row: 7,
      distance: 1_000,
      gateCount: 6,
      payout: "Top 3",
    }),
    observation({
      event: "event-2",
      core: "core-a",
      elapsed: 42_000,
      finish: 2,
      eventAt: "2026-04-02T00:00:00Z",
      row: 2,
    }),
    observation({
      event: "event-9",
      core: "core-z",
      elapsed: 40_000,
      finish: 1,
      eventAt: "2026-04-09T00:00:00Z",
      row: 9,
      mode: "car",
    }),
    observation({
      event: "event-1",
      core: "core-a",
      elapsed: 40_000,
      finish: 1,
      eventAt: "2026-04-01T00:00:00Z",
      row: 1,
    }),
    observation({
      event: "event-8",
      core: "core-x",
      elapsed: 54_000,
      finish: 1,
      eventAt: "2026-04-08T00:00:00Z",
      row: 8,
      distance: 1_234,
    }),
    observation({
      event: "event-6",
      core: "core-b",
      elapsed: 50_000,
      finish: 1,
      eventAt: "2026-04-06T00:00:00Z",
      row: 6,
      distance: 1_000,
      gateCount: 6,
      payout: "Top 3",
    }),
    observation({
      event: "event-3",
      core: "core-b",
      elapsed: 44_000,
      finish: 3,
      eventAt: "2026-04-03T00:00:00Z",
      row: 3,
    }),
    observation({
      event: "event-10",
      core: "core-y",
      elapsed: 41_000,
      finish: 1,
      eventAt: "2026-04-10T00:00:00Z",
      row: 10,
      payout: null,
    }),
    observation({
      event: "event-4",
      core: "core-b",
      elapsed: 46_000,
      finish: 4,
      eventAt: "2026-04-04T00:00:00Z",
      row: 4,
    }),
    observation({
      event: "event-5",
      core: "core-a",
      elapsed: 41_000,
      finish: 1,
      eventAt: "2026-04-05T00:00:00Z",
      row: 5,
    }),
    observation({
      event: "event-11",
      core: "core-w",
      elapsed: 42_000,
      finish: 1,
      eventAt: "2026-04-11T00:00:00Z",
      row: 11,
      payout: "Split pot",
    }),
    observation({
      event: "event-12",
      core: "core-u",
      elapsed: 43_000,
      finish: 2,
      eventAt: "2026-04-11T12:00:00Z",
      row: 12,
      distance: 1_000,
      gateCount: 2,
    }),
  ]);
}

describe("spillable Pro League exact-format evidence", () => {
  it("matches the bounded reference contract across external-sort runs", async () => {
    const values = inputRows();
    const refreshedAt = "2026-04-12T00:00:00Z";
    const resident = proLeagueExactFormatEvidenceFromRaceArchive({
      observations: values,
      refreshedAt,
      maximumObservations: 100,
      maximumBenchmarks: 20,
      maximumProfiles: 20,
    });
    const observationScratch =
      memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const acceptedScratch =
      memoryStore<AcceptedProLeagueExactFormatObservation>();
    const spillable =
      await spillableProLeagueExactFormatEvidenceFromRaceArchive({
        observations: records(values),
        observationStore: observationScratch.store,
        acceptedStore: acceptedScratch.store,
        runPrefix: "test/pro-league",
        refreshedAt,
        maximumRecordsInMemory: 2,
        mergeFanIn: 2,
        maximumObservations: 100,
        maximumRunObjects: 200,
        maximumBenchmarks: 20,
        maximumProfiles: 20,
      });

    expect(spillable.inputObservationCount).toBe(values.length);
    expect(spillable.acceptedPublishedCellEntryCount).toBe(
      resident.acceptedPublishedCellEntryCount,
    );
    expect(spillable.nonBikeEntryCount).toBe(resident.nonBikeEntryCount);
    expect(spillable.missingFormatEntryCount).toBe(
      resident.missingFormatEntryCount,
    );
    expect(spillable.unsupportedFormatEntryCount).toBe(
      resident.unsupportedFormatEntryCount,
    );
    expect(spillable.unpublishedCellEntryCount).toBe(
      resident.unpublishedCellEntryCount,
    );
    expect(spillable.preparationInitialRunCount).toBeGreaterThan(2);
    const rows = await collect(spillable.readRows());
    expect(
      rows.filter((row) => row.kind === "benchmark").map((row) => row.value),
    ).toEqual(resident.benchmarks);
    expect(
      rows.filter((row) => row.kind === "profile").map((row) => row.value),
    ).toEqual(resident.profiles);
    expect(spillable.unbenchmarkedPublishedCellEntryCount()).toBe(
      resident.unbenchmarkedPublishedCellEntryCount,
    );
    expect(observationScratch.runs.size).toBe(0);
    expect(acceptedScratch.runs.size).toBe(0);
  });

  it("matches exact trimmed-mean and dispersion semantics above the analytical sample gate", async () => {
    const values = Object.freeze(
      Array.from({ length: 12 }, (_, index) =>
        observation({
          event: `event-${index + 1}`,
          core: "core-a",
          elapsed: 40_000 + index * 137,
          finish: index === 0 ? 1 : Math.min(12, index + 1),
          eventAt: `2026-04-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
          row: index + 1,
        }),
      ),
    );
    const refreshedAt = "2026-04-13T00:00:00Z";
    const resident = proLeagueExactFormatEvidenceFromRaceArchive({
      observations: values,
      refreshedAt,
      maximumObservations: 100,
      maximumBenchmarks: 10,
      maximumProfiles: 10,
    });
    const observationScratch =
      memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const acceptedScratch =
      memoryStore<AcceptedProLeagueExactFormatObservation>();
    const spillable =
      await spillableProLeagueExactFormatEvidenceFromRaceArchive({
        observations: records(values),
        observationStore: observationScratch.store,
        acceptedStore: acceptedScratch.store,
        runPrefix: "test/analytical",
        refreshedAt,
        maximumRecordsInMemory: 2,
        mergeFanIn: 2,
        maximumObservations: 100,
        maximumRunObjects: 200,
        maximumBenchmarks: 10,
        maximumProfiles: 10,
      });
    const rows = await collect(spillable.readRows());
    expect(
      rows.filter((row) => row.kind === "profile").map((row) => row.value),
    ).toEqual(resident.profiles);
    expect(observationScratch.runs.size).toBe(0);
    expect(acceptedScratch.runs.size).toBe(0);
  });

  it("fails closed on duplicate natural keys during preparation and cleans scratch", async () => {
    const duplicate = observation({
      event: "event-1",
      core: "core-a",
      elapsed: 40_000,
      finish: 1,
      eventAt: "2026-04-01T00:00:00Z",
      row: 1,
    });
    const observationScratch =
      memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const acceptedScratch =
      memoryStore<AcceptedProLeagueExactFormatObservation>();

    await expect(
      spillableProLeagueExactFormatEvidenceFromRaceArchive({
        observations: records([duplicate, duplicate]),
        observationStore: observationScratch.store,
        acceptedStore: acceptedScratch.store,
        runPrefix: "test/duplicate",
        refreshedAt: "2026-04-02T00:00:00Z",
        maximumRecordsInMemory: 1,
        mergeFanIn: 2,
        maximumObservations: 10,
        maximumRunObjects: 30,
        maximumBenchmarks: 10,
        maximumProfiles: 10,
      }),
    ).rejects.toThrow("duplicate race entry");
    expect(observationScratch.runs.size).toBe(0);
    expect(acceptedScratch.runs.size).toBe(0);
  });

  it("fails closed on a post-cutoff row and cleans scratch", async () => {
    const observationScratch =
      memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const acceptedScratch =
      memoryStore<AcceptedProLeagueExactFormatObservation>();
    await expect(
      spillableProLeagueExactFormatEvidenceFromRaceArchive({
        observations: records([
          observation({
            event: "future",
            core: "core-a",
            elapsed: 40_000,
            finish: 1,
            eventAt: "2026-04-03T00:00:00Z",
            row: 1,
          }),
        ]),
        observationStore: observationScratch.store,
        acceptedStore: acceptedScratch.store,
        runPrefix: "test/future",
        refreshedAt: "2026-04-02T00:00:00Z",
        maximumRecordsInMemory: 1,
        mergeFanIn: 2,
        maximumObservations: 10,
        maximumRunObjects: 30,
        maximumBenchmarks: 10,
        maximumProfiles: 10,
      }),
    ).rejects.toThrow("point-in-time cutoff");
    expect(observationScratch.runs.size).toBe(0);
    expect(acceptedScratch.runs.size).toBe(0);
  });

  it("enforces the profile bound while reading and removes every owned run", async () => {
    const values = inputRows().slice(0, 8);
    const observationScratch =
      memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const acceptedScratch =
      memoryStore<AcceptedProLeagueExactFormatObservation>();
    const spillable =
      await spillableProLeagueExactFormatEvidenceFromRaceArchive({
        observations: records(values),
        observationStore: observationScratch.store,
        acceptedStore: acceptedScratch.store,
        runPrefix: "test/profile-bound",
        refreshedAt: "2026-04-12T00:00:00Z",
        maximumRecordsInMemory: 1,
        mergeFanIn: 2,
        maximumObservations: 100,
        maximumRunObjects: 300,
        maximumBenchmarks: 20,
        maximumProfiles: 1,
      });

    await expect(collect(spillable.readRows())).rejects.toThrow(
      "profile bound was exceeded",
    );
    expect(observationScratch.runs.size).toBe(0);
    expect(acceptedScratch.runs.size).toBe(0);
  });

  it("supports cleanup without reading and rejects replay", async () => {
    const values = inputRows().slice(0, 4);
    const observationScratch =
      memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const acceptedScratch =
      memoryStore<AcceptedProLeagueExactFormatObservation>();
    const spillable =
      await spillableProLeagueExactFormatEvidenceFromRaceArchive({
        observations: records(values),
        observationStore: observationScratch.store,
        acceptedStore: acceptedScratch.store,
        runPrefix: "test/manual-cleanup",
        refreshedAt: "2026-04-12T00:00:00Z",
        maximumRecordsInMemory: 2,
        mergeFanIn: 2,
        maximumObservations: 100,
        maximumRunObjects: 100,
        maximumBenchmarks: 20,
        maximumProfiles: 20,
      });
    await spillable.cleanup();
    expect(() => spillable.readRows()).toThrow("has been cleaned");
    expect(observationScratch.runs.size).toBe(0);
    expect(acceptedScratch.runs.size).toBe(0);
  });

  it("cleans every scratch run when the output iterator returns early", async () => {
    const observationScratch =
      memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const acceptedScratch =
      memoryStore<AcceptedProLeagueExactFormatObservation>();
    const spillable =
      await spillableProLeagueExactFormatEvidenceFromRaceArchive({
        observations: records(inputRows()),
        observationStore: observationScratch.store,
        acceptedStore: acceptedScratch.store,
        runPrefix: "test/early-return",
        refreshedAt: "2026-04-12T00:00:00Z",
        maximumRecordsInMemory: 2,
        mergeFanIn: 2,
        maximumObservations: 100,
        maximumRunObjects: 200,
        maximumBenchmarks: 20,
        maximumProfiles: 20,
      });
    const iterator = spillable.readRows()[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    await iterator.return?.();
    expect(observationScratch.runs.size).toBe(0);
    expect(acceptedScratch.runs.size).toBe(0);
  });
});
