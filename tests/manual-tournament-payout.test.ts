import { describe, expect, it } from "vitest";

import {
  createManualTournamentPayout,
  type ManualTournamentPayoutInput,
} from "@/domain/manual-tournament-payout";

function payout(
  overrides: Partial<ManualTournamentPayoutInput> = {},
): ManualTournamentPayoutInput {
  return {
    payoutId: "payout-1",
    occurredAt: "2026-07-20T12:00:00Z",
    tournamentId: "tournament-1",
    stage: "overall_prize",
    amount: "1",
    assetCode: "ETH",
    assetKind: "crypto",
    assetDecimalPlaces: 2,
    allocationMethod: "vault_unallocated",
    ...overrides,
  };
}

describe("manual tournament payout", () => {
  it("preserves a genuine vault-level payout without invented core attribution", () => {
    const result = createManualTournamentPayout(payout());

    expect(result).toEqual(
      expect.objectContaining({
        sourceType: "manual_tournament_payout",
        allocationStatus: "vault_unallocated",
        allocations: [],
        allocatedAmount: "0",
        unallocatedAmount: "1",
        duplicateReviewRequired: true,
      }),
    );
  });

  it("attributes the exact full amount to one core", () => {
    const result = createManualTournamentPayout(
      payout({
        allocationMethod: "single_core",
        allocations: [{ coreId: "core-a" }],
      }),
    );

    expect(result.allocations).toEqual([
      {
        coreId: "core-a",
        amount: "1",
        percentage: "100",
        points: null,
      },
    ]);
    expect(result.unallocatedAmount).toBe("0");
  });

  it("uses deterministic largest-remainder allocation for equal splits", () => {
    const result = createManualTournamentPayout(
      payout({
        allocationMethod: "equal",
        allocations: [
          { coreId: "core-c" },
          { coreId: "core-a" },
          { coreId: "core-b" },
        ],
      }),
    );

    expect(result.allocations).toEqual([
      {
        coreId: "core-a",
        amount: "0.34",
        percentage: null,
        points: null,
      },
      {
        coreId: "core-b",
        amount: "0.33",
        percentage: null,
        points: null,
      },
      {
        coreId: "core-c",
        amount: "0.33",
        percentage: null,
        points: null,
      },
    ]);
    expect(result.allocatedAmount).toBe("1");
  });

  it("accepts exact manual amount allocations only when they reconcile", () => {
    const result = createManualTournamentPayout(
      payout({
        amount: "5",
        allocationMethod: "manual_amounts",
        allocations: [
          { coreId: "core-b", amount: "1.25" },
          { coreId: "core-a", amount: "3.75" },
        ],
      }),
    );

    expect(
      result.allocations.map(({ coreId, amount }) => ({ coreId, amount })),
    ).toEqual([
      { coreId: "core-a", amount: "3.75" },
      { coreId: "core-b", amount: "1.25" },
    ]);
  });

  it("allocates exact percentages without binary floating point", () => {
    const result = createManualTournamentPayout(
      payout({
        amount: "10",
        allocationMethod: "manual_percentages",
        allocations: [
          { coreId: "core-a", percentage: "25" },
          { coreId: "core-b", percentage: "75" },
        ],
      }),
    );

    expect(result.allocations).toEqual([
      {
        coreId: "core-a",
        amount: "2.5",
        percentage: "25",
        points: null,
      },
      {
        coreId: "core-b",
        amount: "7.5",
        percentage: "75",
        points: null,
      },
    ]);
  });

  it("supports a documented points method with exact reconciliation", () => {
    const result = createManualTournamentPayout(
      payout({
        allocationMethod: "documented_points",
        allocations: [
          { coreId: "core-a", points: "1" },
          { coreId: "core-b", points: "2" },
        ],
      }),
    );

    expect(result.allocations).toEqual([
      {
        coreId: "core-a",
        amount: "0.33",
        percentage: null,
        points: "1",
      },
      {
        coreId: "core-b",
        amount: "0.67",
        percentage: null,
        points: "2",
      },
    ]);
  });

  it("keeps remainder ordering exact for weights beyond safe integers", () => {
    const result = createManualTournamentPayout(
      payout({
        amount: "0.03",
        allocationMethod: "documented_points",
        allocations: [
          { coreId: "core-a", points: "9007199254740993" },
          { coreId: "core-b", points: "9007199254740992" },
        ],
      }),
    );

    expect(result.allocations).toEqual([
      {
        coreId: "core-a",
        amount: "0.02",
        percentage: null,
        points: "9007199254740993",
      },
      {
        coreId: "core-b",
        amount: "0.01",
        percentage: null,
        points: "9007199254740992",
      },
    ]);
  });

  it("rejects duplicate cores and allocation totals that do not reconcile", () => {
    expect(() =>
      createManualTournamentPayout(
        payout({
          allocationMethod: "equal",
          allocations: [{ coreId: "core-a" }, { coreId: "core-a" }],
        }),
      ),
    ).toThrow("core IDs must be unique");

    expect(() =>
      createManualTournamentPayout(
        payout({
          allocationMethod: "manual_amounts",
          allocations: [
            { coreId: "core-a", amount: "0.4" },
            { coreId: "core-b", amount: "0.5" },
          ],
        }),
      ),
    ).toThrow("must equal the payout amount");
  });

  it("rejects invalid percentages, points and evidence mixtures", () => {
    expect(() =>
      createManualTournamentPayout(
        payout({
          allocationMethod: "manual_percentages",
          allocations: [
            { coreId: "core-a", percentage: "40" },
            { coreId: "core-b", percentage: "50" },
          ],
        }),
      ),
    ).toThrow("must total exactly 100");

    expect(() =>
      createManualTournamentPayout(
        payout({
          allocationMethod: "documented_points",
          allocations: [{ coreId: "core-a", points: "0" }],
        }),
      ),
    ).toThrow("points allocation evidence is invalid");
  });

  it("fails closed on BGC, invalid precision and unsupported runtime enums", () => {
    expect(() =>
      createManualTournamentPayout(
        payout({ assetCode: "BGC", assetKind: "fiat" }),
      ),
    ).toThrow("asset identity is invalid");

    expect(() =>
      createManualTournamentPayout(payout({ assetDecimalPlaces: 1.5 })),
    ).toThrow("decimal places");

    expect(() =>
      createManualTournamentPayout(
        payout({
          allocationMethod:
            "invented" as ManualTournamentPayoutInput["allocationMethod"],
        }),
      ),
    ).toThrow("allocation method is invalid");
  });
});
