import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import { starProfilesFromRaceArchive } from "../lib/race-archive-star-profiles";
import {
  decodeRaceArchiveStarProfileContributionLine,
  encodeRaceArchiveStarProfileContribution,
  spillableStarProfilesFromRaceArchive,
  type RaceArchiveStarProfileContribution,
} from "../lib/race-archive-spillable-star-profiles";

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

function fixture(): readonly RaceArchiveCoreAnalyticalObservation[] {
  return Object.freeze([
    observation({
      eventId: "event-valid",
      coreId: "core-2",
      eventAt: "2026-08-01T00:00:00Z",
      row: 2,
      goldStar: false,
      blueStar: false,
    }),
    observation({
      eventId: "event-missing",
      coreId: "core-1",
      eventAt: "2026-08-03T00:00:00Z",
      row: 5,
      goldStar: null,
      blueStar: null,
      starDataStatus: "missing",
    }),
    observation({
      eventId: "event-multi",
      coreId: "core-2",
      eventAt: "2026-08-02T00:00:00Z",
      row: 4,
      goldStar: true,
      blueStar: true,
    }),
    observation({
      eventId: "event-valid",
      coreId: "core-1",
      eventAt: "2026-08-01T00:00:00Z",
      row: 1,
      goldStar: true,
      blueStar: true,
    }),
    observation({
      eventId: "event-multi",
      coreId: "core-1",
      eventAt: "2026-08-02T00:00:00Z",
      row: 3,
      goldStar: true,
      blueStar: false,
    }),
    observation({
      eventId: "event-missing",
      coreId: "core-2",
      eventAt: "2026-08-03T00:00:00Z",
      row: 6,
      goldStar: false,
      blueStar: false,
      starDataStatus: "partial",
    }),
    observation({
      eventId: "event-ineligible",
      coreId: "core-1",
      eventAt: "2026-08-04T00:00:00Z",
      row: 7,
      gateCount: 3,
      goldStarEligible: false,
      goldStar: true,
      blueStar: true,
      mode: "car",
      distance: 1200,
    }),
    observation({
      eventId: "event-ineligible",
      coreId: "core-3",
      eventAt: "2026-08-04T00:00:00Z",
      row: 8,
      gateCount: 3,
      goldStarEligible: false,
      goldStar: false,
      blueStar: false,
      mode: "car",
      distance: 1200,
    }),
  ]);
}

async function spillable(input: {
  observations: readonly RaceArchiveCoreAnalyticalObservation[];
  maximumEvents?: number;
  maximumEntriesPerEvent?: number;
  maximumProfiles?: number;
}) {
  const observationScratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
  const contributionScratch = memoryStore<RaceArchiveStarProfileContribution>();
  const eventValidations: unknown[] = [];
  const source = await spillableStarProfilesFromRaceArchive({
    observations: records(input.observations),
    observationStore: observationScratch.store,
    contributionStore: contributionScratch.store,
    runPrefix: "test/star",
    maximumRecordsInMemory: 2,
    mergeFanIn: 2,
    maximumObservations: 100,
    maximumRunObjects: 100,
    maximumEvents: input.maximumEvents ?? 20,
    maximumEntriesPerEvent: input.maximumEntriesPerEvent ?? 20,
    maximumProfiles: input.maximumProfiles ?? 20,
    onEventValidation(validation) {
      eventValidations.push(validation);
    },
  });
  return { source, observationScratch, contributionScratch, eventValidations };
}

describe("spillable Race archive star profiles", () => {
  it("matches resident event validation and Core profile semantics across forced spill/merge runs", async () => {
    const observations = fixture();
    const resident = starProfilesFromRaceArchive({
      observations,
      maximumObservations: 100,
      maximumEvents: 20,
      maximumProfiles: 20,
    });
    const prepared = await spillable({ observations });

    expect(prepared.source.inputObservationCount).toBe(observations.length);
    expect(prepared.source.validatedEventCount).toBe(resident.eventValidations.length);
    expect(prepared.source.initialEventRunCount).toBeGreaterThan(1);
    expect(prepared.source.initialContributionRunCount).toBeGreaterThan(1);
    expect(prepared.eventValidations).toEqual(resident.eventValidations);
    expect(await collect(prepared.source.readProfiles())).toEqual(resident.profiles);
    expect(prepared.observationScratch.runs.size).toBe(0);
    expect(prepared.contributionScratch.runs.size).toBe(0);
  });

  it("round-trips compact profile contributions exactly", () => {
    const contribution: RaceArchiveStarProfileContribution = Object.freeze({
      eventId: "event-1",
      coreId: "core-1",
      eventAt: "2026-08-01T00:00:00.000Z",
      mode: "bike",
      distance: 1000,
      starDataStatus: "complete",
      goldStarEligible: true,
      goldAssignmentOpportunity: true,
      goldReceived: true,
      goldNegativeOpportunity: false,
      goldEligibleNoAssignment: false,
      goldIneligibleAssignment: false,
      goldExcludedAnomaly: false,
      blueAssignmentOpportunity: true,
      blueReceived: true,
      blueNegativeOpportunity: false,
      blueNoAssignment: false,
      blueExcludedAnomaly: false,
      sameCoreReceivedBoth: true,
    });
    const encoded = encodeRaceArchiveStarProfileContribution(contribution);
    expect(new TextDecoder().decode(encoded).endsWith("\n")).toBe(true);
    expect(
      decodeRaceArchiveStarProfileContributionLine(
        new TextDecoder().decode(encoded).trimEnd(),
      ),
    ).toEqual(contribution);
  });

  it("fails closed on duplicate Race evidence and cleans both scratch stages", async () => {
    const row = observation({
      eventId: "event-1",
      coreId: "core-1",
      eventAt: "2026-08-01T00:00:00Z",
      row: 1,
      goldStar: true,
      blueStar: false,
    });
    const observationScratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const contributionScratch = memoryStore<RaceArchiveStarProfileContribution>();
    await expect(
      spillableStarProfilesFromRaceArchive({
        observations: records([row, row]),
        observationStore: observationScratch.store,
        contributionStore: contributionScratch.store,
        runPrefix: "test/star-duplicate",
        maximumRecordsInMemory: 1,
        mergeFanIn: 2,
        maximumObservations: 10,
        maximumRunObjects: 20,
        maximumEvents: 10,
        maximumEntriesPerEvent: 10,
        maximumProfiles: 10,
      }),
    ).rejects.toThrow("Archive star profiles contain duplicate Race evidence.");
    expect(observationScratch.runs.size).toBe(0);
    expect(contributionScratch.runs.size).toBe(0);
  });

  it("fails closed on event metadata and game-rule eligibility conflicts", async () => {
    const base = observation({
      eventId: "event-1",
      coreId: "core-1",
      eventAt: "2026-08-01T00:00:00Z",
      row: 1,
      goldStar: true,
      blueStar: false,
    });
    const changedMetadata = observation({
      eventId: "event-1",
      coreId: "core-2",
      eventAt: "2026-08-02T00:00:00Z",
      row: 2,
      goldStar: false,
      blueStar: true,
    });
    await expect(
      spillable({ observations: [base, changedMetadata] }),
    ).rejects.toThrow("Archive star event metadata changed within one event.");

    await expect(
      spillable({ observations: [{ ...base, goldStarEligible: false }] }),
    ).rejects.toThrow("Archive star eligibility conflicts with game rules.");
  });

  it("enforces event, per-event entry and profile bounds without residue", async () => {
    const observations = fixture();
    await expect(spillable({ observations, maximumEvents: 1 })).rejects.toThrow(
      "Archive star event bound was exceeded.",
    );
    await expect(
      spillable({ observations, maximumEntriesPerEvent: 1 }),
    ).rejects.toThrow("Archive star event-entry bound was exceeded.");

    const prepared = await spillable({ observations, maximumProfiles: 1 });
    await expect(collect(prepared.source.readProfiles())).rejects.toThrow(
      "Archive star profile bound was exceeded.",
    );
    expect(prepared.observationScratch.runs.size).toBe(0);
    expect(prepared.contributionScratch.runs.size).toBe(0);
  });
});
