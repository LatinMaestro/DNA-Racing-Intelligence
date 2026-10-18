import { describe, expect, it, vi } from "vitest";

import {
  createTournamentHorseScreeningAcceptedSourceBoundary,
  type TournamentHorseAcceptedSourceRepositories,
  type TournamentHorseHistorySnapshot,
  type TournamentHorseOpponentPoolSnapshot,
  type TournamentHorseRosterSnapshot,
} from "@/lib/tournament-horse-screening-accepted-source";
import {
  materializeTournamentHorseScreeningSnapshot,
  type TournamentHorseScreeningPublicationCandidate,
} from "@/lib/tournament-horse-screening-materializer";

const owner = "11111111-1111-4111-8111-111111111111";
const rosterVersion = "a".repeat(64);
const historyVersion = "b".repeat(64);
const observationVersion = "c".repeat(64);
const poolVersion = "d".repeat(64);
const cutoff = "2026-10-18T00:00:00.000Z";

const roster: TournamentHorseRosterSnapshot = {
  databaseOwnerId: owner,
  rosterSnapshotVersion: rosterVersion,
  state: "accepted",
  complete: true,
  truncated: false,
  cores: [{ coreId: "101", name: "Owned Horse", element: "Fire" }],
};

const pools: TournamentHorseOpponentPoolSnapshot = {
  databaseOwnerId: owner,
  opponentPoolSnapshotVersion: poolVersion,
  state: "accepted",
  completeForRosterElements: true,
  truncated: false,
  cores: [{ coreId: "201", name: "Opponent", element: "Fire" }],
  groups: [1000, 1400, 2200].map((distanceMetres) => ({
    element: "Fire",
    distanceMetres,
    tournamentFieldOpponentCoreIds: ["201"],
    topTenPercentOpponentCoreIds: ["201"],
    status: "confirmed" as const,
  })),
};

function observation(
  coreId: string,
  distanceMetres: number,
  gateCount: number,
) {
  return {
    eventId: `${coreId}-${distanceMetres}-${gateCount}`,
    eventAt: "2026-10-01T00:00:00.000Z",
    mode: "horse" as const,
    distanceMetres,
    gateCount,
    elapsedTimeMilliseconds: coreId === "101" ? 50_000 : 55_000,
  };
}

const history: TournamentHorseHistorySnapshot = {
  databaseOwnerId: owner,
  historyGenerationVersion: historyVersion,
  observationSetSha256: observationVersion,
  evidenceCutoff: cutoff,
  state: "accepted",
  completeForRequestedCores: true,
  truncated: false,
  requestedCoreIds: ["101", "201"],
  cores: ["101", "201"].map((coreId) => ({
    coreId,
    observations: [
      observation(coreId, 1000, 2),
      observation(coreId, 1400, 4),
      observation(coreId, 2200, 2),
    ],
  })),
};

function harness(change?: {
  roster?: TournamentHorseRosterSnapshot | null;
  pools?: TournamentHorseOpponentPoolSnapshot | null;
  history?: TournamentHorseHistorySnapshot | null;
}) {
  const loadAcceptedHorseRosterByOwner = vi.fn(async () =>
    change && "roster" in change ? change.roster! : roster,
  );
  const loadAcceptedHorseOpponentPoolsByOwner = vi.fn(async () =>
    change && "pools" in change ? change.pools! : pools,
  );
  const loadAcceptedHorseHistoryByOwner = vi.fn(async () =>
    change && "history" in change ? change.history! : history,
  );
  const repositories: TournamentHorseAcceptedSourceRepositories = {
    roster: {
      loadAcceptedHorseRosterByOwner,
      readAcceptedHorseRosterVersionByOwner: vi.fn(async () => rosterVersion),
    },
    opponentPools: {
      loadAcceptedHorseOpponentPoolsByOwner,
      readAcceptedHorseOpponentPoolVersionByOwner: vi.fn(
        async () => poolVersion,
      ),
    },
    history: {
      loadAcceptedHorseHistoryByOwner,
      readAcceptedHorseHistoryPointerByOwner: vi.fn(async () => ({
        historyGenerationVersion: historyVersion,
        observationSetSha256: observationVersion,
        evidenceCutoff: cutoff,
      })),
    },
  };
  return {
    boundary: createTournamentHorseScreeningAcceptedSourceBoundary({
      databaseOwnerId: owner,
      repositories,
    }),
    loadAcceptedHorseHistoryByOwner,
  };
}

describe("Tournament Horse screening accepted source", () => {
  it("composes complete all-distance owner and confirmed opponent evidence", async () => {
    const test = harness();
    const source = await test.boundary.loadAcceptedSourceByOwner(owner);
    expect(source).toMatchObject({
      databaseOwnerId: owner,
      sourceSnapshotVersion: expect.stringMatching(/^[a-f0-9]{64}$/u),
      evidenceCutoff: cutoff,
      coverage: {
        state: "accepted",
        generationIntegrityVerified: true,
        ownerRosterVerified: true,
        exactHorseDistanceCoverageVerified: true,
        opponentPoolsVerified: true,
        completeForRequestedCores: true,
        truncated: false,
      },
    });
    expect(source?.groups).toHaveLength(3);
    expect(source?.groups.map(({ distanceMetres }) => distanceMetres)).toEqual([
      1000, 1400, 2200,
    ]);
    expect(source?.groups[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coreId: "101",
          owned: true,
          distanceObservations: [
            expect.objectContaining({ eventId: "101-1000-2" }),
          ],
          directOneVOneObservations: [
            expect.objectContaining({ eventId: "101-1000-2" }),
          ],
        }),
        expect.objectContaining({ coreId: "201", owned: false }),
      ]),
    );
    expect(test.loadAcceptedHorseHistoryByOwner).toHaveBeenCalledWith(owner, {
      coreIds: ["101", "201"],
      distancesMetres: [1000, 1400, 2200],
      maximumRows: 10_000,
    });
    await expect(
      test.boundary.readAcceptedSourceIdentityByOwner(owner),
    ).resolves.toBe(source?.sourceSnapshotVersion);
  });

  it("keeps non-two-gate observations out of the direct 1v1 lane", async () => {
    const source = await harness().boundary.loadAcceptedSourceByOwner(owner);
    const core = source?.groups
      .find(({ distanceMetres }) => distanceMetres === 1400)
      ?.evidence.find(({ coreId }) => coreId === "101");
    expect(core?.distanceObservations).toHaveLength(1);
    expect(core?.directOneVOneObservations).toEqual([]);
  });

  it("keeps the complete 195-Core owner Vault inside the bounded source", async () => {
    const completeRoster = {
      ...roster,
      cores: Array.from({ length: 195 }, (_, index) => ({
        coreId: String(1_000 + index),
        name: `Owned Horse ${index + 1}`,
        element: "Fire",
      })),
    };
    const completeHistory = {
      ...history,
      requestedCoreIds: [
        ...completeRoster.cores.map(({ coreId }) => coreId),
        "201",
      ].sort(),
      cores: [
        ...completeRoster.cores.map(({ coreId }) => ({
          coreId,
          observations: [],
        })),
        { coreId: "201", observations: history.cores[1]!.observations },
      ],
    };
    const source = await harness({
      roster: completeRoster,
      history: completeHistory,
    }).boundary.loadAcceptedSourceByOwner(owner);
    expect(source?.coverage.ownerRosterVerified).toBe(true);
    expect(
      source?.groups[0]?.evidence.filter(({ owned }) => owned),
    ).toHaveLength(195);
  });

  it("feeds the existing materializer without changing the approved model", async () => {
    const test = harness();
    const publishCandidate = vi.fn(
      async (candidate: TournamentHorseScreeningPublicationCandidate) => {
        void candidate;
        return "published" as const;
      },
    );
    await expect(
      materializeTournamentHorseScreeningSnapshot({
        databaseOwnerId: owner,
        source: test.boundary,
        publication: {
          readActiveSnapshotVersionByOwner: vi.fn(async () => null),
          publishCandidate,
        },
        now: () => new Date("2026-10-19T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ status: "published" });
    const payload = JSON.parse(
      publishCandidate.mock.calls[0]![0].payloadJson,
    ) as Record<string, unknown>;
    expect(payload.modelVersion).toBe("horse-1v1-exact-distance-transfer-v2");
  });

  it("marks missing histories and incomplete pools partial instead of accepted", async () => {
    const partialHistory = {
      ...history,
      state: "partial" as const,
      completeForRequestedCores: false,
      cores: history.cores.slice(0, 1),
    };
    const partialPools = {
      ...pools,
      state: "partial" as const,
      completeForRosterElements: false,
      groups: pools.groups.slice(0, 2),
    };
    const source = await harness({
      history: partialHistory,
      pools: partialPools,
    }).boundary.loadAcceptedSourceByOwner(owner);
    expect(source?.coverage).toMatchObject({
      state: "partial",
      exactHorseDistanceCoverageVerified: false,
      opponentPoolsVerified: false,
      completeForRequestedCores: false,
    });
    expect(source?.groups).toHaveLength(2);
  });

  it("returns unavailable before history access when roster or pools are absent", async () => {
    const test = harness({ roster: null });
    await expect(
      test.boundary.loadAcceptedSourceByOwner(owner),
    ).resolves.toBeNull();
    expect(test.loadAcceptedHorseHistoryByOwner).not.toHaveBeenCalled();
  });

  it("rejects cross-owner, duplicate, future and non-Horse evidence with a sanitized error", async () => {
    const cases: TournamentHorseHistorySnapshot[] = [
      {
        ...history,
        databaseOwnerId: "22222222-2222-4222-8222-222222222222",
      },
      {
        ...history,
        cores: [history.cores[0]!, history.cores[0]!],
      },
      {
        ...history,
        cores: [
          {
            ...history.cores[0]!,
            observations: [
              { ...history.cores[0]!.observations[0]!, eventAt: cutoff },
            ],
          },
          history.cores[1]!,
        ],
      },
      {
        ...history,
        cores: [
          {
            ...history.cores[0]!,
            observations: [
              {
                ...history.cores[0]!.observations[0]!,
                mode: "bike" as unknown as "horse",
              },
            ],
          },
          history.cores[1]!,
        ],
      },
    ];
    for (const value of cases) {
      await expect(
        harness({ history: value }).boundary.loadAcceptedSourceByOwner(owner),
      ).rejects.toThrow(
        "Tournament Horse screening accepted source unavailable.",
      );
    }
  });

  it("rejects unconfirmed pool membership outside the matching element", async () => {
    const invalidPools = {
      ...pools,
      cores: [{ coreId: "201", name: "Opponent", element: "Water" }],
    };
    await expect(
      harness({ pools: invalidPools }).boundary.loadAcceptedSourceByOwner(
        owner,
      ),
    ).rejects.toThrow(
      "Tournament Horse screening accepted source unavailable.",
    );
  });
});
