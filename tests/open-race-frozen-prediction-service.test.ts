import { describe, expect, it } from "vitest";

import type { RacePredictionValue } from "@/domain/race-prediction-snapshot";
import {
  freezePersistedOpenRacePrediction,
  type AcceptedOpenRacePredictionEvidence,
} from "@/lib/open-race-frozen-prediction-service";
import type { OpenRaceWorkspaceSession } from "@/lib/open-race-workspace-service";

const context = {
  mode: "bike" as const,
  distanceMeters: 1400,
  competition: "normal" as const,
  format: "4 gate WTA",
  gateCount: 4,
  element: { status: "unknown" as const, value: null },
};

function predictions(): readonly RacePredictionValue[] {
  return (["win", "place", "blue_star", "yellow_star"] as const).map(
    (target) => ({
      coreId: "owned-a",
      target,
      status: "unavailable" as const,
      probabilityMillionths: null,
      evidenceStatus: "unavailable" as const,
      calculationId: null,
    }),
  );
}

function session(): OpenRaceWorkspaceSession {
  return {
    stage: "locked_observation",
    field: {
      requestId: "request-1",
      capturedAt: "2026-10-17T10:00:00.000Z",
      dataCurrentThrough: "2026-10-16T00:00:00.000Z",
      lastImported: "2026-10-17T09:00:00.000Z",
      freshness: "current",
      mode: "bike",
      distanceMeters: 1400,
      gateCount: 4,
      availableGates: 1,
      raceFormat: "4 gate WTA",
      eventStartsAt: "2026-10-17T12:00:00.000Z",
      eventIdentity: { status: "confirmed", eventId: "game-event-101" },
      probabilityContext: context,
      entryFee: null,
      opponentCoreIds: ["opponent-a", "opponent-b", "opponent-c"],
      restrictions: [],
      status: "ready_for_provisional_selection",
      reviewReasons: [],
      fieldStage: "forming",
      currentRaceStarsAccepted: false,
      historicalSnapshotOnly: true,
      liveGameConnection: false,
      sourceDisclosure: "Synthetic accepted field fixture.",
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
      evaluatedAt: "2026-10-17T10:30:00.000Z",
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
      strongestOpponentCoreId: "opponent-a",
      avoidSignal: false,
      reviewReasons: [],
      warnings: [],
      currentRaceStarsUsed: false,
      replacementRecommendationAllowed: false,
      raceEntryAllowed: false,
      finalActionableRecommendationAllowed: false,
    },
    lock: {
      lockId: "lock-1",
      requestId: "request-1",
      preEntryRankingId: "ranking-v1",
      lockedAt: "2026-10-17T11:00:00.000Z",
      gateCount: 4,
      enteredCoreIds: ["owned-a", "opponent-a", "opponent-b", "opponent-c"],
      eventStartsAt: "2026-10-17T12:00:00.000Z",
      eventIdentity: { status: "confirmed", eventId: "game-event-101" },
      selectedOwnedCoreId: "owned-a",
      provisionalRecommendedCoreId: "owned-a",
      selectionMatchedProvisionalLeader: true,
      preEntryStatus: "provisional",
      fieldStage: "locked_observation",
      commitmentStatus: "entry_committed",
      optionalObservationAllowed: true,
      replacementRecommendationAllowed: false,
      coreSwitchAllowed: false,
      raceEntryAllowed: false,
      currentRaceStarsCaptured: false,
      warnings: [],
    },
    observation: null,
    comparison: null,
    bindings: {
      sessionVersion: "session-locked-v1",
      fieldVersion: "field-v1",
      eligibilityVersion: "eligibility-v1",
      historicalAggregateVersion: "aggregate-v5",
      raceImportVersion: "race-import-v7",
      vaultSnapshotVersion: "vault-v4",
      rankingVersion: "ranking-v1",
      lockVersion: "lock-version-v1",
      observationVersion: null,
      comparisonVersion: null,
    },
    mutationAllowed: false,
    liveGameConnection: false,
    gateCPassed: false,
  };
}

function accepted(): AcceptedOpenRacePredictionEvidence {
  return {
    authenticatedOwnerId: "owner-1",
    sessionVersion: "session-locked-v1",
    fieldVersion: "field-v1",
    eligibilityVersion: "eligibility-v1",
    rankingVersion: "ranking-v1",
    lockVersion: "lock-version-v1",
    raceImportVersion: "race-import-v7",
    vaultSnapshotVersion: "vault-v4",
    historicalAggregateVersion: "aggregate-v5",
    historyGenerationVersion: "history-generation-v3",
    historySourceIdentitySha256: "a".repeat(64),
    predictedAt: "2026-10-17T11:01:00.000Z",
    evidenceCutoff: "2026-10-16T00:00:00.000Z",
    modelVersion: "empirical-pairwise-v1",
    context,
    predictions: predictions(),
  };
}

describe("persisted Open Race frozen prediction binding", () => {
  it("freezes explicit target states against the complete locked field and sources", () => {
    const view = freezePersistedOpenRacePrediction(
      "owner-1",
      session(),
      accepted(),
    );
    expect(view).toMatchObject({
      status: "frozen",
      reason: null,
      snapshot: {
        eventId: "game-event-101",
        predictedAt: "2026-10-17T11:01:00.000Z",
        eventStartsAt: "2026-10-17T12:00:00.000Z",
        modelVersion: "empirical-pairwise-v1",
        field: {
          fieldVersion: "field-v1",
          enteredCoreIds: ["owned-a", "opponent-a", "opponent-b", "opponent-c"],
        },
        sources: {
          sessionVersion: "session-locked-v1",
          eligibilityVersion: "eligibility-v1",
          raceImportVersion: "race-import-v7",
          vaultSnapshotVersion: "vault-v4",
          historicalAggregateVersion: "aggregate-v5",
          historyGenerationVersion: "history-generation-v3",
          historySourceIdentitySha256: "a".repeat(64),
          lockVersion: "lock-version-v1",
        },
        predictions: predictions(),
        frozen: true,
        predictionMutationAllowed: false,
        reconciliationStatus: "pending",
      },
    });
  });

  it("withholds freezing when required locked authority is unavailable", () => {
    const base = session();
    expect(
      freezePersistedOpenRacePrediction("owner-1", base, null),
    ).toMatchObject({
      status: "unavailable",
      reason: "PREDICTION_EVIDENCE_UNAVAILABLE",
    });
    expect(
      freezePersistedOpenRacePrediction(
        "owner-1",
        { ...base, stage: "provisional_selection", lock: null },
        accepted(),
      ),
    ).toMatchObject({ status: "unavailable", reason: "NOT_LOCKED" });
    expect(
      freezePersistedOpenRacePrediction(
        "owner-1",
        {
          ...base,
          field: {
            ...base.field,
            eventIdentity: { status: "unavailable", eventId: null },
          },
        },
        accepted(),
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "EVENT_IDENTITY_UNAVAILABLE",
    });
    expect(
      freezePersistedOpenRacePrediction(
        "owner-1",
        { ...base, field: { ...base.field, eventStartsAt: null } },
        accepted(),
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: "EVENT_SCHEDULE_UNAVAILABLE",
    });
  });

  it("rejects cross-owner, version, context and chronology drift", () => {
    expect(() =>
      freezePersistedOpenRacePrediction("owner-1", session(), {
        ...accepted(),
        authenticatedOwnerId: "owner-2",
      }),
    ).toThrow("source owner mismatch");
    expect(() =>
      freezePersistedOpenRacePrediction("owner-1", session(), {
        ...accepted(),
        lockVersion: "different-lock",
      }),
    ).toThrow("source identity has changed");
    expect(() =>
      freezePersistedOpenRacePrediction("owner-1", session(), {
        ...accepted(),
        context: { ...context, competition: "esports" },
      }),
    ).toThrow("context differs");
    expect(() =>
      freezePersistedOpenRacePrediction("owner-1", session(), {
        ...accepted(),
        predictedAt: "2026-10-17T10:59:59.000Z",
      }),
    ).toThrow("cannot predate the complete field lock");
    expect(() =>
      freezePersistedOpenRacePrediction("owner-1", session(), {
        ...accepted(),
        predictedAt: "2026-10-17T12:00:00.000Z",
      }),
    ).toThrow("must be frozen before the event starts");
  });

  it("requires explicit states for every target of the committed owned Core", () => {
    expect(() =>
      freezePersistedOpenRacePrediction("owner-1", session(), {
        ...accepted(),
        predictions: predictions().slice(0, 3),
      }),
    ).toThrow("every target");
    expect(() =>
      freezePersistedOpenRacePrediction("owner-1", session(), {
        ...accepted(),
        predictions: predictions().map((prediction, index) =>
          index === 0 ? { ...prediction, coreId: "opponent-a" } : prediction,
        ),
      }),
    ).toThrow("committed owned Core");
  });
});
