import { describe, expect, it } from "vitest";

import {
  assessProLeagueCommissioningReadiness,
  type ProLeagueCommissioningReadinessInput,
} from "@/domain/pro-league-commissioning-readiness";

const readyInput: ProLeagueCommissioningReadinessInput = {
  activeEvidence: true,
  populationProfileCount: 1_200,
  ownedProfileCount: 25,
  ownedCoreWithoutEvidenceCount: 2,
  generationCutoffsConsistent: true,
  rosterAvailable: true,
  rosterCompliant: true,
  rosteredCoreCount: 25,
  namedRosteredCoreCount: 25,
  lineupAvailable: true,
  mapCount: 4,
  lineCount: 168,
  first16LineCount: 64,
  mapPreparationAvailable: true,
  mapPreparationCount: 4,
  currentCoreStateConnected: true,
  currentCoreCount: 25,
  historicalEvidenceFreshness: "current",
  currentCoreFreshness: "current",
  openRaceFreshness: "current",
  breedingPerformanceFreshness: "current",
  breedingArenaFreshness: "unknown",
  apiRatePolicyConnected: true,
  effectiveRequestsPerMinute: 30,
  apiRateFallbackActive: false,
  lastProviderLimit: null,
  discoveryQueueAvailable: true,
  discoveryExperimentCount: 3,
  openRaceStateConnected: true,
  exactOpenRaceGapMatchingAvailable: false,
  breedingResearchConnected: true,
  breedingObjectiveCount: 2,
  substitutionLedgerResolved: false,
  opponentExactFormatEvidenceAvailable: false,
  everyAutomaticOrGameActionDisabled: true,
};

describe("Pro League commissioning readiness", () => {
  it("separates a protected Preview review from known authority limitations", () => {
    const result = assessProLeagueCommissioningReadiness(readyInput);

    expect(result.status).toBe("ready_for_protected_preview_review");
    expect(result.summary.blockCount).toBe(0);
    expect(
      result.checks
        .filter(({ status }) => status === "review")
        .map(({ code }) => code),
    ).toEqual([
      "LAST_GOOD_FRESHNESS",
      "OPEN_RACE_LIMITATIONS",
      "SUBSTITUTION_LEDGER",
      "OPPONENT_EVIDENCE",
      "OWNER_PREVIEW_ACCEPTANCE",
    ]);
    expect(result.ownerAcceptanceRequired).toBe(true);
    expect(result.protectedPreviewDeploymentAllowed).toBe(false);
    expect(result.productionActivationAllowed).toBe(false);
    expect(result.rosterOrMapSubmissionAllowed).toBe(false);
  });

  it("flags an elevated API rate for explicit Preview review", () => {
    const result = assessProLeagueCommissioningReadiness({
      ...readyInput,
      effectiveRequestsPerMinute: 150,
    });

    expect(result.status).toBe("ready_for_protected_preview_review");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "API_REFRESH_CONTROL",
        status: "review",
        requiredForProtectedPreview: false,
      }),
    );
  });

  it("keeps stale last-good evidence visible as an owner review item", () => {
    const result = assessProLeagueCommissioningReadiness({
      ...readyInput,
      historicalEvidenceFreshness: "stale",
    });

    expect(result.status).toBe("ready_for_protected_preview_review");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "LAST_GOOD_FRESHNESS",
        status: "review",
        requiredForProtectedPreview: false,
      }),
    );
  });

  it("blocks when current state does not cover every recommended Core", () => {
    const result = assessProLeagueCommissioningReadiness({
      ...readyInput,
      currentCoreCount: 24,
    });

    expect(result.status).toBe("blocked");
    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: "CURRENT_CORE_STATE", status: "block" }),
    );
  });

  it("blocks when any automatic or game-action path is enabled", () => {
    const result = assessProLeagueCommissioningReadiness({
      ...readyInput,
      everyAutomaticOrGameActionDisabled: false,
    });

    expect(result.status).toBe("blocked");
    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: "READ_ONLY_BOUNDARY", status: "block" }),
    );
  });

  it("rejects invalid unbounded counts", () => {
    expect(() =>
      assessProLeagueCommissioningReadiness({
        ...readyInput,
        populationProfileCount: -1,
      }),
    ).toThrow("population profile count is invalid");
  });
});
