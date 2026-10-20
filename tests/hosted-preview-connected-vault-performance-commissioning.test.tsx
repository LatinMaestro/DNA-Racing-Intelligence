import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VaultPerformanceWorkspace } from "@/components/vault-performance-workspace";
import { neonManualLedgerPersistenceFromEnvironment } from "@/lib/neon-manual-ledger-write-repository";
import { neonManualTournamentPayoutPersistenceFromEnvironment } from "@/lib/neon-manual-tournament-payout-write-repository";
import { neonVaultPerformanceSummaryRepositoryFromEnvironment } from "@/lib/neon-vault-performance-summary-repository";
import { resolveVaultPerformanceEconomicWriteStatus } from "@/lib/vault-performance-economic-write-status-service";
import { loadVaultPerformancePageState } from "@/lib/vault-performance-workspace-service";

const connected = process.env.VAULT_PERFORMANCE_COMMISSIONING === "1";
const describeConnected = connected ? describe : describe.skip;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.trim() !== value ||
    value.length > 4_096 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

describeConnected("hosted Preview Vault Performance commissioning", () => {
  it("renders the owner-scoped read model and verifies economic write contexts without writing", async () => {
    const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
    const verifiedAt = requiredEnvironment(
      "VAULT_PERFORMANCE_COMMISSIONING_VERIFIED_AT",
    );
    const exactHeadSha = requiredEnvironment("GITHUB_SHA").toLowerCase();
    const now = new Date(verifiedAt);
    expect(now.toISOString()).toBe(verifiedAt);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
    expect(exactHeadSha).toMatch(/^[a-f0-9]{40}$/);

    const databaseEnvironment = {
      databaseUrl: requiredEnvironment("DATABASE_URL"),
      databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
      runtimeRole: "dna_app_runtime",
    };
    const summaryRepository =
      neonVaultPerformanceSummaryRepositoryFromEnvironment(
        { ...databaseEnvironment, authenticatedOwnerId: ownerId },
        undefined,
        () => now,
      );
    const ledgerPersistence =
      neonManualLedgerPersistenceFromEnvironment(databaseEnvironment);
    const payoutPersistence =
      neonManualTournamentPayoutPersistenceFromEnvironment(databaseEnvironment);
    expect(summaryRepository.status).toBe("ready");
    expect(ledgerPersistence.status).toBe("ready");
    expect(payoutPersistence.status).toBe("ready");
    if (
      summaryRepository.status !== "ready" ||
      ledgerPersistence.status !== "ready" ||
      payoutPersistence.status !== "ready"
    ) {
      throw new Error("Vault Performance repositories are unavailable");
    }

    const [state, economicWriteStatus] = await Promise.all([
      loadVaultPerformancePageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: summaryRepository,
        now,
      }),
      resolveVaultPerformanceEconomicWriteStatus({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        manualLedgerPersistence: ledgerPersistence,
        tournamentPayoutPersistence: payoutPersistence,
      }),
    ]);
    expect(state.connectionStatus).toBe("read_model_connected");
    expect([
      "asset_registry_unavailable",
      "manual_ledger_ready",
      "tournament_payout_ready",
    ]).toContain(economicWriteStatus);

    const [
      wrongSummaryOwnerRejected,
      wrongLedgerOwnerRejected,
      wrongPayoutOwnerRejected,
    ] = await Promise.all([
      summaryRepository.loadSummaryByOwner(`${ownerId}-wrong`).then(
        () => false,
        () => true,
      ),
      ledgerPersistence.loadContextByOwner(`${ownerId}-wrong`).then(
        () => false,
        () => true,
      ),
      payoutPersistence.loadContextByOwner(`${ownerId}-wrong`).then(
        () => false,
        () => true,
      ),
    ]);
    expect(wrongSummaryOwnerRejected).toBe(true);
    expect(wrongLedgerOwnerRejected).toBe(true);
    expect(wrongPayoutOwnerRejected).toBe(true);

    const markup = renderToStaticMarkup(
      createElement(VaultPerformanceWorkspace, {
        acceptedEvidence: state.acceptedEvidence,
        connectionStatus: state.connectionStatus,
        economicWriteStatus,
        summary: state.summary,
      }),
    );
    expect(markup).toContain("Vault Performance");
    expect(markup).toContain("Historical economic summary connected");
    expect(markup).toContain("Manual economic evidence");
    if (economicWriteStatus === "asset_registry_unavailable") {
      expect(markup).toContain("Accepted assets unavailable");
      expect(markup.match(/<fieldset[^>]*disabled/g)).toHaveLength(2);
      expect(markup).toContain(
        "missing assets and transactions are not treated as zeros",
      );
    }
    if (state.summary === null) {
      expect(markup).toContain("No accepted economic summary");
      expect(markup).toContain("not a zero balance");
    } else {
      expect(markup).toContain("Original-asset totals");
      expect(state.summary.combinedAssetTotalAvailable).toBe(false);
      expect(state.summary.bgcIncludedInCashCryptoProfit).toBe(false);
      expect(state.summary.lifetimeProfitClaimAllowed).toBe(false);
    }

    console.log(
      JSON.stringify({
        status: "vault_performance_connected",
        summaryStatus: state.connectionStatus,
        acceptedSummaryPresent: state.summary !== null,
        acceptedSourceVersion:
          state.acceptedEvidence?.acceptedSourceVersion ?? null,
        includedTransactionCount:
          state.summary?.includedTransactionCount ?? null,
        excludedTransactionCount:
          state.summary?.excludedTransactionCount ?? null,
        unresolvedReconciliationCount:
          state.summary?.unresolvedReconciliationCount ?? null,
        warnings: state.summary?.warnings ?? [],
        economicWriteStatus,
        wrongSummaryOwnerRejected,
        wrongLedgerOwnerRejected,
        wrongPayoutOwnerRejected,
        writePerformed: false,
        providerSettingChanged: false,
        deploymentPerformed: false,
        productionMutationPerformed: false,
        gameActionPerformed: false,
        exactCodeHeadSha: exactHeadSha,
        verifiedAt,
      }),
    );
  }, 30_000);
});
