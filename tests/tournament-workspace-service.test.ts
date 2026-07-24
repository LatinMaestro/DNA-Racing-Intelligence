import { describe, expect, it, vi } from "vitest";
import type { TournamentCandidateRankingInput } from "@/domain/tournament-candidate-ranking";
import {
  loadTournamentWorkspacePageState,
  unavailableTournamentCandidateRepository,
} from "@/lib/tournament-workspace-service";

const bracket: TournamentCandidateRankingInput = {
  tournamentId: "synthetic-tournament",
  bracketId: "synthetic-bracket",
  candidates: [
    {
      coreId: "synthetic-core",
      leaderboardGroupId: "synthetic-group",
      eligibility: "eligible",
      metricStatus: "complete",
      metricRank: 2,
      metricEvidenceLabel: "Synthetic metric",
      timeEvidence: "competitive",
      historicalStarSupport: "supports",
      evidenceConfidence: "medium",
      maidenState: "eligible",
      maidenModeDisposition: "preserve_for_stronger_mode",
      dataCurrentThrough: "2026-07-20T00:00:00.000Z",
      lastImported: "2026-07-20T01:00:00.000Z",
      freshness: "current",
    },
  ],
};

describe("Tournament workspace service", () => {
  it("returns identity and persistence states without reading evidence", async () => {
    await expect(
      loadTournamentWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableTournamentCandidateRepository,
      }),
    ).resolves.toEqual({
      brackets: [],
      lastImportedAt: null,
      connectionStatus: "identity_not_connected",
    });
    await expect(
      loadTournamentWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableTournamentCandidateRepository,
      }),
    ).resolves.toEqual({
      brackets: [],
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const listCandidateEvidenceByOwner = vi.fn(async () => ({
      brackets: [bracket],
      lastImportedAt: "2026-07-20T01:00:00.000Z",
    }));
    await expect(
      loadTournamentWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", listCandidateEvidenceByOwner },
      }),
    ).rejects.toThrow("access denied");
    expect(listCandidateEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("builds deterministic non-actionable bracket reviews", async () => {
    await expect(
      loadTournamentWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          listCandidateEvidenceByOwner: async (ownerId) => {
            expect(ownerId).toBe("owner");
            return {
              brackets: [bracket],
              lastImportedAt: "2026-07-20T01:00:00.000Z",
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      brackets: [
        {
          tournamentId: "synthetic-tournament",
          bracketId: "synthetic-bracket",
          orderingAuthority: "configured_qualification_metric",
          actionableRecommendationAllowed: false,
          candidates: [
            {
              coreId: "synthetic-core",
              disposition: "preserve_me",
              actionableRecommendationAllowed: false,
              automaticEntryAllowed: false,
            },
          ],
        },
      ],
    });
  });

  it("rejects duplicate brackets and invalid import timestamps", async () => {
    for (const evidence of [
      { brackets: [bracket, bracket], lastImportedAt: null },
      { brackets: [bracket], lastImportedAt: "invalid" },
    ]) {
      await expect(
        loadTournamentWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            listCandidateEvidenceByOwner: async () => evidence,
          },
        }),
      ).rejects.toThrow();
    }
  });
});
