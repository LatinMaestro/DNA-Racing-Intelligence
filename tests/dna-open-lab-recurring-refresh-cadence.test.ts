import { describe, expect, it } from "vitest";

import {
  createDnaRecurringRefreshCadenceDecision,
  DNA_FINISHED_RACE_NEAR_LIVE_INTERVAL_MILLISECONDS,
  DNA_NON_RACE_CURRENT_STATE_INTERVAL_MILLISECONDS,
} from "@/lib/dna-open-lab-recurring-refresh-cadence";

describe("DNA recurring refresh cadence", () => {
  it("starts a race cycle on the one-minute boundary without forcing daily current state", () => {
    const decision = createDnaRecurringRefreshCadenceDecision({
      evaluatedAt: "2026-09-24T00:01:00.000Z",
      lastFinishedRaceCompletedAt: "2026-09-24T00:00:00.000Z",
      lastCurrentStateCompletedAt: "2026-09-23T12:00:00.000Z",
    });

    expect(decision.finishedRaces.status).toBe("start_incremental_cycle");
    expect(decision.finishedRaces.intervalMilliseconds).toBe(60_000);
    expect(decision.currentState.due).toBe(false);
    expect(decision.currentState.intervalMilliseconds).toBe(24 * 60 * 60_000);
  });

  it("resumes an unfinished race cycle instead of starting a competing cycle", () => {
    const decision = createDnaRecurringRefreshCadenceDecision({
      evaluatedAt: "2026-09-24T00:01:00.000Z",
      lastFinishedRaceCompletedAt: "2026-09-24T00:00:00.000Z",
      finishedRaceCycleActive: true,
      lastCurrentStateCompletedAt: "2026-09-24T00:00:00.000Z",
    });

    expect(decision.finishedRaces.status).toBe("resume_active_cycle");
    expect(decision.currentState.due).toBe(false);
  });

  it("honours provider retry boundaries without changing the daily clock", () => {
    const decision = createDnaRecurringRefreshCadenceDecision({
      evaluatedAt: "2026-09-24T00:01:00.000Z",
      lastFinishedRaceCompletedAt: "2026-09-24T00:00:00.000Z",
      finishedRaceRetryNotBefore: "2026-09-24T00:04:00.000Z",
      lastCurrentStateCompletedAt: "2026-09-23T23:00:00.000Z",
    });

    expect(decision.finishedRaces).toMatchObject({
      status: "retry_blocked",
      nextEvaluationAt: "2026-09-24T00:04:00.000Z",
    });
    expect(decision.currentState.due).toBe(false);
  });

  it("marks non-race current state due only at its independent 24-hour boundary", () => {
    const decision = createDnaRecurringRefreshCadenceDecision({
      evaluatedAt: "2026-09-24T12:00:00.000Z",
      lastFinishedRaceCompletedAt: "2026-09-24T11:59:30.000Z",
      lastCurrentStateCompletedAt: "2026-09-23T12:00:00.000Z",
    });

    expect(decision.finishedRaces.status).toBe("idle");
    expect(decision.currentState.due).toBe(true);
  });

  it("starts both feeds immediately when no checkpoints exist", () => {
    const decision = createDnaRecurringRefreshCadenceDecision({
      evaluatedAt: "2026-09-24T12:00:00.000Z",
    });

    expect(decision.finishedRaces.status).toBe("start_incremental_cycle");
    expect(decision.currentState.due).toBe(true);
    expect(DNA_FINISHED_RACE_NEAR_LIVE_INTERVAL_MILLISECONDS).toBe(60_000);
    expect(DNA_NON_RACE_CURRENT_STATE_INTERVAL_MILLISECONDS).toBe(86_400_000);
  });

  it("rejects future checkpoints", () => {
    expect(() =>
      createDnaRecurringRefreshCadenceDecision({
        evaluatedAt: "2026-09-24T12:00:00.000Z",
        lastFinishedRaceCompletedAt: "2026-09-24T12:01:00.000Z",
      }),
    ).toThrow("checkpoint is in the future");

    expect(() =>
      createDnaRecurringRefreshCadenceDecision({
        evaluatedAt: "2026-09-24T12:00:00.000Z",
        lastCurrentStateCompletedAt: "2026-09-24T12:01:00.000Z",
      }),
    ).toThrow("checkpoint is in the future");
  });
});
