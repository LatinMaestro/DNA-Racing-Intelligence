import { describe, expect, it, vi } from "vitest";

import type { BreedingPairRankingInput } from "@/domain/breeding-pair-ranking";
import {
  acceptedProLeagueBreedingAnalysisSha256,
  type AcceptedProLeagueBreedingAnalysis,
  type AcceptedProLeagueBreedingAnalysisSnapshot,
} from "@/lib/pro-league-breeding-ranking-publication-service";
import {
  type AcceptedProLeagueBreedingAnalysisSource,
  type ProLeagueBreedingPublicationAuthoritySource,
  runProLeagueBreedingRankingPublication,
} from "@/lib/pro-league-breeding-ranking-publication-runner";

const ownerId = "private_owner";
const analysisId = "accepted-analysis-v1";

function ranking(): BreedingPairRankingInput {
  return {
    rankingId: "bike-1000",
    rankingLabel: "Bike 1,000 m accepted research",
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
        pairId: "research-pair-1",
        parents: [
          {
            coreId: "owned-parent-a",
            ownership: "owned",
            coreClass: "Genesis",
            element: "Metal",
            fNumber: 3,
          },
          {
            coreId: "owned-parent-b",
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

function snapshot(
  overrides: Partial<AcceptedProLeagueBreedingAnalysis> = {},
): AcceptedProLeagueBreedingAnalysisSnapshot {
  const value: AcceptedProLeagueBreedingAnalysis = {
    analysisId,
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
    ...overrides,
  };
  return {
    ...value,
    contentSha256: acceptedProLeagueBreedingAnalysisSha256(value),
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const accepted = snapshot();
  const loadAcceptedAnalysisByOwner = vi.fn<
    Extract<
      AcceptedProLeagueBreedingAnalysisSource,
      { status: "ready" }
    >["loadAcceptedAnalysisByOwner"]
  >(async () => ({ status: "ready", snapshot: accepted }));
  const loadCurrentAuthorityByOwner = vi.fn<
    Extract<
      ProLeagueBreedingPublicationAuthoritySource,
      { status: "ready" }
    >["loadCurrentAuthorityByOwner"]
  >(async () => ({
    rosterEvidenceCutoffAt: accepted.rosterEvidenceCutoffAt,
    latestAcceptedPerformanceImportAt:
      accepted.latestAcceptedPerformanceImportAt,
    latestAcceptedArenaImportAt: accepted.latestAcceptedArenaImportAt,
  }));
  const publish = vi.fn(async () => "published" as const);
  return {
    input: {
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      analysisId,
      expectedContentSha256: accepted.contentSha256,
      generationId: "85000000-0000-4000-8000-000000000101",
      workerId: "breeding-ranking-worker",
      publishedAt: "2026-09-08T02:05:00.000Z",
      source: { status: "ready" as const, loadAcceptedAnalysisByOwner },
      authoritySource: {
        status: "ready" as const,
        loadCurrentAuthorityByOwner,
      },
      target: { status: "ready" as const, publish },
      ...overrides,
    },
    accepted,
    loadAcceptedAnalysisByOwner,
    loadCurrentAuthorityByOwner,
    publish,
  };
}

describe("Pro League breeding ranking publication runner", () => {
  it("publishes only the expected accepted analysis under current authority", async () => {
    const test = harness();
    await expect(
      runProLeagueBreedingRankingPublication(test.input),
    ).resolves.toEqual({
      status: "published",
      published: true,
      analysisId,
      rankingCount: 1,
      candidateCount: 1,
      contentSha256: test.accepted.contentSha256,
    });
    expect(test.loadCurrentAuthorityByOwner).toHaveBeenCalledWith(ownerId);
    expect(test.loadAcceptedAnalysisByOwner).toHaveBeenCalledWith(
      ownerId,
      analysisId,
    );
    expect(test.publish).toHaveBeenCalledOnce();
  });

  it("fails before private source access for a different owner", async () => {
    const test = harness({ authenticatedOwnerId: "different_owner" });
    await expect(
      runProLeagueBreedingRankingPublication(test.input),
    ).rejects.toThrow("owner scope denied");
    expect(test.loadCurrentAuthorityByOwner).not.toHaveBeenCalled();
    expect(test.loadAcceptedAnalysisByOwner).not.toHaveBeenCalled();
    expect(test.publish).not.toHaveBeenCalled();
  });

  it("holds without publication when a required server source is unavailable", async () => {
    const source = harness({ source: { status: "not_configured" as const } });
    await expect(
      runProLeagueBreedingRankingPublication(source.input),
    ).resolves.toEqual({ status: "source_not_configured", published: false });

    const authority = harness({
      authoritySource: { status: "not_configured" as const },
    });
    await expect(
      runProLeagueBreedingRankingPublication(authority.input),
    ).resolves.toEqual({
      status: "authority_not_configured",
      published: false,
    });

    const target = harness({ target: { status: "not_configured" as const } });
    await expect(
      runProLeagueBreedingRankingPublication(target.input),
    ).resolves.toEqual({ status: "target_not_configured", published: false });
    expect(source.publish).not.toHaveBeenCalled();
    expect(authority.publish).not.toHaveBeenCalled();
    expect(target.publish).not.toHaveBeenCalled();
  });

  it("holds when the current authority or accepted analysis is absent", async () => {
    const authority = harness();
    authority.loadCurrentAuthorityByOwner.mockResolvedValueOnce(null);
    await expect(
      runProLeagueBreedingRankingPublication(authority.input),
    ).resolves.toEqual({ status: "authority_not_found", published: false });
    expect(authority.loadAcceptedAnalysisByOwner).not.toHaveBeenCalled();

    const analysis = harness();
    analysis.loadAcceptedAnalysisByOwner.mockResolvedValueOnce({
      status: "not_found" as const,
    });
    await expect(
      runProLeagueBreedingRankingPublication(analysis.input),
    ).resolves.toEqual({ status: "analysis_not_found", published: false });
    expect(analysis.publish).not.toHaveBeenCalled();
  });

  it("rejects a changed accepted analysis identity or digest", async () => {
    const identity = harness({ analysisId: "expected-analysis-v2" });
    await expect(
      runProLeagueBreedingRankingPublication(identity.input),
    ).rejects.toThrow("accepted source identity changed");

    const digest = harness({ expectedContentSha256: "f".repeat(64) });
    await expect(
      runProLeagueBreedingRankingPublication(digest.input),
    ).rejects.toThrow("accepted source identity changed");
    expect(identity.publish).not.toHaveBeenCalled();
    expect(digest.publish).not.toHaveBeenCalled();
  });

  it("rejects stale roster, performance or Arena authority", async () => {
    for (const authority of [
      {
        rosterEvidenceCutoffAt: "2026-09-08T01:00:01.000Z",
        latestAcceptedPerformanceImportAt: "2026-09-08T00:30:00.000Z",
        latestAcceptedArenaImportAt: null,
      },
      {
        rosterEvidenceCutoffAt: "2026-09-08T01:00:00.000Z",
        latestAcceptedPerformanceImportAt: "2026-09-08T00:31:00.000Z",
        latestAcceptedArenaImportAt: null,
      },
      {
        rosterEvidenceCutoffAt: "2026-09-08T01:00:00.000Z",
        latestAcceptedPerformanceImportAt: "2026-09-08T00:30:00.000Z",
        latestAcceptedArenaImportAt: "2026-09-08T00:20:00.000Z",
      },
    ]) {
      const test = harness();
      test.loadCurrentAuthorityByOwner.mockResolvedValueOnce(authority);
      await expect(
        runProLeagueBreedingRankingPublication(test.input),
      ).rejects.toThrow("accepted authority is stale");
      expect(test.publish).not.toHaveBeenCalled();
    }
  });

  it("leaves partial-analysis and race-type authority checks at the guarded boundary", async () => {
    const test = harness();
    const incomplete = snapshot({ expectedRankingCount: 2 });
    test.loadAcceptedAnalysisByOwner.mockResolvedValueOnce({
      status: "ready",
      snapshot: incomplete,
    });
    test.input.expectedContentSha256 = incomplete.contentSha256;
    await expect(
      runProLeagueBreedingRankingPublication(test.input),
    ).rejects.toThrow("ranking coverage is incomplete");
    expect(test.publish).not.toHaveBeenCalled();
  });
});
