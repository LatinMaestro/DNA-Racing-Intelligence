import { describe, expect, it, vi } from "vitest";

import type { CoreStarProfile } from "../domain/star-signals";
import type { DatasetEvidenceObjectRegistration } from "../lib/neon-dataset-evidence-object-repository";
import type { NeonRaceArchiveAggregatePublicationRepository } from "../lib/neon-race-archive-aggregate-publication";
import type { SealedRaceArchiveManifest } from "../lib/neon-sealed-race-archive-manifest-repository";
import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import type {
  RaceArchiveAggregateRefreshPlanVersion,
} from "../lib/race-archive-aggregate-refresher";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import { createSpillableRaceArchiveAggregateRefresher } from "../lib/race-archive-spillable-aggregate-refresher";
import type { RaceStagedRowRehydrator } from "../lib/race-staged-row-rehydrator";

const OWNER = "owner-1";
const REFRESH = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const BATCH = "33333333-3333-4333-8333-333333333333";
const SOURCE_HASH = "a".repeat(64);
const REFRESHED_AT = "2026-08-25T03:30:00.000Z";

function manifest(): SealedRaceArchiveManifest {
  return Object.freeze({
    datasetVersionId: VERSION,
    importBatchId: BATCH,
    sourceType: "race_merge" as const,
    evidenceKind: "staged_rows" as const,
    partitionCount: 1,
    rowCount: 2,
    byteSize: 100,
    objects: Object.freeze([
      Object.freeze({}) as unknown as DatasetEvidenceObjectRegistration,
    ]),
  });
}

function staged(input: {
  sourceRowNumber: number;
  coreId: string;
  finishPosition: number;
  fingerprint: string;
  goldStar?: boolean;
  blueStar?: boolean;
}) {
  const eventId = "event-1";
  const naturalKey = `${eventId}:${input.coreId}`;
  return Object.freeze({
    datasetVersionId: VERSION,
    importBatchId: BATCH,
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
          sourceEventId: eventId,
          eventAt: "2026-08-20T01:02:03.000Z",
          sourceEventDatetime: "2026-08-20T01:02:03.000Z",
          mode: "bike" as const,
          distance: 1000,
          sourceCoreId: input.coreId,
          coreNameSourceValue: input.coreId,
          gate: input.finishPosition,
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

function rehydrator(): RaceStagedRowRehydrator {
  return Object.freeze({
    async open(request) {
      expect(request).toEqual({
        ownerId: OWNER,
        datasetVersionId: VERSION,
        maximumPartitions: 10,
      });
      return Object.freeze({
        status: "ready" as const,
        manifest: manifest(),
        rows: asyncRows([
          staged({
            sourceRowNumber: 1,
            coreId: "core-1",
            finishPosition: 1,
            fingerprint: "1".repeat(64),
            goldStar: true,
          }),
          staged({
            sourceRowNumber: 2,
            coreId: "core-2",
            finishPosition: 2,
            fingerprint: "2".repeat(64),
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
        if (values === undefined) throw new Error(`missing run ${runId}`);
        return asyncRows(values);
      },
      async deleteRun({ runId }) {
        runs.delete(runId);
      },
    }),
  };
}

function harness(input?: { finalizerRowDelta?: number }) {
  const observations = memoryStore<RaceArchiveCoreAnalyticalObservation>();
  const starProfiles = memoryStore<CoreStarProfile>();
  const lifecycle: string[] = [];
  let materializedRowCount = 0;
  const staged = new Map<
    string,
    readonly Readonly<Record<string, unknown>>[]
  >();
  const planList = vi.fn(
    async (): Promise<readonly RaceArchiveAggregateRefreshPlanVersion[]> =>
      Object.freeze([
        Object.freeze({
          datasetVersionId: VERSION,
          importBatchId: BATCH,
          versionNumber: 1,
          sourceRowCount: 2,
          acceptedRowCount: 2,
          evidencePartitionCount: 1,
          evidenceRowCount: 2,
        }),
      ]),
  );
  const scratchCreate = vi.fn(async () =>
    Object.freeze({
      observationStore: observations.store,
      starProfileStore: starProfiles.store,
    }),
  );
  const publicationRepository: NeonRaceArchiveAggregatePublicationRepository =
    Object.freeze({
      async begin(request) {
        lifecycle.push("begin");
        expect(request.ownerId).toBe(OWNER);
        expect(request.refreshId).toBe(REFRESH);
        expect(request.raceDatasetVersionId).toBe(VERSION);
        expect(request.sourceVersionSetSha256).toBe(SOURCE_HASH);
        return "staging" as const;
      },
      async stageRows(request) {
        lifecycle.push(`stage:${request.family}`);
        staged.set(request.family, request.rows);
        return request.rows.length;
      },
      async publish(request) {
        lifecycle.push("publish");
        materializedRowCount =
          request.corePerformanceProfileCount +
          request.discoveryBenchmarkCount +
          request.payoutFormatProfileCount +
          request.coreStarProfileCount;
        expect(request.validatedEventCount).toBe(1);
        expect(request.acceptedFormatEntryCount).toBe(2);
        return Object.freeze({
          status: "published" as const,
          materializedRowCount,
        });
      },
    });
  const finalizerPrepare = vi.fn(async () => {
    lifecycle.push("finalize");
    return Object.freeze({
      preparedAggregateSetId: REFRESH,
      sourceVersionSetSha256: SOURCE_HASH,
      aggregateFamilyCount: 4,
      materializedRowCount:
        materializedRowCount + (input?.finalizerRowDelta ?? 0),
    });
  });
  const refresher = createSpillableRaceArchiveAggregateRefresher({
    planRepository: Object.freeze({ list: planList }),
    rehydrator: rehydrator(),
    scratchStoreFactory: Object.freeze({ create: scratchCreate }),
    publicationRepository,
    finalizer: Object.freeze({ prepare: finalizerPrepare }),
    workerId: "worker-1",
    now: () => new Date(REFRESHED_AT),
    maximumVersions: 10,
    maximumRowsPerStage: 2,
    bounds: Object.freeze({
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
    }),
  });
  return {
    refresher,
    planList,
    scratchCreate,
    finalizerPrepare,
    lifecycle,
    staged,
    observations,
    starProfiles,
  };
}

describe("spillable Race archive aggregate refresher", () => {
  it("publishes the bounded spillable rebuild before finalizing the same source set", async () => {
    const test = harness();

    const prepared = await test.refresher.prepare({
      ownerId: OWNER,
      updateSessionId: VERSION,
      refreshId: REFRESH,
      sourceVersionSetSha256: SOURCE_HASH,
    });

    expect(prepared).toEqual({
      preparedAggregateSetId: REFRESH,
      sourceVersionSetSha256: SOURCE_HASH,
      aggregateFamilyCount: 4,
      materializedRowCount: 7,
    });
    expect(test.planList).toHaveBeenCalledWith({
      ownerId: OWNER,
      refreshId: REFRESH,
      updateSessionId: VERSION,
      sourceVersionSetSha256: SOURCE_HASH,
      maximumVersions: 10,
    });
    expect(test.scratchCreate).toHaveBeenCalledWith({
      ownerId: OWNER,
      updateSessionId: VERSION,
      refreshId: REFRESH,
      sourceVersionSetSha256: SOURCE_HASH,
    });
    expect(test.lifecycle.at(-1)).toBe("finalize");
    expect(test.lifecycle.indexOf("publish")).toBeLessThan(
      test.lifecycle.indexOf("finalize"),
    );
    expect([...test.staged.keys()].sort()).toEqual([
      "core_performance",
      "core_star_profile",
      "discovery_benchmark",
      "payout_format",
    ]);
    expect(test.observations.runs.size).toBe(0);
    expect(test.starProfiles.runs.size).toBe(0);
  });

  it("fails closed when final sealing reports a different materialized row count", async () => {
    const test = harness({ finalizerRowDelta: 1 });

    await expect(
      test.refresher.prepare({
        ownerId: OWNER,
        updateSessionId: VERSION,
        refreshId: REFRESH,
        sourceVersionSetSha256: SOURCE_HASH,
      }),
    ).rejects.toThrow(/finalizer changed materialized row count/);
    expect(test.finalizerPrepare).toHaveBeenCalledTimes(1);
    expect(test.observations.runs.size).toBe(0);
    expect(test.starProfiles.runs.size).toBe(0);
  });

  it("rejects a plan that does not end at the requested Race version before scratch creation", async () => {
    const test = harness();
    test.planList.mockResolvedValueOnce(
      Object.freeze([
        Object.freeze({
          datasetVersionId: "other-version",
          importBatchId: BATCH,
          versionNumber: 1,
          sourceRowCount: 2,
          acceptedRowCount: 2,
          evidencePartitionCount: 1,
          evidenceRowCount: 2,
        }),
      ]),
    );

    await expect(
      test.refresher.prepare({
        ownerId: OWNER,
        updateSessionId: VERSION,
        refreshId: REFRESH,
        sourceVersionSetSha256: SOURCE_HASH,
      }),
    ).rejects.toThrow(/does not end at the target version/);
    expect(test.scratchCreate).not.toHaveBeenCalled();
  });
});
