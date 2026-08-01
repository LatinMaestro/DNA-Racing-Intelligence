import {
  isNegativeExactDecimal,
  isZeroExactDecimal,
  negateExactDecimal,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";

export const manualLedgerCategories = [
  "income",
  "expense",
  "deposit",
  "withdrawal",
  "transfer",
  "opening_balance",
  "adjustment",
] as const;
export type ManualLedgerCategory = (typeof manualLedgerCategories)[number];

export const manualLedgerSubcategories = [
  "manual_tournament_payout",
  "breeding_fee_earned",
  "breeding_fee_paid",
  "dna_base_fee",
  "arena_owner_fee",
  "arena_fee_bgc",
  "core_purchase",
  "core_sale",
  "marketplace_fee",
  "burn_bgc_credit",
  "refund",
  "other_income",
  "other_expense",
  "deposit",
  "withdrawal",
  "internal_transfer",
  "opening_balance",
  "adjustment",
] as const;
export type ManualLedgerSubcategory =
  (typeof manualLedgerSubcategories)[number];

export const assetKinds = ["crypto", "fiat", "game_credit"] as const;
export type AssetKind = (typeof assetKinds)[number];

export type ManualLedgerEntryInput = {
  entryId: string;
  occurredAt: string;
  assetCode: string;
  assetKind: AssetKind;
  amount: string;
  category: ManualLedgerCategory;
  subcategory: ManualLedgerSubcategory;
  direction?: "credit" | "debit";
  accountLabel?: string | null;
  fromAccountLabel?: string | null;
  toAccountLabel?: string | null;
  tournamentId?: string | null;
  coreIds?: readonly string[];
  externalReference?: string | null;
  costBasisStatus?: "known" | "missing" | "not_applicable";
  note?: string | null;
};

export type ManualLedgerAssetDefinition = Readonly<{
  code: string;
  kind: AssetKind;
  precision: number;
}>;

export type TournamentCampaignBinding = Readonly<{
  tournamentId: string;
  evidenceId: string;
  configurationVersion: string;
  ownerAcknowledgedAt: string;
}>;

export type ManualLedgerWarning =
  | "CORE_SALE_COST_BASIS_MISSING"
  | "UNALLOCATED_TOURNAMENT_PAYOUT"
  | "TOURNAMENT_CAMPAIGN_BINDING_REQUIRED";

export type ManualLedgerPosting = Readonly<{
  postingId: string;
  accountLabel: string;
  assetCode: string;
  assetKind: AssetKind;
  signedAmount: string;
  category: ManualLedgerCategory;
  subcategory: ManualLedgerSubcategory;
  operating: boolean;
  tournamentAggregationEligible: boolean;
}>;

export type ValidatedManualLedgerEntry = Readonly<{
  entryId: string;
  occurredAt: string;
  assetCode: string;
  assetKind: AssetKind;
  assetRegistryVersion: string;
  assetPrecision: number;
  amount: string;
  category: ManualLedgerCategory;
  subcategory: ManualLedgerSubcategory;
  tournamentId: string | null;
  tournamentCampaignBinding: TournamentCampaignBinding | null;
  tournamentAggregationEligible: boolean;
  coreIds: readonly string[];
  externalReference: string | null;
  note: string | null;
  postings: readonly ManualLedgerPosting[];
  warnings: readonly ManualLedgerWarning[];
  completeness: "complete" | "partial";
}>;

const allowedSubcategories: Readonly<
  Record<ManualLedgerCategory, readonly ManualLedgerSubcategory[]>
> = {
  income: [
    "manual_tournament_payout",
    "breeding_fee_earned",
    "core_sale",
    "burn_bgc_credit",
    "refund",
    "other_income",
  ],
  expense: [
    "breeding_fee_paid",
    "dna_base_fee",
    "arena_owner_fee",
    "arena_fee_bgc",
    "core_purchase",
    "marketplace_fee",
    "other_expense",
  ],
  deposit: ["deposit"],
  withdrawal: ["withdrawal"],
  transfer: ["internal_transfer"],
  opening_balance: ["opening_balance"],
  adjustment: ["adjustment"],
};
const operatingCategories = new Set<ManualLedgerCategory>([
  "income",
  "expense",
]);
const debitCategories = new Set<ManualLedgerCategory>([
  "expense",
  "withdrawal",
]);
const assetCodePattern = /^[A-Z][A-Z0-9_]{1,15}$/;

function requiredTrimmed(
  value: string | null | undefined,
  label: string,
): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") throw new Error(`${label} is required.`);
  return trimmed;
}
function optionalTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
function canonicalTimestamp(value: string, label: string): string {
  const parsed = new Date(requiredTrimmed(value, label));
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`${label} must be a valid timestamp.`);
  return parsed.toISOString();
}
function validateAmount(value: string, precision: number): string {
  let normalized: string;
  try {
    normalized = normalizeExactDecimal(value);
  } catch {
    throw new Error("Manual amount must be a plain base-10 decimal.");
  }
  if (isNegativeExactDecimal(normalized) || isZeroExactDecimal(normalized))
    throw new Error("Manual amount must be greater than zero.");
  const fractionLength = normalized.split(".")[1]?.length ?? 0;
  if (fractionLength > precision)
    throw new Error("Manual amount exceeds the authoritative asset precision.");
  return normalized;
}
function assertAsset(
  input: ManualLedgerEntryInput,
  definition: ManualLedgerAssetDefinition,
): string {
  const supplied = input.assetCode.trim().toUpperCase();
  const authoritative = definition.code.trim().toUpperCase();
  if (
    !assetCodePattern.test(authoritative) ||
    !assetKinds.includes(definition.kind) ||
    !Number.isInteger(definition.precision) ||
    definition.precision < 0 ||
    definition.precision > 100
  ) {
    throw new Error("Authoritative manual asset definition is invalid.");
  }
  if (supplied !== authoritative || input.assetKind !== definition.kind)
    throw new Error(
      "Manual asset metadata does not match the authoritative registry.",
    );
  return authoritative;
}
function assertCategoryPair(
  category: ManualLedgerCategory,
  subcategory: ManualLedgerSubcategory,
): void {
  if (
    !manualLedgerCategories.includes(category) ||
    !manualLedgerSubcategories.includes(subcategory) ||
    !allowedSubcategories[category].includes(subcategory)
  )
    throw new Error("Manual category and subcategory are incompatible.");
}
function assertBgcUse(
  assetCode: string,
  subcategory: ManualLedgerSubcategory,
): void {
  if (
    ["arena_fee_bgc", "burn_bgc_credit"].includes(subcategory) &&
    assetCode !== "BGC"
  )
    throw new Error(`${subcategory} requires the BGC game-credit asset.`);
  if (
    assetCode === "BGC" &&
    ![
      "arena_fee_bgc",
      "burn_bgc_credit",
      "opening_balance",
      "adjustment",
    ].includes(subcategory)
  )
    throw new Error("BGC is limited to its separate in-game-credit ledger.");
}
function normalizeCoreIds(coreIds: readonly string[] | undefined): string[] {
  const normalized = (coreIds ?? []).map((id) =>
    requiredTrimmed(id, "Core ID"),
  );
  if (new Set(normalized).size !== normalized.length)
    throw new Error("Manual entry core IDs must be unique.");
  return normalized.sort((a, b) => a.localeCompare(b));
}
function signedAmount(
  category: ManualLedgerCategory,
  amount: string,
  direction: "credit" | "debit" | undefined,
): string {
  if (category === "adjustment") {
    if (direction === undefined)
      throw new Error("An adjustment requires a credit or debit direction.");
    return direction === "debit" ? negateExactDecimal(amount) : amount;
  }
  if (direction !== undefined) {
    const expected = debitCategories.has(category) ? "debit" : "credit";
    if (direction !== expected)
      throw new Error(`Manual ${category} direction must be ${expected}.`);
  }
  return debitCategories.has(category) ? negateExactDecimal(amount) : amount;
}
function buildPostings(input: {
  entryId: string;
  category: ManualLedgerCategory;
  subcategory: ManualLedgerSubcategory;
  amount: string;
  direction: "credit" | "debit" | undefined;
  assetCode: string;
  assetKind: AssetKind;
  accountLabel: string | null;
  fromAccountLabel: string | null;
  toAccountLabel: string | null;
  tournamentAggregationEligible: boolean;
}): ManualLedgerPosting[] {
  const common = {
    assetCode: input.assetCode,
    assetKind: input.assetKind,
    category: input.category,
    subcategory: input.subcategory,
    tournamentAggregationEligible: input.tournamentAggregationEligible,
  };
  if (input.category === "transfer") {
    const from = requiredTrimmed(
      input.fromAccountLabel,
      "Transfer source account",
    );
    const to = requiredTrimmed(
      input.toAccountLabel,
      "Transfer destination account",
    );
    if (from === to) throw new Error("Transfer accounts must be different.");
    return [
      {
        ...common,
        postingId: `${input.entryId}:from`,
        accountLabel: from,
        signedAmount: negateExactDecimal(input.amount),
        operating: false,
      },
      {
        ...common,
        postingId: `${input.entryId}:to`,
        accountLabel: to,
        signedAmount: input.amount,
        operating: false,
      },
    ];
  }
  return [
    {
      ...common,
      postingId: `${input.entryId}:primary`,
      accountLabel: requiredTrimmed(input.accountLabel, "Manual entry account"),
      signedAmount: signedAmount(input.category, input.amount, input.direction),
      operating: operatingCategories.has(input.category),
    },
  ];
}

export function validateManualLedgerEntry(
  input: ManualLedgerEntryInput,
  context: Readonly<{
    assetDefinition: ManualLedgerAssetDefinition;
    assetRegistryVersion: string;
    serverNow: string;
    tournamentCampaignBinding: TournamentCampaignBinding | null;
  }>,
): ValidatedManualLedgerEntry {
  const entryId = requiredTrimmed(input.entryId, "Manual entry ID");
  const occurredAt = canonicalTimestamp(input.occurredAt, "Occurred at");
  const serverNow = canonicalTimestamp(context.serverNow, "Server time");
  if (Date.parse(occurredAt) > Date.parse(serverNow))
    throw new Error("Occurred at cannot be in the future.");
  const assetRegistryVersion = requiredTrimmed(
    context.assetRegistryVersion,
    "Asset registry version",
  );
  const assetCode = assertAsset(input, context.assetDefinition);
  const amount = validateAmount(
    input.amount,
    context.assetDefinition.precision,
  );
  assertCategoryPair(input.category, input.subcategory);
  assertBgcUse(assetCode, input.subcategory);
  const tournamentId = optionalTrimmed(input.tournamentId);
  const suppliedBinding = context.tournamentCampaignBinding;
  let binding: TournamentCampaignBinding | null = null;
  if (suppliedBinding !== null) {
    const boundTournamentId = requiredTrimmed(
      suppliedBinding.tournamentId,
      "Bound tournament ID",
    );
    if (tournamentId === null || boundTournamentId !== tournamentId)
      throw new Error(
        "Tournament campaign binding does not match the manual entry.",
      );
    const ownerAcknowledgedAt = canonicalTimestamp(
      suppliedBinding.ownerAcknowledgedAt,
      "Tournament owner acknowledgement",
    );
    if (Date.parse(ownerAcknowledgedAt) > Date.parse(serverNow))
      throw new Error(
        "Tournament owner acknowledgement cannot be in the future.",
      );
    binding = {
      tournamentId: boundTournamentId,
      evidenceId: requiredTrimmed(
        suppliedBinding.evidenceId,
        "Tournament campaign evidence ID",
      ),
      configurationVersion: requiredTrimmed(
        suppliedBinding.configurationVersion,
        "Tournament configuration version",
      ),
      ownerAcknowledgedAt,
    };
  }
  const tournamentAggregationEligible =
    tournamentId === null || binding !== null;
  const coreIds = normalizeCoreIds(input.coreIds);
  if (input.subcategory === "manual_tournament_payout" && tournamentId === null)
    throw new Error("A manual tournament payout requires a tournament.");
  if (
    input.subcategory === "burn_bgc_credit" &&
    (assetCode !== "BGC" || coreIds.length !== 1)
  )
    throw new Error(
      "A burn BGC credit requires BGC and exactly one linked core.",
    );
  const warnings: ManualLedgerWarning[] = [];
  if (input.subcategory === "core_sale" && input.costBasisStatus !== "known")
    warnings.push("CORE_SALE_COST_BASIS_MISSING");
  if (input.subcategory === "manual_tournament_payout" && coreIds.length === 0)
    warnings.push("UNALLOCATED_TOURNAMENT_PAYOUT");
  if (tournamentId !== null && binding === null)
    warnings.push("TOURNAMENT_CAMPAIGN_BINDING_REQUIRED");
  const postings = buildPostings({
    entryId,
    category: input.category,
    subcategory: input.subcategory,
    amount,
    direction: input.direction,
    assetCode,
    assetKind: context.assetDefinition.kind,
    accountLabel: optionalTrimmed(input.accountLabel),
    fromAccountLabel: optionalTrimmed(input.fromAccountLabel),
    toAccountLabel: optionalTrimmed(input.toAccountLabel),
    tournamentAggregationEligible,
  });
  return {
    entryId,
    occurredAt,
    assetCode,
    assetKind: context.assetDefinition.kind,
    assetRegistryVersion,
    assetPrecision: context.assetDefinition.precision,
    amount,
    category: input.category,
    subcategory: input.subcategory,
    tournamentId,
    tournamentCampaignBinding: binding,
    tournamentAggregationEligible,
    coreIds,
    externalReference: optionalTrimmed(input.externalReference),
    note: optionalTrimmed(input.note),
    postings,
    warnings,
    completeness: warnings.length === 0 ? "complete" : "partial",
  };
}
