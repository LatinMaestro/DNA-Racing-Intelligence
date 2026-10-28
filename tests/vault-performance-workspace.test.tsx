import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VaultPerformanceWorkspace } from "@/components/vault-performance-workspace";
import { buildVaultPerformanceSummary } from "@/domain/vault-performance-summary";
import { resolveVaultPerformanceEconomicWriteStatus } from "@/lib/vault-performance-economic-write-status-service";
import { loadVaultPerformancePageState } from "@/lib/vault-performance-workspace-service";

describe("Vault Performance workspace", () => {
  it("replays empty owner evidence without implying profit or enabling economic writes", async () => {
    const ownerId = "preview-owner";
    const loadSummaryByOwner = vi.fn(async () => null);
    const loadLedgerContextByOwner = vi.fn(async () => {
      throw new Error("accepted asset registry unavailable");
    });
    const loadPayoutContextByOwner = vi.fn(async () => {
      throw new Error("accepted payout candidates unavailable");
    });
    const [state, economicWriteStatus] = await Promise.all([
      loadVaultPerformancePageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: { status: "ready", loadSummaryByOwner },
        now: new Date("2026-10-29T00:00:00.000Z"),
      }),
      resolveVaultPerformanceEconomicWriteStatus({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        manualLedgerPersistence: {
          status: "ready",
          repository: { status: "ready" } as never,
          loadContextByOwner: loadLedgerContextByOwner,
        },
        tournamentPayoutPersistence: {
          status: "ready",
          repository: { status: "ready" } as never,
          loadContextByOwner: loadPayoutContextByOwner,
        },
      }),
    ]);

    expect(loadSummaryByOwner).toHaveBeenCalledExactlyOnceWith(ownerId);
    expect(loadLedgerContextByOwner).toHaveBeenCalledExactlyOnceWith(ownerId);
    expect(loadPayoutContextByOwner).not.toHaveBeenCalled();
    expect(state).toEqual({
      summary: null,
      acceptedEvidence: null,
      connectionStatus: "read_model_connected",
    });
    expect(economicWriteStatus).toBe("asset_registry_unavailable");

    const html = renderToStaticMarkup(
      <VaultPerformanceWorkspace
        acceptedEvidence={state.acceptedEvidence}
        connectionStatus={state.connectionStatus}
        economicWriteStatus={economicWriteStatus}
        summary={state.summary}
      />,
    );

    expect(html).toContain("No accepted economic summary");
    expect(html).toContain("not a zero balance");
    expect(html).toContain("Accepted assets unavailable");
    expect(html).toContain(
      "missing assets and transactions are not treated as zeros",
    );
    expect(html.match(/<fieldset[^>]*disabled/g)).toHaveLength(2);
    expect(html).not.toContain("Lifetime profit");
    expect(html).not.toContain("0 DEZ");
  });

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

  it("renders a sanitized compact-read failure", () => {
    const html = renderToStaticMarkup(
      <VaultPerformanceWorkspace
        connectionStatus="read_failed"
        summary={null}
      />,
    );

    expect(html).toContain("Vault Performance summary temporarily unavailable");
    expect(html).toContain("provider details are not exposed");
    expect(html).not.toContain("private provider detail");
    expect(html).not.toContain("0 DEZ");
  });

  it("renders an integrity failure without financial values", () => {
    const html = renderToStaticMarkup(
      <VaultPerformanceWorkspace
        connectionStatus="integrity_failed"
        summary={null}
      />,
    );

    expect(html).toContain("Vault Performance summary failed validation");
    expect(html).toContain("All financial totals remain withheld");
    expect(html).toContain("No accepted economic summary");
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
        acceptedEvidence={{
          acceptedSourceVersion: "a".repeat(64),
          materializedAt: "2026-07-21T02:00:00.000Z",
        }}
        connectionStatus="read_model_connected"
        summary={summary}
      />,
    );

    expect(html).toContain("Historical economic summary connected");
    expect(html).toContain("Accepted economic generation");
    expect(html).toContain(
      `Ledger version <code class="break-all text-[var(--foreground)]">${"a".repeat(64)}</code>`,
    );
    expect(html).toContain("Materialized 21 July 2026, 2:00 am");
    expect(html).toContain("1.25 DEZ");
    expect(html).toContain("25 BGC");
    expect(html).toContain("Game Credit");
    expect(html).toContain("Freshness: Current");
    expect(html).toContain("not a complete lifetime-profit claim");
    expect(html).not.toContain("Combined total");
  });
});
