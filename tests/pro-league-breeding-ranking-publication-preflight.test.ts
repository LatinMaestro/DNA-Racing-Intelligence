import { describe, expect, it, vi } from "vitest";

import type { BreedingPairRankingInput } from "@/domain/breeding-pair-ranking";
import {
  createProLeagueBreedingPublicationPreflight,
  type ProLeagueBreedingPublicationPreflightInvocation,
} from "@/lib/pro-league-breeding-ranking-publication-preflight";
import {
  acceptedProLeagueBreedingAnalysisSha256,
  type AcceptedProLeagueBreedingAnalysis,
} from "@/lib/pro-league-breeding-ranking-publication-service";

const ownerId = "private-owner";

function ranking(): BreedingPairRankingInput {
  return {
    rankingId: "bike-1000",
    rankingLabel: "Bike 1,000 m held research",
    rulesetVersion: "rules-v1",
    candidateSnapshotVersion: "candidates-v1",
    projectionVersion: "projection-v1",
    arenaSnapshotVersion: null,
    evaluatedAt: "2026-09-08T01:30:00.000Z",
    dataCurrentThrough: "2026-09-08T00:15:00.000Z",
    lastImported: "2026-09-08T00:30:00.000Z",
    freshness: "current",
    arenaDataCurrentThrough: null,
    arenaLastImported: null,
    arenaFreshness: "unknown",
    eliteWeightBasisPoints: 5_000,
    vaultFitWeightBasisPoints: 5_000,
    candidates: [
      {
        pairId: "held-pair-1",
        parents: [
          {
            coreId: "owned-a",
            ownership: "owned",
            coreClass: "Genesis",
            element: "Metal",
            fNumber: 3,
          },
          {
            coreId: "owned-b",
            ownership: "owned",
            coreClass: "Morphed",
            element: "Earth",
            fNumber: 8,
          },
        ],
        source: "owned_owned",
        mode: "Bike",
        exactDistanceM: 1_000,
        rulesetVersion: "rules-v1",
        candidateSnapshotVersion: "candidates-v1",
        projectionVersion: "projection-v1",
        arenaSnapshotVersion: null,
        ruleStatus: "eligible",
        familyStatus: "eligible",
        sexCompatibilityStatus: "compatible",
        cycleStatus: "available",
        spliceCapacityStatus: "available",
        availabilityStatus: "confirmed",
        arenaListingExpiresAt: null,
        evidenceConfidence: "high",
        distributionStatus: "supported",
        chronologicalValidationStatus: "supported",
        usesStarFeatures: false,
        starLiftStatus: "not_evaluated",
        exceptionalUpsideBasisPoints: 2_000,
        strongerOrExceptionalBasisPoints: 5_000,
        vaultFitBasisPoints: 6_000,
      },
    ],
  };
}

function snapshot() {
  const analysis: AcceptedProLeagueBreedingAnalysis = {
    analysisId: "accepted-analysis-1",
    acceptanceStatus: "accepted",
    completionStatus: "complete",
    acceptedAt: "2026-09-08T02:00:00.000Z",
    rosterEvidenceCutoffAt: "2026-09-08T01:00:00.000Z",
    latestAcceptedPerformanceImportAt: "2026-09-08T00:30:00.000Z",
    latestAcceptedArenaImportAt: null,
    proLeagueRaceTypeEvidence: "unavailable",
    expectedRankingCount: 1,
    expectedCandidateCount: 1,
    rankings: [ranking()],
  };
  return {
    ...analysis,
    contentSha256: acceptedProLeagueBreedingAnalysisSha256(analysis),
  };
}

function harness() {
  const accepted = snapshot();
  const loadAcceptedAnalysisByOwner = vi
    .fn()
    .mockResolvedValue({ status: "ready", snapshot: accepted });
  const loadCurrentAuthorityByOwner = vi.fn().mockResolvedValue({
    rosterEvidenceCutoffAt: accepted.rosterEvidenceCutoffAt,
    latestAcceptedPerformanceImportAt:
      accepted.latestAcceptedPerformanceImportAt,
    latestAcceptedArenaImportAt: accepted.latestAcceptedArenaImportAt,
  });
  const inspect = createProLeagueBreedingPublicationPreflight({
    configuredOwnerId: ownerId,
    source: { status: "ready", loadAcceptedAnalysisByOwner },
    authoritySource: { status: "ready", loadCurrentAuthorityByOwner },
  }).inspect;
  const invocation: ProLeagueBreedingPublicationPreflightInvocation = {
    preflightVersion: "pro-league-breeding-preflight/v1",
    intent: "inspect_accepted_private_analysis",
    authenticatedOwnerId: ownerId,
    analysisId: accepted.analysisId,
    expectedContentSha256: accepted.contentSha256,
    checkedAt: "2026-09-08T02:05:00.000Z",
  };
  return {
    accepted,
    inspect,
    invocation,
    loadAcceptedAnalysisByOwner,
    loadCurrentAuthorityByOwner,
  };
}

describe("Pro League breeding publication preflight", () => {
  it("returns a redacted ready receipt without authorising a write", async () => {
    const test = harness();
    await expect(test.inspect(test.invocation)).resolves.toEqual({
      status: "ready",
      readyForGuardedPublication: true,
      persistentWritePerformed: false,
      writeAuthorized: false,
      pairRecommendationAllowed: false,
      breedingExecutionAllowed: false,
      analysisId: test.accepted.analysisId,
      contentSha256: test.accepted.contentSha256,
      rankingCount: 1,
      candidateCount: 1,
      rosterEvidenceCutoffAt: test.accepted.rosterEvidenceCutoffAt,
      latestAcceptedPerformanceImportAt:
        test.accepted.latestAcceptedPerformanceImportAt,
      latestAcceptedArenaImportAt: null,
      proLeagueRaceTypeEvidence: "unavailable",
    });
  });

  it("reports every normal missing dependency as held", async () => {
    const test = harness();
    const source = createProLeagueBreedingPublicationPreflight({
      configuredOwnerId: ownerId,
      source: { status: "not_configured" },
      authoritySource: {
        status: "ready",
        loadCurrentAuthorityByOwner: vi.fn(),
      },
    });
    await expect(source.inspect(test.invocation)).resolves.toMatchObject({
      status: "held",
      reason: "source_not_configured",
      persistentWritePerformed: false,
    });

    test.loadCurrentAuthorityByOwner.mockResolvedValueOnce(null);
    await expect(test.inspect(test.invocation)).resolves.toMatchObject({
      status: "held",
      reason: "authority_not_found",
    });

    test.loadAcceptedAnalysisByOwner.mockResolvedValueOnce({
      status: "not_found",
    });
    await expect(test.inspect(test.invocation)).resolves.toMatchObject({
      status: "held",
      reason: "analysis_not_found",
    });
  });

  it("holds changed identity, stale authority and invalid accepted content", async () => {
    const identity = harness();
    await expect(
      identity.inspect({
        ...identity.invocation,
        expectedContentSha256: "f".repeat(64),
      }),
    ).resolves.toMatchObject({
      status: "held",
      reason: "accepted_identity_changed",
    });

    const stale = harness();
    stale.loadCurrentAuthorityByOwner.mockResolvedValueOnce({
      rosterEvidenceCutoffAt: "2026-09-08T01:00:01.000Z",
      latestAcceptedPerformanceImportAt:
        stale.accepted.latestAcceptedPerformanceImportAt,
      latestAcceptedArenaImportAt: null,
    });
    await expect(stale.inspect(stale.invocation)).resolves.toMatchObject({
      status: "held",
      reason: "accepted_authority_stale",
    });

    const invalid = harness();
    const acceptedAnalysis = Object.fromEntries(
      Object.entries(invalid.accepted).filter(
        ([key]) => key !== "contentSha256",
      ),
    ) as AcceptedProLeagueBreedingAnalysis;
    const incompleteAnalysis = {
      ...acceptedAnalysis,
      expectedRankingCount: 2,
    };
    const incompleteSnapshot = {
      ...incompleteAnalysis,
      contentSha256:
        acceptedProLeagueBreedingAnalysisSha256(incompleteAnalysis),
    };
    invalid.loadAcceptedAnalysisByOwner.mockResolvedValueOnce({
      status: "ready",
      snapshot: incompleteSnapshot,
    });
    await expect(
      invalid.inspect({
        ...invalid.invocation,
        expectedContentSha256: incompleteSnapshot.contentSha256,
      }),
    ).resolves.toMatchObject({
      status: "held",
      reason: "accepted_analysis_invalid",
    });
  });

  it("denies cross-owner checks before source access", async () => {
    const test = harness();
    await expect(
      test.inspect({ ...test.invocation, authenticatedOwnerId: "other-owner" }),
    ).rejects.toThrow("owner scope denied");
    expect(test.loadCurrentAuthorityByOwner).not.toHaveBeenCalled();
    expect(test.loadAcceptedAnalysisByOwner).not.toHaveBeenCalled();
  });
});
