import { describe, expect, it } from "vitest";
import {
  createManualTournamentPayout,
  type ManualTournamentPayoutInput,
} from "@/domain/manual-tournament-payout";

const baseInput: ManualTournamentPayoutInput = {
  payoutId: "payout-1",
  occurredAt: "2026-07-31T10:00:00Z",
  tournamentId: "tournament-1",
  stage: "final",
  amount: "10.00",
  assetCode: "usdc",
  assetKind: "crypto",
  assetDecimalPlaces: 6,
  allocationMethod: "vault_unallocated",
};

const context = {
  serverNow: "2026-08-01T10:00:00Z",
  assetDefinition: { code: "USDC", kind: "crypto" as const, precision: 6 },
  assetRegistryVersion: "assets-v4",
  tournamentCampaignBinding: {
    tournamentId: "tournament-1",
    evidenceId: "evidence-9",
    configurationVersion: "config-3",
    ownerAcknowledgedAt: "2026-07-30T10:00:00Z",
  },
};

describe("createManualTournamentPayout", () => {
  it("records an authoritative vault-level payout without inventing allocation", () => {
    expect(createManualTournamentPayout(baseInput, context)).toMatchObject({
      occurredAt: "2026-07-31T10:00:00.000Z",
      amount: "10",
      assetCode: "USDC",
      assetRegistryVersion: "assets-v4",
      allocationStatus: "vault_unallocated",
      allocations: [],
      allocatedAmount: "0",
      unallocatedAmount: "10",
      tournamentAggregationEligible: true,
      duplicateReviewRequired: true,
    });
  });

  it("apportions exact atoms deterministically and conserves the payout", () => {
    const payout = createManualTournamentPayout(
      {
        ...baseInput,
        amount: "1",
        assetDecimalPlaces: 2,
        allocationMethod: "equal",
        allocations: [
          { coreId: "core-b" },
          { coreId: "core-a" },
          { coreId: "core-c" },
        ],
      },
      {
        ...context,
        assetDefinition: { ...context.assetDefinition, precision: 2 },
      },
    );
    expect(payout.allocations).toEqual([
      { coreId: "core-a", amount: "0.34", percentage: null, points: null },
      { coreId: "core-b", amount: "0.33", percentage: null, points: null },
      { coreId: "core-c", amount: "0.33", percentage: null, points: null },
    ]);
    expect(payout.allocatedAmount).toBe("1");
    expect(payout.unallocatedAmount).toBe("0");
  });

  it("requires exact manual amounts and percentage totals", () => {
    expect(() =>
      createManualTournamentPayout(
        {
          ...baseInput,
          allocationMethod: "manual_amounts",
          allocations: [
            { coreId: "core-a", amount: "6" },
            { coreId: "core-b", amount: "3" },
          ],
        },
        context,
      ),
    ).toThrow("must equal");
    expect(() =>
      createManualTournamentPayout(
        {
          ...baseInput,
          allocationMethod: "manual_percentages",
          allocations: [
            { coreId: "core-a", percentage: "60" },
            { coreId: "core-b", percentage: "39.99" },
          ],
        },
        context,
      ),
    ).toThrow("exactly 100");
  });

  it("rejects caller-supplied asset metadata, BGC, and precision drift", () => {
    expect(() =>
      createManualTournamentPayout(
        { ...baseInput, assetKind: "fiat" },
        context,
      ),
    ).toThrow("authoritative registry");
    expect(() =>
      createManualTournamentPayout(baseInput, {
        ...context,
        assetDefinition: { code: "BGC", kind: "game_credit", precision: 0 },
      }),
    ).toThrow("Authoritative tournament payout asset is invalid");
    expect(() =>
      createManualTournamentPayout(
        { ...baseInput, assetDecimalPlaces: 5 },
        context,
      ),
    ).toThrow("authoritative registry");
  });

  it("rejects unbound campaigns and future evidence", () => {
    expect(() =>
      createManualTournamentPayout(baseInput, {
        ...context,
        tournamentCampaignBinding: {
          ...context.tournamentCampaignBinding,
          tournamentId: "different",
        },
      }),
    ).toThrow("does not match");
    expect(() =>
      createManualTournamentPayout(baseInput, {
        ...context,
        tournamentCampaignBinding: {
          ...context.tournamentCampaignBinding,
          ownerAcknowledgedAt: "2026-08-02T10:00:00Z",
        },
      }),
    ).toThrow("cannot be in the future");
    expect(() =>
      createManualTournamentPayout(
        { ...baseInput, occurredAt: "2026-08-02T10:00:00Z" },
        context,
      ),
    ).toThrow("cannot be in the future");
  });
});
