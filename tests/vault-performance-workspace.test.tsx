import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VaultPerformanceWorkspace } from "@/components/vault-performance-workspace";
import { buildVaultPerformanceSummary } from "@/domain/vault-performance-summary";

describe("Vault Performance workspace", () => {
  it("renders unavailable evidence without fabricated zeros", () => {
    const html = renderToStaticMarkup(
      <VaultPerformanceWorkspace
        connectionStatus="persistence_not_configured"
        summary={null}
      />,
    );

    expect(html).toContain("Vault Performance storage not connected");
    expect(html).toContain("No accepted economic summary");
    expect(html).toContain("not a zero balance");
    expect(html).not.toContain("0 DEZ");
  });

  it("renders exact original-asset totals and BGC separately", () => {
    const summary = buildVaultPerformanceSummary(
      [
        {
          transactionId: "synthetic-dez-payout",
          occurredAt: "2026-07-20T00:00:00.000Z",
          assetCode: "DEZ",
          assetKind: "crypto",
          signedAmount: "1.25",
          category: "open_race_payout",
          operating: true,
          aggregateStatus: "included",
          classificationStatus: "confirmed",
          reconciliationStatus: "reconciled",
        },
        {
          transactionId: "synthetic-bgc-credit",
          occurredAt: "2026-07-21T00:00:00.000Z",
          assetCode: "BGC",
          assetKind: "game_credit",
          signedAmount: "25",
          category: "burn_bgc_credit",
          operating: true,
          aggregateStatus: "included",
          classificationStatus: "confirmed",
          reconciliationStatus: "reconciled",
        },
      ],
      {
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-07-31T23:59:59.000Z",
        sourceCoverage: "complete_recorded_period",
        manualTournamentPayoutStatus: "confirmed_none",
        dataCurrentThrough: "2026-07-21T00:00:00.000Z",
        lastImported: "2026-07-21T01:00:00.000Z",
        freshnessState: "current",
      },
    );
    const html = renderToStaticMarkup(
      <VaultPerformanceWorkspace
        connectionStatus="read_model_connected"
        summary={summary}
      />,
    );

    expect(html).toContain("Historical economic summary connected");
    expect(html).toContain("1.25 DEZ");
    expect(html).toContain("25 BGC");
    expect(html).toContain("Game Credit");
    expect(html).toContain("Freshness: Current");
    expect(html).toContain("not a complete lifetime-profit claim");
    expect(html).not.toContain("Combined total");
  });
});
