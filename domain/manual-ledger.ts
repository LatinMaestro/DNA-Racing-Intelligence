import {
  isNegativeExactDecimal,
  isZeroExactDecimal,
  negateExactDecimal,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";

export type ManualLedgerEntryInput = {
  entryId: string;
  occurredAt: string;
  assetCode: string;
  assetKind: "crypto" | "fiat" | "game_credit";
  amount: string;
  category:
    | "income"
    | "expense"
    | "deposit"
    | "withdrawal"
    | "transfer"
    | "opening_balance"
    | "adjustment";
  subcategory: string;
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

export type ManualLedgerPosting = {
  postingId: string;
  accountLabel: string;
  assetCode: string;
  assetKind: "crypto" | "fiat" | "game_credit";
  signedAmount: string;
  category: ManualLedgerEntryInput["category"];
  subcategory: string;
  operating: boolean;
};

export type ValidatedManualLedgerEntry = {
  entryId: string;
  occurredAt: string;
  assetCode: string;
  assetKind: ManualLedgerEntryInput["assetKind"];
  amount: string;
  category: ManualLedgerEntryInput["category"];
  subcategory: string;
  tournamentId: string | null;
  coreIds: readonly string[];
  externalReference: string | null;
  costBasisStatus: ManualLedgerEntryInput["costBasisStatus"] | null;
  note: string | null;
  postings: readonly ManualLedgerPosting[];
  warnings: readonly string[];
  completeness: "complete" | "partial";
};

const assetKinds = ["crypto", "fiat", "game_credit"] as const;
const categories = [
  "income",
  "expense",
  "deposit",
  "withdrawal",
  "transfer",
  "opening_balance",
  "adjustment",
] as const;
const directions = ["credit", "debit"] as const;
const costBasisStatuses = ["known", "missing", "not_applicable"] as const;
const assetCodePattern = /^[A-Z][A-Z0-9_]{1,15}$/;
const subcategoryPattern = /^[a-z][a-z0-9_]{1,63}$/;

function required(value: string | null | undefined, label: string): string {
  const normalized = value?.trim() ?? "";
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function optional(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function exactPositiveAmount(value: string): string {
  let normalized: string;
  try {
    normalized = normalizeExactDecimal(value);
  } catch {
    throw new Error("Manual amount must be a plain base-10 decimal.");
  }
  if (isNegativeExactDecimal(normalized) || isZeroExactDecimal(normalized)) {
    throw new Error("Manual amount must be positive.");
  }
  return normalized;
}

function normalizedTimestamp(value: string): string {
  const parsed = Date.parse(required(value, "Manual ledger timestamp"));
  if (Number.isNaN(parsed)) {
    throw new Error("Manual ledger timestamp is invalid.");
  }
  return new Date(parsed).toISOString();
}

function normalizedCoreIds(coreIds: readonly string[] | undefined): string[] {
  const normalized = (coreIds ?? []).map((coreId) =>
    required(coreId, "Core ID"),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Manual ledger core IDs must be unique.");
  }
  return normalized.sort();
}

function singlePosting(input: {
  entryId: string;
  accountLabel: string;
  assetCode: string;
  assetKind: ManualLedgerEntryInput["assetKind"];
  amount: string;
  category: ManualLedgerEntryInput["category"];
  subcategory: string;
  direction: "credit" | "debit";
}): ManualLedgerPosting {
  return {
    postingId: `${input.entryId}:primary`,
    accountLabel: input.accountLabel,
    assetCode: input.assetCode,
    assetKind: input.assetKind,
    signedAmount:
      input.direction === "debit"
        ? negateExactDecimal(input.amount)
        : input.amount,
    category: input.category,
    subcategory: input.subcategory,
    operating: input.category === "income" || input.category === "expense",
  };
}

export function validateManualLedgerEntry(
  input: ManualLedgerEntryInput,
): ValidatedManualLedgerEntry {
  if (!assetKinds.includes(input.assetKind)) {
    throw new Error("Manual ledger asset kind is invalid.");
  }
  if (!categories.includes(input.category)) {
    throw new Error("Manual ledger category is invalid.");
  }
  if (input.direction !== undefined && !directions.includes(input.direction)) {
    throw new Error("Manual ledger direction is invalid.");
  }
  if (
    input.costBasisStatus !== undefined &&
    !costBasisStatuses.includes(input.costBasisStatus)
  ) {
    throw new Error("Manual ledger cost-basis status is invalid.");
  }

  const entryId = required(input.entryId, "Manual ledger entry ID");
  const occurredAt = normalizedTimestamp(input.occurredAt);
  const assetCode = required(input.assetCode, "Asset code").toUpperCase();
  if (!assetCodePattern.test(assetCode)) {
    throw new Error("Manual ledger asset code is invalid.");
  }
  if (
    (assetCode === "BGC" && input.assetKind !== "game_credit") ||
    (assetCode !== "BGC" && input.assetKind === "game_credit")
  ) {
    throw new Error("Manual ledger BGC asset evidence is invalid.");
  }
  const amount = exactPositiveAmount(input.amount);
  const subcategory = required(input.subcategory, "Manual ledger subcategory");
  if (!subcategoryPattern.test(subcategory)) {
    throw new Error("Manual ledger subcategory is invalid.");
  }

  const accountLabel = optional(input.accountLabel);
  const fromAccountLabel = optional(input.fromAccountLabel);
  const toAccountLabel = optional(input.toAccountLabel);
  let postings: readonly ManualLedgerPosting[];

  if (input.category === "transfer") {
    if (input.direction !== undefined || accountLabel !== null) {
      throw new Error(
        "Internal transfer cannot contain a single posting direction or account.",
      );
    }
    const from = required(fromAccountLabel, "Transfer source account");
    const to = required(toAccountLabel, "Transfer destination account");
    if (from === to) {
      throw new Error("Transfer accounts must be distinct.");
    }
    postings = [
      {
        postingId: `${entryId}:from`,
        accountLabel: from,
        assetCode,
        assetKind: input.assetKind,
        signedAmount: negateExactDecimal(amount),
        category: input.category,
        subcategory,
        operating: false,
      },
      {
        postingId: `${entryId}:to`,
        accountLabel: to,
        assetCode,
        assetKind: input.assetKind,
        signedAmount: amount,
        category: input.category,
        subcategory,
        operating: false,
      },
    ];
  } else {
    if (fromAccountLabel !== null || toAccountLabel !== null) {
      throw new Error(
        "Non-transfer evidence cannot contain transfer account fields.",
      );
    }
    const account = required(accountLabel, "Account label");
    let direction: "credit" | "debit";
    if (input.category === "adjustment") {
      direction = required(input.direction, "Adjustment direction") as
        "credit" | "debit";
      if (!directions.includes(direction)) {
        throw new Error("Adjustment direction is invalid.");
      }
    } else {
      direction =
        input.category === "expense" || input.category === "withdrawal"
          ? "debit"
          : "credit";
      if (input.direction !== undefined && input.direction !== direction) {
        throw new Error("Posting direction conflicts with ledger category.");
      }
    }
    postings = [
      singlePosting({
        entryId,
        accountLabel: account,
        assetCode,
        assetKind: input.assetKind,
        amount,
        category: input.category,
        subcategory,
        direction,
      }),
    ];
  }

  const costBasisWarning =
    subcategory === "core_sale_proceeds" && input.costBasisStatus !== "known";
  const warnings = costBasisWarning ? ["missing_cost_basis"] : [];

  return {
    entryId,
    occurredAt,
    assetCode,
    assetKind: input.assetKind,
    amount,
    category: input.category,
    subcategory,
    tournamentId: optional(input.tournamentId),
    coreIds: normalizedCoreIds(input.coreIds),
    externalReference: optional(input.externalReference),
    costBasisStatus: input.costBasisStatus ?? null,
    note: optional(input.note),
    postings,
    warnings,
    completeness: costBasisWarning ? "partial" : "complete",
  };
}
