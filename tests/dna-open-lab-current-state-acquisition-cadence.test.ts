import { describe, expect, it } from "vitest";

import {
  classifyDnaCurrentStateAcquisitionFailure,
  createDnaCurrentStateAcquisitionSchedule,
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  inspectDnaCurrentStateAcquisitionCompletion,
  type DnaCurrentStateAcquisitionGroup,
} from "@/lib/dna-open-lab-current-state-acquisition-cadence";
import { createDnaCurrentStateSyncPlan } from "@/lib/dna-open-lab-current-state-sync-plan";
import {
  DnaOpenLabApiError,
  type DnaOpenLabRateLimit,
} from "@/lib/dna-open-lab-v1-client";

const evaluatedAt = "2026-08-28T12:30:00.000Z";

function checkpoints(
  completedAt = "2026-08-28T12:29:30.000Z",
): Record<DnaCurrentStateAcquisitionGroup, Readonly<{ completedAt: string }>> {
  return Object.fromEntries(
    DNA_CURRENT_STATE_ACQUISITION_GROUPS.map((group) => [
      group,
      { completedAt },
    ]),
  ) as Record<
    DnaCurrentStateAcquisitionGroup,
    Readonly<{ completedAt: string }>
  >;
}

function evidence(
  observedAt = "2026-08-28T12:29:30.000Z",
): Record<DnaCurrentStateAcquisitionGroup, string> {
  return Object.fromEntries(
    DNA_CURRENT_STATE_ACQUISITION_GROUPS.map((group) => [group, observedAt]),
  ) as Record<DnaCurrentStateAcquisitionGroup, string>;
}

function rateLimit(
  overrides: Partial<DnaOpenLabRateLimit> = {},
): DnaOpenLabRateLimit {
  return Object.freeze({
    limit: overrides.limit ?? 150,
    remaining: overrides.remaining ?? 0,
    resetSeconds: overrides.resetSeconds ?? 12,
    rateClass: overrides.rateClass ?? "api_key",
    retryAfterSeconds: overrides.retryAfterSeconds ?? null,
  });
}

describe("DNA Open Lab current-state acquisition cadence", () => {
  it("cold-starts every recurring group in conservative batches and benches pair reads", () => {
    const schedule = createDnaCurrentStateAcquisitionSchedule({
      evaluatedAt,
      plan: createDnaCurrentStateSyncPlan({
        vault: "synthetic-owner",
        ownedCoreIds: Array.from({ length: 45 }, (_, index) => index + 1),
        activeRaceIds: Array.from(
          { length: 41 },
          (_, index) => `race-${index + 1}`,
        ),
        splicePairs: [{ fatherCoreId: 1, motherCoreId: 2 }],
      }),
    });

    expect(schedule.status).toBe("ready");
    expect(schedule.dueGroups).toEqual(DNA_CURRENT_STATE_ACQUISITION_GROUPS);
    expect(schedule.maximumAggregateRequestsPerMinute).toBe(30);
    expect(schedule.requestBatches.map((batch) => batch.length)).toEqual([
      30, 6,
    ]);
    expect(schedule.scheduledRequestCount).toBe(36);
    expect(schedule.onDemandPairRequestCount).toBe(2);
    expect(
      schedule.requestBatches
        .flat()
        .some((entry) => entry.request.endpoint.startsWith("splice.pair_")),
    ).toBe(false);
  });

  it("refreshes every family together at the daily boundary", () => {
    const recent = checkpoints();
    const schedule = createDnaCurrentStateAcquisitionSchedule({
      evaluatedAt,
      plan: createDnaCurrentStateSyncPlan({
        vault: "synthetic-owner",
        ownedCoreIds: [1, 2],
        activeRaceIds: ["race-1"],
      }),
      checkpoints: {
        ...recent,
        race_activity: { completedAt: "2026-08-27T12:29:59.000Z" },
      },
    });

    expect(schedule.dueGroups).toEqual(DNA_CURRENT_STATE_ACQUISITION_GROUPS);
    expect(schedule.requestBatches.flat()).toHaveLength(18);
    expect(schedule.nextEvaluationAt).toBe(evaluatedAt);
  });

  it("stays idle until the next local cadence boundary", () => {
    const schedule = createDnaCurrentStateAcquisitionSchedule({
      evaluatedAt,
      plan: createDnaCurrentStateSyncPlan({ vault: "synthetic-owner" }),
      checkpoints: checkpoints(),
    });

    expect(schedule.status).toBe("idle");
    expect(schedule.scheduledRequestCount).toBe(0);
    expect(schedule.nextEvaluationAt).toBe("2026-08-29T12:29:30.000Z");
  });

  it("does not schedule work before an authoritative retry boundary", () => {
    const schedule = createDnaCurrentStateAcquisitionSchedule({
      evaluatedAt,
      plan: createDnaCurrentStateSyncPlan({ vault: "synthetic-owner" }),
      retryNotBefore: "2026-08-28T12:31:17.000Z",
    });

    expect(schedule).toMatchObject({
      status: "retry_blocked",
      dueGroups: [],
      requestBatches: [],
      scheduledRequestCount: 0,
      nextEvaluationAt: "2026-08-28T12:31:17.000Z",
    });
  });

  it("requires every due refresh plus cached evidence before publication", () => {
    const schedule = createDnaCurrentStateAcquisitionSchedule({
      evaluatedAt,
      plan: createDnaCurrentStateSyncPlan({ vault: "synthetic-owner" }),
      checkpoints: {
        ...checkpoints(),
        race_activity: { completedAt: "2026-08-27T12:28:00.000Z" },
        token_prices: { completedAt: "2026-08-27T12:24:00.000Z" },
      },
    });

    expect(
      inspectDnaCurrentStateAcquisitionCompletion({
        schedule,
        completedGroups: DNA_CURRENT_STATE_ACQUISITION_GROUPS.filter(
          (group) => group !== "token_prices",
        ),
        evidenceObservedAt: evidence(),
      }),
    ).toEqual({ publishable: false, incompleteGroups: ["token_prices"] });
    expect(
      inspectDnaCurrentStateAcquisitionCompletion({
        schedule,
        completedGroups: [...DNA_CURRENT_STATE_ACQUISITION_GROUPS],
        evidenceObservedAt: evidence(),
      }),
    ).toEqual({ publishable: true, incompleteGroups: [] });

    const missingCache = evidence();
    delete (missingCache as Partial<typeof missingCache>).splice_arena;
    expect(
      inspectDnaCurrentStateAcquisitionCompletion({
        schedule,
        completedGroups: [...DNA_CURRENT_STATE_ACQUISITION_GROUPS],
        evidenceObservedAt: missingCache,
      }),
    ).toEqual({ publishable: false, incompleteGroups: ["splice_arena"] });
  });

  it("can constrain completion to an explicit non-publication control phase", () => {
    const schedule = Object.freeze({
      ...createDnaCurrentStateAcquisitionSchedule({
        evaluatedAt,
        plan: createDnaCurrentStateSyncPlan({ vault: "synthetic-owner" }),
      }),
      completionScope: "scheduled_requests_only" as const,
      dueGroups: Object.freeze(["vault_identity", "race_activity"] as const),
    });
    expect(
      inspectDnaCurrentStateAcquisitionCompletion({
        schedule,
        completedGroups: ["vault_identity", "race_activity"],
        evidenceObservedAt: {
          vault_identity: evaluatedAt,
          race_activity: evaluatedAt,
        },
      }),
    ).toEqual({ publishable: true, incompleteGroups: [] });
  });

  it("maps failures to non-destructive pause and catch-up directives", () => {
    expect(
      classifyDnaCurrentStateAcquisitionFailure({
        operation: "current_state_request",
        error: new DnaOpenLabApiError({
          kind: "rate_limited",
          message: "synthetic rate limit",
          httpStatus: 429,
          rateLimit: rateLimit({ retryAfterSeconds: 17 }),
        }),
      }),
    ).toEqual({
      reason: "rate_limited",
      retryAfterSeconds: 17,
      retryRequestImmediately: false,
      preserveLastGood: true,
      catchUpRequired: true,
    });

    const bodyError = new DnaOpenLabApiError({
      kind: "api_error",
      message: "synthetic body error",
      httpStatus: 305,
    });
    expect(
      classifyDnaCurrentStateAcquisitionFailure({
        operation: "eligibility_probe",
        error: bodyError,
      }).reason,
    ).toBe("api_ineligible");
    expect(
      classifyDnaCurrentStateAcquisitionFailure({
        operation: "current_state_request",
        error: bodyError,
      }).reason,
    ).toBe("invalid_payload");
    expect(
      classifyDnaCurrentStateAcquisitionFailure({
        operation: "current_state_request",
        error: new DnaOpenLabApiError({
          kind: "api_error",
          message: "synthetic unavailable",
          httpStatus: 503,
        }),
      }).reason,
    ).toBe("api_unavailable");
  });

  it("fails closed on future checkpoints or future evidence", () => {
    expect(() =>
      createDnaCurrentStateAcquisitionSchedule({
        evaluatedAt,
        plan: createDnaCurrentStateSyncPlan({ vault: "synthetic-owner" }),
        checkpoints: {
          race_activity: { completedAt: "2026-08-28T12:30:01.000Z" },
        },
      }),
    ).toThrow("race_activity.completedAt cannot be in the future");

    const schedule = createDnaCurrentStateAcquisitionSchedule({
      evaluatedAt,
      plan: createDnaCurrentStateSyncPlan({ vault: "synthetic-owner" }),
    });
    expect(() =>
      inspectDnaCurrentStateAcquisitionCompletion({
        schedule,
        completedGroups: [...DNA_CURRENT_STATE_ACQUISITION_GROUPS],
        evidenceObservedAt: {
          ...evidence(),
          race_activity: "2026-08-28T12:30:01.000Z",
        },
      }),
    ).toThrow("race_activity evidence cannot follow the completion time");

    expect(
      inspectDnaCurrentStateAcquisitionCompletion({
        schedule,
        completedAt: "2026-08-28T12:30:02.000Z",
        completedGroups: [...DNA_CURRENT_STATE_ACQUISITION_GROUPS],
        evidenceObservedAt: {
          ...evidence(),
          race_activity: "2026-08-28T12:30:01.000Z",
        },
      }),
    ).toEqual({ publishable: true, incompleteGroups: [] });
  });
});
