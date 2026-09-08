import { describe, expect, it, vi } from "vitest";

import type {
  BreedingPairRankingInput,
  BreedingRankingCandidateInput,
} from "@/domain/breeding-pair-ranking";
import {
  acceptedProLeagueBreedingAnalysisSha256,
  publishAcceptedProLeagueBreedingAnalysis,
  type AcceptedProLeagueBreedingAnalysis,
  type AcceptedProLeagueBreedingAnalysisSnapshot,
} from "@/lib/pro-league-breeding-ranking-publication-service";

const ownerId = "private_owner";
const generationId = "85000000-0000-4000-8000-000000000101";

function candidate(): BreedingRankingCandidateInput {
  return {
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
  };
}

function ranking(
  overrides: Partial<BreedingPairRankingInput> = {},
): BreedingPairRankingInput {
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
    candidates: [candidate()],
    ...overrides,
  };
}

function analysis(
  overrides: Partial<AcceptedProLeagueBreedingAnalysis> = {},
): AcceptedProLeagueBreedingAnalysis {
  return {
    analysisId: "accepted-analysis-v1",
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
}

function snapshot(
  overrides: Partial<AcceptedProLeagueBreedingAnalysis> = {},
): AcceptedProLeagueBreedingAnalysisSnapshot {
  const value = analysis(overrides);
  return {
    ...value,
    contentSha256: acceptedProLeagueBreedingAnalysisSha256(value),
  };
}

function publisher(disposition: "published" | "existing" = "published") {
  const publish = vi.fn(async () => disposition);
  return { status: "ready" as const, publish };
}

function request(
  overrides: Partial<
    Parameters<typeof publishAcceptedProLeagueBreedingAnalysis>[0]
  > = {},
) {
  return {
    authenticatedOwnerId: ownerId,
    configuredOwnerId: ownerId,
    generationId,
    workerId: "breeding-ranking-worker",
    publishedAt: "2026-09-08T02:05:00.000Z",
    snapshot: snapshot(),
    publisher: publisher(),
    ...overrides,
  };
}

describe("Pro League breeding ranking publication service", () => {
  it("publishes one complete accepted and digest-verified generation", async () => {
    const input = request();

    await expect(
      publishAcceptedProLeagueBreedingAnalysis(input),
    ).resolves.toEqual({
      disposition: "published",
      analysisId: "accepted-analysis-v1",
      rankingCount: 1,
      candidateCount: 1,
      contentSha256: input.snapshot.contentSha256,
    });
    expect(input.publisher.publish).toHaveBeenCalledOnce();
    expect(input.publisher.publish).toHaveBeenCalledWith(ownerId, {
      generationId,
      workerId: "breeding-ranking-worker",
      rosterEvidenceCutoffAt: "2026-09-08T01:00:00.000Z",
      latestAcceptedPerformanceImportAt: "2026-09-08T00:30:00.000Z",
      latestAcceptedArenaImportAt: null,
      publishedAt: "2026-09-08T02:05:00.000Z",
      rankings: input.snapshot.rankings,
    });
  });

  it("returns the repository's exact-replay disposition", async () => {
    const input = request({ publisher: publisher("existing") });
    await expect(
      publishAcceptedProLeagueBreedingAnalysis(input),
    ).resolves.toMatchObject({ disposition: "existing" });
  });

  it("rejects partial and empty analysis before publication", async () => {
    const incomplete = request({
      snapshot: snapshot({ expectedRankingCount: 2 }),
    });
    await expect(
      publishAcceptedProLeagueBreedingAnalysis(incomplete),
    ).rejects.toThrow("ranking coverage is incomplete");
    expect(incomplete.publisher.publish).not.toHaveBeenCalled();

    const emptyValue = analysis({
      expectedRankingCount: 0,
      expectedCandidateCount: 0,
      rankings: [],
    });
    const empty = request({
      snapshot: {
        ...emptyValue,
        contentSha256: acceptedProLeagueBreedingAnalysisSha256(emptyValue),
      },
    });
    await expect(
      publishAcceptedProLeagueBreedingAnalysis(empty),
    ).rejects.toThrow("ranking count is outside its bound");
    expect(empty.publisher.publish).not.toHaveBeenCalled();
  });

  it("rejects candidate count drift and duplicate ranking identity", async () => {
    const countDrift = request({
      snapshot: snapshot({ expectedCandidateCount: 2 }),
    });
    await expect(
      publishAcceptedProLeagueBreedingAnalysis(countDrift),
    ).rejects.toThrow("candidate coverage is incomplete");

    const duplicate = request({
      snapshot: snapshot({
        expectedRankingCount: 2,
        expectedCandidateCount: 2,
        rankings: [ranking(), ranking()],
      }),
    });
    await expect(
      publishAcceptedProLeagueBreedingAnalysis(duplicate),
    ).rejects.toThrow("ranking identity is duplicated");
  });

  it("rejects changed content after analysis acceptance", async () => {
    const accepted = snapshot();
    const changed = request({
      snapshot: {
        ...accepted,
        analysisId: "changed-after-acceptance",
      },
    });
    await expect(
      publishAcceptedProLeagueBreedingAnalysis(changed),
    ).rejects.toThrow("analysis digest does not match");
    expect(changed.publisher.publish).not.toHaveBeenCalled();
  });

  it("rejects cross-owner and chronologically invalid publication", async () => {
    const crossOwner = request({ authenticatedOwnerId: "different_owner" });
    await expect(
      publishAcceptedProLeagueBreedingAnalysis(crossOwner),
    ).rejects.toThrow("owner scope denied");

    const tooEarly = request({
      publishedAt: "2026-09-08T01:59:59.000Z",
    });
    await expect(
      publishAcceptedProLeagueBreedingAnalysis(tooEarly),
    ).rejects.toThrow("chronologically invalid");
  });

  it("rejects rankings that drift from the accepted imports or cutoff", async () => {
    const importDrift = request({
      snapshot: snapshot({
        rankings: [ranking({ lastImported: "2026-09-08T00:29:00.000Z" })],
      }),
    });
    await expect(
      publishAcceptedProLeagueBreedingAnalysis(importDrift),
    ).rejects.toThrow("does not match accepted authority");

    const cutoffDrift = request({
      snapshot: snapshot({
        rosterEvidenceCutoffAt: "2026-09-08T00:10:00.000Z",
      }),
    });
    await expect(
      publishAcceptedProLeagueBreedingAnalysis(cutoffDrift),
    ).rejects.toThrow("does not match accepted authority");
  });

  it("cannot claim unavailable Pro League race-type evidence", async () => {
    const invalid = request({
      snapshot: {
        ...snapshot(),
        proLeagueRaceTypeEvidence: "available",
      } as unknown as AcceptedProLeagueBreedingAnalysisSnapshot,
    });
    await expect(
      publishAcceptedProLeagueBreedingAnalysis(invalid),
    ).rejects.toThrow("must remain unavailable");
    expect(invalid.publisher.publish).not.toHaveBeenCalled();
  });
});
