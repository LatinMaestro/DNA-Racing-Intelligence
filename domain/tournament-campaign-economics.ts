import { normalizeExactDecimal } from "@/domain/exact-decimal";

export const campaignEconomicCategories = [
  "qualification_entry_fee",
  "qualification_race_payout",
  "tournament_round_payout",
  "tournament_final_payout",
  "manual_tournament_payout",
  "campaign_expense",
] as const;
export type CampaignEconomicCategory =
  (typeof campaignEconomicCategories)[number];

export const campaignAssetKinds = ["crypto", "fiat", "game_credit"] as const;
export type CampaignAssetKind = (typeof campaignAssetKinds)[number];

export type CampaignEconomicRecordInput = {
  transactionId: string;
  occurredAt: string;
  tournamentId: string | null;
  bracketId?: string | null;
  assetCode: string;
  assetKind: CampaignAssetKind;
  signedAmount: string;
  category: CampaignEconomicCategory;
  operating: boolean;
  aggregateStatus: "included" | "excluded";
  classificationStatus: "confirmed" | "inferred" | "unclassified";
  reconciliationStatus: "reconciled" | "review_required";
  allocationStatus: "explicit_core_link" | "vault_unallocated";
  coreIds?: readonly string[];
};

export type TournamentCampaignCoverageInput = {
  tournamentId: string;
  periodStart: string;
  periodEnd: string;
  sourceCoverage: "complete_recorded_period" | "partial" | "unknown";
  manualExternalPayoutStatus:
    "confirmed_complete" | "confirmed_none" | "unknown";
  dataCurrentThrough: string | null;
  lastImported: string | null;
};

export type CampaignAssetTotal = {
  assetCode: string;
  assetKind: CampaignAssetKind;
  qualificationEntryFees: string;
  qualificationRacePayouts: string;
  roundPayouts: string;
  finalPayouts: string;
  manualTournamentPayouts: string;
  campaignExpenses: string;
  net: string;
  transactionCount: number;
};

export type TournamentCampaignWarning =
  | "SOURCE_COVERAGE_INCOMPLETE"
  | "MANUAL_EXTERNAL_PAYOUT_COVERAGE_UNKNOWN"
  | "UNCLASSIFIED_CAMPAIGN_ACTIVITY"
  | "INFERRED_CLASSIFICATION_PRESENT"
  | "UNRESOLVED_RECONCILIATION"
  | "VAULT_LEVEL_PAYOUT_UNALLOCATED"
  | "DATA_CUTOFF_UNKNOWN";

export type TournamentCampaignEconomics = {
  tournamentId: string;
  periodStart: string;
  periodEnd: string;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  status: "complete_recorded_period" | "partial";
  cashCryptoTotals: readonly CampaignAssetTotal[];
  bgcTotals: readonly CampaignAssetTotal[];
  includedTransactionCount: number;
  excludedTransactionCount: number;
  unallocatedPayoutCount: number;
  warnings: readonly TournamentCampaignWarning[];
  combinedAssetTotalAvailable: false;
  lifetimeProfitClaimAllowed: false;
};

type ParsedDecimal = {
  negative: boolean;
  digits: bigint;
  scale: number;
};

type NormalizedRecord = Omit<
  CampaignEconomicRecordInput,
  "occurredAt" | "assetCode" | "signedAmount" | "coreIds" | "bracketId"
> & {
  occurredAt: string;
  assetCode: string;
  signedAmount: string;
  coreIds: readonly string[];
  bracketId: string | null;
};

const creditCategories = new Set<CampaignEconomicCategory>([
  "qualification_race_payout",
  "tournament_round_payout",
  "tournament_final_payout",
  "manual_tournament_payout",
]);
const payoutCategories = creditCategories;
const assetCodePattern = /^[A-Z][A-Z0-9_]{1,15}$/;

function requiredTrimmed(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(`${label} is required.`);
  return trimmed;
}

function optionalTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
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

function normalizeCoreIds(coreIds: readonly string[] | undefined): string[] {
  const normalized = (coreIds ?? []).map((coreId) =>
    requiredTrimmed(coreId, "Core ID"),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Campaign core IDs must be unique.");
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

function normalizeRecord(input: CampaignEconomicRecordInput): NormalizedRecord {
  if (!campaignEconomicCategories.includes(input.category)) {
    throw new Error("Campaign economic category is invalid.");
  }
  if (!campaignAssetKinds.includes(input.assetKind)) {
    throw new Error("Campaign asset kind is invalid.");
  }
  if (!["included", "excluded"].includes(input.aggregateStatus)) {
    throw new Error("Campaign aggregate status is invalid.");
  }
  if (
    !["confirmed", "inferred", "unclassified"].includes(
      input.classificationStatus,
    )
  ) {
    throw new Error("Campaign classification status is invalid.");
  }
  if (!["reconciled", "review_required"].includes(input.reconciliationStatus)) {
    throw new Error("Campaign reconciliation status is invalid.");
  }
  if (
    !["explicit_core_link", "vault_unallocated"].includes(
      input.allocationStatus,
    )
  ) {
    throw new Error("Campaign allocation status is invalid.");
  }
  if (typeof input.operating !== "boolean" || !input.operating) {
    throw new Error("Campaign economics require an operating ledger record.");
  }

  const assetCode = input.assetCode.trim().toUpperCase();
  if (!assetCodePattern.test(assetCode)) {
    throw new Error("Campaign asset identity is invalid.");
  }
  if (
    (assetCode === "BGC" && input.assetKind !== "game_credit") ||
    (assetCode !== "BGC" && input.assetKind === "game_credit")
  ) {
    throw new Error("BGC must remain the separate game-credit asset.");
  }

  const signedAmount = normalizeExactDecimal(input.signedAmount);
  if (signedAmount === "0") {
    throw new Error("Campaign economic records cannot use a zero amount.");
  }
  const shouldBeCredit = creditCategories.has(input.category);
  if (signedAmount.startsWith("-") === shouldBeCredit) {
    throw new Error("Campaign category direction is invalid.");
  }

  const coreIds = normalizeCoreIds(input.coreIds);
  if (
    (input.allocationStatus === "vault_unallocated" && coreIds.length !== 0) ||
    (input.allocationStatus === "explicit_core_link" && coreIds.length === 0)
  ) {
    throw new Error("Campaign core allocation evidence is inconsistent.");
  }

  return {
    ...input,
    transactionId: requiredTrimmed(input.transactionId, "Transaction ID"),
    occurredAt: normalizeTimestamp(input.occurredAt, "Occurred at"),
    tournamentId: optionalTrimmed(input.tournamentId),
    bracketId: optionalTrimmed(input.bracketId),
    assetCode,
    signedAmount,
    coreIds,
  };
}

function emptyAssetTotal(record: NormalizedRecord): CampaignAssetTotal {
  return {
    assetCode: record.assetCode,
    assetKind: record.assetKind,
    qualificationEntryFees: "0",
    qualificationRacePayouts: "0",
    roundPayouts: "0",
    finalPayouts: "0",
    manualTournamentPayouts: "0",
    campaignExpenses: "0",
    net: "0",
    transactionCount: 0,
  };
}

function aggregateByAsset(
  records: readonly NormalizedRecord[],
): CampaignAssetTotal[] {
  const totals = new Map<string, CampaignAssetTotal>();
  for (const record of records) {
    const key = `${record.assetKind}:${record.assetCode}`;
    const total = totals.get(key) ?? emptyAssetTotal(record);
    const unsigned = absolute(record.signedAmount);
    switch (record.category) {
      case "qualification_entry_fee":
        total.qualificationEntryFees = addExact(
          total.qualificationEntryFees,
          unsigned,
        );
        break;
      case "qualification_race_payout":
        total.qualificationRacePayouts = addExact(
          total.qualificationRacePayouts,
          unsigned,
        );
        break;
      case "tournament_round_payout":
        total.roundPayouts = addExact(total.roundPayouts, unsigned);
        break;
      case "tournament_final_payout":
        total.finalPayouts = addExact(total.finalPayouts, unsigned);
        break;
      case "manual_tournament_payout":
        total.manualTournamentPayouts = addExact(
          total.manualTournamentPayouts,
          unsigned,
        );
        break;
      case "campaign_expense":
        total.campaignExpenses = addExact(total.campaignExpenses, unsigned);
        break;
    }
    total.net = addExact(total.net, record.signedAmount);
    total.transactionCount += 1;
    totals.set(key, total);
  }
  return [...totals.values()].sort(
    (left, right) =>
      left.assetKind.localeCompare(right.assetKind) ||
      left.assetCode.localeCompare(right.assetCode),
  );
}

export function buildTournamentCampaignEconomics(
  recordInputs: readonly CampaignEconomicRecordInput[],
  coverageInput: TournamentCampaignCoverageInput,
): TournamentCampaignEconomics {
  const tournamentId = requiredTrimmed(
    coverageInput.tournamentId,
    "Tournament ID",
  );
  const periodStart = normalizeTimestamp(
    coverageInput.periodStart,
    "Campaign period start",
  );
  const periodEnd = normalizeTimestamp(
    coverageInput.periodEnd,
    "Campaign period end",
  );
  if (periodStart > periodEnd) {
    throw new Error("Campaign period start must not be after its end.");
  }
  if (
    !["complete_recorded_period", "partial", "unknown"].includes(
      coverageInput.sourceCoverage,
    )
  ) {
    throw new Error("Campaign source coverage is invalid.");
  }
  if (
    !["confirmed_complete", "confirmed_none", "unknown"].includes(
      coverageInput.manualExternalPayoutStatus,
    )
  ) {
    throw new Error("Campaign manual-payout coverage is invalid.");
  }

  const records = recordInputs.map(normalizeRecord);
  if (
    new Set(records.map((record) => record.transactionId)).size !==
    records.length
  ) {
    throw new Error("Campaign transaction IDs must be unique.");
  }

  const selected = records.filter(
    (record) =>
      record.tournamentId === tournamentId &&
      record.occurredAt >= periodStart &&
      record.occurredAt <= periodEnd,
  );
  const included = selected.filter(
    (record) => record.aggregateStatus === "included",
  );
  const totals = aggregateByAsset(included);
  const warnings = new Set<TournamentCampaignWarning>();

  if (coverageInput.sourceCoverage !== "complete_recorded_period") {
    warnings.add("SOURCE_COVERAGE_INCOMPLETE");
  }
  if (coverageInput.manualExternalPayoutStatus === "unknown") {
    warnings.add("MANUAL_EXTERNAL_PAYOUT_COVERAGE_UNKNOWN");
  }
  if (
    included.some((record) => record.classificationStatus === "unclassified")
  ) {
    warnings.add("UNCLASSIFIED_CAMPAIGN_ACTIVITY");
  }
  if (included.some((record) => record.classificationStatus === "inferred")) {
    warnings.add("INFERRED_CLASSIFICATION_PRESENT");
  }
  if (
    included.some((record) => record.reconciliationStatus === "review_required")
  ) {
    warnings.add("UNRESOLVED_RECONCILIATION");
  }
  const unallocatedPayoutCount = included.filter(
    (record) =>
      payoutCategories.has(record.category) &&
      record.allocationStatus === "vault_unallocated",
  ).length;
  if (unallocatedPayoutCount > 0) {
    warnings.add("VAULT_LEVEL_PAYOUT_UNALLOCATED");
  }
  const dataCurrentThrough = optionalTimestamp(
    coverageInput.dataCurrentThrough,
    "Data current through",
  );
  if (dataCurrentThrough === null) warnings.add("DATA_CUTOFF_UNKNOWN");

  const status =
    warnings.has("SOURCE_COVERAGE_INCOMPLETE") ||
    warnings.has("MANUAL_EXTERNAL_PAYOUT_COVERAGE_UNKNOWN") ||
    warnings.has("UNCLASSIFIED_CAMPAIGN_ACTIVITY") ||
    warnings.has("UNRESOLVED_RECONCILIATION") ||
    warnings.has("DATA_CUTOFF_UNKNOWN")
      ? "partial"
      : "complete_recorded_period";

  return {
    tournamentId,
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
    includedTransactionCount: included.length,
    excludedTransactionCount: selected.length - included.length,
    unallocatedPayoutCount,
    warnings: [...warnings],
    combinedAssetTotalAvailable: false,
    lifetimeProfitClaimAllowed: false,
  };
}
