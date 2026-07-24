import { normalizeExactDecimal } from "@/domain/exact-decimal";
import {
  vaultPerformanceAssetKinds,
  type VaultPerformanceAssetTotal,
  type VaultPerformanceSummary,
  type VaultPerformanceWarning,
} from "@/domain/vault-performance-summary";

export type VaultPerformanceSummaryRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadSummaryByOwner: (
        ownerId: string,
      ) => Promise<VaultPerformanceSummary | null>;
    }>;

export type VaultPerformanceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type VaultPerformancePageState = Readonly<{
  summary: VaultPerformanceSummary | null;
  connectionStatus: VaultPerformanceConnectionStatus;
}>;

export const unavailableVaultPerformanceSummaryRepository: VaultPerformanceSummaryRepository =
  Object.freeze({ status: "not_configured" });

const warnings = new Set<VaultPerformanceWarning>([
  "SOURCE_COVERAGE_INCOMPLETE",
  "MANUAL_TOURNAMENT_PAYOUT_COVERAGE_UNKNOWN",
  "UNCLASSIFIED_ACTIVITY",
  "INFERRED_CLASSIFICATION_PRESENT",
  "UNRESOLVED_RECONCILIATION",
  "CORE_SALE_COST_BASIS_MISSING",
  "DATA_CUTOFF_UNKNOWN",
  "IMPORTED_DATA_AGEING",
  "IMPORTED_DATA_STALE",
]);
const assetCodePattern = /^[A-Z][A-Z0-9_]{1,15}$/;

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function isTimestamp(value: string): boolean {
  return value.trim() !== "" && !Number.isNaN(Date.parse(value));
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertAssetTotal(
  total: VaultPerformanceAssetTotal,
  expectedKind: "cash_crypto" | "bgc",
): void {
  if (
    !assetCodePattern.test(total.assetCode) ||
    !vaultPerformanceAssetKinds.includes(total.assetKind) ||
    !isCount(total.includedTransactionCount) ||
    (expectedKind === "bgc" &&
      (total.assetCode !== "BGC" || total.assetKind !== "game_credit")) ||
    (expectedKind === "cash_crypto" &&
      (total.assetCode === "BGC" || total.assetKind === "game_credit"))
  ) {
    throw new Error("Invalid Vault Performance asset total.");
  }

  for (const [key, value] of Object.entries(total)) {
    if (
      ["assetCode", "assetKind", "includedTransactionCount"].includes(key) ||
      value === null
    ) {
      continue;
    }
    if (typeof value !== "string") {
      throw new Error("Invalid Vault Performance exact total.");
    }
    try {
      if (normalizeExactDecimal(value) !== value) {
        throw new Error("Invalid Vault Performance exact total.");
      }
    } catch {
      throw new Error("Invalid Vault Performance exact total.");
    }
  }
}

function assertSummary(summary: VaultPerformanceSummary): void {
  if (
    !isTimestamp(summary.periodStart) ||
    !isTimestamp(summary.periodEnd) ||
    Date.parse(summary.periodStart) > Date.parse(summary.periodEnd) ||
    (summary.dataCurrentThrough !== null &&
      !isTimestamp(summary.dataCurrentThrough)) ||
    (summary.lastImported !== null && !isTimestamp(summary.lastImported)) ||
    !["current", "ageing", "stale", "unknown"].includes(
      summary.freshnessState,
    ) ||
    !["complete_recorded_period", "partial"].includes(summary.status) ||
    !isCount(summary.includedTransactionCount) ||
    !isCount(summary.excludedTransactionCount) ||
    !isCount(summary.nonOperatingTransactionCount) ||
    !isCount(summary.unclassifiedTransactionCount) ||
    !isCount(summary.unresolvedReconciliationCount) ||
    summary.nonOperatingTransactionCount > summary.includedTransactionCount ||
    summary.unclassifiedTransactionCount > summary.includedTransactionCount ||
    summary.unresolvedReconciliationCount > summary.includedTransactionCount ||
    summary.combinedAssetTotalAvailable !== false ||
    summary.bgcIncludedInCashCryptoProfit !== false ||
    summary.lifetimeProfitClaimAllowed !== false ||
    summary.warnings.some((warning) => !warnings.has(warning)) ||
    new Set(summary.warnings).size !== summary.warnings.length ||
    summary.status !==
      (summary.warnings.length === 0 ? "complete_recorded_period" : "partial")
  ) {
    throw new Error("Invalid Vault Performance read-model summary.");
  }

  for (const total of summary.cashCryptoTotals) {
    assertAssetTotal(total, "cash_crypto");
  }
  for (const total of summary.bgcTotals) {
    assertAssetTotal(total, "bgc");
  }

  const totals = [...summary.cashCryptoTotals, ...summary.bgcTotals];
  if (
    new Set(totals.map(({ assetCode }) => assetCode)).size !== totals.length ||
    totals.reduce((sum, total) => sum + total.includedTransactionCount, 0) !==
      summary.includedTransactionCount
  ) {
    throw new Error("Invalid Vault Performance aggregate counts.");
  }
}

export async function loadVaultPerformancePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: VaultPerformanceSummaryRepository;
  }>,
): Promise<VaultPerformancePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      summary: null,
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Vault Performance workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      summary: null,
      connectionStatus: "persistence_not_configured",
    };
  }

  const summary =
    await input.repository.loadSummaryByOwner(authenticatedOwnerId);
  if (summary !== null) assertSummary(summary);
  return {
    summary,
    connectionStatus: "read_model_connected",
  };
}
