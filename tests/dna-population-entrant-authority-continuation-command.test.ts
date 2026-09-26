import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  createDnaPopulationEntrantAuthorityContinuationCommand,
  DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_VERSION,
  type DnaPopulationEntrantAuthorityContinuationCommandInvocation,
  type DnaPopulationEntrantAuthorityContinuationCommandRuntime,
} from "@/lib/dna-population-entrant-authority-continuation-command";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION,
  type DnaPopulationEntrantAuthorityContinuationReadinessReceipt,
} from "@/lib/dna-population-entrant-authority-continuation-readiness";
import type {
  DnaPopulationEntrantAuthorityCommittedCohortSummary,
  DnaPopulationEntrantAuthorityPreparedCohort,
} from "@/lib/dna-population-entrant-authority-cohort";
import type { DnaPopulationEntrantAuthorityLiveAudit } from "@/lib/dna-population-entrant-authority-cohort-command";
import {
  planDnaPopulationHistoryAcquisition,
  type DnaPopulationHistoryAcquisitionPlan,
} from "@/lib/dna-population-history-acquisition-plan";
import { createDnaOpenLabRequestBudget } from "@/lib/dna-open-lab-request-budget";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

const HEAD = "a".repeat(40);
const OTHER_HASH = "f".repeat(64);
const OWNER = "private-owner";
const CHECKPOINT_AT = "2026-09-26T06:02:00.000Z";
const OBSERVED_AT = "2026-09-26T06:03:00.000Z";
const CAPACITY_AT = "2026-09-26T06:04:00.000Z";
const NOW_AT = "2026-09-26T06:05:00.000Z";
const COMMIT_AT = "2026-09-26T06:06:00.000Z";

function audit(): DnaPopulationEntrantAuthorityLiveAudit {
  const raceDocuments: readonly CanonicalRaceDocumentMetadata[] = Object.freeze(
    ["race-1", "race-2", "race-3"].map((sourceRaceId) =>
      Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId,
        mode: "bike" as const,
      }),
    ),
  );
  const plan: DnaPopulationHistoryAcquisitionPlan =
    planDnaPopulationHistoryAcquisition({ raceDocuments });
  if (plan.unresolvedRaceSetSha256 === null) {
    throw new Error("synthetic unresolved authority unavailable");
  }
  return Object.freeze({
    exactCodeHeadSha: HEAD,
    plan,
    raceDocuments,
    authority: Object.freeze({
      version: 1 as const,
      generationId: plan.unresolvedRaceSetSha256,
      unresolvedRaceCount: plan.unresolvedRaceCount,
      unresolvedRaceSetSha256: plan.unresolvedRaceSetSha256,
    }),
  });
}

const LIVE = audit();
const BOUNDARY = Object.freeze({
  recoveredChunkCount: 1,
  recoveredRaceCount: 2,
  nextChunkOrdinal: 2,
  checkpointUpdatedAt: CHECKPOINT_AT,
  durableBoundarySha256: "d".repeat(64),
});

function readiness(
  overrides: Partial<DnaPopulationEntrantAuthorityContinuationReadinessReceipt> = {},
): DnaPopulationEntrantAuthorityContinuationReadinessReceipt {
  return Object.freeze({
    version: DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION,
    status: "ready_for_continuation" as const,
    exactCodeHeadSha: HEAD,
    unresolvedRaceCount: LIVE.authority.unresolvedRaceCount,
    unresolvedRaceSetSha256: LIVE.authority.unresolvedRaceSetSha256,
    recoveredChunkCount: BOUNDARY.recoveredChunkCount,
    recoveredRaceCount: BOUNDARY.recoveredRaceCount,
    nextChunkOrdinal: BOUNDARY.nextChunkOrdinal,
    checkpointUpdatedAt: BOUNDARY.checkpointUpdatedAt,
    capacityObservedAt: CAPACITY_AT,
    durableBoundarySha256: BOUNDARY.durableBoundarySha256,
    previewOnly: true as const,
    providerRequestPerformed: false as const,
    persistentWritePerformed: false as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
    ...overrides,
  });
}

const invocation: DnaPopulationEntrantAuthorityContinuationCommandInvocation =
  Object.freeze({
    commandVersion:
      DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_VERSION,
    intent: DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_INTENT,
    allowPersistentWrite: true,
    exactCodeHeadSha: HEAD,
    cohortObservedAt: OBSERVED_AT,
    expectedUnresolvedRaceCount: LIVE.authority.unresolvedRaceCount,
    expectedUnresolvedRaceSetSha256: LIVE.authority.unresolvedRaceSetSha256,
    expectedRecoveredChunkCount: BOUNDARY.recoveredChunkCount,
    expectedRecoveredRaceCount: BOUNDARY.recoveredRaceCount,
    expectedNextChunkOrdinal: BOUNDARY.nextChunkOrdinal,
    expectedCheckpointUpdatedAt: BOUNDARY.checkpointUpdatedAt,
    expectedDurableBoundarySha256: BOUNDARY.durableBoundarySha256,
  });

function committed(): DnaPopulationEntrantAuthorityCommittedCohortSummary {
  return Object.freeze({
    version: 1 as const,
    status: "committed" as const,
    authority: LIVE.authority,
    chunkOrdinal: 2,
    rowCount: 1,
    resolvedRaceCount: 1,
    quarantinedRaceCount: 0,
    bodySha256: "b".repeat(64),
    raceSetSha256: "c".repeat(64),
    recordSetSha256: "e".repeat(64),
    storageStatus: "created" as const,
    capacityObservedAt: COMMIT_AT,
    checkpointRaceCountBefore: 2,
    checkpointRaceCountAfter: 3,
    authorityComplete: true,
    providerRequestPerformed: false,
    persistentWritePerformed: true,
    providerWritePerformed: false,
    paidUsageAllowed: false,
  });
}

function prepared(
  overrides: Partial<DnaPopulationEntrantAuthorityPreparedCohort["summary"]> = {},
): DnaPopulationEntrantAuthorityPreparedCohort {
  return Object.freeze({
    summary: Object.freeze({
      version: 1 as const,
      status: "prepared_uncommitted" as const,
      authority: LIVE.authority,
      recoveredRaceCount: 2,
      chunkOrdinal: 2,
      selectedRaceCount: 1,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 0,
      providerRequestCount: 1,
      preparationSource: "provider_hydration" as const,
      cohortSha256: "1".repeat(64),
      selectedRaceSetSha256: "2".repeat(64),
      preparedBodySha256: "3".repeat(64),
      preparedRecordSetSha256: "4".repeat(64),
      cohortObservedAt: OBSERVED_AT,
      aggregateRequestsPerMinute: 30,
      providerRequestPerformed: true,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
      ...overrides,
    }),
    commit: vi.fn(async () => committed()),
  });
}

function runtime(): DnaPopulationEntrantAuthorityContinuationCommandRuntime {
  return Object.freeze({
    client: { raceDocs: vi.fn() },
    requestBudget: createDnaOpenLabRequestBudget(),
    capacityGate: { assertFreshCurrentCapacity: vi.fn() },
    checkpointRepository: {
      read: vi.fn(),
      listChunkManifests: vi.fn(),
      registerChunk: vi.fn(),
    },
    r2Store: {
      read: vi.fn(),
      findPending: vi.fn(),
      write: vi.fn(),
    },
  }) as unknown as DnaPopulationEntrantAuthorityContinuationCommandRuntime;
}

function clock(values: readonly string[]) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]!);
}

describe("DNA population entrant authority continuation command", () => {
  it("revalidates the accepted durable boundary before preparing and commits exactly the next cohort", async () => {
    const inspect = vi.fn(async () => readiness());
    const load = vi.fn(async () => LIVE);
    const cohortPreparer = vi.fn(async () => prepared());
    const command = createDnaPopulationEntrantAuthorityContinuationCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load },
      continuationReadiness: { inspect },
      runtime: runtime(),
      now: clock([NOW_AT, COMMIT_AT]),
      cohortPreparer,
    });

    const session = await command.execute(invocation);

    expect(inspect).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
    expect(cohortPreparer).toHaveBeenCalledWith(
      expect.objectContaining({
        cohortObservedAt: OBSERVED_AT,
        expectedRecoveryBoundary: {
          recoveredRaceCount: 2,
          nextChunkOrdinal: 2,
          checkpointUpdatedAt: CHECKPOINT_AT,
        },
      }),
    );
    expect(session.prepared).toMatchObject({
      status: "prepared_uncommitted",
      recoveredChunkCountBeforePreparation: 1,
      recoveredRaceCount: 2,
      chunkOrdinal: 2,
      continuationCapacityObservedAt: CAPACITY_AT,
      durableBoundarySha256: BOUNDARY.durableBoundarySha256,
      persistentWriteArmed: true,
      previewOnly: true,
      entrantChunkPersistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });

    const receipt = await session.commit();

    expect(receipt).toMatchObject({
      status: "committed",
      chunkOrdinal: 2,
      checkpointRaceCountBefore: 2,
      checkpointRaceCountAfter: 3,
      authorityComplete: true,
      continuationCapacityObservedAt: CAPACITY_AT,
      durableBoundarySha256: BOUNDARY.durableBoundarySha256,
      persistentWriteArmed: true,
      previewOnly: true,
      persistentWritePerformed: true,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
  });

  it("rejects a stale caller boundary before authority loading or cohort preparation", async () => {
    const inspect = vi.fn(async () =>
      readiness({ durableBoundarySha256: OTHER_HASH }),
    );
    const load = vi.fn(async () => LIVE);
    const cohortPreparer = vi.fn(async () => prepared());
    const command = createDnaPopulationEntrantAuthorityContinuationCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load },
      continuationReadiness: { inspect },
      runtime: runtime(),
      now: () => new Date(NOW_AT),
      cohortPreparer,
    });

    await expect(command.execute(invocation)).rejects.toMatchObject({
      diagnostic: "continuation_boundary_mismatch",
      message: "Population entrant continuation command is unavailable",
    });
    expect(load).not.toHaveBeenCalled();
    expect(cohortPreparer).not.toHaveBeenCalled();
  });

  it("sanitizes read-only continuation readiness failures before cohort preparation", async () => {
    const load = vi.fn(async () => LIVE);
    const cohortPreparer = vi.fn(async () => prepared());
    const command = createDnaPopulationEntrantAuthorityContinuationCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load },
      continuationReadiness: {
        inspect: vi.fn(async () => {
          throw new Error("sensitive-detail");
        }),
      },
      runtime: runtime(),
      now: () => new Date(NOW_AT),
      cohortPreparer,
    });

    const error = await command
      .execute(invocation)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "continuation_readiness_unavailable",
      message: "Population entrant continuation command is unavailable",
    });
    expect(String(error)).not.toContain("sensitive-detail");
    expect(load).not.toHaveBeenCalled();
    expect(cohortPreparer).not.toHaveBeenCalled();
  });

  it("fails closed when preparation no longer matches the revalidated recovery boundary", async () => {
    const cohortPreparer = vi.fn(async () =>
      prepared({ recoveredRaceCount: 3, chunkOrdinal: 3 }),
    );
    const command = createDnaPopulationEntrantAuthorityContinuationCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load: vi.fn(async () => LIVE) },
      continuationReadiness: { inspect: vi.fn(async () => readiness()) },
      runtime: runtime(),
      now: () => new Date(NOW_AT),
      cohortPreparer,
    });

    await expect(command.execute(invocation)).rejects.toMatchObject({
      diagnostic: "cohort_unavailable",
    });
  });

  it("places the generic recovery-boundary guard before pending recovery and provider hydration", async () => {
    const source = await readFile(
      "lib/dna-population-entrant-authority-cohort.ts",
      "utf8",
    );
    const guard = source.indexOf("input.expectedRecoveryBoundary");
    const pending = source.indexOf("input.r2Store.findPending");
    const hydration = source.indexOf("hydrateDnaRaceDocumentsWithQuarantine({");

    expect(guard).toBeGreaterThan(0);
    expect(pending).toBeGreaterThan(guard);
    expect(hydration).toBeGreaterThan(pending);
  });
});
