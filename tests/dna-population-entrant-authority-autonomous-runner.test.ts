import { describe, expect, it, vi } from "vitest";

import {
  createDnaPopulationEntrantAuthorityAutonomousRunner,
  DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_VERSION,
  type DnaPopulationEntrantAuthorityAutonomousBoundary,
} from "@/lib/dna-population-entrant-authority-autonomous-runner";
import type {
  DnaPopulationEntrantAuthorityContinuationCommandReceipt,
  DnaPopulationEntrantAuthorityContinuationCommandSession,
} from "@/lib/dna-population-entrant-authority-continuation-command";

const HEAD = "a".repeat(40);
const AUTHORITY = "b".repeat(64);
const STARTED_AT = "2026-09-28T00:00:00.000Z";
const CAPACITY_AT = "2026-09-28T00:00:30.000Z";

function boundary(
  input: {
    status?: "ready_for_continuation" | "authority_complete";
    recoveredChunkCount?: number;
    recoveredRaceCount?: number;
    checkpointUpdatedAt?: string;
    capacityObservedAt?: string;
    durableBoundarySha256?: string;
    unresolvedRaceCount?: number;
  } = {},
): DnaPopulationEntrantAuthorityAutonomousBoundary {
  const recoveredChunkCount = input.recoveredChunkCount ?? 2;
  const recoveredRaceCount = input.recoveredRaceCount ?? 2_000;
  const unresolvedRaceCount = input.unresolvedRaceCount ?? 4_000;
  return Object.freeze({
    version: 1 as const,
    status:
      input.status ??
      (recoveredRaceCount === unresolvedRaceCount
        ? "authority_complete"
        : "ready_for_continuation"),
    exactCodeHeadSha: HEAD,
    unresolvedRaceCount,
    unresolvedRaceSetSha256: AUTHORITY,
    recoveredChunkCount,
    recoveredRaceCount,
    nextChunkOrdinal: recoveredChunkCount + 1,
    checkpointUpdatedAt: input.checkpointUpdatedAt ?? STARTED_AT,
    capacityObservedAt: input.capacityObservedAt ?? CAPACITY_AT,
    durableBoundarySha256:
      input.durableBoundarySha256 ?? String(recoveredChunkCount).repeat(64),
    previewOnly: true as const,
    providerRequestPerformed: false as const,
    persistentWritePerformed: false as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}

function commit(input: {
  before: DnaPopulationEntrantAuthorityAutonomousBoundary;
  rowCount: number;
}): DnaPopulationEntrantAuthorityContinuationCommandReceipt {
  const after = input.before.recoveredRaceCount + input.rowCount;
  return Object.freeze({
    status: "committed" as const,
    exactCodeHeadSha: HEAD,
    cohortObservedAt: "2026-09-28T00:01:00.000Z",
    chunkOrdinal: input.before.nextChunkOrdinal,
    rowCount: input.rowCount,
    resolvedRaceCount: input.rowCount - 1,
    quarantinedRaceCount: 1,
    bodySha256: "c".repeat(64),
    raceSetSha256: "d".repeat(64),
    recordSetSha256: "e".repeat(64),
    checkpointRaceCountBefore: input.before.recoveredRaceCount,
    checkpointRaceCountAfter: after,
    authorityComplete: after === input.before.unresolvedRaceCount,
    storageStatus: "created" as const,
    checkpointUpdatedAt: input.before.checkpointUpdatedAt,
    durableBoundarySha256: input.before.durableBoundarySha256,
    readinessCapacityObservedAt: input.before.capacityObservedAt,
    revalidatedCapacityObservedAt: "2026-09-28T00:00:45.000Z",
    commitCapacityObservedAt: "2026-09-28T00:00:50.000Z",
    persistentWriteArmed: true as const,
    previewOnly: true as const,
    providerRequestPerformed: false as const,
    persistentWritePerformed: true as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
    preserveLastGood: true as const,
  });
}

function session(input: {
  before: DnaPopulationEntrantAuthorityAutonomousBoundary;
  rowCount?: number;
}): DnaPopulationEntrantAuthorityContinuationCommandSession {
  const receipt = commit({
    before: input.before,
    rowCount: input.rowCount ?? 1_000,
  });
  return Object.freeze({
    prepared: Object.freeze({
      status: "prepared_uncommitted" as const,
      exactCodeHeadSha: HEAD,
      cohortObservedAt: receipt.cohortObservedAt,
      recoveredChunkCount: input.before.recoveredChunkCount,
      recoveredRaceCount: input.before.recoveredRaceCount,
      chunkOrdinal: input.before.nextChunkOrdinal,
      selectedRaceCount: receipt.rowCount,
      resolvedRaceCount: receipt.resolvedRaceCount,
      quarantinedRaceCount: receipt.quarantinedRaceCount,
      providerRequestCount: 50,
      preparationSource: "provider_hydration" as const,
      checkpointUpdatedAt: input.before.checkpointUpdatedAt,
      durableBoundarySha256: input.before.durableBoundarySha256,
      readinessCapacityObservedAt: input.before.capacityObservedAt,
      revalidatedCapacityObservedAt: receipt.revalidatedCapacityObservedAt,
      cohortSha256: "f".repeat(64),
      selectedRaceSetSha256: receipt.raceSetSha256,
      preparedBodySha256: receipt.bodySha256,
      preparedRecordSetSha256: receipt.recordSetSha256,
      aggregateRequestsPerMinute: 90 as const,
      persistentWriteArmed: true as const,
      previewOnly: true as const,
      providerRequestPerformed: true,
      entrantChunkPersistentWritePerformed: false as const,
      providerWritePerformed: false as const,
      paidUsageAllowed: false as const,
      preserveLastGood: true as const,
    }),
    commit: vi.fn(async () => receipt),
  });
}

function invocation(
  acceptedBoundary: DnaPopulationEntrantAuthorityAutonomousBoundary,
) {
  return Object.freeze({
    runnerVersion: DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_VERSION,
    intent: DNA_POPULATION_ENTRANT_AUTHORITY_AUTONOMOUS_RUNNER_INTENT,
    allowPersistentWrite: true as const,
    exactCodeHeadSha: HEAD,
    acceptedBoundary,
  });
}

describe("population entrant authority autonomous runner", () => {
  it("yields an exact resumable boundary after the hosted cohort limit", async () => {
    const first = boundary();
    const second = boundary({
      recoveredChunkCount: 3,
      recoveredRaceCount: 3_000,
      checkpointUpdatedAt: "2026-09-28T00:02:00.000Z",
      capacityObservedAt: "2026-09-28T00:02:10.000Z",
      durableBoundarySha256: "3".repeat(64),
    });
    const inspect = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const executeContinuation = vi.fn(async () => session({ before: first }));
    const runner = createDnaPopulationEntrantAuthorityAutonomousRunner({
      runtimeCodeHeadSha: HEAD,
      boundaryInspector: { inspect },
      continuationCommand: { executeContinuation },
      now: () => new Date("2026-09-28T00:01:00.000Z"),
    });

    await expect(
      runner.runBoundedSession(invocation(first), 1),
    ).resolves.toMatchObject({
      status: "advanced",
      initialRecoveredRaceCount: 2_000,
      completedCohortCount: 1,
      boundary: {
        status: "ready_for_continuation",
        recoveredChunkCount: 3,
        recoveredRaceCount: 3_000,
        durableBoundarySha256: "3".repeat(64),
      },
      previewOnly: true,
      paidUsageAllowed: false,
    });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(executeContinuation).toHaveBeenCalledOnce();
  });

  it("rejects an invalid hosted cohort limit before inspecting durable state", async () => {
    const accepted = boundary();
    const inspect = vi.fn();
    const executeContinuation = vi.fn();
    const runner = createDnaPopulationEntrantAuthorityAutonomousRunner({
      runtimeCodeHeadSha: HEAD,
      boundaryInspector: { inspect },
      continuationCommand: { executeContinuation },
    });

    await expect(
      runner.runBoundedSession(invocation(accepted), 0),
    ).rejects.toMatchObject({ diagnostic: "invalid_configuration" });
    expect(inspect).not.toHaveBeenCalled();
    expect(executeContinuation).not.toHaveBeenCalled();
  });

  it("stops before the next cohort when the hosted exact-main guard fails", async () => {
    const accepted = boundary();
    const executeContinuation = vi.fn();
    const assertCurrentExactHead = vi.fn(async () => {
      throw new Error("main moved");
    });
    const runner = createDnaPopulationEntrantAuthorityAutonomousRunner({
      runtimeCodeHeadSha: HEAD,
      boundaryInspector: { inspect: vi.fn(async () => accepted) },
      continuationCommand: { executeContinuation },
      cohortGuard: { assertCurrentExactHead },
    });

    await expect(
      runner.runBoundedSession(invocation(accepted), 1),
    ).rejects.toMatchObject({ diagnostic: "boundary_drift" });
    expect(assertCurrentExactHead).toHaveBeenCalledWith(HEAD);
    expect(executeContinuation).not.toHaveBeenCalled();
  });

  it("advances bounded cohorts until independently verified exact completion", async () => {
    const first = boundary();
    const second = boundary({
      recoveredChunkCount: 3,
      recoveredRaceCount: 3_000,
      checkpointUpdatedAt: "2026-09-28T00:02:00.000Z",
      capacityObservedAt: "2026-09-28T00:02:10.000Z",
      durableBoundarySha256: "3".repeat(64),
    });
    const complete = boundary({
      status: "authority_complete",
      recoveredChunkCount: 4,
      recoveredRaceCount: 4_000,
      checkpointUpdatedAt: "2026-09-28T00:04:00.000Z",
      capacityObservedAt: "2026-09-28T00:04:10.000Z",
      durableBoundarySha256: "4".repeat(64),
    });
    const inspect = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(complete);
    const executeContinuation = vi
      .fn()
      .mockResolvedValueOnce(session({ before: first }))
      .mockResolvedValueOnce(session({ before: second }));
    const times = [
      new Date("2026-09-28T00:01:00.000Z"),
      new Date("2026-09-28T00:03:00.000Z"),
    ];
    const runner = createDnaPopulationEntrantAuthorityAutonomousRunner({
      runtimeCodeHeadSha: HEAD,
      boundaryInspector: { inspect },
      continuationCommand: { executeContinuation },
      now: () => times.shift() ?? new Date("invalid"),
    });

    await expect(
      runner.runToCompletion(invocation(first)),
    ).resolves.toMatchObject({
      status: "authority_complete",
      initialRecoveredRaceCount: 2_000,
      completedCohortCount: 2,
      recoveredChunkCount: 4,
      recoveredRaceCount: 4_000,
      previewOnly: true,
      paidUsageAllowed: false,
    });
    expect(inspect).toHaveBeenCalledTimes(3);
    expect(executeContinuation).toHaveBeenCalledTimes(2);
    expect(executeContinuation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        expectedRecoveredChunkCount: 3,
        expectedRecoveredRaceCount: 3_000,
        expectedNextChunkOrdinal: 4,
        durableBoundarySha256: "3".repeat(64),
      }),
    );
  });

  it("requires an explicit write arm before inspecting durable state", async () => {
    const accepted = boundary();
    const inspect = vi.fn();
    const executeContinuation = vi.fn();
    const runner = createDnaPopulationEntrantAuthorityAutonomousRunner({
      runtimeCodeHeadSha: HEAD,
      boundaryInspector: { inspect },
      continuationCommand: { executeContinuation },
    });

    await expect(
      runner.runToCompletion({
        ...invocation(accepted),
        allowPersistentWrite: false,
      } as unknown as ReturnType<typeof invocation>),
    ).rejects.toMatchObject({ diagnostic: "not_explicitly_armed" });
    expect(inspect).not.toHaveBeenCalled();
    expect(executeContinuation).not.toHaveBeenCalled();
  });

  it("fails closed when the accepted boundary has drifted", async () => {
    const accepted = boundary();
    const drifted = boundary({ durableBoundarySha256: "9".repeat(64) });
    const executeContinuation = vi.fn();
    const runner = createDnaPopulationEntrantAuthorityAutonomousRunner({
      runtimeCodeHeadSha: HEAD,
      boundaryInspector: { inspect: vi.fn(async () => drifted) },
      continuationCommand: { executeContinuation },
    });

    await expect(
      runner.runToCompletion(invocation(accepted)),
    ).rejects.toMatchObject({ diagnostic: "boundary_drift" });
    expect(executeContinuation).not.toHaveBeenCalled();
  });

  it("stops after commit when the durable post-boundary is inconsistent", async () => {
    const accepted = boundary();
    const inconsistent = boundary({
      recoveredChunkCount: 3,
      recoveredRaceCount: 2_999,
      checkpointUpdatedAt: "2026-09-28T00:02:00.000Z",
      capacityObservedAt: "2026-09-28T00:02:10.000Z",
      durableBoundarySha256: "3".repeat(64),
    });
    const inspect = vi
      .fn()
      .mockResolvedValueOnce(accepted)
      .mockResolvedValueOnce(inconsistent);
    const executeContinuation = vi.fn(async () =>
      session({ before: accepted }),
    );
    const runner = createDnaPopulationEntrantAuthorityAutonomousRunner({
      runtimeCodeHeadSha: HEAD,
      boundaryInspector: { inspect },
      continuationCommand: { executeContinuation },
      now: () => new Date("2026-09-28T00:01:00.000Z"),
    });

    await expect(
      runner.runToCompletion(invocation(accepted)),
    ).rejects.toMatchObject({ diagnostic: "boundary_drift" });
    expect(executeContinuation).toHaveBeenCalledOnce();
  });

  it("requires an independent durable completion boundary", async () => {
    const accepted = boundary({ unresolvedRaceCount: 3_000 });
    const stillReady = boundary({
      unresolvedRaceCount: 3_000,
      recoveredChunkCount: 3,
      recoveredRaceCount: 2_999,
      checkpointUpdatedAt: "2026-09-28T00:02:00.000Z",
      capacityObservedAt: "2026-09-28T00:02:10.000Z",
      durableBoundarySha256: "3".repeat(64),
    });
    const runner = createDnaPopulationEntrantAuthorityAutonomousRunner({
      runtimeCodeHeadSha: HEAD,
      boundaryInspector: {
        inspect: vi
          .fn()
          .mockResolvedValueOnce(accepted)
          .mockResolvedValueOnce(stillReady),
      },
      continuationCommand: {
        executeContinuation: vi.fn(async () =>
          session({ before: accepted, rowCount: 1_000 }),
        ),
      },
      now: () => new Date("2026-09-28T00:01:00.000Z"),
    });

    await expect(
      runner.runToCompletion(invocation(accepted)),
    ).rejects.toMatchObject({ diagnostic: "completion_unverified" });
  });

  it("is a no-write replay when the accepted authority is already complete", async () => {
    const complete = boundary({
      status: "authority_complete",
      recoveredChunkCount: 4,
      recoveredRaceCount: 4_000,
      checkpointUpdatedAt: "2026-09-28T00:04:00.000Z",
      capacityObservedAt: "2026-09-28T00:04:10.000Z",
      durableBoundarySha256: "4".repeat(64),
    });
    const executeContinuation = vi.fn();
    const runner = createDnaPopulationEntrantAuthorityAutonomousRunner({
      runtimeCodeHeadSha: HEAD,
      boundaryInspector: { inspect: vi.fn(async () => complete) },
      continuationCommand: { executeContinuation },
    });

    await expect(
      runner.runToCompletion(invocation(complete)),
    ).resolves.toMatchObject({
      status: "authority_complete",
      completedCohortCount: 0,
      recoveredRaceCount: 4_000,
    });
    expect(executeContinuation).not.toHaveBeenCalled();
  });

  it("sanitizes provider, capacity and persistence failures", async () => {
    const accepted = boundary();
    const runner = createDnaPopulationEntrantAuthorityAutonomousRunner({
      runtimeCodeHeadSha: HEAD,
      boundaryInspector: { inspect: vi.fn(async () => accepted) },
      continuationCommand: {
        executeContinuation: vi.fn(async () => {
          throw new Error("private provider and object detail");
        }),
      },
      now: () => new Date("2026-09-28T00:01:00.000Z"),
    });

    const error = await runner
      .runToCompletion(invocation(accepted))
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ diagnostic: "continuation_unavailable" });
    expect(String(error)).not.toContain("private provider and object detail");
  });
});
