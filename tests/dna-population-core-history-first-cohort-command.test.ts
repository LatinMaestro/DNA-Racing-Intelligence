import { describe, expect, it, vi } from "vitest";

import {
  applyDnaCoreRaceHistoryPageReceipt,
  completeDnaCoreRaceHistoryAcquisitionCycle,
  createDnaCoreRaceHistoryAcquisitionCycle,
  createDnaCoreRaceHistoryCoreCheckpoint,
  createDnaCoreRaceHistoryPageReceipt,
  type DnaCoreRaceHistoryAcquisitionRepository,
  type DnaCoreRaceHistoryAcquisitionCycle,
  type StoredDnaCoreRaceHistoryAcquisitionCycle,
} from "@/lib/dna-core-race-history-acquisition-cycle";
import {
  DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_AUTHORITY_VERSION,
  type DnaPopulationCoreHistoryFirstCohortAuthority,
} from "@/lib/dna-population-core-history-first-cohort-authority";
import {
  createDnaPopulationCoreHistoryFirstCohortCommand,
  DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_INTENT,
  DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_VERSION,
  verifyDnaPopulationCoreHistoryFirstCohort,
  type DnaPopulationCoreHistoryFirstCohortCommandInvocation,
  type DnaPopulationCoreHistoryFirstCohortCommandReceipt,
} from "@/lib/dna-population-core-history-first-cohort-command";
import type { DnaOpenLabProviderCapacityPreflight } from "@/lib/dna-open-lab-provider-capacity-preflight";
import { dnaPopulationPersistedCoreSetSha256 } from "@/lib/dna-population-history-acquisition-plan";

const HEAD = "a".repeat(40);
const SHA = "b".repeat(64);
const EVALUATED_AT = "2026-10-03T00:00:00.000Z";
const NOW = "2026-10-03T00:01:00.000Z";
const PREDECESSOR_CORE_IDS = Object.freeze([10, 11]);
const SELECTED_CORE_ID = 12;

function authority(
  overrides: Partial<DnaPopulationCoreHistoryFirstCohortAuthority> = {},
): DnaPopulationCoreHistoryFirstCohortAuthority {
  return Object.freeze({
    authorityVersion:
      DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_AUTHORITY_VERSION,
    exactCodeHeadSha: HEAD,
    cohortOrdinal: 0,
    cohortOffset: 0,
    coreIds: Object.freeze([SELECTED_CORE_ID]) as readonly [number],
    populationCoreCount: 3,
    persistedPerformanceCoreCount: PREDECESSOR_CORE_IDS.length,
    populationCoreSetSha256: "1".repeat(64),
    persistedPerformanceCoreSetSha256:
      dnaPopulationPersistedCoreSetSha256(PREDECESSOR_CORE_IDS)!,
    acquisitionCoreSetSha256: "2".repeat(64),
    selectedCoreSetSha256: "3".repeat(64),
    measurementSliceSha256: "4".repeat(64),
    providerRequestCount: 3,
    projectedPersistentR2Usage: Object.freeze({
      storageBytes: 50_000_000,
      classAOperations: 6,
      classBOperations: 21,
    }),
    populationUniverseCompleteness: "partial_due_to_unresolved_races",
    unresolvedRaceCount: 100,
    capacityPreflightRequired: true,
    providerReadAllowed: false,
    persistentWriteAllowed: false,
    paidUsageAllowed: false,
    previewOnly: true,
    ...overrides,
  });
}

function invocation(
  source = authority(),
): DnaPopulationCoreHistoryFirstCohortCommandInvocation {
  return Object.freeze({
    commandVersion: DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_VERSION,
    intent: DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_INTENT,
    allowPersistentWrite: true,
    exactCodeHeadSha: source.exactCodeHeadSha,
    evaluatedAt: EVALUATED_AT,
    maximumSteps: 4,
    populationCoreSetSha256: source.populationCoreSetSha256,
    persistedPerformanceCoreSetSha256: source.persistedPerformanceCoreSetSha256,
    acquisitionCoreSetSha256: source.acquisitionCoreSetSha256,
    selectedCoreSetSha256: source.selectedCoreSetSha256,
    measurementSliceSha256: source.measurementSliceSha256,
  });
}

function capacity(
  status: "ready" | "held" = "ready",
): DnaOpenLabProviderCapacityPreflight {
  return Object.freeze({
    inspect: vi.fn(async (request) =>
      status === "held"
        ? Object.freeze({
            status: "held" as const,
            readyForRefresh: false as const,
            reason: "capacity_blocked" as const,
            blockerIds: Object.freeze(["storage_budget_exhausted"] as const),
            persistentWritePerformed: false as const,
            providerWritePerformed: false as const,
            paidUsageAllowed: false as const,
            preserveLastGood: true as const,
          })
        : (Object.freeze({
            status: "ready" as const,
            readyForRefresh: true as const,
            exactCodeHeadSha: request.exactCodeHeadSha,
            ownerScopeSha256: "5".repeat(64),
            refreshCycleId: request.refreshCycleId,
            budgetWindowId: request.budgetWindowId,
            measurementSha256: "6".repeat(64),
            planSha256: "7".repeat(64),
            preflightSha256: "8".repeat(64),
            checkedAt: NOW,
            validUntil: "2026-10-03T00:06:00.000Z",
            projection: {},
            persistentWritePerformed: false as const,
            providerWritePerformed: false as const,
            paidUsageAllowed: false as const,
            preserveLastGood: true as const,
          }) as never),
    ),
  });
}

async function completeReceipt(
  source = authority(),
): Promise<DnaPopulationCoreHistoryFirstCohortCommandReceipt> {
  const runCollectionStep = vi
    .fn()
    .mockResolvedValueOnce({
      kind: "page_advanced",
      source: "provider",
      stored: {},
    })
    .mockResolvedValueOnce({ kind: "collection_complete", stored: {} });
  return createDnaPopulationCoreHistoryFirstCohortCommand({
    configuredOwnerId: "owner",
    authority: source,
    capacityPreflight: capacity(),
    runCollectionStep,
    now: () => new Date(NOW),
  }).execute(invocation(source));
}

function completedCycle(input: {
  coreIds: readonly number[];
  evaluatedAt: string;
  previousCompletedCycleId: string | null;
  generationId: string;
}): DnaCoreRaceHistoryAcquisitionCycle {
  const running = createDnaCoreRaceHistoryAcquisitionCycle({
    previousCompletedCycleId: input.previousCompletedCycleId,
    currentStateGenerationId: input.generationId,
    evaluatedAt: input.evaluatedAt,
    coreIds: input.coreIds,
  });
  const checkpoints = input.coreIds.map((coreId, index) => {
    const checkpoint = createDnaCoreRaceHistoryCoreCheckpoint({
      cycle: running,
      coreId,
    });
    return applyDnaCoreRaceHistoryPageReceipt({
      checkpoint,
      receipt: createDnaCoreRaceHistoryPageReceipt({
        cycleId: running.cycleId,
        attemptNumber: 1,
        coreId,
        pageNumber: 1,
        observedAt: "2026-10-03T00:00:30.000Z",
        sourceRowCount: 0,
        acceptedResultCount: 0,
        quarantineCount: 0,
        replayDuplicateCount: 0,
        pageObjectKey: `private/core-${index + 1}/page-1.json`,
        pageBodySha256: SHA,
        pageByteLength: 2,
        quarantineObjectKey: null,
        quarantineBodySha256: null,
        quarantineByteLength: null,
      }),
    });
  });
  return completeDnaCoreRaceHistoryAcquisitionCycle({
    cycle: running,
    checkpoints,
    completedAt: "2026-10-03T00:00:45.000Z",
  });
}

function repository(
  input: {
    predecessorCoreIds?: readonly number[];
    latestCoreIds?: readonly number[];
  } = {},
): DnaCoreRaceHistoryAcquisitionRepository {
  const predecessor = completedCycle({
    coreIds: input.predecessorCoreIds ?? PREDECESSOR_CORE_IDS,
    evaluatedAt: "2026-10-02T00:00:00.000Z",
    previousCompletedCycleId: null,
    generationId: "10000000-0000-4000-8000-000000000001",
  });
  const latest = completedCycle({
    coreIds: input.latestCoreIds ?? [SELECTED_CORE_ID],
    evaluatedAt: EVALUATED_AT,
    previousCompletedCycleId: predecessor.cycleId,
    generationId: "10000000-0000-4000-8000-000000000002",
  });
  const stored = new Map<string, StoredDnaCoreRaceHistoryAcquisitionCycle>([
    [predecessor.cycleId, { revision: "1", cycle: predecessor }],
    [latest.cycleId, { revision: "1", cycle: latest }],
  ]);
  return {
    loadLatestComplete: vi.fn(async () => stored.get(latest.cycleId)!),
    loadAttempt: vi.fn(
      async ({ cycleId }: { cycleId: string; attemptNumber: number }) =>
        stored.get(cycleId) ?? null,
    ),
    loadNextCore: vi.fn(),
    loadCores: vi.fn(),
    saveAttempt: vi.fn(),
    savePage: vi.fn(),
  } as unknown as DnaCoreRaceHistoryAcquisitionRepository;
}

describe("population Core-history first-cohort command", () => {
  it("fails closed before capacity or collection on invocation drift", async () => {
    const inspect = vi.fn();
    const runCollectionStep = vi.fn();
    const command = createDnaPopulationCoreHistoryFirstCohortCommand({
      configuredOwnerId: "owner",
      authority: authority(),
      capacityPreflight: { inspect },
      runCollectionStep,
      now: () => new Date(NOW),
    });
    await expect(
      command.execute({
        ...invocation(),
        selectedCoreSetSha256: "f".repeat(64),
      }),
    ).rejects.toThrow("selected Core set authority drifted");
    expect(inspect).not.toHaveBeenCalled();
    expect(runCollectionStep).not.toHaveBeenCalled();
  });

  it("holds before collection when fresh A$0 capacity is unavailable", async () => {
    const runCollectionStep = vi.fn();
    const receipt = await createDnaPopulationCoreHistoryFirstCohortCommand({
      configuredOwnerId: "owner",
      authority: authority(),
      capacityPreflight: capacity("held"),
      runCollectionStep,
      now: () => new Date(NOW),
    }).execute(invocation());
    expect(receipt).toMatchObject({
      status: "held",
      terminalKind: "provider_capacity_held:capacity_blocked",
      stepCount: 0,
      preflightSha256: null,
      collectionOnly: true,
      publicationPerformed: false,
      paidUsageAllowed: false,
    });
    expect(runCollectionStep).not.toHaveBeenCalled();
  });

  it("advances only the exact measured singleton at 30 aggregate RPM and stops before publication", async () => {
    const source = authority();
    const runCollectionStep = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "page_advanced",
        source: "provider",
        stored: {},
      })
      .mockResolvedValueOnce({ kind: "collection_complete", stored: {} });
    const receipt = await createDnaPopulationCoreHistoryFirstCohortCommand({
      configuredOwnerId: "owner",
      authority: source,
      capacityPreflight: capacity(),
      runCollectionStep,
      now: () => new Date(NOW),
    }).execute(invocation(source));
    expect(receipt).toMatchObject({
      status: "complete",
      terminalKind: "collection:collection_complete",
      stepCount: 2,
      selectedCoreSetSha256: source.selectedCoreSetSha256,
      preflightSha256: "8".repeat(64),
      collectionOnly: true,
      publicationPerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
      preserveLastGood: true,
      previewOnly: true,
    });
    expect(runCollectionStep).toHaveBeenCalledTimes(2);
    expect(
      runCollectionStep.mock.calls.every(
        ([request]) =>
          request.authority.coreIds.length === 1 &&
          request.authority.coreIds[0] === SELECTED_CORE_ID &&
          request.maximumAggregateRequestsPerMinute === 30 &&
          request.allowPersistentWrite === true &&
          request.allowPublication === false,
      ),
    ).toBe(true);
  });

  it("independently verifies a singleton delta chained to the unchanged persisted lineage", async () => {
    const source = authority();
    const result = await verifyDnaPopulationCoreHistoryFirstCohort({
      authority: source,
      commandReceipt: await completeReceipt(source),
      repository: repository(),
    });
    expect(result).toEqual({
      status: "pass",
      exactCodeHeadSha: HEAD,
      lineageCycleCount: 2,
      persistedCoreCountBefore: 2,
      persistedCoreCountAfter: 3,
      persistedCoreSetSha256Before: source.persistedPerformanceCoreSetSha256,
      persistedCoreSetSha256After: dnaPopulationPersistedCoreSetSha256([
        10,
        11,
        SELECTED_CORE_ID,
      ]),
      selectedCoreSetSha256: source.selectedCoreSetSha256,
      measurementSliceSha256: source.measurementSliceSha256,
      collectionComplete: true,
      publicationPerformed: false,
      paidUsageAllowed: false,
      preserveLastGood: true,
      previewOnly: true,
    });
  });

  it("rejects lineage that already contained the selected Core", async () => {
    const source = authority({
      persistedPerformanceCoreCount: 3,
      persistedPerformanceCoreSetSha256: dnaPopulationPersistedCoreSetSha256([
        10,
        11,
        SELECTED_CORE_ID,
      ])!,
    });
    await expect(
      verifyDnaPopulationCoreHistoryFirstCohort({
        authority: source,
        commandReceipt: await completeReceipt(source),
        repository: repository({
          predecessorCoreIds: [10, 11, SELECTED_CORE_ID],
        }),
      }),
    ).rejects.toThrow("predecessor persisted Core authority drifted");
  });
});
