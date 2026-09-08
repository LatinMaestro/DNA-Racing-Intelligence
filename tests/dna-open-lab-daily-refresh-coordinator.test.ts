import { describe, expect, it, vi } from "vitest";

import {
  dnaOpenLabDailyRefreshBudgetRequestSha256,
  runDnaOpenLabDailyRefreshStep,
  type DnaOpenLabDailyRefreshGeneration,
  type DnaOpenLabDailyRefreshGenerationRepository,
} from "@/lib/dna-open-lab-daily-refresh-coordinator";
import type {
  DnaOpenLabR2BudgetRepository,
  DnaOpenLabR2BudgetReservationDecision,
  DnaOpenLabR2BudgetWindow,
} from "@/lib/dna-open-lab-r2-budget-repository";
import type { DnaCurrentStateOperatorStepResult } from "@/lib/dna-open-lab-current-state-operator";
import type { DnaFinishedRaceIncrementalStepResult } from "@/lib/dna-open-lab-finished-race-incremental-runner";
import type { DnaOpenLabR2Usage } from "@/lib/dna-open-lab-zero-cost-refresh-policy";

const windowId = "1".repeat(64);
const refreshCycleId = "2".repeat(64);
const historyCycleId = "3".repeat(64);
const currentGenerationId = "11111111-1111-4111-8111-111111111111";
const plannedR2Usage = Object.freeze({
  storageBytes: 10_000,
  classAOperations: 20,
  classBOperations: 30,
});
const actualR2Usage = Object.freeze({
  storageBytes: 7_500,
  classAOperations: 12,
  classBOperations: 23,
});

function budgetWindow(): DnaOpenLabR2BudgetWindow {
  return Object.freeze({
    windowId,
    windowStartAt: "2026-09-01T00:00:00.000Z",
    windowEndAt: "2026-10-01T00:00:00.000Z",
    measuredAt: "2026-09-01T00:00:00.000Z",
    baselineUsage: {
      storageBytes: 1_000,
      classAOperations: 100,
      classBOperations: 200,
    },
    accountedUsage: {
      storageBytes: 0,
      classAOperations: 0,
      classBOperations: 0,
    },
    reservedUsage: {
      storageBytes: 0,
      classAOperations: 0,
      classBOperations: 0,
    },
    lastBlockedAt: null,
    lastBlockerIds: [],
    revision: 1,
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
}

function reservationDecision(
  status: "reserved" | "accounted" = "reserved",
): DnaOpenLabR2BudgetReservationDecision {
  return Object.freeze({
    allowed: true,
    blockerIds: [],
    projectedUsage: plannedR2Usage,
    reservationStatus: status,
    paidUsageAllowed: false,
    preserveLastGood: true,
  });
}

function budgetRepository(input?: {
  window?: DnaOpenLabR2BudgetWindow | null;
  decision?: DnaOpenLabR2BudgetReservationDecision;
}) {
  const readWindow = vi.fn(async () =>
    input && "window" in input ? (input.window ?? null) : budgetWindow(),
  );
  const reserve = vi.fn(async () =>
    input?.decision === undefined ? reservationDecision() : input.decision,
  );
  const account = vi.fn(async (request) =>
    Object.freeze({
      windowId: request.windowId,
      refreshCycleId: request.refreshCycleId,
      requestSha256: request.requestSha256,
      status: "accounted" as const,
      plannedUsage: plannedR2Usage,
      actualUsage: request.actualUsage,
      reservedAt: "2026-09-08T00:00:00.000Z",
      accountedAt: "2026-09-08T00:30:00.000Z",
    }),
  );
  return {
    repository: {
      status: "ready",
      readWindow,
      openWindow: vi.fn(),
      reserve,
      account,
    } as unknown as Extract<DnaOpenLabR2BudgetRepository, { status: "ready" }>,
    readWindow,
    reserve,
    account,
  };
}

function generationRepository(existing?: DnaOpenLabDailyRefreshGeneration) {
  let stored = existing ?? null;
  const load = vi.fn(async () => stored);
  const publish = vi.fn(
    async (_ownerId: string, candidate: DnaOpenLabDailyRefreshGeneration) => {
      if (
        stored !== null &&
        JSON.stringify(stored) !== JSON.stringify(candidate)
      ) {
        throw new Error("synthetic generation conflict");
      }
      stored = Object.freeze(candidate);
      return stored;
    },
  );
  return {
    repository: { load, publish } as DnaOpenLabDailyRefreshGenerationRepository,
    load,
    publish,
  };
}

function history(
  kind: DnaFinishedRaceIncrementalStepResult["kind"],
): DnaFinishedRaceIncrementalStepResult {
  return {
    kind,
    stored: { cycle: { cycleId: historyCycleId } },
    ...(kind === "collecting" ? { step: { kind: "split" } } : {}),
  } as unknown as DnaFinishedRaceIncrementalStepResult;
}

function current(published: boolean): DnaCurrentStateOperatorStepResult {
  return (published
    ? {
        kind: "scheduled",
        discovery: { kind: "final_plan_ready" },
        scheduled: {
          kind: "published",
          publicationMode: "full",
          state: { servingGenerationId: currentGenerationId },
        },
      }
    : {
        kind: "scheduled",
        discovery: { kind: "final_plan_ready" },
        scheduled: {
          kind: "acquiring",
          publicationMode: "full",
          step: { kind: "request_completed" },
        },
      }) as unknown as DnaCurrentStateOperatorStepResult;
}

function input(overrides: Record<string, unknown> = {}) {
  const budget = budgetRepository();
  const generations = generationRepository();
  const advanceFinishedHistory = vi.fn(async () =>
    history("collection_complete"),
  );
  const advanceCurrentState = vi.fn(async () => current(true));
  const measureActualR2Usage = vi.fn<() => Promise<DnaOpenLabR2Usage>>(
    async () => actualR2Usage,
  );
  return {
    budget,
    generations,
    advanceFinishedHistory,
    advanceCurrentState,
    measureActualR2Usage,
    request: {
      ownerId: "private-owner",
      refreshCycleId,
      budgetWindowId: windowId,
      plannedR2Usage,
      budgetRepository: budget.repository,
      generationRepository: generations.repository,
      advanceFinishedHistory,
      advanceCurrentState,
      measureActualR2Usage,
      publishedAt: "2026-09-08T00:30:00.000Z",
      ...overrides,
    },
  };
}

describe("DNA Open Lab daily refresh coordinator", () => {
  it("derives a stable reservation identity from the whole planned cycle", () => {
    const first = dnaOpenLabDailyRefreshBudgetRequestSha256({
      refreshCycleId,
      budgetWindowId: windowId,
      plannedR2Usage,
    });
    const replay = dnaOpenLabDailyRefreshBudgetRequestSha256({
      refreshCycleId,
      budgetWindowId: windowId,
      plannedR2Usage: { ...plannedR2Usage },
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(replay).toBe(first);
  });

  it("fails closed before source work when budget authority is unavailable", async () => {
    const test = input({ budgetRepository: { status: "not_configured" } });

    await expect(runDnaOpenLabDailyRefreshStep(test.request)).resolves.toEqual({
      kind: "budget_unavailable",
      reason: "not_configured",
    });
    expect(test.advanceFinishedHistory).not.toHaveBeenCalled();
    expect(test.advanceCurrentState).not.toHaveBeenCalled();
    expect(test.measureActualR2Usage).not.toHaveBeenCalled();
  });

  it("fails closed when the measured billing window is missing or changed", async () => {
    const missing = input();
    missing.budget.readWindow.mockResolvedValueOnce(null);
    await expect(
      runDnaOpenLabDailyRefreshStep(missing.request),
    ).resolves.toEqual({
      kind: "budget_unavailable",
      reason: "window_missing",
    });

    const changed = input();
    changed.budget.readWindow.mockResolvedValueOnce({
      ...budgetWindow(),
      windowId: "f".repeat(64),
    });
    await expect(
      runDnaOpenLabDailyRefreshStep(changed.request),
    ).resolves.toEqual({
      kind: "budget_unavailable",
      reason: "window_mismatch",
    });
    expect(changed.budget.reserve).not.toHaveBeenCalled();
    expect(changed.advanceFinishedHistory).not.toHaveBeenCalled();
  });

  it("does no provider work when the durable reservation is blocked", async () => {
    const test = input();
    test.budget.reserve.mockResolvedValueOnce({
      allowed: false,
      blockerIds: ["storage_budget_exhausted"],
      projectedUsage: plannedR2Usage,
      reservationStatus: null,
      paidUsageAllowed: false,
      preserveLastGood: true,
    });

    const result = await runDnaOpenLabDailyRefreshStep(test.request);

    expect(result).toMatchObject({
      kind: "budget_blocked",
      decision: { blockerIds: ["storage_budget_exhausted"] },
    });
    expect(test.advanceFinishedHistory).not.toHaveBeenCalled();
    expect(test.advanceCurrentState).not.toHaveBeenCalled();
    expect(test.budget.account).not.toHaveBeenCalled();
  });

  it("advances history first and never starts current state in the same step", async () => {
    const test = input();
    test.advanceFinishedHistory.mockResolvedValueOnce(history("collecting"));

    const result = await runDnaOpenLabDailyRefreshStep(test.request);

    expect(result).toMatchObject({
      kind: "finished_history",
      step: { kind: "collecting" },
    });
    expect(test.advanceCurrentState).not.toHaveBeenCalled();
    expect(test.generations.publish).not.toHaveBeenCalled();
    expect(test.budget.account).not.toHaveBeenCalled();
  });

  it("waits for current-state publication before measurement or accounting", async () => {
    const test = input();
    test.advanceCurrentState.mockResolvedValueOnce(current(false));

    const result = await runDnaOpenLabDailyRefreshStep(test.request);

    expect(result).toMatchObject({
      kind: "current_state",
      historyCycleId,
      step: { kind: "scheduled", scheduled: { kind: "acquiring" } },
    });
    expect(test.measureActualR2Usage).not.toHaveBeenCalled();
    expect(test.generations.publish).not.toHaveBeenCalled();
    expect(test.budget.account).not.toHaveBeenCalled();
  });

  it("publishes one complete generation before reconciling actual usage", async () => {
    const test = input();

    const result = await runDnaOpenLabDailyRefreshStep(test.request);

    expect(result).toMatchObject({
      kind: "complete",
      generation: {
        refreshCycleId,
        budgetWindowId: windowId,
        finishedHistoryCycleId: historyCycleId,
        currentStateGenerationId: currentGenerationId,
        actualR2Usage,
      },
      accounting: { status: "accounted", actualUsage: actualR2Usage },
    });
    expect(test.budget.reserve).toHaveBeenCalledTimes(1);
    expect(test.generations.publish).toHaveBeenCalledWith(
      "private-owner",
      expect.objectContaining({ refreshCycleId }),
    );
    expect(test.budget.account).toHaveBeenCalledTimes(1);
    expect(test.generations.publish.mock.invocationCallOrder[0]).toBeLessThan(
      test.budget.account.mock.invocationCallOrder[0]!,
    );
  });

  it("loads a published generation and finishes accounting without source replay", async () => {
    const requestSha256 = dnaOpenLabDailyRefreshBudgetRequestSha256({
      refreshCycleId,
      budgetWindowId: windowId,
      plannedR2Usage,
    });
    const existing: DnaOpenLabDailyRefreshGeneration = Object.freeze({
      version: 1,
      refreshCycleId,
      budgetWindowId: windowId,
      budgetRequestSha256: requestSha256,
      finishedHistoryCycleId: historyCycleId,
      currentStateGenerationId: currentGenerationId,
      actualR2Usage,
      publishedAt: "2026-09-08T00:30:00.000Z",
    });
    const test = input({
      generationRepository: generationRepository(existing).repository,
    });
    test.budget.reserve.mockResolvedValueOnce(reservationDecision("accounted"));

    const result = await runDnaOpenLabDailyRefreshStep(test.request);

    expect(result).toMatchObject({ kind: "complete", generation: existing });
    expect(test.advanceFinishedHistory).not.toHaveBeenCalled();
    expect(test.advanceCurrentState).not.toHaveBeenCalled();
    expect(test.measureActualR2Usage).not.toHaveBeenCalled();
    expect(test.budget.account).toHaveBeenCalledWith(
      expect.objectContaining({ actualUsage: actualR2Usage }),
    );
  });

  it("refuses publication when measured use exceeds the reserved upper bound", async () => {
    const test = input();
    test.measureActualR2Usage.mockResolvedValueOnce({
      ...plannedR2Usage,
      classAOperations: plannedR2Usage.classAOperations + 1,
    });

    await expect(runDnaOpenLabDailyRefreshStep(test.request)).rejects.toThrow(
      "actual R2 usage exceeds the reserved upper bound",
    );
    expect(test.generations.publish).not.toHaveBeenCalled();
    expect(test.budget.account).not.toHaveBeenCalled();
  });

  it("keeps the full reservation charged if source work is interrupted", async () => {
    const test = input();
    test.advanceFinishedHistory.mockRejectedValueOnce(
      new Error("synthetic provider interruption"),
    );

    await expect(runDnaOpenLabDailyRefreshStep(test.request)).rejects.toThrow(
      "synthetic provider interruption",
    );
    expect(test.budget.reserve).toHaveBeenCalledTimes(1);
    expect(test.budget.account).not.toHaveBeenCalled();
    expect(test.generations.publish).not.toHaveBeenCalled();
  });
});
