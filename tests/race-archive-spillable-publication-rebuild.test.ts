import { describe, expect, it, vi } from "vitest";

import type { CoreStarProfile } from "../domain/star-signals";
import type { DatasetEvidenceObjectRegistration } from "../lib/neon-dataset-evidence-object-repository";
import type { NeonRaceArchiveAggregatePublicationRepository } from "../lib/neon-race-archive-aggregate-publication";
import type { SealedRaceArchiveManifest } from "../lib/neon-sealed-race-archive-manifest-repository";
import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import {
  createRaceArchiveAggregateRefresher,
  type RaceArchiveAggregateRefreshPlanVersion,
} from "../lib/race-archive-aggregate-refresher";
import { rebuildSpillableRaceArchivePublicationRows } from "../lib/race-archive-spillable-publication-rebuild";
import type { RaceStagedRowRehydrator } from "../lib/race-staged-row-rehydrator";

const OWNER = "owner-1";
const REFRESH = "11111111-1111-4111-8111-111111111111";
const VERSION_1 = "22222222-2222-4222-8222-222222222221";
const VERSION_2 = "22222222-2222-4222-8222-222222222222";
const BATCH_1 = "33333333-3333-4333-8333-333333333331";
const BATCH_2 = "33333333-3333-4333-8333-333333333332";
const SOURCE_HASH = "a".repeat(64);
const REFRESHED_AT = "2026-08-25T03:30:00.000Z";

function plan(): readonly RaceArchiveAggregateRefreshPlanVersion[] {
  return Object.freeze([
    {
      datasetVersionId: VERSION_1,
      importBatchId: BATCH_1,
      versionNumber: 1,
      sourceRowCount: 2,
      acceptedRowCount: 2,
      evidencePartitionCount: 1,
      evidenceRowCount: 2,
    },
    {
      datasetVersionId: VERSION_2,
      importBatchId: BATCH_2,
      versionNumber: 2,
      sourceRowCount: 2,
      acceptedRowCount: 2,
      evidencePartitionCount: 1,
      evidenceRowCount: 2,
    },
  ]);
}

function manifest(input: {
  datasetVersionId: string;
  importBatchId: string;
  rowCount: number;
}): SealedRaceArchiveManifest {
  return Object.freeze({
    datasetVersionId: input.datasetVersionId,
    importBatchId: input.importBatchId,
    sourceType: "race_merge" as const,
    evidenceKind: "staged_rows" as const,
    partitionCount: 1,
    rowCount: input.rowCount,
    byteSize: 100,
    objects: Object.freeze([
      Object.freeze({}) as unknown as DatasetEvidenceObjectRegistration,
    ]),
  });
}

function staged(input: {
  datasetVersionId: string;
  importBatchId: string;
  sourceRowNumber: number;
  eventId: string;
  coreId: string;
  finishPosition: number;
  fingerprint: string;
  goldStar?: boolean;
  blueStar?: boolean;
}) {
  const naturalKey = `${input.eventId}:${input.coreId}`;
  return Object.freeze({
    datasetVersionId: input.datasetVersionId,
    importBatchId: input.importBatchId,
    partitionNumber: 0,
    stagedRow: Object.freeze({
      sourceRowNumber: input.sourceRowNumber,
      naturalKey,
      fingerprintSha256: input.fingerprint,
      row: Object.freeze({
        status: "ready" as const,
        sourceType: "race_merge" as const,
        provenance: Object.freeze([]),
        issues: Object.freeze([]),
        record: Object.freeze({
          sourceType: "race_merge" as const,
          sourceEventId: input.eventId,
          eventAt: "2026-08-20T01:02:03.000Z",
          sourceEventDatetime: "2026-08-20T01:02:03.000Z",
          mode: "bike" as const,
          distance: 1000,
          sourceCoreId: input.coreId,
          coreNameSourceValue: input.coreId,
          gate: 2,
          gateCount: 8,
          goldStar: input.goldStar ?? false,
          blueStar: input.blueStar ?? false,
          goldStarEligible: true,
          goldStarSourceValue: String(input.goldStar ?? false),
          blueStarSourceValue: String(input.blueStar ?? false),
          starDataStatus: "complete" as const,
          finishPosition: input.finishPosition,
          elapsedTimeSourceValue:
            input.finishPosition === 1 ? "60.000" : "61.000",
          sourceRaceClass: "A",
          sourceFormat: "Sprint",
          feeSourceValue: "0",
          prizeSourceValue: "0",
          assetSourceValue: "DEZ",
          payoutMechanismSourceValue: "Top 3",
          raceTagsSourceValue: "Synthetic",
          raceAsset: "DEZ" as const,
          entryFeeAmount: "0",
          grossPayoutAmount: "0",
          economicDataStatus: "ready" as const,
        }),
      }),
    }),
  });
}

function asyncRows<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

function rehydrator(input?: {
  conflictReplay?: boolean;
}): RaceStagedRowRehydrator {
  const duplicateFingerprint = input?.conflictReplay
    ? "f".repeat(64)
    : "1".repeat(64);
  return Object.freeze({
    async open(request) {
      if (request.datasetVersionId === VERSION_1) {
        return Object.freeze({
          status: "ready" as const,
          manifest: manifest({
            datasetVersionId: VERSION_1,
            importBatchId: BATCH_1,
            rowCount: 2,
          }),
          rows: asyncRows([
            staged({
              datasetVersionId: VERSION_1,
              importBatchId: BATCH_1,
              sourceRowNumber: 1,
              eventId: "event-1",
              coreId: "core-1",
              finishPosition: 1,
              fingerprint: "1".repeat(64),
              goldStar: true,
            }),
            staged({
              datasetVersionId: VERSION_1,
              importBatchId: BATCH_1,
              sourceRowNumber: 2,
              eventId: "event-1",
              coreId: "core-2",
              finishPosition: 2,
              fingerprint: "2".repeat(64),
              blueStar: true,
            }),
          ]),
        });
      }
      return Object.freeze({
        status: "ready" as const,
        manifest: manifest({
          datasetVersionId: VERSION_2,
          importBatchId: BATCH_2,
          rowCount: 2,
        }),
        rows: asyncRows([
          staged({
            datasetVersionId: VERSION_2,
            importBatchId: BATCH_2,
            sourceRowNumber: 1,
            eventId: "event-1",
            coreId: "core-1",
            finishPosition: 1,
            fingerprint: duplicateFingerprint,
            goldStar: true,
          }),
          staged({
            datasetVersionId: VERSION_2,
            importBatchId: BATCH_2,
            sourceRowNumber: 2,
            eventId: "event-2",
            coreId: "core-1",
            finishPosition: 1,
            fingerprint: "3".repeat(64),
            goldStar: true,
            blueStar: true,
          }),
        ]),
      });
    },
  });
}

function memoryStore<T>(): {
  store: RaceArchiveExternalSortedRunStore<T>;
  runs: Map<string, T[]>;
} {
  const runs = new Map<string, T[]>();
  return {
    runs,
    store: Object.freeze({
      async writeRun({ runId, records }) {
        const values: T[] = [];
        for await (const record of records) values.push(record);
        runs.set(runId, values);
      },
      readRun({ runId }) {
        const values = runs.get(runId);
        if (values === undefined) {
          throw new Error(`missing scratch run ${runId}`);
        }
        return asyncRows(values);
      },
      async deleteRun({ runId }) {
        runs.delete(runId);
      },
    }),
  };
}

function publicationRepository() {
  const stagedFamilies = new Map<
    string,
    readonly Readonly<Record<string, unknown>>[]
  >();
  return Object.freeze({
    stagedFamilies,
    repository: Object.freeze({
      async begin() {
        return "staging" as const;
      },
      async stageRows(input: {
        family: string;
        rows: readonly Readonly<Record<string, unknown>>[];
      }) {
        stagedFamilies.set(input.family, input.rows);
        return input.rows.length;
      },
      async publish(input: {
        validatedEventCount: number;
        corePerformanceProfileCount: number;
        discoveryBenchmarkCount: number;
        payoutFormatProfileCount: number;
        coreStarProfileCount: number;
      }) {
        return Object.freeze({
          status: "published" as const,
          materializedRowCount:
            input.validatedEventCount +
            input.corePerformanceProfileCount +
            input.discoveryBenchmarkCount +
            input.payoutFormatProfileCount +
            input.coreStarProfileCount,
        });
      },
    }) as NeonRaceArchiveAggregatePublicationRepository,
  });
}

async function residentRows() {
  const publication = publicationRepository();
  const refresher = createRaceArchiveAggregateRefresher({
    planRepository: { list: async () => plan() },
    rehydrator: rehydrator(),
    publicationRepository: publication.repository,
    finalizer: {
      prepare: vi.fn(async () => ({
        preparedAggregateSetId: REFRESH,
        sourceVersionSetSha256: SOURCE_HASH,
        aggregateFamilyCount: 4,
        materializedRowCount: 9,
      })),
    },
    workerId: "aggregate-worker-1",
    now: () => new Date(REFRESHED_AT),
  });
  await refresher.prepare({
    ownerId: OWNER,
    updateSessionId: VERSION_2,
    refreshId: REFRESH,
    sourceVersionSetSha256: SOURCE_HASH,
  });
  return publication.stagedFamilies;
}

const BOUNDS = Object.freeze({
  maximumArchivePartitions: 10,
  maximumRecordsInMemory: 1,
  mergeFanIn: 2,
  maximumInputObservations: 100,
  maximumRunObjects: 100,
  maximumCorePerformanceProfiles: 100,
  maximumDiscoveryBenchmarks: 100,
  maximumPayoutFormatProfiles: 100,
  maximumStarEvents: 100,
  maximumStarEntriesPerEvent: 100,
  maximumStarContributions: 100,
  maximumStarProfiles: 100,
});

describe("spillable Race archive publication rebuild", () => {
  it("matches resident all-family publication semantics under forced spill and cleans scratch", async () => {
    const resident = await residentRows();
    const observations = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const starProfiles = memoryStore<CoreStarProfile>();

    const rebuilt = await rebuildSpillableRaceArchivePublicationRows({
      ownerId: OWNER,
      versions: plan(),
      rehydrator: rehydrator(),
      observationStore: observations.store,
      starProfileStore: starProfiles.store,
      runPrefix: "test-rebuild",
      refreshedAt: REFRESHED_AT,
      bounds: BOUNDS,
    });

    expect(rebuilt.uniqueObservationCount).toBe(3);
    expect(rebuilt.validatedEventCount).toBe(2);
    expect(rebuilt.acceptedFormatEntryCount).toBe(3);
    expect(rebuilt.rows.corePerformance).toEqual(
      resident.get("core_performance"),
    );
    expect(rebuilt.rows.discoveryBenchmarks).toEqual(
      resident.get("discovery_benchmark"),
    );
    expect(rebuilt.rows.payoutFormatProfiles).toEqual(
      resident.get("payout_format"),
    );
    expect(rebuilt.rows.coreStarProfiles).toEqual(
      resident.get("core_star_profile"),
    );
    expect(observations.runs.size).toBe(0);
    expect(starProfiles.runs.size).toBe(0);
  });

  it("fails closed on conflicting replay evidence before any family output and cleans scratch", async () => {
    const observations = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const starProfiles = memoryStore<CoreStarProfile>();

    await expect(
      rebuildSpillableRaceArchivePublicationRows({
        ownerId: OWNER,
        versions: plan(),
        rehydrator: rehydrator({ conflictReplay: true }),
        observationStore: observations.store,
        starProfileStore: starProfiles.store,
        runPrefix: "test-conflict",
        refreshedAt: REFRESHED_AT,
        bounds: BOUNDS,
      }),
    ).rejects.toThrow(/conflicting replay evidence/);
    expect(observations.runs.size).toBe(0);
    expect(starProfiles.runs.size).toBe(0);
  });
});
