import { describe, expect, it } from "vitest";

import { createDnaCoreRaceHistoryRefreshPlan } from "@/lib/dna-core-race-history-refresh-plan";

const sha = (value: string): string => value.repeat(64);

describe("DNA Core race history refresh plan", () => {
  it("uses a full pull only for an initial generation", () => {
    const plan = createDnaCoreRaceHistoryRefreshPlan({
      evaluatedAt: "2026-09-24T00:00:00.000Z",
      currentStateGenerationId: sha("a"),
      currentOwnedCoreIds: [30, 10, 20],
      previousCompletedCycleId: null,
      previouslyCoveredCoreIds: [],
      activeGenerationId: null,
    });

    expect(plan).toMatchObject({
      mode: "initial_full_history",
      currentOwnedCoreIds: [10, 20, 30],
      fullHistoryCoreIds: [10, 20, 30],
      incrementalProbeCoreIds: [],
      retainedLineageCoreIds: [],
      requiresHistoricalLineageComposition: false,
      requiresExistingCoreDeltaProof: false,
    });
    expect(plan.planId).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("splits new, existing and no-longer-owned Cores without rebuilding history", () => {
    const previous = Array.from({ length: 203 }, (_, index) => index + 1);
    const current = [
      ...previous,
      ...Array.from({ length: 11 }, (_, index) => index + 204),
    ];
    const plan = createDnaCoreRaceHistoryRefreshPlan({
      evaluatedAt: "2026-09-24T10:00:00+10:00",
      currentStateGenerationId: sha("b"),
      currentOwnedCoreIds: current,
      previousCompletedCycleId: "completed-cycle",
      previouslyCoveredCoreIds: previous,
      activeGenerationId: sha("c"),
    });

    expect(plan.mode).toBe("incremental_reconciliation");
    expect(plan.currentOwnedCoreIds).toHaveLength(214);
    expect(plan.incrementalProbeCoreIds).toHaveLength(203);
    expect(plan.fullHistoryCoreIds).toEqual(
      Array.from({ length: 11 }, (_, index) => index + 204),
    );
    expect(plan.retainedLineageCoreIds).toEqual([]);
    expect(plan.requiresHistoricalLineageComposition).toBe(true);
    expect(plan.requiresExistingCoreDeltaProof).toBe(true);
  });

  it("is deterministic and never schedules unchanged Cores for full history", () => {
    const input = {
      evaluatedAt: "2026-09-24T00:00:00.000Z",
      currentStateGenerationId: sha("d"),
      currentOwnedCoreIds: [7, 8],
      previousCompletedCycleId: "completed-cycle",
      previouslyCoveredCoreIds: [8, 7],
      activeGenerationId: sha("e"),
    } as const;
    const first = createDnaCoreRaceHistoryRefreshPlan(input);
    const replay = createDnaCoreRaceHistoryRefreshPlan(input);

    expect(replay).toEqual(first);
    expect(first.fullHistoryCoreIds).toEqual([]);
    expect(first.incrementalProbeCoreIds).toEqual([7, 8]);
  });

  it("retains lineage for a Core that is no longer currently owned", () => {
    const plan = createDnaCoreRaceHistoryRefreshPlan({
      evaluatedAt: "2026-09-24T00:00:00.000Z",
      currentStateGenerationId: sha("d"),
      currentOwnedCoreIds: [7, 9],
      previousCompletedCycleId: "completed-cycle",
      previouslyCoveredCoreIds: [7, 8],
      activeGenerationId: sha("e"),
    });

    expect(plan.fullHistoryCoreIds).toEqual([9]);
    expect(plan.incrementalProbeCoreIds).toEqual([7]);
    expect(plan.retainedLineageCoreIds).toEqual([8]);
  });

  it("fails closed when lineage authority is absent or ambiguous", () => {
    expect(() =>
      createDnaCoreRaceHistoryRefreshPlan({
        evaluatedAt: "2026-09-24T00:00:00.000Z",
        currentStateGenerationId: sha("f"),
        currentOwnedCoreIds: [1],
        previousCompletedCycleId: "completed-cycle",
        previouslyCoveredCoreIds: [1],
        activeGenerationId: null,
      }),
    ).toThrow("completed-cycle and active-generation authority disagree");

    expect(() =>
      createDnaCoreRaceHistoryRefreshPlan({
        evaluatedAt: "2026-09-24T00:00:00.000Z",
        currentStateGenerationId: sha("f"),
        currentOwnedCoreIds: [1, 1],
        previousCompletedCycleId: null,
        previouslyCoveredCoreIds: [],
        activeGenerationId: null,
      }),
    ).toThrow("unique positive Core IDs");
  });
});
