import { describe, expect, it, vi } from "vitest";

import type { DatasetEvidenceObjectRegistration } from "../lib/neon-dataset-evidence-object-repository";
import type { NeonRaceArchiveAggregatePublicationRepository } from "../lib/neon-race-archive-aggregate-publication";
import type { SealedRaceArchiveManifest } from "../lib/neon-sealed-race-archive-manifest-repository";
import {
  createRaceArchiveAggregateRefresher,
  type RaceArchiveAggregateRefreshPlanVersion,
} from "../lib/race-archive-aggregate-refresher";
import type { RaceStagedRowRehydrator } from "../lib/race-staged-row-rehydrator";

const OWNER = "owner-1";
const REFRESH = "11111111-1111-4111-8111-111111111111";
const VERSION_1 = "22222222-2222-4222-8222-222222222221";
const VERSION_2 = "22222222-2222-4222-8222-222222222222";
const BATCH_1 = "33333333-3333-4333-8333-333333333331";
const BATCH_2 = "33333333-3333-4333-8333-333333333332";
const SOURCE_HASH = "a".repeat(64);

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

function publicationRepository() {
  const stagedFamilies = new Map<
    string,
    readonly Readonly<Record<string, unknown>>[]
  >();
  const begin = vi.fn(async () => "staging" as const);
  const stageRows = vi.fn(
    async (input: {
      family: string;
      rows: readonly Readonly<Record<string, unknown>>[];
    }) => {
      stagedFamilies.set(input.family, input.rows);
      return input.rows.length;
    },
  );
  const publish = vi.fn(
    async (input: {
      validatedEventCount: number;
      corePerformanceProfileCount: number;
      discoveryBenchmarkCount: number;
      payoutFormatProfileCount: number;
      coreStarProfileCount: number;
    }) => ({
      status: "published" as const,
      materializedRowCount:
        input.validatedEventCount +
        input.corePerformanceProfileCount +
        input.discoveryBenchmarkCount +
        input.payoutFormatProfileCount +
        input.coreStarProfileCount,
    }),
  );
  return {
    repository: Object.freeze({
      begin,
      stageRows,
      publish,
    }) as NeonRaceArchiveAggregatePublicationRepository,
    begin,
    stageRows,
    publish,
    stagedFamilies,
  };
}

describe("Race archive aggregate refresher", () => {
  it("reconstructs all Race-derived families across exact sealed versions and publishes before finalisation", async () => {
    const publication = publicationRepository();
    const finalizer = {
      prepare: vi.fn(async () => ({
        preparedAggregateSetId: REFRESH,
        sourceVersionSetSha256: SOURCE_HASH,
        aggregateFamilyCount: 4,
        materializedRowCount: 9,
      })),
    };
    const planRepository = {
      list: vi.fn(async () => plan()),
    };
    const refresher = createRaceArchiveAggregateRefresher({
      planRepository,
      rehydrator: rehydrator(),
      publicationRepository: publication.repository,
      finalizer,
      workerId: "aggregate-worker-1",
      now: () => new Date("2026-08-25T03:30:00.000Z"),
    });

    await expect(
      refresher.prepare({
        ownerId: OWNER,
        updateSessionId: VERSION_2,
        refreshId: REFRESH,
        sourceVersionSetSha256: SOURCE_HASH,
      }),
    ).resolves.toEqual({
      preparedAggregateSetId: REFRESH,
      sourceVersionSetSha256: SOURCE_HASH,
      aggregateFamilyCount: 4,
      materializedRowCount: 9,
    });

    expect(planRepository.list).toHaveBeenCalledWith({
      ownerId: OWNER,
      refreshId: REFRESH,
      updateSessionId: VERSION_2,
      sourceVersionSetSha256: SOURCE_HASH,
      maximumVersions: 24,
    });
    expect(publication.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        raceDatasetVersionId: VERSION_2,
        sourceVersionSetSha256: SOURCE_HASH,
      }),
    );
    expect(publication.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        validatedEventCount: 2,
        acceptedFormatEntryCount: 3,
        corePerformanceProfileCount: 2,
        discoveryBenchmarkCount: 1,
        payoutFormatProfileCount: 2,
        coreStarProfileCount: 2,
      }),
    );
    expect(publication.stagedFamilies.get("core_performance")).toHaveLength(2);
    expect(publication.stagedFamilies.get("discovery_benchmark")).toHaveLength(
      1,
    );
    expect(publication.stagedFamilies.get("payout_format")).toHaveLength(2);
    expect(publication.stagedFamilies.get("core_star_profile")).toHaveLength(2);
    expect(finalizer.prepare).toHaveBeenCalledOnce();
    expect(publication.publish.mock.invocationCallOrder[0]).toBeLessThan(
      finalizer.prepare.mock.invocationCallOrder[0]!,
    );
  });

  it("deduplicates exact cross-version replay but fails closed on conflicting replay", async () => {
    const publication = publicationRepository();
    const finalizer = {
      prepare: vi.fn(async () => ({
        preparedAggregateSetId: REFRESH,
        sourceVersionSetSha256: SOURCE_HASH,
        aggregateFamilyCount: 4,
        materializedRowCount: 9,
      })),
    };
    const refresher = createRaceArchiveAggregateRefresher({
      planRepository: { list: async () => plan() },
      rehydrator: rehydrator({ conflictReplay: true }),
      publicationRepository: publication.repository,
      finalizer,
      workerId: "aggregate-worker-1",
    });

    await expect(
      refresher.prepare({
        ownerId: OWNER,
        updateSessionId: VERSION_2,
        refreshId: REFRESH,
        sourceVersionSetSha256: SOURCE_HASH,
      }),
    ).rejects.toThrow(/conflicting replay evidence/);
    expect(publication.begin).not.toHaveBeenCalled();
    expect(finalizer.prepare).not.toHaveBeenCalled();
  });

  it("fails closed when the exact sealed plan does not end at the claimed Race version", async () => {
    const publication = publicationRepository();
    const finalizer = {
      prepare: vi.fn(async () => ({
        preparedAggregateSetId: REFRESH,
        sourceVersionSetSha256: SOURCE_HASH,
        aggregateFamilyCount: 4,
        materializedRowCount: 0,
      })),
    };
    const refresher = createRaceArchiveAggregateRefresher({
      planRepository: { list: async () => plan().slice(0, 1) },
      rehydrator: rehydrator(),
      publicationRepository: publication.repository,
      finalizer,
      workerId: "aggregate-worker-1",
    });

    await expect(
      refresher.prepare({
        ownerId: OWNER,
        updateSessionId: VERSION_2,
        refreshId: REFRESH,
        sourceVersionSetSha256: SOURCE_HASH,
      }),
    ).rejects.toThrow(/does not end at the target version/);
    expect(publication.begin).not.toHaveBeenCalled();
  });
});
