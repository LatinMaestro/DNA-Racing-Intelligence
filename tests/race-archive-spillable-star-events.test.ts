import { describe, expect, it } from "vitest";

import { refreshStarProfiles } from "../domain/star-signals";
import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import { spillableStarEventsFromRaceArchive } from "../lib/race-archive-spillable-star-events";
import { starProfilesFromRaceArchive } from "../lib/race-archive-star-profiles";

function observation(input: {
  eventId: string;
  coreId: string;
  row: number;
  eventAt: string;
  gateCount?: number;
  goldStarEligible?: boolean;
  goldStar: boolean | null;
  blueStar: boolean | null;
  starDataStatus?: "complete" | "partial" | "missing" | "invalid";
  mode?: "bike" | "car" | "horse";
  distance?: number;
}): RaceArchiveCoreAnalyticalObservation {
  const gateCount = input.gateCount ?? 8;
  return Object.freeze({
    datasetVersionId: "11111111-1111-1111-1111-111111111111",
    importBatchId: "22222222-2222-2222-2222-222222222222",
    versionNumber: 1,
    partitionNumber: 0,
    sourceRowNumber: input.row,
    naturalKey: `${input.eventId}:${input.coreId}`,
    fingerprintSha256: "e".repeat(64),
    sourceEventId: input.eventId,
    sourceCoreId: input.coreId,
    eventAt: input.eventAt,
    mode: input.mode ?? "bike",
    distance: input.distance ?? 1000,
    gateCount,
    goldStarEligible: input.goldStarEligible ?? gateCount > 3,
    goldStar: input.goldStar,
    blueStar: input.blueStar,
    starDataStatus: input.starDataStatus ?? "complete",
    finishPosition: 1,
    elapsedMilliseconds: 10_000 + input.row,
    payoutMechanismSourceValue: "Top 3",
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
    eventId: "event-2",
    coreId: "core-2",
    row: 4,
    eventAt: "2026-08-02T00:00:00Z",
    goldStar: false,
    blueStar: false,
    starDataStatus: "partial",
  }),
  observation({
    eventId: "event-1",
    coreId: "core-2",
    row: 2,
    eventAt: "2026-08-01T00:00:00Z",
    goldStar: false,
    blueStar: false,
  }),
  observation({
    eventId: "event-2",
    coreId: "core-1",
    row: 3,
    eventAt: "2026-08-02T00:00:00Z",
    goldStar: null,
    blueStar: null,
    starDataStatus: "missing",
  }),
  observation({
    eventId: "event-1",
    coreId: "core-1",
    row: 1,
    eventAt: "2026-08-01T00:00:00Z",
    goldStar: true,
    blueStar: true,
  }),
]);

describe("spillable Race archive star event stream", () => {
  it("matches resident event ordering, validation and profile semantics across forced spill/merge", async () => {
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const spillable = await spillableStarEventsFromRaceArchive({
      observations: records(FIXTURE),
      store: scratch.store,
      runPrefix: "test/star-events",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumObservations: 100,
      maximumRunObjects: 100,
      maximumEvents: 20,
      maximumEntriesPerEvent: 20,
    });
    const events = await collect(spillable.readEvents());
    const streamedRefresh = refreshStarProfiles(events);
    const resident = starProfilesFromRaceArchive({
      observations: FIXTURE,
      maximumObservations: 100,
      maximumEvents: 20,
      maximumProfiles: 20,
    });

    expect(spillable.inputObservationCount).toBe(FIXTURE.length);
    expect(spillable.initialRunCount).toBeGreaterThan(1);
    expect(streamedRefresh).toEqual(resident);
    expect(events.map(({ eventId }) => eventId)).toEqual([
      "event-1",
      "event-2",
    ]);
    expect(events[0]?.entries.map(({ coreId }) => coreId)).toEqual([
      "core-1",
      "core-2",
    ]);
    expect(scratch.runs.size).toBe(0);
  });

  it("fails closed on event metadata drift and cleans scratch", async () => {
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const fixture = Object.freeze([
      observation({
        eventId: "event-1",
        coreId: "core-1",
        row: 1,
        eventAt: "2026-08-01T00:00:00Z",
        goldStar: true,
        blueStar: false,
      }),
      observation({
        eventId: "event-1",
        coreId: "core-2",
        row: 2,
        eventAt: "2026-08-02T00:00:00Z",
        goldStar: false,
        blueStar: true,
      }),
    ]);
    const spillable = await spillableStarEventsFromRaceArchive({
      observations: records(fixture),
      store: scratch.store,
      runPrefix: "test/star-metadata",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumObservations: 10,
      maximumRunObjects: 20,
      maximumEvents: 10,
      maximumEntriesPerEvent: 10,
    });

    await expect(collect(spillable.readEvents())).rejects.toThrow(
      "Archive star event metadata changed within one event.",
    );
    expect(scratch.runs.size).toBe(0);
  });

  it("fails closed when archived gold eligibility conflicts with the current game rule", async () => {
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const spillable = await spillableStarEventsFromRaceArchive({
      observations: records([
        observation({
          eventId: "event-1",
          coreId: "core-1",
          row: 1,
          eventAt: "2026-08-01T00:00:00Z",
          gateCount: 8,
          goldStarEligible: false,
          goldStar: false,
          blueStar: true,
        }),
      ]),
      store: scratch.store,
      runPrefix: "test/star-eligibility",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumObservations: 10,
      maximumRunObjects: 20,
      maximumEvents: 10,
      maximumEntriesPerEvent: 10,
    });

    await expect(collect(spillable.readEvents())).rejects.toThrow(
      "Archive star eligibility conflicts with game rules.",
    );
    expect(scratch.runs.size).toBe(0);
  });

  it("fails closed on duplicate Race evidence and the per-event memory bound", async () => {
    const duplicate = observation({
      eventId: "event-1",
      coreId: "core-1",
      row: 1,
      eventAt: "2026-08-01T00:00:00Z",
      goldStar: true,
      blueStar: false,
    });
    const duplicateScratch =
      memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const duplicateSource = await spillableStarEventsFromRaceArchive({
      observations: records([duplicate, duplicate]),
      store: duplicateScratch.store,
      runPrefix: "test/star-duplicate",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumObservations: 10,
      maximumRunObjects: 20,
      maximumEvents: 10,
      maximumEntriesPerEvent: 10,
    });
    await expect(collect(duplicateSource.readEvents())).rejects.toThrow(
      "Archive star profiles contain duplicate Race evidence.",
    );
    expect(duplicateScratch.runs.size).toBe(0);

    const boundScratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const boundSource = await spillableStarEventsFromRaceArchive({
      observations: records(
        FIXTURE.filter(({ sourceEventId }) => sourceEventId === "event-1"),
      ),
      store: boundScratch.store,
      runPrefix: "test/star-entry-bound",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumObservations: 10,
      maximumRunObjects: 20,
      maximumEvents: 10,
      maximumEntriesPerEvent: 1,
    });
    await expect(collect(boundSource.readEvents())).rejects.toThrow(
      "Archive star event entry bound was exceeded.",
    );
    expect(boundScratch.runs.size).toBe(0);
  });
});
