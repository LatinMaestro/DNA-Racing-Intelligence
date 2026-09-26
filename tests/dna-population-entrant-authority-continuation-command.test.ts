import { describe, expect, it, vi } from "vitest";

import type { DnaPopulationEntrantAuthorityPreparedCohort } from "@/lib/dna-population-entrant-authority-cohort";
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
import {
  planDnaPopulationHistoryAcquisition,
  type DnaPopulationHistoryAcquisitionPlan,
} from "@/lib/dna-population-history-acquisition-plan";
import { createDnaOpenLabRequestBudget } from "@/lib/dna-open-lab-request-budget";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

const HEAD = "a".repeat(40);
const OWNER = "private-owner";
const COHORT_OBSERVED_AT = "2026-09-27T00:04:00.000Z";
const CONTINUATION_CAPACITY_AT = "2026-09-27T00:03:00.000Z";
const CURRENT_CAPACITY_AT = "2026-09-27T00:04:00.000Z";
const CHECKPOINT_UPDATED_AT = "2026-09-27T00:02:00.000Z";
const BOUNDARY = "b".repeat(64);

function audit() {
  const raceDocuments: readonly CanonicalRaceDocumentMetadata[] = Object.freeze(
    [
      Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId: "race-1",
        mode: "bike" as const,
      }),
      Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId: "race-2",
        mode: "bike" as const,
      }),
      Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId: "race-3",
        mode: "bike" as const,
      }),
    ],
  );
  const plan: DnaPopulationHistoryAcquisitionPlan =
    planDnaPopulationHistoryAcquisition({ raceDocuments });
  if (plan.unresolvedRaceSetSha256 === null) {
    throw new Error("synthetic authority unavailable");
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

const LIVE_AUDIT = audit();

function readiness(
  overrides: Partial<DnaPopulationEntrantAuthorityContinuationReadinessReceipt> = {},
): DnaPopulationEntrantAuthorityContinuationReadinessReceipt {
  return Object.freeze({
    version: DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION,
    status: "ready_for_continuation",
    exactCodeHeadSha: HEAD,
    unresolvedRaceCount: LIVE_AUDIT.authority.unresolvedRaceCount,
    unresolvedRaceSetSha256: LIVE_AUDIT.authority.unresolvedRaceSetSha256,
    recoveredChunkCount: 1,
    recoveredRaceCount: 2,
    nextChunkOrdinal: 2,
    checkpointUpdatedAt: CHECKPOINT_UPDATED_AT,
    capacityObservedAt: CURRENT_CAPACITY_AT,
    durableBoundarySha256: BOUNDARY,
    previewOnly: true,
    providerRequestPerformed: false,
    persistentWritePerformed: false,
    providerWritePerformed: false,
    paidUsageAllowed: false,
    ...overrides,
  });
}

function invocation(
  overrides: Partial<DnaPopulationEntrantAuthorityContinuationCommandInvocation> = {},
): DnaPopulationEntrantAuthorityContinuationCommandInvocation {
  return Object.freeze({
    commandVersion:
      DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_VERSION,
    intent: DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_INTENT,
    allowPersistentWrite: true,
    exactCodeHeadSha: HEAD,
    cohortObservedAt: COHORT_OBSERVED_AT,
    expectedUnresolvedRaceCount: LIVE_AUDIT.authority.unresolvedRaceCount,
    expectedUnresolvedRaceSetSha256:
      LIVE_AUDIT.authority.unresolvedRaceSetSha256,
    expectedRecoveredChunkCount: 1,
    expectedRecoveredRaceCount: 2,
    expectedNextChunkOrdinal: 2,
    expectedCheckpointUpdatedAt: CHECKPOINT_UPDATED_AT,
    continuationCapacityObservedAt: CONTINUATION_CAPACITY_AT,
    durableBoundarySha256: BOUNDARY,
    ...overrides,
  });
}

function runtime(): DnaPopulationEntrantAuthorityContinuationCommandRuntime {
  return Object.freeze({
    client: { raceDocs: vi.fn() },
    requestBudget: createDnaOpenLabRequestBudget(),
    capacityGate: {
      assertFreshCurrentCapacity: vi.fn(),
    },
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

function committed() {
  return Object.freeze({
    version: 1 as const,
    status: "committed" as const,
    authority: LIVE_AUDIT.authority,
    chunkOrdinal: 2,
    rowCount: 1,
    resolvedRaceCount: 1,
    quarantinedRaceCount: 0,
    bodySha256: "c".repeat(64),
    raceSetSha256: "d".repeat(64),
    recordSetSha256: "e".repeat(64),
    storageStatus: "created" as const,
    capacityObservedAt: "2026-09-27T00:05:00.000Z",
    checkpointRaceCountBefore: 2,
    checkpointRaceCountAfter: 3,
    authorityComplete: true,
    providerRequestPerformed: false as const,
    persistentWritePerformed: true as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}

function prepared(
  overrides: Partial<
    DnaPopulationEntrantAuthorityPreparedCohort["summary"]
  > = {},
): DnaPopulationEntrantAuthorityPreparedCohort {
  return Object.freeze({
    summary: Object.freeze({
      version: 1 as const,
      status: "prepared_uncommitted" as const,
      authority: LIVE_AUDIT.authority,
      recoveredRaceCount: 2,
      chunkOrdinal: 2,
      selectedRaceCount: 1,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 0,
      providerRequestCount: 1,
      preparationSource: "provider_hydration" as const,
      cohortSha256: "f".repeat(64),
      selectedRaceSetSha256: "1".repeat(64),
      preparedBodySha256: "2".repeat(64),
      preparedRecordSetSha256: "3".repeat(64),
      cohortObservedAt: COHORT_OBSERVED_AT,
      aggregateRequestsPerMinute: 30,
      providerRequestPerformed: true,
      persistentWritePerformed: false as const,
      providerWritePerformed: false as const,
      paidUsageAllowed: false as const,
      ...overrides,
    }),
    commit: vi.fn(async () => committed()),
  });
}

function command(input?: {
  readinessReceipt?: DnaPopulationEntrantAuthorityContinuationReadinessReceipt;
  events?: string[];
  cohortPreparer?: ReturnType<typeof vi.fn>;
  now?: () => Date;
}) {
  const events = input?.events ?? [];
  const continuationReadinessSource = Object.freeze({
    inspect: vi.fn(async () => {
      events.push("readiness");
      return input?.readinessReceipt ?? readiness();
    }),
  });
  const authoritySource = Object.freeze({
    load: vi.fn(async () => {
      events.push("authority");
      return LIVE_AUDIT;
    }),
  });
  const cohortPreparer =
    input?.cohortPreparer ??
    vi.fn(async () => {
      events.push("prepare");
      return prepared();
    });
  const value = createDnaPopulationEntrantAuthorityContinuationCommand({
    configuredOwnerId: OWNER,
    runtimeCodeHeadSha: HEAD,
    continuationReadinessSource,
    authoritySource,
    runtime: runtime(),
    now: input?.now ?? (() => new Date("2026-09-27T00:04:30.000Z")),
    cohortPreparer,
  });
  return {
    value,
    events,
    continuationReadinessSource,
    authoritySource,
    cohortPreparer,
  };
}

describe("population entrant single-next-cohort continuation command", () => {
  it("rejects missing persistent-write arming before any connected inspection", async () => {
    const test = command();

    await expect(
      test.value.execute({
        ...invocation(),
        allowPersistentWrite: false,
      } as unknown as DnaPopulationEntrantAuthorityContinuationCommandInvocation),
    ).rejects.toMatchObject({ diagnostic: "not_explicitly_armed" });

    expect(test.continuationReadinessSource.inspect).not.toHaveBeenCalled();
    expect(test.authoritySource.load).not.toHaveBeenCalled();
    expect(test.cohortPreparer).not.toHaveBeenCalled();
  });

  it("rejects stale caller continuation evidence before any connected inspection", async () => {
    const test = command({
      now: () => new Date("2026-09-27T00:08:00.001Z"),
    });

    await expect(test.value.execute(invocation())).rejects.toMatchObject({
      diagnostic: "stale_continuation_readiness",
    });

    expect(test.continuationReadinessSource.inspect).not.toHaveBeenCalled();
    expect(test.cohortPreparer).not.toHaveBeenCalled();
  });

  it("rejects future current capacity evidence before authority reload or provider preparation", async () => {
    const test = command({
      readinessReceipt: readiness({
        capacityObservedAt: "2026-09-27T00:04:30.001Z",
      }),
    });

    await expect(test.value.execute(invocation())).rejects.toMatchObject({
      diagnostic: "continuation_readiness_unavailable",
    });

    expect(test.events).toEqual(["readiness"]);
    expect(test.authoritySource.load).not.toHaveBeenCalled();
    expect(test.cohortPreparer).not.toHaveBeenCalled();
  });

  it("rejects durable boundary drift before authority reload or provider preparation", async () => {
    const test = command({
      readinessReceipt: readiness({
        durableBoundarySha256: "9".repeat(64),
      }),
    });

    await expect(test.value.execute(invocation())).rejects.toMatchObject({
      diagnostic: "continuation_boundary_mismatch",
      message: "Population entrant continuation command is unavailable",
    });

    expect(test.events).toEqual(["readiness"]);
    expect(test.authoritySource.load).not.toHaveBeenCalled();
    expect(test.cohortPreparer).not.toHaveBeenCalled();
  });

  it("rejects a newly observed capacity timestamp older than the supplied continuation receipt", async () => {
    const test = command({
      readinessReceipt: readiness({
        capacityObservedAt: "2026-09-27T00:02:59.999Z",
      }),
    });

    await expect(test.value.execute(invocation())).rejects.toMatchObject({
      diagnostic: "continuation_boundary_mismatch",
    });
    expect(test.cohortPreparer).not.toHaveBeenCalled();
  });

  it("revalidates exact continuation boundary before preparing exactly the next cohort", async () => {
    const events: string[] = [];
    const cohortPreparer = vi.fn(async (input) => {
      events.push("prepare");
      expect(input.expectedRecoveryBoundary).toEqual({
        recoveredChunkCount: 1,
        recoveredRaceCount: 2,
        nextChunkOrdinal: 2,
        checkpointUpdatedAt: CHECKPOINT_UPDATED_AT,
      });
      return prepared();
    });
    const test = command({ events, cohortPreparer });

    const session = await test.value.execute(invocation());

    expect(events).toEqual(["readiness", "authority", "prepare"]);
    expect(session.prepared).toMatchObject({
      status: "prepared_uncommitted",
      exactCodeHeadSha: HEAD,
      recoveredChunkCount: 1,
      recoveredRaceCount: 2,
      chunkOrdinal: 2,
      continuationCapacityObservedAt: CONTINUATION_CAPACITY_AT,
      currentCapacityObservedAt: CURRENT_CAPACITY_AT,
      checkpointUpdatedAt: CHECKPOINT_UPDATED_AT,
      durableBoundarySha256: BOUNDARY,
      persistentWriteArmed: true,
      previewOnly: true,
      entrantChunkPersistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(JSON.stringify(session.prepared)).not.toContain(OWNER);
    expect(JSON.stringify(session.prepared)).not.toContain("race-2");
  });

  it("accepts restart-safe pending R2 recovery without new provider requests", async () => {
    const cohortPreparer = vi.fn(async () =>
      prepared({
        preparationSource: "pending_r2_recovery",
        providerRequestCount: 0,
        providerRequestPerformed: false,
        cohortObservedAt: "2026-09-27T00:02:30.000Z",
      }),
    );
    const test = command({ cohortPreparer });

    const session = await test.value.execute(invocation());

    expect(session.prepared).toMatchObject({
      preparationSource: "pending_r2_recovery",
      providerRequestCount: 0,
      providerRequestPerformed: false,
      recoveredRaceCount: 2,
      chunkOrdinal: 2,
    });
  });

  it("commits only the revalidated next cohort and is idempotent within the session", async () => {
    const exactPrepared = prepared();
    const cohortPreparer = vi.fn(async () => exactPrepared);
    const test = command({
      cohortPreparer,
      now: (() => {
        const values = ["2026-09-27T00:04:30.000Z", "2026-09-27T00:05:00.000Z"];
        let index = 0;
        return () => new Date(values[Math.min(index++, 1)]!);
      })(),
    });

    const session = await test.value.execute(invocation());
    const first = await session.commit();
    const second = await session.commit();

    expect(first).toEqual(second);
    expect(exactPrepared.commit).toHaveBeenCalledOnce();
    expect(first).toMatchObject({
      status: "committed",
      exactCodeHeadSha: HEAD,
      recoveredChunkCountBefore: 1,
      chunkOrdinal: 2,
      rowCount: 1,
      checkpointRaceCountBefore: 2,
      checkpointRaceCountAfter: 3,
      authorityComplete: true,
      continuationCapacityObservedAt: CONTINUATION_CAPACITY_AT,
      boundaryCapacityObservedAt: CURRENT_CAPACITY_AT,
      commitCapacityObservedAt: "2026-09-27T00:05:00.000Z",
      durableBoundarySha256: BOUNDARY,
      persistentWritePerformed: true,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
  });

  it("fails closed if the committed checkpoint no longer advances from the verified boundary", async () => {
    const exactPrepared = prepared();
    const badPrepared = Object.freeze({
      ...exactPrepared,
      commit: vi.fn(async () =>
        Object.freeze({
          ...committed(),
          checkpointRaceCountBefore: 3,
          checkpointRaceCountAfter: 4,
        }),
      ),
    });
    const test = command({
      cohortPreparer: vi.fn(async () => badPrepared),
    });

    const session = await test.value.execute(invocation());

    await expect(session.commit()).rejects.toMatchObject({
      diagnostic: "cohort_unavailable",
    });
  });
});
