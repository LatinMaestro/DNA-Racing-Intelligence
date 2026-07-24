import { normalizeExactDecimal } from "@/domain/exact-decimal";

export const coreEconomicCategories = [
  "open_race_entry_fee",
  "open_race_payout",
  "qualification_entry_fee",
  "qualification_race_payout",
  "tournament_round_payout",
  "tournament_final_payout",
  "manual_tournament_payout",
  "breeding_fee_earned",
  "breeding_expense",
  "core_purchase",
  "core_sale",
  "selling_fee",
  "burn_bgc_credit",
  "lifecycle_income",
  "lifecycle_expense",
] as const;
export type CoreEconomicCategory = (typeof coreEconomicCategories)[number];

export const coreEconomicAssetKinds = [
  "crypto",
  "fiat",
  "game_credit",
] as const;
export type CoreEconomicAssetKind = (typeof coreEconomicAssetKinds)[number];

export type CoreAmountAllocationInput = {
  coreId: string;
  signedAmount: string;
};

export type CoreEconomicRecordInput = {
  transactionId: string;
  occurredAt: string;
  assetCode: string;
  assetKind: CoreEconomicAssetKind;
  signedAmount: string;
  category: CoreEconomicCategory;
  aggregateStatus: "included" | "excluded";
  reconciliationStatus: "reconciled" | "review_required";
  allocationStatus:
    "explicit_allocations" | "related_unallocated" | "unrelated";
  coreAllocations?: readonly CoreAmountAllocationInput[];
  relatedCoreIds?: readonly string[];
};

export type CoreEconomicProfileCoverageInput = {
  coreId: string;
  periodStart: string;
  periodEnd: string;
  sourceCoverage: "complete_recorded_period" | "partial" | "unknown";
  costBasisByAsset?: readonly {
    assetCode: string;
    status: "known_same_asset" | "missing_or_unconvertible";
  }[];
  dataCurrentThrough: string | null;
  lastImported: string | null;
};

export type CoreEconomicAssetTotal = {
  assetCode: string;
  assetKind: CoreEconomicAssetKind;
  openRaceEntryFees: string;
  openRacePayouts: string;
  tournamentEntryFees: string;
  tournamentPayouts: string;
  breedingIncome: string;
  breedingExpenses: string;
  acquisitionCosts: string;
  saleProceeds: string;
  sellingFees: string;
  burnBgcCredits: string;
  otherLifecycleIncome: string;
  otherLifecycleExpenses: string;
  recordedNet: string;
  realisedTradingResult: string | null;
  allocatedTransactionCount: number;
};

export type CoreEconomicProfileWarning =
  | "SOURCE_COVERAGE_INCOMPLETE"
  | "COST_BASIS_MISSING"
  | "UNRESOLVED_RECONCILIATION"
  | "RELATED_SHARED_ACTIVITY_UNALLOCATED"
  | "DATA_CUTOFF_UNKNOWN";

export type CoreEconomicProfile = {
  coreId: string;
  periodStart: string;
  periodEnd: string;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  status: "complete_recorded_period" | "partial";
  cashCryptoTotals: readonly CoreEconomicAssetTotal[];
  bgcTotals: readonly CoreEconomicAssetTotal[];
  allocatedTransactionCount: number;
  excludedAllocatedTransactionCount: number;
  relatedUnallocatedTransactionCount: number;
  warnings: readonly CoreEconomicProfileWarning[];
  combinedAssetTotalAvailable: false;
  lifetimeProfitClaimAllowed: false;
};

type ParsedDecimal = {
  negative: boolean;
  digits: bigint;
  scale: number;
};

type NormalizedAllocation = {
  coreId: string;
  signedAmount: string;
};

type NormalizedRecord = Omit<
  CoreEconomicRecordInput,
  | "occurredAt"
  | "assetCode"
  | "signedAmount"
  | "coreAllocations"
  | "relatedCoreIds"
> & {
  occurredAt: string;
  assetCode: string;
  signedAmount: string;
  coreAllocations: readonly NormalizedAllocation[];
  relatedCoreIds: readonly string[];
};

type AllocatedRecord = Omit<NormalizedRecord, "signedAmount"> & {
  signedAmount: string;
};

const creditCategories = new Set<CoreEconomicCategory>([
  "open_race_payout",
  "qualification_race_payout",
  "tournament_round_payout",
  "tournament_final_payout",
  "manual_tournament_payout",
  "breeding_fee_earned",
  "core_sale",
  "burn_bgc_credit",
  "lifecycle_income",
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

function normalizeUniqueCoreIds(
  values: readonly string[] | undefined,
  label: string,
): string[] {
  const normalized = (values ?? []).map((value) =>
    requiredTrimmed(value, label),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} values must be unique.`);
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

function normalizeRecord(input: CoreEconomicRecordInput): NormalizedRecord {
  if (!coreEconomicCategories.includes(input.category)) {
    throw new Error("Core economic category is invalid.");
  }
  if (!coreEconomicAssetKinds.includes(input.assetKind)) {
    throw new Error("Core economic asset kind is invalid.");
  }
  if (!["included", "excluded"].includes(input.aggregateStatus)) {
    throw new Error("Core economic aggregate status is invalid.");
  }
  if (!["reconciled", "review_required"].includes(input.reconciliationStatus)) {
    throw new Error("Core economic reconciliation status is invalid.");
  }
  if (
    !["explicit_allocations", "related_unallocated", "unrelated"].includes(
      input.allocationStatus,
    )
  ) {
    throw new Error("Core economic allocation status is invalid.");
  }

  const assetCode = input.assetCode.trim().toUpperCase();
  if (!assetCodePattern.test(assetCode)) {
    throw new Error("Core economic asset identity is invalid.");
  }
  if (
    (assetCode === "BGC" && input.assetKind !== "game_credit") ||
    (assetCode !== "BGC" && input.assetKind === "game_credit")
  ) {
    throw new Error("BGC must remain the separate game-credit asset.");
  }
  if (
    (input.category === "burn_bgc_credit" && assetCode !== "BGC") ||
    (assetCode === "BGC" &&
      !["burn_bgc_credit", "breeding_expense"].includes(input.category))
  ) {
    throw new Error(
      "Core-profile BGC evidence is limited to actual burn credits and breeding spend.",
    );
  }

  const signedAmount = normalizeExactDecimal(input.signedAmount);
  if (signedAmount === "0") {
    throw new Error("Core economic records cannot use a zero amount.");
  }
  const shouldBeCredit = creditCategories.has(input.category);
  if (signedAmount.startsWith("-") === shouldBeCredit) {
    throw new Error("Core economic category direction is invalid.");
  }

  const coreAllocations = (input.coreAllocations ?? []).map((allocation) => ({
    coreId: requiredTrimmed(allocation.coreId, "Allocation core ID"),
    signedAmount: normalizeExactDecimal(allocation.signedAmount),
  }));
  if (
    new Set(coreAllocations.map((allocation) => allocation.coreId)).size !==
    coreAllocations.length
  ) {
    throw new Error("Allocation core IDs must be unique.");
  }
  if (
    coreAllocations.some(
      (allocation) =>
        allocation.signedAmount === "0" ||
        allocation.signedAmount.startsWith("-") !==
          signedAmount.startsWith("-"),
    )
  ) {
    throw new Error("Core allocations must preserve transaction direction.");
  }
  const relatedCoreIds = normalizeUniqueCoreIds(
    input.relatedCoreIds,
    "Related core ID",
  );

  if (input.allocationStatus === "explicit_allocations") {
    if (coreAllocations.length === 0 || relatedCoreIds.length !== 0) {
      throw new Error("Explicit core-allocation evidence is inconsistent.");
    }
    const allocatedTotal = coreAllocations.reduce(
      (sum, allocation) => addExact(sum, allocation.signedAmount),
      "0",
    );
    if (allocatedTotal !== signedAmount) {
      throw new Error("Explicit core allocations must equal the transaction.");
    }
  } else if (input.allocationStatus === "related_unallocated") {
    if (coreAllocations.length !== 0 || relatedCoreIds.length === 0) {
      throw new Error("Related unallocated core evidence is inconsistent.");
    }
  } else if (coreAllocations.length !== 0 || relatedCoreIds.length !== 0) {
    throw new Error("Unrelated transactions cannot carry core evidence.");
  }

  return {
    ...input,
    transactionId: requiredTrimmed(input.transactionId, "Transaction ID"),
    occurredAt: normalizeTimestamp(input.occurredAt, "Occurred at"),
    assetCode,
    signedAmount,
    coreAllocations: coreAllocations.sort((left, right) =>
      left.coreId.localeCompare(right.coreId),
    ),
    relatedCoreIds,
  };
}

function emptyTotal(record: AllocatedRecord): CoreEconomicAssetTotal {
  return {
    assetCode: record.assetCode,
    assetKind: record.assetKind,
    openRaceEntryFees: "0",
    openRacePayouts: "0",
    tournamentEntryFees: "0",
    tournamentPayouts: "0",
    breedingIncome: "0",
    breedingExpenses: "0",
    acquisitionCosts: "0",
    saleProceeds: "0",
    sellingFees: "0",
    burnBgcCredits: "0",
    otherLifecycleIncome: "0",
    otherLifecycleExpenses: "0",
    recordedNet: "0",
    realisedTradingResult: null,
    allocatedTransactionCount: 0,
  };
}

function aggregateByAsset(
  records: readonly AllocatedRecord[],
  costBasisStatuses: ReadonlyMap<
    string,
    "known_same_asset" | "missing_or_unconvertible"
  >,
): CoreEconomicAssetTotal[] {
  const totals = new Map<string, CoreEconomicAssetTotal>();
  for (const record of records) {
    const key = `${record.assetKind}:${record.assetCode}`;
    const total = totals.get(key) ?? emptyTotal(record);
    const unsigned = absolute(record.signedAmount);
    switch (record.category) {
      case "open_race_entry_fee":
        total.openRaceEntryFees = addExact(total.openRaceEntryFees, unsigned);
        break;
      case "open_race_payout":
        total.openRacePayouts = addExact(total.openRacePayouts, unsigned);
        break;
      case "qualification_entry_fee":
        total.tournamentEntryFees = addExact(
          total.tournamentEntryFees,
          unsigned,
        );
        break;
      case "qualification_race_payout":
      case "tournament_round_payout":
      case "tournament_final_payout":
      case "manual_tournament_payout":
        total.tournamentPayouts = addExact(total.tournamentPayouts, unsigned);
        break;
      case "breeding_fee_earned":
        total.breedingIncome = addExact(total.breedingIncome, unsigned);
        break;
      case "breeding_expense":
        total.breedingExpenses = addExact(total.breedingExpenses, unsigned);
        break;
      case "core_purchase":
        total.acquisitionCosts = addExact(total.acquisitionCosts, unsigned);
        break;
      case "core_sale":
        total.saleProceeds = addExact(total.saleProceeds, unsigned);
        break;
      case "selling_fee":
        total.sellingFees = addExact(total.sellingFees, unsigned);
        break;
      case "burn_bgc_credit":
        total.burnBgcCredits = addExact(total.burnBgcCredits, unsigned);
        break;
      case "lifecycle_income":
        total.otherLifecycleIncome = addExact(
          total.otherLifecycleIncome,
          unsigned,
        );
        break;
      case "lifecycle_expense":
        total.otherLifecycleExpenses = addExact(
          total.otherLifecycleExpenses,
          unsigned,
        );
        break;
    }
    total.recordedNet = addExact(total.recordedNet, record.signedAmount);
    total.allocatedTransactionCount += 1;
    totals.set(key, total);
  }

  for (const total of totals.values()) {
    if (total.saleProceeds === "0") continue;
    total.realisedTradingResult =
      costBasisStatuses.get(total.assetCode) === "known_same_asset"
        ? addExact(
            addExact(total.saleProceeds, `-${total.acquisitionCosts}`),
            `-${total.sellingFees}`,
          )
        : null;
  }

  return [...totals.values()].sort(
    (left, right) =>
      left.assetKind.localeCompare(right.assetKind) ||
      left.assetCode.localeCompare(right.assetCode),
  );
}

export function buildCoreEconomicProfile(
  recordInputs: readonly CoreEconomicRecordInput[],
  coverageInput: CoreEconomicProfileCoverageInput,
): CoreEconomicProfile {
  const coreId = requiredTrimmed(coverageInput.coreId, "Core ID");
  const periodStart = normalizeTimestamp(
    coverageInput.periodStart,
    "Core economic period start",
  );
  const periodEnd = normalizeTimestamp(
    coverageInput.periodEnd,
    "Core economic period end",
  );
  if (periodStart > periodEnd) {
    throw new Error("Core economic period start must not be after its end.");
  }
  if (
    !["complete_recorded_period", "partial", "unknown"].includes(
      coverageInput.sourceCoverage,
    )
  ) {
    throw new Error("Core economic source coverage is invalid.");
  }
  if (
    coverageInput.costBasisByAsset !== undefined &&
    !Array.isArray(coverageInput.costBasisByAsset)
  ) {
    throw new Error("Core cost-basis coverage is invalid.");
  }
  const costBasisEntries = (coverageInput.costBasisByAsset ?? []).map(
    (entry) => {
      const assetCode = entry.assetCode.trim().toUpperCase();
      if (
        !assetCodePattern.test(assetCode) ||
        !["known_same_asset", "missing_or_unconvertible"].includes(entry.status)
      ) {
        throw new Error("Core cost-basis coverage is invalid.");
      }
      return { assetCode, status: entry.status };
    },
  );
  if (
    new Set(costBasisEntries.map((entry) => entry.assetCode)).size !==
    costBasisEntries.length
  ) {
    throw new Error("Core cost-basis asset codes must be unique.");
  }
  const costBasisStatuses = new Map(
    costBasisEntries.map((entry) => [entry.assetCode, entry.status] as const),
  );

  const records = recordInputs.map(normalizeRecord);
  if (
    new Set(records.map((record) => record.transactionId)).size !==
    records.length
  ) {
    throw new Error("Core economic transaction IDs must be unique.");
  }
  const periodRecords = records.filter(
    (record) =>
      record.occurredAt >= periodStart && record.occurredAt <= periodEnd,
  );
  const explicitlyAllocated = periodRecords.flatMap((record) => {
    if (record.allocationStatus !== "explicit_allocations") return [];
    const allocation = record.coreAllocations.find(
      (candidate) => candidate.coreId === coreId,
    );
    return allocation === undefined
      ? []
      : [{ ...record, signedAmount: allocation.signedAmount }];
  });
  const included = explicitlyAllocated.filter(
    (record) => record.aggregateStatus === "included",
  );
  const relatedUnallocatedTransactionCount = periodRecords.filter(
    (record) =>
      record.aggregateStatus === "included" &&
      record.allocationStatus === "related_unallocated" &&
      record.relatedCoreIds.includes(coreId),
  ).length;
  const totals = aggregateByAsset(included, costBasisStatuses);
  const warnings = new Set<CoreEconomicProfileWarning>();

  if (coverageInput.sourceCoverage !== "complete_recorded_period") {
    warnings.add("SOURCE_COVERAGE_INCOMPLETE");
  }
  if (
    totals.some(
      (total) =>
        total.saleProceeds !== "0" && total.realisedTradingResult === null,
    )
  ) {
    warnings.add("COST_BASIS_MISSING");
  }
  if (
    included.some((record) => record.reconciliationStatus === "review_required")
  ) {
    warnings.add("UNRESOLVED_RECONCILIATION");
  }
  if (relatedUnallocatedTransactionCount > 0) {
    warnings.add("RELATED_SHARED_ACTIVITY_UNALLOCATED");
  }
  const dataCurrentThrough = optionalTimestamp(
    coverageInput.dataCurrentThrough,
    "Data current through",
  );
  if (dataCurrentThrough === null) warnings.add("DATA_CUTOFF_UNKNOWN");

  const status =
    warnings.has("SOURCE_COVERAGE_INCOMPLETE") ||
    warnings.has("COST_BASIS_MISSING") ||
    warnings.has("UNRESOLVED_RECONCILIATION") ||
    warnings.has("DATA_CUTOFF_UNKNOWN")
      ? "partial"
      : "complete_recorded_period";

  return {
    coreId,
    periodStart,
    periodEnd,
    dataCurrentThrough,
    lastImported: optionalTimestamp(
      coverageInput.lastImported,
      "Last imported",
    ),
    status,
    cashCryptoTotals: totals.filter(
      (total) => total.assetKind !== "game_credit",
    ),
    bgcTotals: totals.filter((total) => total.assetKind === "game_credit"),
    allocatedTransactionCount: included.length,
    excludedAllocatedTransactionCount:
      explicitlyAllocated.length - included.length,
    relatedUnallocatedTransactionCount,
    warnings: [...warnings],
    combinedAssetTotalAvailable: false,
    lifetimeProfitClaimAllowed: false,
  };
}
