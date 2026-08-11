import { describe, expect, it, vi } from "vitest";

import type { TournamentCandidateRankingInput } from "@/domain/tournament-candidate-ranking";
import {
  loadTournamentWorkspacePageState,
  unavailableTournamentCandidateRepository,
} from "@/lib/tournament-workspace-service";

const now = new Date("2026-07-28T00:00:00.000Z");

function bracket(
  overrides: Partial<TournamentCandidateRankingInput> = {},
): TournamentCandidateRankingInput {
  return {
    tournamentId: "synthetic-tournament",
    tournamentLabel: "Synthetic Tournament",
    bracketId: "synthetic-split",
    splitLabel: "Synthetic Split",
    mode: "horse",
    eligibleDistancesMetres: [1_200, 1_600],
    discoveryRelevance: "eligible",
    qualificationMetricLabel: "Qualification points",
    configurationVersion: "config-v3",
    candidateSnapshotVersion: "snapshot-v9",
    candidates: [
      {
        coreId: "synthetic-core",
        leaderboardGroupId: "synthetic-group",
        leaderboardGroupLabel: "Synthetic Group",
        configurationVersion: "config-v3",
        candidateSnapshotVersion: "snapshot-v9",
        eligibility: "eligible",
        metricStatus: "complete",
        metricRank: 2,
        metricEvidenceLabel: "Qualification points",
        timeEvidence: "competitive",
        historicalStarSupport: "supports",
        evidenceConfidence: "medium",
        maidenState: "eligible",
        maidenModeDisposition: "preferred_here",
        dataCurrentThrough: "2026-07-25T00:00:00.000Z",
        lastImported: "2020-01-01T00:00:00.000Z",
        freshness: "stale",
      },
    ],
    ...overrides,
  };
}

function repository(
  brackets: readonly TournamentCandidateRankingInput[] = [bracket()],
  lastImportedAt: string | null = "2026-07-28T00:00:00.000Z",
) {
  return {
    status: "ready" as const,
    listCandidateEvidenceByOwner: async () => ({ brackets, lastImportedAt }),
  };
}

describe("Tournament workspace service", () => {
  it("returns identity and persistence states without reading evidence", async () => {
    await expect(
      loadTournamentWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableTournamentCandidateRepository,
        now,
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
        now,
      }),
    ).resolves.toEqual({
      brackets: [],
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const listCandidateEvidenceByOwner = vi.fn(async () => ({
      brackets: [bracket()],
      lastImportedAt: "2026-07-28T00:00:00.000Z",
    }));
    await expect(
      loadTournamentWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", listCandidateEvidenceByOwner },
        now,
      }),
    ).rejects.toThrow("access denied");
    expect(listCandidateEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("derives freshness server-side and binds the active versions", async () => {
    await expect(
      loadTournamentWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository(),
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      lastImportedAt: "2026-07-28T00:00:00.000Z",
      brackets: [
        {
          configurationVersion: "config-v3",
          candidateSnapshotVersion: "snapshot-v9",
          leaderboardGroups: [
            {
              leaderboardGroupLabel: "Synthetic Group",
              candidates: [
                {
                  coreId: "synthetic-core",
                  freshness: "current",
                  lastImported: "2026-07-28T00:00:00.000Z",
                  groupReviewRank: 2,
                  actionableRecommendationAllowed: false,
                  automaticEntryAllowed: false,
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it.each([
    [3, "current", 2],
    [4, "ageing", null],
    [7, "ageing", null],
    [8, "stale", null],
  ] as const)(
    "derives the %s-day cutoff boundary as %s",
    async (ageDays, freshness, groupReviewRank) => {
      const dataCurrentThrough = new Date(
        now.getTime() - ageDays * 86_400_000,
      ).toISOString();
      const candidate = bracket().candidates[0]!;
      const evidence = bracket({
        candidates: [
          { ...candidate, dataCurrentThrough, freshness: "current" },
        ],
      });
      await expect(
        loadTournamentWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: repository([evidence]),
          now,
        }),
      ).resolves.toMatchObject({
        brackets: [
          {
            leaderboardGroups: [
              { candidates: [{ freshness, groupReviewRank }] },
            ],
          },
        ],
      });
    },
  );

  it("defers evidence when no accepted import exists", async () => {
    await expect(
      loadTournamentWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository([bracket()], null),
        now,
      }),
    ).resolves.toMatchObject({
      lastImportedAt: null,
      brackets: [
        {
          leaderboardGroups: [
            { candidates: [{ freshness: "unknown", groupReviewRank: null }] },
          ],
        },
      ],
    });
  });

  it("rejects future, post-import and malformed evidence", async () => {
    const candidate = bracket().candidates[0]!;
    const cases = [
      repository([bracket()], "2026-07-29T00:00:00.000Z"),
      repository([
        bracket({
          candidates: [
            {
              ...candidate,
              dataCurrentThrough: "2026-07-29T00:00:00.000Z",
            },
          ],
        }),
      ]),
      repository(
        [
          bracket({
            candidates: [
              {
                ...candidate,
                dataCurrentThrough: "2026-07-27T00:00:00.000Z",
              },
            ],
          }),
        ],
        "2026-07-26T00:00:00.000Z",
      ),
      repository([bracket()], "not-a-timestamp"),
    ];
    for (const item of cases) {
      await expect(
        loadTournamentWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: item,
          now,
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects duplicate brackets and inconsistent tournament labels", async () => {
    const first = bracket();
    const duplicate = bracket();
    const inconsistent = bracket({
      bracketId: "second-split",
      splitLabel: "Second Split",
      tournamentLabel: "Different Tournament Label",
    });
    for (const brackets of [
      [first, duplicate],
      [first, inconsistent],
    ]) {
      await expect(
        loadTournamentWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: repository(brackets),
          now,
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects an unsupported repository state", async () => {
    await expect(
      loadTournamentWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: { status: "unexpected" } as never,
        now,
      }),
    ).rejects.toThrow("repository status");
  });
});
