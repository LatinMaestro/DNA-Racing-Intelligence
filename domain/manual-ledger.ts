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

export type ManualLedgerWarning =
  "CORE_SALE_COST_BASIS_MISSING" | "UNALLOCATED_TOURNAMENT_PAYOUT";

export type ManualLedgerPosting = {
  postingId: string;
  accountLabel: string;
  assetCode: string;
  assetKind: AssetKind;
  signedAmount: string;
  category: ManualLedgerCategory;
  subcategory: ManualLedgerSubcategory;
  operating: boolean;
};

export type ValidatedManualLedgerEntry = {
  entryId: string;
  occurredAt: string;
  assetCode: string;
  assetKind: AssetKind;
  amount: string;
  category: ManualLedgerCategory;
  subcategory: ManualLedgerSubcategory;
  tournamentId: string | null;
  coreIds: readonly string[];
  externalReference: string | null;
  note: string | null;
  postings: readonly ManualLedgerPosting[];
  warnings: readonly ManualLedgerWarning[];
  completeness: "complete" | "partial";
};

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

function validateAmount(value: string): string {
  let normalized: string;
  try {
    normalized = normalizeExactDecimal(value);
  } catch {
    throw new Error("Manual amount must be a plain base-10 decimal.");
  }
  if (isNegativeExactDecimal(normalized) || isZeroExactDecimal(normalized)) {
    throw new Error("Manual amount must be greater than zero.");
  }
  return normalized;
}

function validateAsset(code: string, kind: AssetKind): string {
  const normalized = code.trim().toUpperCase();
  if (!assetKinds.includes(kind) || !assetCodePattern.test(normalized)) {
    throw new Error("Manual asset identity is invalid.");
  }
  if (
    (normalized === "BGC" && kind !== "game_credit") ||
    (normalized !== "BGC" && kind === "game_credit")
  ) {
    throw new Error("BGC must remain the separate game-credit asset.");
  }
  return normalized;
}

function assertCategoryPair(
  category: ManualLedgerCategory,
  subcategory: ManualLedgerSubcategory,
): void {
  if (
    !manualLedgerCategories.includes(category) ||
    !manualLedgerSubcategories.includes(subcategory) ||
    !allowedSubcategories[category].includes(subcategory)
  ) {
    throw new Error("Manual category and subcategory are incompatible.");
  }
}

function assertBgcUse(
  assetCode: string,
  subcategory: ManualLedgerSubcategory,
): void {
  if (
    ["arena_fee_bgc", "burn_bgc_credit"].includes(subcategory) &&
    assetCode !== "BGC"
  ) {
    throw new Error(`${subcategory} requires the BGC game-credit asset.`);
  }
  if (assetCode !== "BGC") return;
  if (
    ![
      "arena_fee_bgc",
      "burn_bgc_credit",
      "opening_balance",
      "adjustment",
    ].includes(subcategory)
  ) {
    throw new Error("BGC is limited to its separate in-game-credit ledger.");
  }
}

function normalizeCoreIds(coreIds: readonly string[] | undefined): string[] {
  const normalized = (coreIds ?? []).map((coreId) =>
    requiredTrimmed(coreId, "Core ID"),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Manual entry core IDs must be unique.");
  }
  return normalized.sort((left, right) => left.localeCompare(right));
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
    if (direction !== expected) {
      throw new Error(`Manual ${category} direction must be ${expected}.`);
    }
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
}): ManualLedgerPosting[] {
  if (input.category === "transfer") {
    const from = requiredTrimmed(
      input.fromAccountLabel,
      "Transfer source account",
    );
    const to = requiredTrimmed(
      input.toAccountLabel,
      "Transfer destination account",
    );
    if (from === to) {
      throw new Error("Transfer accounts must be different.");
    }
    return [
      {
        postingId: `${input.entryId}:from`,
        accountLabel: from,
        assetCode: input.assetCode,
        assetKind: input.assetKind,
        signedAmount: negateExactDecimal(input.amount),
        category: input.category,
        subcategory: input.subcategory,
        operating: false,
      },
      {
        postingId: `${input.entryId}:to`,
        accountLabel: to,
        assetCode: input.assetCode,
        assetKind: input.assetKind,
        signedAmount: input.amount,
        category: input.category,
        subcategory: input.subcategory,
        operating: false,
      },
    ];
  }

  const accountLabel = requiredTrimmed(
    input.accountLabel,
    "Manual entry account",
  );
  return [
    {
      postingId: `${input.entryId}:primary`,
      accountLabel,
      assetCode: input.assetCode,
      assetKind: input.assetKind,
      signedAmount: signedAmount(input.category, input.amount, input.direction),
      category: input.category,
      subcategory: input.subcategory,
      operating: operatingCategories.has(input.category),
    },
  ];
}

export function validateManualLedgerEntry(
  input: ManualLedgerEntryInput,
): ValidatedManualLedgerEntry {
  const entryId = requiredTrimmed(input.entryId, "Manual entry ID");
  const occurredAt = requiredTrimmed(input.occurredAt, "Occurred at");
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new Error("Occurred at must be a valid timestamp.");
  }
  const assetCode = validateAsset(input.assetCode, input.assetKind);
  const amount = validateAmount(input.amount);
  assertCategoryPair(input.category, input.subcategory);
  assertBgcUse(assetCode, input.subcategory);

  const tournamentId = optionalTrimmed(input.tournamentId);
  const coreIds = normalizeCoreIds(input.coreIds);
  const externalReference = optionalTrimmed(input.externalReference);
  const note = optionalTrimmed(input.note);
  if (
    input.subcategory === "manual_tournament_payout" &&
    tournamentId === null
  ) {
    throw new Error("A manual tournament payout requires a tournament.");
  }
  if (
    input.subcategory === "burn_bgc_credit" &&
    (assetCode !== "BGC" || coreIds.length !== 1)
  ) {
    throw new Error(
      "A burn BGC credit requires BGC and exactly one linked core.",
    );
  }

  const warnings: ManualLedgerWarning[] = [];
  if (input.subcategory === "core_sale" && input.costBasisStatus !== "known") {
    warnings.push("CORE_SALE_COST_BASIS_MISSING");
  }
  if (
    input.subcategory === "manual_tournament_payout" &&
    coreIds.length === 0
  ) {
    warnings.push("UNALLOCATED_TOURNAMENT_PAYOUT");
  }

  const postings = buildPostings({
    entryId,
    category: input.category,
    subcategory: input.subcategory,
    amount,
    direction: input.direction,
    assetCode,
    assetKind: input.assetKind,
    accountLabel: optionalTrimmed(input.accountLabel),
    fromAccountLabel: optionalTrimmed(input.fromAccountLabel),
    toAccountLabel: optionalTrimmed(input.toAccountLabel),
  });

  return {
    entryId,
    occurredAt,
    assetCode,
    assetKind: input.assetKind,
    amount,
    category: input.category,
    subcategory: input.subcategory,
    tournamentId,
    coreIds,
    externalReference,
    note,
    postings,
    warnings,
    completeness: warnings.length === 0 ? "complete" : "partial",
  };
}
