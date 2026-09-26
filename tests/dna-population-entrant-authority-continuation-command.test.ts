import { describe, expect, it, vi } from "vitest";

import type {
  DnaPopulationEntrantAuthorityCommittedCohortSummary,
  DnaPopulationEntrantAuthorityPreparedCohort,
} from "@/lib/dna-population-entrant-authority-cohort";
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
const CHECKPOINT_AT = "2026-09-27T00:00:00.000Z";
const CAPACITY_AT = "2026-09-27T00:01:00.000Z";
const REVALIDATED_AT = "2026-09-27T00:01:30.000Z";
const OBSERVED_AT = "2026-09-27T00:01:40.000Z";
const COMMITTED_AT = "2026-09-27T00:02:00.000Z";
const BOUNDARY = "f".repeat(64);

function audit() {
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
  if (plan.unresolvedRaceSetSha256 === null) throw new Error("no authority");
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

const AUDIT = audit();

function readiness(
  overrides: Partial<DnaPopulationEntrantAuthorityContinuationReadinessReceipt> = {},
): DnaPopulationEntrantAuthorityContinuationReadinessReceipt {
  return Object.freeze({
    version: DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION,
    status: "ready_for_continuation" as const,
    exactCodeHeadSha: HEAD,
    unresolvedRaceCount: 3,
    unresolvedRaceSetSha256: AUDIT.authority.unresolvedRaceSetSha256,
    recoveredChunkCount: 1,
    recoveredRaceCount: 2,
    nextChunkOrdinal: 2,
    checkpointUpdatedAt: CHECKPOINT_AT,
    capacityObservedAt: CAPACITY_AT,
    durableBoundarySha256: BOUNDARY,
    previewOnly: true as const,
    providerRequestPerformed: false as const,
    persistentWritePerformed: false as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
    ...overrides,
  });
}

const INVOCATION: DnaPopulationEntrantAuthorityContinuationCommandInvocation =
  Object.freeze({
    commandVersion:
      DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_VERSION,
    intent: DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_COMMAND_INTENT,
    allowPersistentWrite: true,
    exactCodeHeadSha: HEAD,
    cohortObservedAt: OBSERVED_AT,
    expectedUnresolvedRaceCount: 3,
    expectedUnresolvedRaceSetSha256: AUDIT.authority.unresolvedRaceSetSha256,
    expectedRecoveredChunkCount: 1,
    expectedRecoveredRaceCount: 2,
    expectedNextChunkOrdinal: 2,
    expectedCheckpointUpdatedAt: CHECKPOINT_AT,
    readinessCapacityObservedAt: CAPACITY_AT,
    durableBoundarySha256: BOUNDARY,
  });

function committed(): DnaPopulationEntrantAuthorityCommittedCohortSummary {
  return Object.freeze({
    version: 1 as const,
    status: "committed" as const,
    authority: AUDIT.authority,
    chunkOrdinal: 2,
    rowCount: 1,
    resolvedRaceCount: 1,
    quarantinedRaceCount: 0,
    bodySha256: "b".repeat(64),
    raceSetSha256: "c".repeat(64),
    recordSetSha256: "d".repeat(64),
    storageStatus: "created" as const,
    capacityObservedAt: COMMITTED_AT,
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
  overrides: Partial<
    DnaPopulationEntrantAuthorityPreparedCohort["summary"]
  > = {},
): DnaPopulationEntrantAuthorityPreparedCohort {
  return Object.freeze({
    summary: Object.freeze({
      version: 1 as const,
      status: "prepared_uncommitted" as const,
      authority: AUDIT.authority,
      recoveredRaceCount: 2,
      chunkOrdinal: 2,
      selectedRaceCount: 1,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 0,
      providerRequestCount: 1,
      preparationSource: "provider_hydration" as const,
      cohortSha256: "a".repeat(64),
      selectedRaceSetSha256: "c".repeat(64),
      preparedBodySha256: "b".repeat(64),
      preparedRecordSetSha256: "d".repeat(64),
      cohortObservedAt: OBSERVED_AT,
      aggregateRequestsPerMinute: 30 as const,
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
    capacityGate: {
      assertFreshCurrentCapacity: vi.fn(async () =>
        Object.freeze({
          version: 1 as const,
          generationId: AUDIT.authority.generationId,
          unresolvedRaceCount: 3,
          unresolvedRaceSetSha256: AUDIT.authority.unresolvedRaceSetSha256,
          observedAt: REVALIDATED_AT,
          capacityAllowed: true as const,
          paidUsageAllowed: false as const,
        }),
      ),
    },
    checkpointRepository: {
      read: vi.fn(),
      listChunkManifests: vi.fn(),
      registerChunk: vi.fn(),
    },
    r2Store: { read: vi.fn(), findPending: vi.fn(), write: vi.fn() },
  });
}

function command(
  input: {
    readiness?: DnaPopulationEntrantAuthorityContinuationReadinessReceipt;
    cohort?: DnaPopulationEntrantAuthorityPreparedCohort;
    liveAudit?: ReturnType<typeof audit>;
    runtime?: DnaPopulationEntrantAuthorityContinuationCommandRuntime;
  } = {},
) {
  const load = vi.fn(async () => input.liveAudit ?? AUDIT);
  const inspect = vi.fn(async () => input.readiness ?? readiness());
  const cohortPreparer = vi.fn(async () => input.cohort ?? prepared());
  return {
    load,
    inspect,
    cohortPreparer,
    command: createDnaPopulationEntrantAuthorityContinuationCommand({
      configuredOwnerId: OWNER,
      runtimeCodeHeadSha: HEAD,
      authoritySource: { load },
      continuationReadiness: { inspect },
      runtime: input.runtime ?? runtime(),
      now: () => new Date(COMMITTED_AT),
      cohortPreparer,
    }),
  };
}

describe("population entrant authority continuation command", () => {
  it("revalidates the exact durable boundary before one idempotent commit", async () => {
    const test = command();
    const session = await test.command.executeContinuation(INVOCATION);
    expect(session.prepared).toMatchObject({
      recoveredChunkCount: 1,
      recoveredRaceCount: 2,
      chunkOrdinal: 2,
      durableBoundarySha256: BOUNDARY,
      persistentWriteArmed: true,
      previewOnly: true,
      paidUsageAllowed: false,
    });
    const first = await session.commit();
    const second = await session.commit();
    expect(first).toBe(second);
    expect(first).toMatchObject({
      checkpointRaceCountBefore: 2,
      checkpointRaceCountAfter: 3,
      authorityComplete: true,
    });
    expect(test.inspect).toHaveBeenCalledOnce();
    expect(test.load).toHaveBeenCalledOnce();
    expect(test.cohortPreparer).toHaveBeenCalledOnce();
  });

  it("rejects missing arming and stale/tampered boundary evidence before hydration", async () => {
    const unarmed = command();
    await expect(
      unarmed.command.executeContinuation({
        ...INVOCATION,
        allowPersistentWrite: false,
      } as unknown as DnaPopulationEntrantAuthorityContinuationCommandInvocation),
    ).rejects.toMatchObject({ diagnostic: "not_explicitly_armed" });
    expect(unarmed.inspect).not.toHaveBeenCalled();

    const stale = command();
    await expect(
      stale.command.executeContinuation({
        ...INVOCATION,
        readinessCapacityObservedAt: "2026-09-26T23:50:00.000Z",
      }),
    ).rejects.toMatchObject({ diagnostic: "stale_boundary_binding" });
    expect(stale.inspect).not.toHaveBeenCalled();

    const tampered = command({
      readiness: readiness({ durableBoundarySha256: "e".repeat(64) }),
    });
    await expect(
      tampered.command.executeContinuation(INVOCATION),
    ).rejects.toMatchObject({ diagnostic: "durable_boundary_mismatch" });
    expect(tampered.load).not.toHaveBeenCalled();
    expect(tampered.cohortPreparer).not.toHaveBeenCalled();
  });

  it("rejects checkpoint drift discovered during preparation before commit", async () => {
    const drifted = prepared({ recoveredRaceCount: 1 });
    const test = command({ cohort: drifted });
    await expect(
      test.command.executeContinuation(INVOCATION),
    ).rejects.toMatchObject({ diagnostic: "cohort_unavailable" });
    expect(drifted.commit).not.toHaveBeenCalled();
  });

  it("fails closed on live authority drift and loss of zero-cost capacity", async () => {
    const driftedAudit = Object.freeze({
      ...AUDIT,
      authority: Object.freeze({
        ...AUDIT.authority,
        unresolvedRaceCount: 4,
      }),
    });
    const authorityDrift = command({ liveAudit: driftedAudit });
    await expect(
      authorityDrift.command.executeContinuation(INVOCATION),
    ).rejects.toMatchObject({ diagnostic: "authority_binding_mismatch" });
    expect(authorityDrift.cohortPreparer).not.toHaveBeenCalled();

    const baseRuntime = runtime();
    const blockedRuntime = Object.freeze({
      ...baseRuntime,
      capacityGate: Object.freeze({
        assertFreshCurrentCapacity: vi.fn(async () => {
          throw new Error("private capacity detail");
        }),
      }),
    });
    const capacityLoss = command({ runtime: blockedRuntime });
    const error = await capacityLoss.command
      .executeContinuation(INVOCATION)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ diagnostic: "preflight_unavailable" });
    expect(String(error)).not.toContain("private capacity detail");
    expect(capacityLoss.cohortPreparer).not.toHaveBeenCalled();
  });

  it("accepts an interrupted R2-first recovery without duplicate provider hydration", async () => {
    const recovery = prepared({
      preparationSource: "pending_r2_recovery",
      providerRequestCount: 0,
      providerRequestPerformed: false,
    });
    const session = await command({
      cohort: recovery,
    }).command.executeContinuation(INVOCATION);
    expect(session.prepared).toMatchObject({
      preparationSource: "pending_r2_recovery",
      providerRequestCount: 0,
      providerRequestPerformed: false,
    });
  });
});
