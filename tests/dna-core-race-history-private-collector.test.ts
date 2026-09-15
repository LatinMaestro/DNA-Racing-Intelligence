import { describe, expect, it, vi } from "vitest";

import {
  applyDnaCoreRaceHistoryPageReceipt,
  completeDnaCoreRaceHistoryAcquisitionCycle,
  createDnaCoreRaceHistoryAcquisitionCycle,
  createDnaCoreRaceHistoryCoreCheckpoint,
  createDnaCoreRaceHistoryPageReceipt,
  type DnaCoreRaceHistoryAcquisitionRepository,
  type StoredDnaCoreRaceHistoryAcquisitionCycle,
  type StoredDnaCoreRaceHistoryCoreCheckpoint,
} from "@/lib/dna-core-race-history-acquisition-cycle";
import { DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE } from "@/lib/dna-core-race-history-acquisition-runner";
import type {
  DnaCoreRaceHistoryClient,
  DnaCoreRaceHistoryRow,
} from "@/lib/dna-core-race-history-client";
import {
  runDnaCoreRaceHistoryPrivateCollectorStep,
  type DnaCoreRaceHistoryServingAuthorityRow,
} from "@/lib/dna-core-race-history-private-collector";
import type { DnaCoreRaceHistoryR2EvidenceStore } from "@/lib/dna-core-race-history-r2-evidence";
import type {
  DnaOpenLabR2BudgetRepository,
  DnaOpenLabR2BudgetWindow,
} from "@/lib/dna-open-lab-r2-budget-repository";
import { createDnaOpenLabRequestBudget } from "@/lib/dna-open-lab-request-budget";
import type { DnaOpenLabResponse } from "@/lib/dna-open-lab-v1-client";

const generationId = "10000000-0000-4000-8000-000000000001";
const evaluatedAt = "2026-09-15T07:00:00.000Z";
const attemptedAt = "2026-09-15T07:01:00.000Z";
const budgetWindowId = "free-window-2026-09";

type ReadyBudgetRepository = Extract<
  DnaOpenLabR2BudgetRepository,
  { status: "ready" }
>;

function ownedCores(
  coreIds: readonly number[] = [42, 84],
): readonly DnaCoreRaceHistoryServingAuthorityRow[] {
  return coreIds.map((coreId) =>
    Object.freeze({
      generationId,
      canonical: Object.freeze({ sourceCoreId: String(coreId) }),
    }),
  );
}

function response(
  coreId: number,
  rows: number = 1,
): DnaOpenLabResponse<readonly DnaCoreRaceHistoryRow[]> {
  return Object.freeze({
    result: Object.freeze(
      Array.from({ length: rows }, (_, index) =>
        Object.freeze({
          hid: coreId,
          rid: `race-${coreId}-${index + 1}`,
          rvmode: "bike",
          cb: 12,
          time: 65.125 + index,
          pos: index + 1,
        }),
      ),
    ),
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 150,
      remaining: 149,
      resetSeconds: 1,
      rateClass: "public",
      retryAfterSeconds: null,
    }),
  });
}

function completeCycle(
  coreId: number = 42,
): StoredDnaCoreRaceHistoryAcquisitionCycle {
  const cycle = createDnaCoreRaceHistoryAcquisitionCycle({
    previousCompletedCycleId: null,
    currentStateGenerationId: generationId,
    evaluatedAt,
    coreIds: [coreId],
  });
  const checkpoint = createDnaCoreRaceHistoryCoreCheckpoint({ cycle, coreId });
  const receipt = createDnaCoreRaceHistoryPageReceipt({
    cycleId: cycle.cycleId,
    attemptNumber: 1,
    coreId,
    pageNumber: 1,
    observedAt: attemptedAt,
    sourceRowCount: 0,
    acceptedResultCount: 0,
    quarantineCount: 0,
    replayDuplicateCount: 0,
    pageObjectKey: `dna-open-lab/v1/private/core-${coreId}/page-1.json`,
    pageBodySha256: "a".repeat(64),
    pageByteLength: 128,
    quarantineObjectKey: null,
    quarantineBodySha256: null,
    quarantineByteLength: null,
  });
  const completedCheckpoint = applyDnaCoreRaceHistoryPageReceipt({
    checkpoint,
    receipt,
  });
  return Object.freeze({
    revision: "2",
    cycle: completeDnaCoreRaceHistoryAcquisitionCycle({
      cycle,
      checkpoints: [completedCheckpoint],
      completedAt: attemptedAt,
    }),
  });
}

function acquisitionRepository(
  input: {
    latestComplete?: StoredDnaCoreRaceHistoryAcquisitionCycle | null;
  } = {},
) {
  const attempts = new Map<number, StoredDnaCoreRaceHistoryAcquisitionCycle>();
  const cores = new Map<number, StoredDnaCoreRaceHistoryCoreCheckpoint>();
  let latestComplete = input.latestComplete ?? null;

  const repository: DnaCoreRaceHistoryAcquisitionRepository = {
    loadAttempt: vi.fn(
      async ({ attemptNumber }) => attempts.get(attemptNumber) ?? null,
    ),
    loadNextCore: vi.fn(async () =>
      [...cores.values()]
        .filter((entry) => entry.checkpoint.status === "running")
        .sort(
          (left, right) =>
            left.checkpoint.coreOrdinal - right.checkpoint.coreOrdinal,
        )[0] ?? null,
    ),
    loadCores: vi.fn(async () =>
      Object.freeze(
        [...cores.values()].sort(
          (left, right) =>
            left.checkpoint.coreOrdinal - right.checkpoint.coreOrdinal,
        ),
      ),
    ),
    loadLatestComplete: vi.fn(async () => latestComplete),
    saveAttempt: vi.fn(async ({ expectedRevision, cycle }) => {
      const previous = attempts.get(cycle.attemptNumber) ?? null;
      if (previous === null) {
        if (expectedRevision !== null) {
          throw new Error("synthetic revision conflict");
        }
        const stored = Object.freeze({ revision: "1", cycle });
        attempts.set(cycle.attemptNumber, stored);
        for (const coreId of cycle.coreIds) {
          cores.set(
            coreId,
            Object.freeze({
              revision: "1",
              checkpoint: createDnaCoreRaceHistoryCoreCheckpoint({
                cycle,
                coreId,
              }),
            }),
          );
        }
        return stored;
      }
      if (previous.revision !== expectedRevision) {
        throw new Error("synthetic revision conflict");
      }
      const stored = Object.freeze({
        revision: String(Number(previous.revision) + 1),
        cycle,
      });
      attempts.set(cycle.attemptNumber, stored);
      if (cycle.status === "complete") latestComplete = stored;
      return stored;
    }),
    savePage: vi.fn(async ({ expectedCoreRevision, checkpoint }) => {
      const previous = cores.get(checkpoint.coreId);
      if (previous === undefined || previous.revision !== expectedCoreRevision) {
        throw new Error("synthetic Core revision conflict");
      }
      const stored = Object.freeze({
        revision: String(Number(previous.revision) + 1),
        checkpoint,
      });
      cores.set(checkpoint.coreId, stored);
      return stored;
    }),
  };
  return { repository, attempts, cores };
}

function budgetWindow(
  windowId: string = budgetWindowId,
): DnaOpenLabR2BudgetWindow {
  return Object.freeze({
    windowId,
    windowStartAt: "2026-09-01T00:00:00.000Z",
    windowEndAt: "2026-10-01T00:00:00.000Z",
    measuredAt: "2026-09-15T06:59:00.000Z",
    baselineUsage: Object.freeze({
      storageBytes: 0,
      classAOperations: 0,
      classBOperations: 0,
    }),
    accountedUsage: Object.freeze({
      storageBytes: 0,
      classAOperations: 0,
      classBOperations: 0,
    }),
    reservedUsage: Object.freeze({
      storageBytes: 0,
      classAOperations: 0,
      classBOperations: 0,
    }),
    lastBlockedAt: null,
    lastBlockerIds: Object.freeze([]),
    revision: 1,
    updatedAt: "2026-09-15T06:59:00.000Z",
  });
}

function readyBudget(windowId: string = budgetWindowId) {
  const reserve = vi.fn(
    async (request: Parameters<ReadyBudgetRepository["reserve"]>[0]) => ({
      allowed: true,
      blockerIds: Object.freeze([]),
      projectedUsage: request.plannedUsage,
      reservationStatus: "reserved" as const,
      paidUsageAllowed: false as const,
      preserveLastGood: true as const,
    }),
  );
  const repository: DnaOpenLabR2BudgetRepository = {
    status: "ready",
    readWindow: vi.fn(async () => budgetWindow(windowId)),
    openWindow: vi.fn(async () => budgetWindow(windowId)),
    reserve,
    account: vi.fn(async () => {
      throw new Error("account must not run in page collection");
    }),
  };
  return { repository, reserve };
}

function sources() {
  const client = {
    page: vi.fn(async ({ coreId }: { coreId: number; page: number }) =>
      response(coreId),
    ),
  } as DnaCoreRaceHistoryClient;
  const evidenceStore: DnaCoreRaceHistoryR2EvidenceStore = {
    read: vi.fn(async () => null),
    recover: vi.fn(async () => null),
    write: vi.fn(
      async ({ cycle, coreId, pageNumber, observedAt, response: page }) => ({
        status: "ready" as const,
        receipt: createDnaCoreRaceHistoryPageReceipt({
          cycleId: cycle.cycleId,
          attemptNumber: cycle.attemptNumber,
          coreId,
          pageNumber,
          observedAt,
          sourceRowCount: page.result.length,
          acceptedResultCount: page.result.length,
          quarantineCount: 0,
          replayDuplicateCount: 0,
          pageObjectKey: `dna-open-lab/v1/private/core-${coreId}/page-${pageNumber}.json`,
          pageBodySha256: "b".repeat(64),
          pageByteLength: 512,
          quarantineObjectKey: null,
          quarantineBodySha256: null,
          quarantineByteLength: null,
        }),
      }),
    ),
  };
  return {
    client,
    evidenceStore,
    requestBudget: createDnaOpenLabRequestBudget(),
  };
}

function request(input: {
  repository: DnaCoreRaceHistoryAcquisitionRepository;
  budgetRepository: DnaOpenLabR2BudgetRepository;
  client: DnaCoreRaceHistoryClient;
  evidenceStore: DnaCoreRaceHistoryR2EvidenceStore;
  requestBudget: ReturnType<typeof createDnaOpenLabRequestBudget>;
  rows?: readonly DnaCoreRaceHistoryServingAuthorityRow[];
  runAttemptedAt?: string;
}) {
  return runDnaCoreRaceHistoryPrivateCollectorStep({
    ownerId: "private_owner",
    budgetWindowId,
    evaluatedAt,
    attemptedAt: input.runAttemptedAt ?? attemptedAt,
    loadServingOwnedCores: vi.fn(async () => input.rows ?? ownedCores()),
    acquisitionRepository: input.repository,
    budgetRepository: input.budgetRepository,
    client: input.client,
    requestBudget: input.requestBudget,
    evidenceStore: input.evidenceStore,
  });
}

describe("DNA Core race history private collector", () => {
  it("creates one stable owner acquisition cycle and reserves the exact page bound before advancing", async () => {
    const acquisition = acquisitionRepository();
    const budget = readyBudget();
    const source = sources();

    await expect(
      request({
        repository: acquisition.repository,
        budgetRepository: budget.repository,
        ...source,
      }),
    ).resolves.toMatchObject({
      kind: "page_advanced",
      source: "provider",
      stored: { checkpoint: { coreId: 42, nextPage: 2 } },
    });

    expect(acquisition.repository.saveAttempt).toHaveBeenCalledTimes(1);
    expect(budget.reserve).toHaveBeenCalledWith({
      ownerId: "private_owner",
      windowId: budgetWindowId,
      refreshCycleId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      plannedUsage: DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE,
    });
    expect(source.client.page).toHaveBeenCalledTimes(1);
  });

  it("replays the same evaluated cycle instead of creating a second attempt", async () => {
    const acquisition = acquisitionRepository();
    const budget = readyBudget();
    const source = sources();

    await request({
      repository: acquisition.repository,
      budgetRepository: budget.repository,
      ...source,
    });
    await request({
      repository: acquisition.repository,
      budgetRepository: budget.repository,
      ...source,
      runAttemptedAt: "2026-09-15T07:02:00.000Z",
    });

    expect(acquisition.repository.saveAttempt).toHaveBeenCalledTimes(1);
    expect(acquisition.attempts.size).toBe(1);
    expect(source.client.page).toHaveBeenCalledTimes(2);
    expect(budget.reserve).toHaveBeenCalledTimes(2);
    expect(budget.reserve.mock.calls[1]?.[0].refreshCycleId).toBe(
      budget.reserve.mock.calls[0]?.[0].refreshCycleId,
    );
  });

  it("fails closed before R2 or provider work when the durable free-budget window does not match", async () => {
    const acquisition = acquisitionRepository();
    const budget = readyBudget("different-window");
    const source = sources();

    await expect(
      request({
        repository: acquisition.repository,
        budgetRepository: budget.repository,
        ...source,
      }),
    ).resolves.toMatchObject({ kind: "paused", reason: "budget_closed" });

    expect(budget.reserve).not.toHaveBeenCalled();
    expect(source.evidenceStore.recover).not.toHaveBeenCalled();
    expect(source.client.page).not.toHaveBeenCalled();
  });

  it("resumes a retryable durable pause on the next invocation and keeps the same cursor", async () => {
    const acquisition = acquisitionRepository();
    const budget = readyBudget();
    vi.mocked(budget.repository.readWindow)
      .mockResolvedValueOnce(budgetWindow("different-window"))
      .mockResolvedValue(budgetWindow());
    const source = sources();

    await expect(
      request({
        repository: acquisition.repository,
        budgetRepository: budget.repository,
        ...source,
      }),
    ).resolves.toMatchObject({ kind: "paused", reason: "budget_closed" });
    expect(acquisition.cores.get(42)?.checkpoint.nextPage).toBe(1);

    await expect(
      request({
        repository: acquisition.repository,
        budgetRepository: budget.repository,
        ...source,
        runAttemptedAt: "2026-09-15T07:03:00.000Z",
      }),
    ).resolves.toMatchObject({
      kind: "page_advanced",
      stored: { checkpoint: { coreId: 42, nextPage: 2 } },
    });

    expect(source.client.page).toHaveBeenCalledTimes(1);
    expect(acquisition.cores.get(42)?.checkpoint.nextPage).toBe(2);
  });

  it("keeps evidence conflicts held rather than automatically retrying them", async () => {
    const acquisition = acquisitionRepository();
    const budget = readyBudget();
    const source = sources();
    vi.mocked(source.evidenceStore.recover).mockResolvedValueOnce({
      status: "held_conflict",
      cycleId: "c".repeat(64),
      attemptNumber: 1,
      coreId: 42,
      pageNumber: 1,
      observedAt: attemptedAt,
      conflictCount: 1,
      pageObjectKey: "private-page",
      pageBodySha256: "a".repeat(64),
      pageByteLength: 512,
      quarantineObjectKey: "private-quarantine",
      quarantineBodySha256: "b".repeat(64),
      quarantineByteLength: 128,
    });

    await expect(
      request({
        repository: acquisition.repository,
        budgetRepository: budget.repository,
        ...source,
      }),
    ).resolves.toMatchObject({ kind: "paused", reason: "evidence_conflict" });

    await expect(
      request({
        repository: acquisition.repository,
        budgetRepository: budget.repository,
        ...source,
        runAttemptedAt: "2026-09-15T07:04:00.000Z",
      }),
    ).resolves.toMatchObject({ kind: "paused", reason: "evidence_conflict" });

    expect(source.client.page).not.toHaveBeenCalled();
    expect(source.evidenceStore.recover).toHaveBeenCalledTimes(1);
  });

  it("returns an already completed matching cycle without reserving budget or repeating provider work", async () => {
    const completed = completeCycle();
    const acquisition = acquisitionRepository({ latestComplete: completed });
    const budget = readyBudget();
    const source = sources();

    await expect(
      request({
        repository: acquisition.repository,
        budgetRepository: budget.repository,
        ...source,
        rows: ownedCores([42]),
      }),
    ).resolves.toMatchObject({
      kind: "collection_complete",
      stored: { cycle: { cycleId: completed.cycle.cycleId } },
    });

    expect(acquisition.repository.saveAttempt).not.toHaveBeenCalled();
    expect(budget.reserve).not.toHaveBeenCalled();
    expect(source.client.page).not.toHaveBeenCalled();
  });

  it("holds cleanly when the current serving generation has no owned Cores", async () => {
    const acquisition = acquisitionRepository();
    const budget = readyBudget();
    const source = sources();

    await expect(
      request({
        repository: acquisition.repository,
        budgetRepository: budget.repository,
        ...source,
        rows: [],
      }),
    ).resolves.toEqual({
      kind: "authority_unavailable",
      reason: "no_owned_cores",
    });

    expect(acquisition.repository.loadLatestComplete).not.toHaveBeenCalled();
    expect(budget.reserve).not.toHaveBeenCalled();
    expect(source.client.page).not.toHaveBeenCalled();
  });
});
