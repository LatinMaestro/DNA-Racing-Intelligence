import { describe, expect, it } from "vitest";
import {
  composePersistedOpenRaceCandidateScenario,
  type AcceptedOpenRaceScenarioEvidence,
} from "@/lib/open-race-persisted-scenario-service";
import type { OpenRaceWorkspaceSession } from "@/lib/open-race-workspace-service";

function history(prefix: string, start: number, count = 10) {
  return Array.from({ length: count }, (_, index) => ({
    eventId: `${prefix}-${index}`,
    eventAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    elapsedTimeMilliseconds: start + index,
  }));
}

function session(): OpenRaceWorkspaceSession {
  return {
    stage: "provisional_selection",
    lock: null,
    observation: null,
    comparison: null,
    field: {
      requestId: "persisted-session",
      capturedAt: "2026-10-17T10:00:00.000Z",
      dataCurrentThrough: "2026-10-16T00:00:00.000Z",
      lastImported: "2026-10-17T09:00:00.000Z",
      mode: "bike",
      distanceMeters: 1400,
      raceFormat: "4 gate WTA",
      gateCount: 4,
      availableGates: 3,
      entryFee: null,
      opponentCoreIds: ["entered-a"],
      freshness: "current",
      status: "ready_for_provisional_selection",
      reviewReasons: [],
      fieldStage: "forming",
      currentRaceStarsAccepted: false,
      historicalSnapshotOnly: true,
      liveGameConnection: false,
      sourceDisclosure: "Synthetic accepted field fixture.",
      restrictions: [],
    },
    eligibility: {
      evaluationId: "eligibility-v1",
      evaluatedAt: "2026-10-17T09:30:00.000Z",
      vaultDataCurrentThrough: "2026-10-16T00:00:00.000Z",
      freshness: "current",
      eligibleCoreIds: ["owned-a"],
      cores: [{ coreId: "owned-a", status: "eligible", reasons: [] }],
      rankingPerformed: false,
      recommendationMade: false,
      currentRaceStarsUsed: false,
      ownershipMutated: false,
    },
    ranking: {
      rankingId: "ranking-v1",
      evaluatedAt: "2026-10-17T11:00:00.000Z",
      dataCurrentThrough: "2026-10-16T00:00:00.000Z",
      freshness: "current",
      status: "provisional",
      provisionalRecommendedCoreId: "owned-a",
      rankedCandidates: [
        {
          rank: 1,
          coreId: "owned-a",
          medianTimeMs: 9_005,
          marginToStrongestOpponentMs: 1_000,
          sampleStatus: "minimally_analytical",
          historicalStarRationale: ["Synthetic historical fixture."],
          starsAffectedRank: false,
        },
      ],
      strongestOpponentCoreId: "entered-a",
      avoidSignal: false,
      reviewReasons: [],
      warnings: [],
      currentRaceStarsUsed: false,
      replacementRecommendationAllowed: false,
      raceEntryAllowed: false,
      finalActionableRecommendationAllowed: false,
    },
    bindings: {
      sessionVersion: "session-v1",
      fieldVersion: "field-v1",
      eligibilityVersion: "eligibility-v1",
      rankingVersion: "ranking-v1",
      raceImportVersion: "race-import-v7",
      vaultSnapshotVersion: "vault-v4",
      historicalAggregateVersion: "aggregate-v5",
      lockVersion: null,
      observationVersion: null,
      comparisonVersion: null,
    },
    mutationAllowed: false,
    liveGameConnection: false,
    gateCPassed: false,
  } satisfies OpenRaceWorkspaceSession;
}

function source(): AcceptedOpenRaceScenarioEvidence {
  return {
    authenticatedOwnerId: "owner-1",
    sessionVersion: "session-v1",
    fieldVersion: "field-v1",
    eligibilityVersion: "eligibility-v1",
    rankingVersion: "ranking-v1",
    raceImportVersion: "race-import-v7",
    vaultSnapshotVersion: "vault-v4",
    historicalAggregateVersion: "aggregate-v5",
    evidenceCutoff: "2026-10-16T00:00:00.000Z",
    modelVersion: "empirical-pairwise-v1",
    context: {
      mode: "bike",
      distanceMeters: 1400,
      competition: "normal",
      format: "4 gate WTA",
      gateCount: 4,
      element: { status: "unknown", value: null },
    },
    candidateHistories: [
      { coreId: "owned-a", observations: history("owned", 9_000) },
    ],
    opponentHistories: [
      { coreId: "entered-a", observations: history("entered", 10_000) },
    ],
  };
}

describe("persisted Open Race candidate scenario integration", () => {
  it("binds a forming session to accepted exact-source evidence without actionable outputs", () => {
    const view = composePersistedOpenRaceCandidateScenario(
      "owner-1",
      session(),
      source(),
    );
    expect(view.status).toBe("experimental");
    if (view.scenario === null)
      throw new Error("Expected an experimental scenario.");
    expect(view.scenario).toMatchObject({
      status: "available",
      evidenceCutoff: "2026-10-16T00:00:00.000Z",
      field: {
        fieldVersion: "field-v1",
        enteredOpponentCount: 1,
        emptyGateCount: 3,
      },
      combinedFieldProbabilityStatus: "not_calculated_unapproved_combination",
      currentRaceStarsUsed: false,
      fairExOddsUsed: false,
      raceEntryAllowed: false,
      gameActionAllowed: false,
    });
    expect(view.scenario.candidates[0]).toMatchObject({
      coreId: "owned-a",
      combinedFieldWinProbabilityMillionths: null,
      recommendationAllowed: false,
    });
    expect(
      view.scenario.candidates[0]?.comparisons[0]?.probability,
    ).toMatchObject({
      pWinMillionths: 1_000_000,
      candidateSampleCount: 10,
      opponentSampleCount: 10,
      decisionUseAllowed: false,
      economicUseAllowed: false,
    });
  });

  it("does not run for a locked field or without accepted historical evidence", () => {
    expect(
      composePersistedOpenRaceCandidateScenario(
        "owner-1",
        { ...session(), stage: "locked_observation" },
        source(),
      ),
    ).toMatchObject({ status: "unavailable", reason: "NOT_FORMING" });
    expect(
      composePersistedOpenRaceCandidateScenario("owner-1", session(), null),
    ).toMatchObject({
      status: "unavailable",
      reason: "HISTORICAL_EVIDENCE_UNAVAILABLE",
    });
  });

  it("refuses stale and unconfirmed fields rather than presenting estimates", () => {
    const base = session();
    expect(
      composePersistedOpenRaceCandidateScenario(
        "owner-1",
        { ...base, field: { ...base.field, freshness: "stale" } },
        source(),
      ),
    ).toMatchObject({ status: "unavailable", reason: "FIELD_REVIEW_REQUIRED" });
    expect(
      composePersistedOpenRaceCandidateScenario(
        "owner-1",
        { ...base, field: { ...base.field, status: "review_required" } },
        source(),
      ),
    ).toMatchObject({ status: "unavailable", reason: "FIELD_REVIEW_REQUIRED" });
  });

  it("rejects cross-owner accepted histories before comparison", () => {
    expect(() =>
      composePersistedOpenRaceCandidateScenario("owner-1", session(), {
        ...source(),
        authenticatedOwnerId: "owner-2",
      }),
    ).toThrow("source owner mismatch");
  });

  it("rejects version drift and altered exact context", () => {
    expect(() =>
      composePersistedOpenRaceCandidateScenario("owner-1", session(), {
        ...source(),
        fieldVersion: "field-v2",
      }),
    ).toThrow("source identity has changed");
    expect(() =>
      composePersistedOpenRaceCandidateScenario("owner-1", session(), {
        ...source(),
        context: { ...source().context!, distanceMeters: 1600 },
      }),
    ).toThrow("context differs");
    expect(
      composePersistedOpenRaceCandidateScenario("owner-1", session(), {
        ...source(),
        context: null,
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "EXACT_CONTEXT_UNAVAILABLE",
    });
  });

  it("does not substitute a different Core's history or truncate missing evidence", () => {
    expect(
      composePersistedOpenRaceCandidateScenario("owner-1", session(), {
        ...source(),
        opponentHistories: [
          { coreId: "wrong-opponent", observations: history("other", 11_000) },
        ],
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "INCOMPLETE_CORE_HISTORY",
    });
    expect(
      composePersistedOpenRaceCandidateScenario("owner-1", session(), {
        ...source(),
        candidateHistories: [],
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: "INCOMPLETE_CORE_HISTORY",
    });
  });

  it("preserves sample insufficiency as an unavailable diagnostic", () => {
    const candidate = source();
    const view = composePersistedOpenRaceCandidateScenario(
      "owner-1",
      session(),
      {
        ...candidate,
        candidateHistories: [
          { coreId: "owned-a", observations: history("owned", 9_000, 9) },
        ],
      },
    );
    expect(
      view.scenario?.candidates[0]?.comparisons[0]?.probability,
    ).toMatchObject({
      status: "unavailable",
      pWinMillionths: null,
      reasons: ["INSUFFICIENT_CANDIDATE_SAMPLE"],
    });
  });

  it("refuses an element contradicting a confirmed field restriction", () => {
    const base = session();
    expect(() =>
      composePersistedOpenRaceCandidateScenario(
        "owner-1",
        {
          ...base,
          field: {
            ...base.field,
            restrictions: [
              {
                restrictionId: "metal-only",
                kind: "element",
                value: "Metal",
                evidenceStatus: "confirmed",
              },
            ],
          },
        },
        source(),
      ),
    ).toThrow("element context differs");
  });
});
