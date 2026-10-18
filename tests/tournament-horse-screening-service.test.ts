import { describe, expect, it } from "vitest";

import {
  loadTournamentHorseScreeningState,
  type TournamentHorseScreeningRepository,
} from "@/lib/tournament-horse-screening-service";

const candidate = {
  coreId: "horse-7",
  name: "Test Horse",
  element: "Fire",
  distanceMetres: 1400,
  status: "review_required",
  disposition: "inferred_candidate",
  expectedFieldPWinMillionths: null,
  topTenPercentStressPWinMillionths: null,
  projectedFieldOutperformanceMillionths: 510_000,
  projectedTopTenPercentOutperformanceMillionths: 490_000,
  candidateSampleCount: 12,
  candidateDirectOneVOneSampleCount: 0,
  fieldOpponentCoreCount: 4,
  stressOpponentCoreCount: 2,
  evidenceBasis: "same_mode_exact_distance_all_accepted_races",
  formatTransferStatus: "inference_only",
  provenOneVOneSpecialist: false,
  analyticalStatus: "experimental",
  decisionUseAllowed: false,
  economicStatus: "unavailable",
  economicReason: "CONFIRMED_FEE_PRIZE_RULE_NOT_SUPPLIED",
  reasons: ["DIRECT_1V1_INSUFFICIENT_SAMPLE"],
};

function repository(payload: unknown): TournamentHorseScreeningRepository {
  return {
    status: "ready",
    readActiveByOwner: async () => ({
      snapshotVersion: "a".repeat(64),
      payloadJson: JSON.stringify(payload),
      publishedAt: "2026-10-18T12:00:00.000Z",
    }),
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    modelVersion: "horse-1v1-exact-distance-transfer-v2",
    evidenceCutoff: "2026-10-18T11:00:00.000Z",
    sourceSnapshotVersion: "accepted-horse-history-v1",
    candidates: [candidate],
    ...overrides,
  };
}

const input = {
  authenticatedOwnerId: "owner-1",
  configuredOwnerId: "owner-1",
  now: new Date("2026-10-18T13:00:00.000Z"),
};

describe("Tournament Horse screening service", () => {
  it("fails closed before identity or persistence is connected", async () => {
    await expect(
      loadTournamentHorseScreeningState({
        ...input,
        authenticatedOwnerId: null,
        repository: { status: "not_configured" },
      }),
    ).resolves.toEqual({
      connectionStatus: "identity_not_connected",
      snapshot: null,
    });
    await expect(
      loadTournamentHorseScreeningState({
        ...input,
        repository: { status: "not_configured" },
      }),
    ).resolves.toEqual({
      connectionStatus: "persistence_not_configured",
      snapshot: null,
    });
  });

  it("returns a validated experimental snapshot with direct and transfer lanes separate", async () => {
    await expect(
      loadTournamentHorseScreeningState({
        ...input,
        repository: repository(payload()),
      }),
    ).resolves.toMatchObject({
      connectionStatus: "snapshot_connected",
      snapshot: {
        snapshotVersion: "a".repeat(64),
        sourceSnapshotVersion: "accepted-horse-history-v1",
        candidates: [
          {
            coreId: "horse-7",
            expectedFieldPWinMillionths: null,
            projectedFieldOutperformanceMillionths: 510_000,
            candidateSampleCount: 12,
            candidateDirectOneVOneSampleCount: 0,
            formatTransferStatus: "inference_only",
            decisionUseAllowed: false,
          },
        ],
      },
    });
  });

  it("rejects owner mismatch, future evidence and weakened decision boundaries", async () => {
    await expect(
      loadTournamentHorseScreeningState({
        ...input,
        configuredOwnerId: "other-owner",
        repository: repository(payload()),
      }),
    ).rejects.toThrow("access denied");
    await expect(
      loadTournamentHorseScreeningState({
        ...input,
        repository: repository(
          payload({ evidenceCutoff: "2026-10-18T12:30:00.000Z" }),
        ),
      }),
    ).rejects.toThrow("cannot follow publication");
    await expect(
      loadTournamentHorseScreeningState({
        ...input,
        repository: repository(
          payload({ candidates: [{ ...candidate, decisionUseAllowed: true }] }),
        ),
      }),
    ).rejects.toThrow("decision boundary");
  });
});
