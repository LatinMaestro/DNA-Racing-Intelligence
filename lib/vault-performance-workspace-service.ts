import { normalizeExactDecimal } from "@/domain/exact-decimal";
import { deriveFreshness } from "@/domain/freshness";
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

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function validNow(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Vault Performance now must be valid.");
  }
  return value;
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

function normalizeSummary(
  summary: VaultPerformanceSummary,
  now: Date,
): VaultPerformanceSummary {
  if (
    !isCanonicalTimestamp(summary.periodStart) ||
    !isCanonicalTimestamp(summary.periodEnd) ||
    Date.parse(summary.periodStart) > Date.parse(summary.periodEnd) ||
    (summary.dataCurrentThrough !== null &&
      !isCanonicalTimestamp(summary.dataCurrentThrough)) ||
    (summary.lastImported !== null &&
      !isCanonicalTimestamp(summary.lastImported)) ||
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
  const totalIncludedCount = totals.reduce(
    (sum, total) => sum + total.includedTransactionCount,
    0,
  );
  if (
    !Number.isSafeInteger(totalIncludedCount) ||
    new Set(totals.map(({ assetCode }) => assetCode)).size !== totals.length ||
    totalIncludedCount !== summary.includedTransactionCount
  ) {
    throw new Error("Invalid Vault Performance aggregate counts.");
  }

  if (
    summary.dataCurrentThrough !== null &&
    summary.lastImported !== null &&
    Date.parse(summary.dataCurrentThrough) > Date.parse(summary.lastImported)
  ) {
    throw new Error("Vault Performance evidence cannot follow its import.");
  }

  const freshnessState =
    summary.dataCurrentThrough === null
      ? "unknown"
      : deriveFreshness(new Date(summary.dataCurrentThrough), now);
  const normalizedWarnings = new Set<VaultPerformanceWarning>(
    summary.warnings.filter(
      (warning) =>
        warning !== "IMPORTED_DATA_AGEING" &&
        warning !== "IMPORTED_DATA_STALE" &&
        warning !== "DATA_CUTOFF_UNKNOWN",
    ),
  );
  if (summary.dataCurrentThrough === null || summary.lastImported === null) {
    normalizedWarnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (freshnessState === "ageing") {
    normalizedWarnings.add("IMPORTED_DATA_AGEING");
  }
  if (freshnessState === "stale" || freshnessState === "unknown") {
    normalizedWarnings.add("IMPORTED_DATA_STALE");
  }
  const normalizedWarningList = [...normalizedWarnings].sort();

  return {
    ...summary,
    freshnessState,
    warnings: normalizedWarningList,
    status:
      normalizedWarningList.length === 0
        ? "complete_recorded_period"
        : "partial",
  };
}

export async function loadVaultPerformancePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: VaultPerformanceSummaryRepository;
    now: Date;
  }>,
): Promise<VaultPerformancePageState> {
  const now = validNow(input.now);
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

  if (
    input.repository.status !== "ready" ||
    typeof input.repository.loadSummaryByOwner !== "function"
  ) {
    throw new Error("Invalid Vault Performance repository.");
  }

  const persistedSummary =
    await input.repository.loadSummaryByOwner(authenticatedOwnerId);
  return {
    summary:
      persistedSummary === null
        ? null
        : normalizeSummary(persistedSummary, now),
    connectionStatus: "read_model_connected",
  };
}
