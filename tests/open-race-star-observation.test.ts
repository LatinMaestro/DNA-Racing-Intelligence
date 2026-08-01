import { describe, expect, it } from "vitest";

import {
  recordOpenRaceStarObservation,
  type OpenRaceStarObservationInput,
} from "../domain/open-race-star-observation";

function input(
  overrides: Partial<OpenRaceStarObservationInput> = {},
): OpenRaceStarObservationInput {
  return {
    observationId: "observation-1",
    lockId: "lock-1",
    gameEventId: "event-1",
    lockedAt: "2026-07-23T10:03:00Z",
    observedAt: "2026-07-23T10:04:00Z",
    fieldStage: "locked_observation",
    gateCount: 4,
    enteredCoreIds: ["owned-1", "opponent-1", "opponent-2", "opponent-3"],
    selectedOwnedCoreId: "owned-1",
    gold: { status: "assigned", coreId: "owned-1" },
    blue: { status: "assigned", coreId: "owned-1" },
    note: "Synthetic observation",
    ...overrides,
  };
}

describe("Open Race post-lock star observation", () => {
  it("records both revealed stars as observation-only evidence", () => {
    expect(recordOpenRaceStarObservation(input())).toMatchObject({
      selectedCoreSignal: "both",
      recordStatus: "recorded",
      goldApplicable: true,
      sourceType: "manual_pre_run_star_observation",
      observationOnly: true,
      authoritativeHistoricalEvidence: false,
      completedRaceResult: false,
      replacementRecommendationAllowed: false,
      reconciliationStatus: "pending_authoritative_import",
    });
  });

  it("supports the same core, different cores and absent assignments", () => {
    expect(
      recordOpenRaceStarObservation(
        input({
          gold: { status: "assigned", coreId: "opponent-1" },
          blue: { status: "assigned", coreId: "owned-1" },
        }),
      ).selectedCoreSignal,
    ).toBe("blue_only");
    expect(
      recordOpenRaceStarObservation(
        input({
          gold: { status: "not_assigned" },
          blue: { status: "not_assigned" },
        }),
      ).selectedCoreSignal,
    ).toBe("neither_assigned");
  });

  it("keeps not-observed distinct from not-assigned", () => {
    const result = recordOpenRaceStarObservation(
      input({
        gold: { status: "not_observed" },
        blue: { status: "not_assigned" },
      }),
    );
    expect(result.gold).toEqual({ status: "not_observed" });
    expect(result.selectedCoreSignal).toBe("incomplete_observation");
  });

  it("requires Gold not-applicable for a clean three-gate observation", () => {
    const result = recordOpenRaceStarObservation(
      input({
        gateCount: 3,
        enteredCoreIds: ["owned-1", "opponent-1", "opponent-2"],
        gold: { status: "not_applicable" },
      }),
    );
    expect(result).toMatchObject({
      goldApplicable: false,
      recordStatus: "recorded",
      issues: [],
    });
  });

  it("preserves an ineligible Gold claim as a review anomaly", () => {
    const result = recordOpenRaceStarObservation(
      input({
        gateCount: 3,
        enteredCoreIds: ["owned-1", "opponent-1", "opponent-2"],
        gold: { status: "assigned", coreId: "owned-1" },
      }),
    );
    expect(result.gold).toEqual({ status: "assigned", coreId: "owned-1" });
    expect(result.recordStatus).toBe("review_required");
    expect(result.issues[0]).toContain("not applicable");
  });

  it("rejects an assigned star outside the locked field", () => {
    expect(() =>
      recordOpenRaceStarObservation(
        input({ blue: { status: "assigned", coreId: "not-entered" } }),
      ),
    ).toThrow("Blue core must be in the locked field");
  });

  it("requires the locked stage and chronological observation time", () => {
    expect(() =>
      recordOpenRaceStarObservation(
        input({ fieldStage: "forming" as "locked_observation" }),
      ),
    ).toThrow("only after field lock");
    expect(() =>
      recordOpenRaceStarObservation(
        input({ observedAt: "2026-07-23T10:02:00Z" }),
      ),
    ).toThrow("cannot predate field lock");
  });

  it("rejects race outcomes and replacement recommendations", () => {
    expect(() =>
      recordOpenRaceStarObservation({
        ...input(),
        winnerCoreId: "owned-1",
      } as OpenRaceStarObservationInput),
    ).toThrow("cannot contain race outcomes or recommendations");
    expect(() =>
      recordOpenRaceStarObservation({
        ...input(),
        replacementRecommendation: "opponent-1",
      } as OpenRaceStarObservationInput),
    ).toThrow("cannot contain race outcomes or recommendations");
  });
});
