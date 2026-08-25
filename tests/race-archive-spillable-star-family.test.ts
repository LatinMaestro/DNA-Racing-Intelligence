import { describe, expect, it } from "vitest";

import type { CoreStarProfile } from "../domain/star-signals";
import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import { spillableStarProfilesFromRaceArchive } from "../lib/race-archive-spillable-star-family";
import { starProfilesFromRaceArchive } from "../lib/race-archive-star-profiles";

function records<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

function memoryStore<T>() {
  const runs = new Map<string, readonly T[]>();
  const store: RaceArchiveExternalSortedRunStore<T> = Object.freeze({
    async writeRun({ runId, records: source }) {
      if (runs.has(runId)) throw new Error("test run conflict");
      const values: T[] = [];
      for await (const value of source) values.push(value);
      if (values.length < 1) throw new Error("test run cannot be empty");
      runs.set(runId, Object.freeze(values));
    },
    readRun({ runId }) {
      const values = runs.get(runId);
      if (values === undefined) throw new Error("test run unavailable");
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

function observation(input: {
  eventId: string;
  coreId: string;
  eventAt: string;
  row: number;
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
    fingerprintSha256: "f".repeat(64),
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

const FIXTURE = Object.freeze([
  observation({
    eventId: "event-003",
    coreId: "core-b",
    eventAt: "2026-08-03T00:00:00Z",
    row: 6,
    goldStar: false,
    blueStar: false,
    starDataStatus: "partial",
  }),
  observation({
    eventId: "event-001",
    coreId: "core-a",
    eventAt: "2026-08-01T00:00:00Z",
    row: 1,
    goldStar: true,
    blueStar: true,
  }),
  observation({
    eventId: "event-002",
    coreId: "core-b",
    eventAt: "2026-08-02T00:00:00Z",
    row: 4,
    goldStar: true,
    blueStar: true,
  }),
  observation({
    eventId: "event-001",
    coreId: "core-b",
    eventAt: "2026-08-01T00:00:00Z",
    row: 2,
    goldStar: false,
    blueStar: false,
  }),
  observation({
    eventId: "event-003",
    coreId: "core-a",
    eventAt: "2026-08-03T00:00:00Z",
    row: 5,
    goldStar: null,
    blueStar: null,
    starDataStatus: "missing",
  }),
  observation({
    eventId: "event-002",
    coreId: "core-a",
    eventAt: "2026-08-02T00:00:00Z",
    row: 3,
    goldStar: true,
    blueStar: false,
  }),
  observation({
    eventId: "event-004",
    coreId: "core-c",
    eventAt: "2026-08-04T00:00:00Z",
    row: 8,
    gateCount: 3,
    goldStarEligible: false,
    goldStar: false,
    blueStar: false,
    mode: "car",
    distance: 1200,
  }),
  observation({
    eventId: "event-004",
    coreId: "core-a",
    eventAt: "2026-08-04T00:00:00Z",
    row: 7,
    gateCount: 3,
    goldStarEligible: false,
    goldStar: true,
    blueStar: true,
    mode: "car",
    distance: 1200,
  }),
]);

describe("spillable Race archive star-family composition", () => {
  it("matches resident validations and Core star profiles with no scratch residue", async () => {
    const expected = starProfilesFromRaceArchive({
      observations: FIXTURE,
      maximumObservations: 100,
      maximumEvents: 20,
      maximumProfiles: 20,
    });
    const observationScratch =
      memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const contributionScratch = memoryStore<CoreStarProfile>();
    const validations: unknown[] = [];
    const spillable = await spillableStarProfilesFromRaceArchive({
      observations: records(FIXTURE),
      observationStore: observationScratch.store,
      contributionStore: contributionScratch.store,
      runPrefix: "test/star-family",
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumObservations: 100,
      maximumRunObjects: 100,
      maximumEvents: 20,
      maximumEntriesPerEvent: 20,
      maximumContributions: 100,
      maximumProfiles: 20,
      onEventValidation(validation) {
        validations.push(validation);
      },
    });

    expect(spillable.inputObservationCount).toBe(FIXTURE.length);
    expect(spillable.validatedEventCount).toBe(
      expected.eventValidations.length,
    );
    expect(spillable.contributionCount).toBe(FIXTURE.length);
    expect(spillable.initialEventRunCount).toBeGreaterThan(1);
    expect(spillable.initialContributionRunCount).toBeGreaterThan(1);
    expect(validations).toEqual(expected.eventValidations);
    expect(observationScratch.runs.size).toBe(0);
    expect(await collect(spillable.readProfiles())).toEqual(expected.profiles);
    expect(contributionScratch.runs.size).toBe(0);
  });

  it("propagates event metadata failures without leaving event or contribution scratch", async () => {
    const invalid = Object.freeze([
      observation({
        eventId: "event-001",
        coreId: "core-a",
        eventAt: "2026-08-01T00:00:00Z",
        row: 1,
        goldStar: true,
        blueStar: false,
      }),
      observation({
        eventId: "event-001",
        coreId: "core-b",
        eventAt: "2026-08-02T00:00:00Z",
        row: 2,
        goldStar: false,
        blueStar: true,
      }),
    ]);
    const observationScratch =
      memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const contributionScratch = memoryStore<CoreStarProfile>();

    await expect(
      spillableStarProfilesFromRaceArchive({
        observations: records(invalid),
        observationStore: observationScratch.store,
        contributionStore: contributionScratch.store,
        runPrefix: "test/star-family-invalid",
        maximumRecordsInMemory: 1,
        mergeFanIn: 2,
        maximumObservations: 10,
        maximumRunObjects: 20,
        maximumEvents: 10,
        maximumEntriesPerEvent: 10,
        maximumContributions: 20,
        maximumProfiles: 10,
      }),
    ).rejects.toThrow("Archive star event metadata changed within one event.");
    expect(observationScratch.runs.size).toBe(0);
    expect(contributionScratch.runs.size).toBe(0);
  });

  it("supports explicit cleanup before profile consumption", async () => {
    const observationScratch =
      memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const contributionScratch = memoryStore<CoreStarProfile>();
    const spillable = await spillableStarProfilesFromRaceArchive({
      observations: records(FIXTURE),
      observationStore: observationScratch.store,
      contributionStore: contributionScratch.store,
      runPrefix: "test/star-family-cleanup",
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumObservations: 100,
      maximumRunObjects: 100,
      maximumEvents: 20,
      maximumEntriesPerEvent: 20,
      maximumContributions: 100,
      maximumProfiles: 20,
    });

    expect(observationScratch.runs.size).toBe(0);
    expect(contributionScratch.runs.size).toBeGreaterThan(0);
    await spillable.cleanup();
    expect(contributionScratch.runs.size).toBe(0);
    expect(() => spillable.readProfiles()).toThrow(
      "Race archive star-profile source has been cleaned.",
    );
  });
});
