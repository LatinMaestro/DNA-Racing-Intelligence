import { describe, expect, it } from "vitest";

import {
  lockOpenRaceField,
  type OpenRaceFieldLockInput,
} from "../domain/open-race-field-lock";

function input(
  overrides: Partial<OpenRaceFieldLockInput> = {},
): OpenRaceFieldLockInput {
  return {
    lockId: "lock-1",
    requestId: "request-1",
    preEntryRankingId: "ranking-1",
    fieldCapturedAt: "2026-07-23T10:00:00Z",
    rankingEvaluatedAt: "2026-07-23T10:01:00Z",
    lockedAt: "2026-07-23T10:03:00Z",
    fieldStage: "forming",
    gateCount: 4,
    availableGates: 0,
    enteredCoreIds: ["owned-1", "opponent-1", "opponent-2", "opponent-3"],
    selectedOwnedCoreId: "owned-1",
    provisionalRecommendedCoreId: "owned-1",
    preEntryStatus: "provisional",
    userConfirmedCommittedEntry: true,
    allGatesFilled: true,
    raceSetToRun: true,
    ...overrides,
  };
}

describe("Open Race field lock", () => {
  it("creates an immutable observation-stage commitment", () => {
    expect(lockOpenRaceField(input())).toMatchObject({
      fieldStage: "locked_observation",
      commitmentStatus: "entry_committed",
      selectionMatchedProvisionalLeader: true,
      optionalObservationAllowed: true,
      replacementRecommendationAllowed: false,
      coreSwitchAllowed: false,
      raceEntryAllowed: false,
      currentRaceStarsCaptured: false,
    });
  });

  it("preserves a user-selected alternative without rewriting history", () => {
    const result = lockOpenRaceField(
      input({
        selectedOwnedCoreId: "owned-2",
        enteredCoreIds: ["owned-2", "opponent-1", "opponent-2", "opponent-3"],
      }),
    );
    expect(result.selectionMatchedProvisionalLeader).toBe(false);
    expect(result.provisionalRecommendedCoreId).toBe("owned-1");
    expect(result.warnings).toEqual([
      "The committed owned core differs from the provisional pre-entry leader.",
    ]);
  });

  it("preserves an insufficient-evidence commitment without inventing a leader", () => {
    const result = lockOpenRaceField(
      input({
        preEntryStatus: "insufficient_evidence",
        provisionalRecommendedCoreId: null,
      }),
    );
    expect(result.selectionMatchedProvisionalLeader).toBeNull();
    expect(result.warnings).toEqual([
      "The committed entry had no resolved pre-entry recommendation.",
    ]);
  });

  it("requires a complete field and set-to-run confirmation", () => {
    expect(() =>
      lockOpenRaceField(input({ availableGates: 1, allGatesFilled: false })),
    ).toThrow("all gates to be filled");
    expect(() => lockOpenRaceField(input({ raceSetToRun: false }))).toThrow(
      "set to run",
    );
  });

  it("requires explicit user commitment and the selected core in the field", () => {
    expect(() =>
      lockOpenRaceField(input({ userConfirmedCommittedEntry: false })),
    ).toThrow("confirm the committed entry");
    expect(() =>
      lockOpenRaceField(input({ selectedOwnedCoreId: "not-entered" })),
    ).toThrow("must be in the locked field");
  });

  it("rejects duplicate, incomplete and inconsistent field evidence", () => {
    expect(() =>
      lockOpenRaceField(
        input({
          enteredCoreIds: ["owned-1", "opponent-1", "opponent-1", "opponent-3"],
        }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      lockOpenRaceField(input({ enteredCoreIds: ["owned-1", "opponent-1"] })),
    ).toThrow("must equal gate count");
    expect(() =>
      lockOpenRaceField(
        input({
          preEntryStatus: "insufficient_evidence",
          provisionalRecommendedCoreId: "owned-1",
        }),
      ),
    ).toThrow("inconsistent");
  });

  it("requires chronological capture, ranking and lock evidence", () => {
    expect(() =>
      lockOpenRaceField(input({ rankingEvaluatedAt: "2026-07-23T09:59:00Z" })),
    ).toThrow("cannot predate field capture");
    expect(() =>
      lockOpenRaceField(input({ lockedAt: "2026-07-23T10:00:30Z" })),
    ).toThrow("cannot predate the pre-entry ranking");
  });

  it("rejects hidden post-lock stars and race outcomes", () => {
    expect(() =>
      lockOpenRaceField({
        ...input(),
        goldCoreId: "owned-1",
      } as OpenRaceFieldLockInput),
    ).toThrow("cannot contain post-lock stars or race outcomes");
    expect(() =>
      lockOpenRaceField({
        ...input(),
        winnerCoreId: "owned-1",
      } as OpenRaceFieldLockInput),
    ).toThrow("cannot contain post-lock stars or race outcomes");
  });
});
