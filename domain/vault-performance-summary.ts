import { normalizeExactDecimal } from "@/domain/exact-decimal";

export const vaultPerformanceCategories = [
  "open_race_entry_fee",
  "open_race_payout",
  "qualification_entry_fee",
  "qualification_race_payout",
  "tournament_round_payout",
  "tournament_final_payout",
  "manual_tournament_payout",
  "campaign_expense",
  "breeding_fee_earned",
  "breeding_expense",
  "core_purchase",
  "core_sale",
  "selling_fee",
  "burn_bgc_credit",
  "arena_bgc_spend",
  "lifecycle_income",
  "lifecycle_expense",
  "deposit",
  "withdrawal",
  "internal_transfer",
  "opening_balance",
  "reconciliation_adjustment",
] as const;
export type VaultPerformanceCategory =
  (typeof vaultPerformanceCategories)[number];

export const vaultPerformanceAssetKinds = [
  "crypto",
  "fiat",
  "game_credit",
] as const;
export type VaultPerformanceAssetKind =
  (typeof vaultPerformanceAssetKinds)[number];

export type VaultPerformanceRecordInput = {
  transactionId: string;
  occurredAt: string;
  assetCode: string;
  assetKind: VaultPerformanceAssetKind;
  signedAmount: string;
  category: VaultPerformanceCategory;
  operating: boolean;
  aggregateStatus: "included" | "excluded";
  classificationStatus: "confirmed" | "inferred" | "unclassified";
  reconciliationStatus: "reconciled" | "review_required";
};

export type VaultPerformanceCoverageInput = {
  periodStart: string;
  periodEnd: string;
  sourceCoverage: "complete_recorded_period" | "partial" | "unknown";
  manualTournamentPayoutStatus:
    "confirmed_complete" | "confirmed_none" | "unknown";
  costBasisByAsset?: readonly {
    assetCode: string;
    status: "known_same_asset" | "missing_or_unconvertible";
  }[];
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshnessState: "current" | "ageing" | "stale" | "unknown";
};

export type VaultPerformanceAssetTotal = {
  assetCode: string;
  assetKind: VaultPerformanceAssetKind;
  openRaceEntryFees: string;
  openRacePayouts: string;
  openRacingNet: string;
  qualificationEntryFees: string;
  qualificationRacePayouts: string;
  qualificationNet: string;
  tournamentRoundPayouts: string;
  tournamentFinalPayouts: string;
  manualTournamentPayouts: string;
  campaignExpenses: string;
  tournamentRecordedNet: string;
  breedingIncome: string;
  breedingExpenses: string;
  breedingNet: string;
  corePurchases: string;
  coreSaleProceeds: string;
  sellingFees: string;
  realisedCoreTradingResult: string | null;
  burnBgcCredits: string;
  arenaBgcSpend: string;
  netBgcMovement: string;
  otherLifecycleIncome: string;
  otherLifecycleExpenses: string;
  totalRecordedOperatingCashflow: string;
  nonOperatingMovement: string;
  includedTransactionCount: number;
};

export type VaultPerformanceWarning =
  | "SOURCE_COVERAGE_INCOMPLETE"
  | "MANUAL_TOURNAMENT_PAYOUT_COVERAGE_UNKNOWN"
  | "UNCLASSIFIED_ACTIVITY"
  | "INFERRED_CLASSIFICATION_PRESENT"
  | "UNRESOLVED_RECONCILIATION"
  | "CORE_SALE_COST_BASIS_MISSING"
  | "DATA_CUTOFF_UNKNOWN"
  | "IMPORTED_DATA_AGEING"
  | "IMPORTED_DATA_STALE";

export type VaultPerformanceSummary = {
  periodStart: string;
  periodEnd: string;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshnessState: VaultPerformanceCoverageInput["freshnessState"];
  status: "complete_recorded_period" | "partial";
  cashCryptoTotals: readonly VaultPerformanceAssetTotal[];
  bgcTotals: readonly VaultPerformanceAssetTotal[];
  includedTransactionCount: number;
  excludedTransactionCount: number;
  nonOperatingTransactionCount: number;
  unclassifiedTransactionCount: number;
  unresolvedReconciliationCount: number;
  warnings: readonly VaultPerformanceWarning[];
  combinedAssetTotalAvailable: false;
  bgcIncludedInCashCryptoProfit: false;
  lifetimeProfitClaimAllowed: false;
};

type ParsedDecimal = {
  negative: boolean;
  digits: bigint;
  scale: number;
};

type NormalizedRecord = Omit<
  VaultPerformanceRecordInput,
  "occurredAt" | "assetCode" | "signedAmount"
> & {
  occurredAt: string;
  assetCode: string;
  signedAmount: string;
};

const creditCategories = new Set<VaultPerformanceCategory>([
  "open_race_payout",
  "qualification_race_payout",
  "tournament_round_payout",
  "tournament_final_payout",
  "manual_tournament_payout",
  "breeding_fee_earned",
  "core_sale",
  "burn_bgc_credit",
  "lifecycle_income",
  "deposit",
  "opening_balance",
]);
const debitCategories = new Set<VaultPerformanceCategory>([
  "open_race_entry_fee",
  "qualification_entry_fee",
  "campaign_expense",
  "breeding_expense",
  "core_purchase",
  "selling_fee",
  "arena_bgc_spend",
  "lifecycle_expense",
  "withdrawal",
]);
const nonOperatingCategories = new Set<VaultPerformanceCategory>([
  "deposit",
  "withdrawal",
  "internal_transfer",
  "opening_balance",
  "reconciliation_adjustment",
]);
const bgcOnlyCategories = new Set<VaultPerformanceCategory>([
  "burn_bgc_credit",
  "arena_bgc_spend",
]);
const assetCodePattern = /^[A-Z][A-Z0-9_]{1,15}$/;

function requiredTrimmed(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(`${label} is required.`);
  return trimmed;
}

function normalizeTimestamp(value: string, label: string): string {
  const trimmed = requiredTrimmed(value, label);
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function optionalTimestamp(value: string | null, label: string): string | null {
  return value === null ? null : normalizeTimestamp(value, label);
}

function parseDecimal(value: string): ParsedDecimal {
  const normalized = normalizeExactDecimal(value);
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  return {
    negative,
    digits: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function formatDecimal(value: bigint, scale: number): string {
  if (value === 0n) return "0";
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const raw = absolute.toString().padStart(scale + 1, "0");
  const whole =
    scale === 0 ? raw : raw.slice(0, Math.max(1, raw.length - scale));
  const fraction =
    scale === 0 ? "" : raw.slice(raw.length - scale).replace(/0+$/, "");
  const unsigned = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${unsigned}` : unsigned;
}

function addExact(left: string, right: string): string {
  const leftParsed = parseDecimal(left);
  const rightParsed = parseDecimal(right);
  const scale = Math.max(leftParsed.scale, rightParsed.scale);
  const leftValue =
    (leftParsed.negative ? -leftParsed.digits : leftParsed.digits) *
    10n ** BigInt(scale - leftParsed.scale);
  const rightValue =
    (rightParsed.negative ? -rightParsed.digits : rightParsed.digits) *
    10n ** BigInt(scale - rightParsed.scale);
  return formatDecimal(leftValue + rightValue, scale);
}

function absolute(value: string): string {
  return value.startsWith("-") ? value.slice(1) : value;
}

function isNonZero(value: string): boolean {
  return normalizeExactDecimal(value) !== "0";
}

function normalizeRecord(input: VaultPerformanceRecordInput): NormalizedRecord {
  if (!vaultPerformanceCategories.includes(input.category)) {
    throw new Error("Vault Performance category is invalid.");
  }
  if (!vaultPerformanceAssetKinds.includes(input.assetKind)) {
    throw new Error("Vault Performance asset kind is invalid.");
  }
  if (!["included", "excluded"].includes(input.aggregateStatus)) {
    throw new Error("Vault Performance aggregate status is invalid.");
  }
  if (
    !["confirmed", "inferred", "unclassified"].includes(
      input.classificationStatus,
    )
  ) {
    throw new Error("Vault Performance classification status is invalid.");
  }
  if (!["reconciled", "review_required"].includes(input.reconciliationStatus)) {
    throw new Error("Vault Performance reconciliation status is invalid.");
  }

  const assetCode = input.assetCode.trim().toUpperCase();
  if (!assetCodePattern.test(assetCode)) {
    throw new Error("Vault Performance asset identity is invalid.");
  }
  if (
    (assetCode === "BGC" && input.assetKind !== "game_credit") ||
    (assetCode !== "BGC" && input.assetKind === "game_credit")
  ) {
    throw new Error("BGC must remain the separate game-credit asset.");
  }
  if (
    (assetCode === "BGC" &&
      !bgcOnlyCategories.has(input.category) &&
      !nonOperatingCategories.has(input.category)) ||
    (assetCode !== "BGC" && bgcOnlyCategories.has(input.category))
  ) {
    throw new Error("Vault Performance category does not match its asset.");
  }

  const shouldBeOperating = !nonOperatingCategories.has(input.category);
  if (
    typeof input.operating !== "boolean" ||
    input.operating !== shouldBeOperating
  ) {
    throw new Error("Vault Performance operating status is inconsistent.");
  }

  const signedAmount = normalizeExactDecimal(input.signedAmount);
  if (signedAmount === "0") {
    throw new Error("Vault Performance records cannot use a zero amount.");
  }
  if (creditCategories.has(input.category) && signedAmount.startsWith("-")) {
    throw new Error("Vault Performance credit direction is invalid.");
  }
  if (debitCategories.has(input.category) && !signedAmount.startsWith("-")) {
    throw new Error("Vault Performance debit direction is invalid.");
  }

  return {
    ...input,
    transactionId: requiredTrimmed(input.transactionId, "Transaction ID"),
    occurredAt: normalizeTimestamp(input.occurredAt, "Occurred at"),
    assetCode,
    signedAmount,
  };
}

function emptyAssetTotal(record: NormalizedRecord): VaultPerformanceAssetTotal {
  return {
    assetCode: record.assetCode,
    assetKind: record.assetKind,
    openRaceEntryFees: "0",
    openRacePayouts: "0",
    openRacingNet: "0",
    qualificationEntryFees: "0",
    qualificationRacePayouts: "0",
    qualificationNet: "0",
    tournamentRoundPayouts: "0",
    tournamentFinalPayouts: "0",
    manualTournamentPayouts: "0",
    campaignExpenses: "0",
    tournamentRecordedNet: "0",
    breedingIncome: "0",
    breedingExpenses: "0",
    breedingNet: "0",
    corePurchases: "0",
    coreSaleProceeds: "0",
    sellingFees: "0",
    realisedCoreTradingResult: "0",
    burnBgcCredits: "0",
    arenaBgcSpend: "0",
    netBgcMovement: "0",
    otherLifecycleIncome: "0",
    otherLifecycleExpenses: "0",
    totalRecordedOperatingCashflow: "0",
    nonOperatingMovement: "0",
    includedTransactionCount: 0,
  };
}

function applyRecord(
  total: VaultPerformanceAssetTotal,
  record: NormalizedRecord,
): void {
  const amount = record.signedAmount;
  const debit = absolute(amount);
  total.includedTransactionCount += 1;
  if (record.operating) {
    total.totalRecordedOperatingCashflow = addExact(
      total.totalRecordedOperatingCashflow,
      amount,
    );
  } else {
    total.nonOperatingMovement = addExact(total.nonOperatingMovement, amount);
  }

  switch (record.category) {
    case "open_race_entry_fee":
      total.openRaceEntryFees = addExact(total.openRaceEntryFees, debit);
      total.openRacingNet = addExact(total.openRacingNet, amount);
      break;
    case "open_race_payout":
      total.openRacePayouts = addExact(total.openRacePayouts, amount);
      total.openRacingNet = addExact(total.openRacingNet, amount);
      break;
    case "qualification_entry_fee":
      total.qualificationEntryFees = addExact(
        total.qualificationEntryFees,
        debit,
      );
      total.qualificationNet = addExact(total.qualificationNet, amount);
      total.tournamentRecordedNet = addExact(
        total.tournamentRecordedNet,
        amount,
      );
      break;
    case "qualification_race_payout":
      total.qualificationRacePayouts = addExact(
        total.qualificationRacePayouts,
        amount,
      );
      total.qualificationNet = addExact(total.qualificationNet, amount);
      total.tournamentRecordedNet = addExact(
        total.tournamentRecordedNet,
        amount,
      );
      break;
    case "tournament_round_payout":
      total.tournamentRoundPayouts = addExact(
        total.tournamentRoundPayouts,
        amount,
      );
      total.tournamentRecordedNet = addExact(
        total.tournamentRecordedNet,
        amount,
      );
      break;
    case "tournament_final_payout":
      total.tournamentFinalPayouts = addExact(
        total.tournamentFinalPayouts,
        amount,
      );
      total.tournamentRecordedNet = addExact(
        total.tournamentRecordedNet,
        amount,
      );
      break;
    case "manual_tournament_payout":
      total.manualTournamentPayouts = addExact(
        total.manualTournamentPayouts,
        amount,
      );
      total.tournamentRecordedNet = addExact(
        total.tournamentRecordedNet,
        amount,
      );
      break;
    case "campaign_expense":
      total.campaignExpenses = addExact(total.campaignExpenses, debit);
      total.tournamentRecordedNet = addExact(
        total.tournamentRecordedNet,
        amount,
      );
      break;
    case "breeding_fee_earned":
      total.breedingIncome = addExact(total.breedingIncome, amount);
      total.breedingNet = addExact(total.breedingNet, amount);
      break;
    case "breeding_expense":
      total.breedingExpenses = addExact(total.breedingExpenses, debit);
      total.breedingNet = addExact(total.breedingNet, amount);
      break;
    case "core_purchase":
      total.corePurchases = addExact(total.corePurchases, debit);
      break;
    case "core_sale":
      total.coreSaleProceeds = addExact(total.coreSaleProceeds, amount);
      break;
    case "selling_fee":
      total.sellingFees = addExact(total.sellingFees, debit);
      break;
    case "burn_bgc_credit":
      total.burnBgcCredits = addExact(total.burnBgcCredits, amount);
      total.netBgcMovement = addExact(total.netBgcMovement, amount);
      break;
    case "arena_bgc_spend":
      total.arenaBgcSpend = addExact(total.arenaBgcSpend, debit);
      total.netBgcMovement = addExact(total.netBgcMovement, amount);
      break;
    case "lifecycle_income":
      total.otherLifecycleIncome = addExact(total.otherLifecycleIncome, amount);
      break;
    case "lifecycle_expense":
      total.otherLifecycleExpenses = addExact(
        total.otherLifecycleExpenses,
        debit,
      );
      break;
    case "deposit":
    case "withdrawal":
    case "internal_transfer":
    case "opening_balance":
    case "reconciliation_adjustment":
      break;
  }
}

export function buildVaultPerformanceSummary(
  records: readonly VaultPerformanceRecordInput[],
  coverage: VaultPerformanceCoverageInput,
): VaultPerformanceSummary {
  if (
    !["complete_recorded_period", "partial", "unknown"].includes(
      coverage.sourceCoverage,
    )
  ) {
    throw new Error("Vault Performance source coverage is invalid.");
  }
  if (
    !["confirmed_complete", "confirmed_none", "unknown"].includes(
      coverage.manualTournamentPayoutStatus,
    )
  ) {
    throw new Error("Manual tournament payout coverage is invalid.");
  }
  if (
    !["current", "ageing", "stale", "unknown"].includes(coverage.freshnessState)
  ) {
    throw new Error("Vault Performance freshness state is invalid.");
  }

  const periodStart = normalizeTimestamp(coverage.periodStart, "Period start");
  const periodEnd = normalizeTimestamp(coverage.periodEnd, "Period end");
  if (Date.parse(periodStart) > Date.parse(periodEnd)) {
    throw new Error("Vault Performance period is inverted.");
  }
  const dataCurrentThrough = optionalTimestamp(
    coverage.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = optionalTimestamp(
    coverage.lastImported,
    "Last imported",
  );

  const costBasis = new Map<
    string,
    "known_same_asset" | "missing_or_unconvertible"
  >();
  for (const item of coverage.costBasisByAsset ?? []) {
    const assetCode = item.assetCode.trim().toUpperCase();
    if (
      !assetCodePattern.test(assetCode) ||
      !["known_same_asset", "missing_or_unconvertible"].includes(item.status)
    ) {
      throw new Error("Vault Performance cost-basis evidence is invalid.");
    }
    if (costBasis.has(assetCode)) {
      throw new Error("Vault Performance cost-basis assets must be unique.");
    }
    costBasis.set(assetCode, item.status);
  }

  const normalized = records.map(normalizeRecord);
  const transactionIds = normalized.map((record) => record.transactionId);
  if (new Set(transactionIds).size !== transactionIds.length) {
    throw new Error("Vault Performance transaction IDs must be unique.");
  }

  const totals = new Map<string, VaultPerformanceAssetTotal>();
  let excludedTransactionCount = 0;
  let nonOperatingTransactionCount = 0;
  let unclassifiedTransactionCount = 0;
  let unresolvedReconciliationCount = 0;
  let inferredClassificationPresent = false;

  for (const record of normalized) {
    if (
      Date.parse(record.occurredAt) < Date.parse(periodStart) ||
      Date.parse(record.occurredAt) > Date.parse(periodEnd)
    ) {
      continue;
    }
    if (record.aggregateStatus === "excluded") {
      excludedTransactionCount += 1;
      continue;
    }
    if (!record.operating) nonOperatingTransactionCount += 1;
    if (record.classificationStatus === "unclassified") {
      unclassifiedTransactionCount += 1;
    }
    if (record.classificationStatus === "inferred") {
      inferredClassificationPresent = true;
    }
    if (record.reconciliationStatus === "review_required") {
      unresolvedReconciliationCount += 1;
    }

    const existing = totals.get(record.assetCode);
    if (existing && existing.assetKind !== record.assetKind) {
      throw new Error("One asset code cannot use multiple asset kinds.");
    }
    const total = existing ?? emptyAssetTotal(record);
    applyRecord(total, record);
    totals.set(record.assetCode, total);
  }

  let missingCostBasis = false;
  for (const total of totals.values()) {
    if (!isNonZero(total.coreSaleProceeds)) {
      total.realisedCoreTradingResult = "0";
      continue;
    }
    if (costBasis.get(total.assetCode) !== "known_same_asset") {
      total.realisedCoreTradingResult = null;
      missingCostBasis = true;
      continue;
    }
    total.realisedCoreTradingResult = addExact(
      addExact(total.coreSaleProceeds, `-${total.corePurchases}`),
      `-${total.sellingFees}`,
    );
  }

  const warnings = new Set<VaultPerformanceWarning>();
  if (coverage.sourceCoverage !== "complete_recorded_period") {
    warnings.add("SOURCE_COVERAGE_INCOMPLETE");
  }
  if (coverage.manualTournamentPayoutStatus === "unknown") {
    warnings.add("MANUAL_TOURNAMENT_PAYOUT_COVERAGE_UNKNOWN");
  }
  if (unclassifiedTransactionCount > 0) {
    warnings.add("UNCLASSIFIED_ACTIVITY");
  }
  if (inferredClassificationPresent) {
    warnings.add("INFERRED_CLASSIFICATION_PRESENT");
  }
  if (unresolvedReconciliationCount > 0) {
    warnings.add("UNRESOLVED_RECONCILIATION");
  }
  if (missingCostBasis) {
    warnings.add("CORE_SALE_COST_BASIS_MISSING");
  }
  if (dataCurrentThrough === null || lastImported === null) {
    warnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (coverage.freshnessState === "ageing") {
    warnings.add("IMPORTED_DATA_AGEING");
  }
  if (["stale", "unknown"].includes(coverage.freshnessState)) {
    warnings.add("IMPORTED_DATA_STALE");
  }

  const sortedTotals = [...totals.values()].sort((left, right) =>
    left.assetCode.localeCompare(right.assetCode),
  );
  const cashCryptoTotals = sortedTotals.filter(
    (total) => total.assetKind !== "game_credit",
  );
  const bgcTotals = sortedTotals.filter(
    (total) => total.assetKind === "game_credit",
  );

  return {
    periodStart,
    periodEnd,
    dataCurrentThrough,
    lastImported,
    freshnessState: coverage.freshnessState,
    status: warnings.size === 0 ? "complete_recorded_period" : "partial",
    cashCryptoTotals,
    bgcTotals,
    includedTransactionCount: sortedTotals.reduce(
      (sum, total) => sum + total.includedTransactionCount,
      0,
    ),
    excludedTransactionCount,
    nonOperatingTransactionCount,
    unclassifiedTransactionCount,
    unresolvedReconciliationCount,
    warnings: [...warnings].sort(),
    combinedAssetTotalAvailable: false,
    bgcIncludedInCashCryptoProfit: false,
    lifetimeProfitClaimAllowed: false,
  };
}
