import type { VaultPerformanceEconomicWriteStatus } from "@/components/vault-performance-economic-forms";
import type {
  ManualLedgerWriteContext,
  NeonManualLedgerPersistence,
} from "@/lib/neon-manual-ledger-write-repository";
import type { NeonManualTournamentPayoutPersistence } from "@/lib/neon-manual-tournament-payout-write-repository";

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function contextsAgree(
  ledgerContext: ManualLedgerWriteContext,
  payoutContext: Awaited<
    ReturnType<
      Extract<
        NeonManualTournamentPayoutPersistence,
        { status: "ready" }
      >["loadContextByOwner"]
    >
  >,
): boolean {
  const ledgerAssets = ledgerContext.assetRegistry.assets;
  const payoutAssets = payoutContext.assetRegistry.assets;
  return (
    payoutContext.assetRegistry.version ===
      ledgerContext.assetRegistry.version &&
    payoutContext.ledgerVersion === ledgerContext.ledgerVersion &&
    payoutAssets.length === ledgerAssets.length &&
    payoutAssets.every(
      (asset, index) =>
        asset.code === ledgerAssets[index]?.code &&
        asset.kind === ledgerAssets[index]?.kind &&
        asset.precision === ledgerAssets[index]?.precision,
    )
  );
}

export async function resolveVaultPerformanceEconomicWriteStatus(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    manualLedgerPersistence: NeonManualLedgerPersistence;
    tournamentPayoutPersistence: NeonManualTournamentPayoutPersistence;
  }>,
): Promise<VaultPerformanceEconomicWriteStatus> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return "identity_not_connected";
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Vault Performance economic write access denied.");
  }
  if (input.manualLedgerPersistence.status !== "ready") {
    return "persistence_not_configured";
  }

  let ledgerContext: ManualLedgerWriteContext;
  try {
    ledgerContext =
      await input.manualLedgerPersistence.loadContextByOwner(
        authenticatedOwnerId,
      );
  } catch {
    return "asset_registry_unavailable";
  }

  if (input.tournamentPayoutPersistence.status !== "ready") {
    return "manual_ledger_ready";
  }

  try {
    const payoutContext =
      await input.tournamentPayoutPersistence.loadContextByOwner(
        authenticatedOwnerId,
      );
    if (!contextsAgree(ledgerContext, payoutContext)) {
      return "asset_registry_unavailable";
    }
    return "tournament_payout_ready";
  } catch {
    return "manual_ledger_ready";
  }
}
