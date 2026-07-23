import { describe, expect, it } from "vitest";

import {
  assessCoreBurnEvent,
  type CoreBurnEventInput,
} from "../domain/core-burn-event";

function input(
  overrides: Partial<CoreBurnEventInput> = {},
): CoreBurnEventInput {
  return {
    burnId: "burn-1",
    coreId: "core-1",
    coreClass: "Morphed",
    occurredAt: "2026-07-20T00:00:00Z",
    recordedAt: "2026-07-21T00:00:00Z",
    evidenceSource: "manual",
    evidenceStatus: "confirmed",
    ownershipAtBurn: "confirmed_active",
    reason: "Confirmed in-game burn completed.",
    recommendationReferenceId: "lifecycle-1",
    ...overrides,
  };
}

describe("core burn event", () => {
  it("projects a confirmed spliced-core burn for review", () => {
    expect(assessCoreBurnEvent(input())).toMatchObject({
      status: "confirmed_event_review",
      activeVaultProjection: "remove_after_review",
      historicalLineageRetained: true,
    });
  });

  it.each(["Morphed", "Freak", "X-Class"] as const)(
    "supports confirmed %s burn evidence",
    (coreClass) => {
      expect(assessCoreBurnEvent(input({ coreClass })).status).toBe(
        "confirmed_event_review",
      );
    },
  );

  it("permanently rejects Genesis burn evidence", () => {
    expect(() => assessCoreBurnEvent(input({ coreClass: "Genesis" }))).toThrow(
      "Genesis cores cannot be burned",
    );
  });

  it("holds provisional and conflicted burn evidence", () => {
    expect(
      assessCoreBurnEvent(input({ evidenceStatus: "provisional" })),
    ).toMatchObject({
      status: "review_required",
      activeVaultProjection: "no_change",
    });
    expect(
      assessCoreBurnEvent(input({ evidenceStatus: "conflicted" }))
        .reviewReasons,
    ).toContain("Irreversible burn evidence is not confirmed.");
  });

  it("requires confirmed active ownership at burn time", () => {
    const result = assessCoreBurnEvent(input({ ownershipAtBurn: "unknown" }));
    expect(result.status).toBe("review_required");
    expect(result.reviewReasons).toContain(
      "Active ownership at the burn time is not confirmed.",
    );
  });

  it("never predicts credit or converts advice into execution", () => {
    expect(assessCoreBurnEvent(input())).toMatchObject({
      burnCreditAmount: null,
      burnCreditPredicted: false,
      recommendationWasExecutionEvidence: false,
      burnExecutionAllowed: false,
      ownershipMutationAllowed: false,
      ledgerMutationAllowed: false,
    });
  });

  it("rejects reversed timestamps and blank reasons", () => {
    expect(() =>
      assessCoreBurnEvent(input({ recordedAt: "2026-07-19T00:00:00Z" })),
    ).toThrow("cannot precede");
    expect(() => assessCoreBurnEvent(input({ reason: " " }))).toThrow(
      "reason is required",
    );
  });

  it("fails closed on unsupported runtime class and status", () => {
    expect(() =>
      assessCoreBurnEvent(
        input({ coreClass: "Hybrid" as CoreBurnEventInput["coreClass"] }),
      ),
    ).toThrow("class is invalid");
    expect(() =>
      assessCoreBurnEvent(
        input({
          evidenceStatus: "complete" as CoreBurnEventInput["evidenceStatus"],
        }),
      ),
    ).toThrow("status is invalid");
  });
});
