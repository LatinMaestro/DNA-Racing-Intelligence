import { normalizeExactDecimal } from "@/domain/exact-decimal";

export const economicReportScopes = [
  "activity_cashflow",
  "wallet_balance",
  "core_trading",
  "bgc_movement",
] as const;
export type EconomicReportScope = (typeof economicReportScopes)[number];

export const reportAssetKinds = ["crypto", "fiat", "game_credit"] as const;
export type ReportAssetKind = (typeof reportAssetKinds)[number];

export const conversionCoverageStates = [
  "not_requested",
  "complete_actual",
  "complete_estimated",
  "partial_missing",
] as const;
export type ConversionCoverageState = (typeof conversionCoverageStates)[number];

export type ReportLedgerRecordInput = {
  transactionId: string;
  occurredAt: string;
  assetCode: string;
  assetKind: ReportAssetKind;
  signedAmount: string;
  operating: boolean;
  aggregateStatus: "included" | "excluded";
};

export type EconomicReportCoverageInput = {
  reportScope: EconomicReportScope;
  periodStart: string;
  periodEnd: string;
  sourceCoverageStart: string | null;
  sourceCoverageEnd: string | null;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  unclassifiedCount: number;
  unresolvedReconciliationCount: number;
  missingCostBasisCount: number;
  openingBalanceKnown: boolean;
  manualExternalPayoutStatus:
    "confirmed_complete" | "confirmed_none" | "unknown";
  conversionCoverage: ConversionCoverageState;
};

const manualExternalPayoutStates = [
  "confirmed_complete",
  "confirmed_none",
  "unknown",
] as const;

export type AssetSeparatedTotal = {
  assetCode: string;
  assetKind: ReportAssetKind;
  income: string;
  expense: string;
  net: string;
  includedTransactionCount: number;
};

export type EconomicReportWarning =
  | "SOURCE_COVERAGE_INCOMPLETE"
  | "DATA_CUTOFF_UNKNOWN"
  | "UNCLASSIFIED_ACTIVITY"
  | "UNRESOLVED_RECONCILIATION"
  | "MANUAL_EXTERNAL_PAYOUT_COVERAGE_UNKNOWN"
  | "COST_BASIS_MISSING"
  | "OPENING_BALANCE_MISSING"
  | "CONVERSION_RATE_MISSING"
  | "ESTIMATED_CONVERSION_USED";

export type EconomicReportResult = {
  reportScope: EconomicReportScope;
  status: "complete" | "partial" | "estimated";
  periodStart: string;
  periodEnd: string;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  cashCryptoTotals: readonly AssetSeparatedTotal[];
  bgcTotals: readonly AssetSeparatedTotal[];
  excludedTransactionCount: number;
  warnings: readonly EconomicReportWarning[];
  combinedAssetTotalAvailable: false;
  lifetimeProfitClaimAllowed: false;
};

type ParsedDecimal = {
  negative: boolean;
  digits: bigint;
  scale: number;
};

function requiredTrimmed(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(`${label} is required.`);
  return trimmed;
}

function normalizeTimestamp(value: string, label: string): string {
  const trimmed = requiredTrimmed(value, label);
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) throw new Error(`${label} must be valid.`);
  return new Date(timestamp).toISOString();
}

function optionalTimestamp(value: string | null, label: string): string | null {
  return value === null ? null : normalizeTimestamp(value, label);
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
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

function isNegative(value: string): boolean {
  return parseDecimal(value).negative;
}

function absolute(value: string): string {
  return value.startsWith("-") ? value.slice(1) : value;
}

function normalizeRecord(
  input: ReportLedgerRecordInput,
): ReportLedgerRecordInput & { occurredAt: string; signedAmount: string } {
  if (!reportAssetKinds.includes(input.assetKind)) {
    throw new Error("Report asset kind is invalid.");
  }
  if (!["included", "excluded"].includes(input.aggregateStatus)) {
    throw new Error("Aggregate status is invalid.");
  }
  if (typeof input.operating !== "boolean") {
    throw new Error("Operating status is invalid.");
  }
  const assetCode = input.assetCode.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(assetCode)) {
    throw new Error("Report asset identity is invalid.");
  }
  if (
    (assetCode === "BGC" && input.assetKind !== "game_credit") ||
    (assetCode !== "BGC" && input.assetKind === "game_credit")
  ) {
    throw new Error("BGC must remain the separate game-credit asset.");
  }
  const signedAmount = normalizeExactDecimal(input.signedAmount);
  if (signedAmount === "0") {
    throw new Error("Report ledger records cannot use a zero amount.");
  }
  return {
    ...input,
    transactionId: requiredTrimmed(input.transactionId, "Transaction ID"),
    occurredAt: normalizeTimestamp(input.occurredAt, "Occurred at"),
    assetCode,
    signedAmount,
  };
}

function aggregateByAsset(
  records: readonly ReturnType<typeof normalizeRecord>[],
): AssetSeparatedTotal[] {
  const totals = new Map<string, AssetSeparatedTotal>();
  for (const record of records) {
    const key = `${record.assetKind}:${record.assetCode}`;
    const total = totals.get(key) ?? {
      assetCode: record.assetCode,
      assetKind: record.assetKind,
      income: "0",
      expense: "0",
      net: "0",
      includedTransactionCount: 0,
    };
    if (isNegative(record.signedAmount)) {
      total.expense = addExact(total.expense, absolute(record.signedAmount));
    } else {
      total.income = addExact(total.income, record.signedAmount);
    }
    total.net = addExact(total.net, record.signedAmount);
    total.includedTransactionCount += 1;
    totals.set(key, total);
  }
  return [...totals.values()].sort(
    (left, right) =>
      left.assetKind.localeCompare(right.assetKind) ||
      left.assetCode.localeCompare(right.assetCode),
  );
}

export function buildEconomicReport(
  recordInputs: readonly ReportLedgerRecordInput[],
  coverageInput: EconomicReportCoverageInput,
): EconomicReportResult {
  if (!economicReportScopes.includes(coverageInput.reportScope)) {
    throw new Error("Economic report scope is invalid.");
  }
  if (!conversionCoverageStates.includes(coverageInput.conversionCoverage)) {
    throw new Error("Conversion coverage is invalid.");
  }
  if (
    !manualExternalPayoutStates.includes(
      coverageInput.manualExternalPayoutStatus,
    )
  ) {
    throw new Error("Manual external-payout coverage is invalid.");
  }

  const periodStart = normalizeTimestamp(
    coverageInput.periodStart,
    "Report period start",
  );
  const periodEnd = normalizeTimestamp(
    coverageInput.periodEnd,
    "Report period end",
  );
  if (periodStart > periodEnd) {
    throw new Error("Report period start must not be after its end.");
  }
  const sourceCoverageStart = optionalTimestamp(
    coverageInput.sourceCoverageStart,
    "Source coverage start",
  );
  const sourceCoverageEnd = optionalTimestamp(
    coverageInput.sourceCoverageEnd,
    "Source coverage end",
  );
  if (
    sourceCoverageStart !== null &&
    sourceCoverageEnd !== null &&
    sourceCoverageStart > sourceCoverageEnd
  ) {
    throw new Error("Source coverage start must not be after its end.");
  }
  const dataCurrentThrough = optionalTimestamp(
    coverageInput.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = optionalTimestamp(
    coverageInput.lastImported,
    "Last imported",
  );
  const counts = {
    unclassified: nonNegativeInteger(
      coverageInput.unclassifiedCount,
      "Unclassified count",
    ),
    unresolved: nonNegativeInteger(
      coverageInput.unresolvedReconciliationCount,
      "Unresolved reconciliation count",
    ),
    missingCostBasis: nonNegativeInteger(
      coverageInput.missingCostBasisCount,
      "Missing cost-basis count",
    ),
  };

  const records = recordInputs.map(normalizeRecord);
  if (
    new Set(records.map(({ transactionId }) => transactionId)).size !==
    records.length
  ) {
    throw new Error("Report transaction IDs must be unique.");
  }
  const inPeriod = records.filter(
    ({ occurredAt }) => occurredAt >= periodStart && occurredAt <= periodEnd,
  );
  const included = inPeriod.filter(
    ({ aggregateStatus }) => aggregateStatus === "included",
  );
  const scopeRecords =
    coverageInput.reportScope === "bgc_movement"
      ? included.filter(({ assetKind }) => assetKind === "game_credit")
      : included;
  const operating =
    coverageInput.reportScope === "activity_cashflow"
      ? scopeRecords.filter(({ operating: isOperating }) => isOperating)
      : scopeRecords;
  const cashCryptoTotals = aggregateByAsset(
    operating.filter(({ assetKind }) => assetKind !== "game_credit"),
  );
  const bgcTotals = aggregateByAsset(
    operating.filter(({ assetKind }) => assetKind === "game_credit"),
  );

  const warnings: EconomicReportWarning[] = [];
  if (
    sourceCoverageStart === null ||
    sourceCoverageEnd === null ||
    sourceCoverageStart > periodStart ||
    sourceCoverageEnd < periodEnd
  ) {
    warnings.push("SOURCE_COVERAGE_INCOMPLETE");
  }
  if (dataCurrentThrough === null || lastImported === null) {
    warnings.push("DATA_CUTOFF_UNKNOWN");
  }
  if (counts.unclassified > 0) warnings.push("UNCLASSIFIED_ACTIVITY");
  if (counts.unresolved > 0) warnings.push("UNRESOLVED_RECONCILIATION");
  if (coverageInput.manualExternalPayoutStatus === "unknown") {
    warnings.push("MANUAL_EXTERNAL_PAYOUT_COVERAGE_UNKNOWN");
  }
  if (
    coverageInput.reportScope === "core_trading" &&
    counts.missingCostBasis > 0
  ) {
    warnings.push("COST_BASIS_MISSING");
  }
  if (
    coverageInput.reportScope === "wallet_balance" &&
    !coverageInput.openingBalanceKnown
  ) {
    warnings.push("OPENING_BALANCE_MISSING");
  }
  if (coverageInput.conversionCoverage === "partial_missing") {
    warnings.push("CONVERSION_RATE_MISSING");
  }
  if (coverageInput.conversionCoverage === "complete_estimated") {
    warnings.push("ESTIMATED_CONVERSION_USED");
  }

  const partialWarnings = warnings.filter(
    (warning) => warning !== "ESTIMATED_CONVERSION_USED",
  );
  const status =
    partialWarnings.length > 0
      ? "partial"
      : warnings.includes("ESTIMATED_CONVERSION_USED")
        ? "estimated"
        : "complete";

  return {
    reportScope: coverageInput.reportScope,
    status,
    periodStart,
    periodEnd,
    dataCurrentThrough,
    lastImported,
    cashCryptoTotals,
    bgcTotals,
    excludedTransactionCount: inPeriod.length - included.length,
    warnings,
    combinedAssetTotalAvailable: false,
    lifetimeProfitClaimAllowed: false,
  };
}
