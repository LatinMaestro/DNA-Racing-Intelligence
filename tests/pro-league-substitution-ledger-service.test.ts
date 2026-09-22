import { describe, expect, it, vi } from "vitest";

import { loadProLeagueSubstitutionLedgerState } from "@/lib/pro-league-substitution-ledger-service";

function substitution(number: number) {
  return {
    seasonYear: 2026,
    substitutionNumber: number,
    fromRosterVersionId: `roster-${number}`,
    toRosterVersionId: `roster-${number + 1}`,
    outgoingCoreId: `out-${number}`,
    incomingCoreId: `in-${number}`,
    reason: "Test",
    evidence: {
      asOf: "2026-09-20T02:00:00.000Z",
      generationId: "generation",
      sha256: "a".repeat(64),
      confidence: "limited" as const,
    },
    substitutionSha256: "b".repeat(64),
    recordedAt: `2026-09-${String(20 + number).padStart(2, "0")}T02:00:00.000Z`,
  };
}

describe("Pro League substitution ledger state", () => {
  it("reports used and remaining substitutions from the append-only ledger", async () => {
    const result = await loadProLeagueSubstitutionLedgerState({
      ownerId: "private_owner",
      seasonYear: 2026,
      repository: {
        listSubstitutions: vi.fn(async () => [
          substitution(1),
          substitution(2),
        ]),
      },
    });

    expect(result).toMatchObject({
      status: "connected",
      seasonYear: 2026,
      maximumSubstitutions: 10,
      usedCount: 2,
      remainingCount: 8,
    });
  });

  it("does not infer usage when the ledger is unavailable", async () => {
    await expect(
      loadProLeagueSubstitutionLedgerState({
        ownerId: "private_owner",
        seasonYear: 2026,
        repository: null,
      }),
    ).resolves.toMatchObject({
      status: "not_configured",
      usedCount: null,
      remainingCount: null,
    });
  });

  it("treats an undeployed hosted ledger schema as not configured", async () => {
    await expect(
      loadProLeagueSubstitutionLedgerState({
        ownerId: "private_owner",
        seasonYear: 2026,
        repository: {
          listSubstitutions: vi.fn(async () => {
            throw new Error(
              'relation "dna.pro_league_roster_substitution" does not exist',
            );
          }),
        },
      }),
    ).resolves.toMatchObject({
      status: "not_configured",
      maximumSubstitutions: 10,
      usedCount: null,
      remainingCount: null,
    });
  });

  it("fails closed when the persisted sequence is not contiguous", async () => {
    await expect(
      loadProLeagueSubstitutionLedgerState({
        ownerId: "private_owner",
        seasonYear: 2026,
        repository: {
          listSubstitutions: vi.fn(async () => [substitution(2)]),
        },
      }),
    ).resolves.toMatchObject({
      status: "invalid_state",
      usedCount: null,
      remainingCount: null,
    });
  });
});
