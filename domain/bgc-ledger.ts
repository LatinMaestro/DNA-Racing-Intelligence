import { normalizeExactDecimal } from "@/domain/exact-decimal";

export const bgcLedgerCategories = [
  "opening_balance",
  "burn_credit",
  "arena_fee_spend",
  "adjustment",
  "internal_transfer",
] as const;
export type BgcLedgerCategory = (typeof bgcLedgerCategories)[number];

export type BgcLedgerRecordInput = {
  recordId: string;
  transactionId: string;
  occurredAt: string;
  accountLabel: string;
  signedAmount: string;
  category: BgcLedgerCategory;
  aggregateStatus: "included" | "excluded";
  reconciliationStatus: "reconciled" | "review_required";
};

export type BgcLedgerCoverageInput = {
  periodStart: string;
  periodEnd: string;
  sourceCoverage: "complete_recorded_period" | "partial" | "unknown";
  openingBalanceCoverage: "complete" | "partial" | "missing";
  dataCurrentThrough: string | null;
  lastImported: string | null;
};

export type BgcAccountMovement = {
  accountLabel: string;
  openingBalance: string;
  earned: string;
  spent: string;
  adjustments: string;
  internalTransferNet: string;
  netMovement: string;
  derivedBalance: string | null;
};

export type BgcLedgerWarning =
  | "SOURCE_COVERAGE_INCOMPLETE"
  | "OPENING_BALANCE_INCOMPLETE"
  | "UNRESOLVED_RECONCILIATION"
  | "DATA_CUTOFF_UNKNOWN";

export type BgcLedgerSummary = {
  assetCode: "BGC";
  assetKind: "game_credit";
  periodStart: string;
  periodEnd: string;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  status: "complete_recorded_period" | "partial";
  openingBalance: string;
  earned: string;
  spent: string;
  adjustments: string;
  netMovement: string;
  derivedBalance: string | null;
  accounts: readonly BgcAccountMovement[];
  includedMovementCount: number;
  excludedMovementCount: number;
  transferPostingCount: number;
  warnings: readonly BgcLedgerWarning[];
  referenceUsdPerBgc: "1";
  separateReferenceUsdEquivalent: string | null;
  includedInCashCryptoProfit: false;
};

type ParsedDecimal = {
  negative: boolean;
  digits: bigint;
  scale: number;
};

type NormalizedRecord = Omit<
  BgcLedgerRecordInput,
  "occurredAt" | "signedAmount" | "accountLabel"
> & {
  occurredAt: string;
  signedAmount: string;
  accountLabel: string;
};

type MutableAccount = Omit<BgcAccountMovement, "derivedBalance">;

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

function normalizeRecord(input: BgcLedgerRecordInput): NormalizedRecord {
  if (!bgcLedgerCategories.includes(input.category)) {
    throw new Error("BGC ledger category is invalid.");
  }
  if (!["included", "excluded"].includes(input.aggregateStatus)) {
    throw new Error("BGC aggregate status is invalid.");
  }
  if (!["reconciled", "review_required"].includes(input.reconciliationStatus)) {
    throw new Error("BGC reconciliation status is invalid.");
  }
  const signedAmount = normalizeExactDecimal(input.signedAmount);
  if (input.category !== "opening_balance" && signedAmount === "0") {
    throw new Error("BGC movement records cannot use a zero amount.");
  }
  if (
    (input.category === "burn_credit" && signedAmount.startsWith("-")) ||
    (input.category === "arena_fee_spend" && !signedAmount.startsWith("-"))
  ) {
    throw new Error("BGC category direction is invalid.");
  }
  if (input.category === "opening_balance" && signedAmount.startsWith("-")) {
    throw new Error("BGC opening balance cannot be negative.");
  }
  return {
    ...input,
    recordId: requiredTrimmed(input.recordId, "BGC record ID"),
    transactionId: requiredTrimmed(input.transactionId, "BGC transaction ID"),
    occurredAt: normalizeTimestamp(input.occurredAt, "BGC occurred at"),
    accountLabel: requiredTrimmed(input.accountLabel, "BGC account label"),
    signedAmount,
  };
}

function emptyAccount(accountLabel: string): MutableAccount {
  return {
    accountLabel,
    openingBalance: "0",
    earned: "0",
    spent: "0",
    adjustments: "0",
    internalTransferNet: "0",
    netMovement: "0",
  };
}

function sumAccounts(
  accounts: readonly MutableAccount[],
  field: keyof Pick<
    MutableAccount,
    "openingBalance" | "earned" | "spent" | "adjustments" | "netMovement"
  >,
): string {
  return accounts.reduce((sum, account) => addExact(sum, account[field]), "0");
}

export function buildBgcLedgerSummary(
  recordInputs: readonly BgcLedgerRecordInput[],
  coverageInput: BgcLedgerCoverageInput,
): BgcLedgerSummary {
  const periodStart = normalizeTimestamp(
    coverageInput.periodStart,
    "BGC period start",
  );
  const periodEnd = normalizeTimestamp(
    coverageInput.periodEnd,
    "BGC period end",
  );
  if (periodStart > periodEnd) {
    throw new Error("BGC period start must not be after its end.");
  }
  if (
    !["complete_recorded_period", "partial", "unknown"].includes(
      coverageInput.sourceCoverage,
    )
  ) {
    throw new Error("BGC source coverage is invalid.");
  }
  if (
    !["complete", "partial", "missing"].includes(
      coverageInput.openingBalanceCoverage,
    )
  ) {
    throw new Error("BGC opening-balance coverage is invalid.");
  }

  const records = recordInputs.map(normalizeRecord);
  if (
    new Set(records.map((record) => record.recordId)).size !== records.length
  ) {
    throw new Error("BGC record IDs must be unique.");
  }

  const includedOpenings = records.filter(
    (record) =>
      record.aggregateStatus === "included" &&
      record.category === "opening_balance" &&
      record.occurredAt <= periodStart,
  );
  const openingAccounts = new Set<string>();
  for (const record of includedOpenings) {
    if (openingAccounts.has(record.accountLabel)) {
      throw new Error("BGC accounts can have only one active opening balance.");
    }
    openingAccounts.add(record.accountLabel);
  }

  const periodRecords = records.filter(
    (record) =>
      record.category !== "opening_balance" &&
      record.occurredAt >= periodStart &&
      record.occurredAt <= periodEnd,
  );
  const included = periodRecords.filter(
    (record) => record.aggregateStatus === "included",
  );
  const movementAccountLabels = new Set(
    included.map((record) => record.accountLabel),
  );
  const openingCoverageSupported =
    coverageInput.openingBalanceCoverage === "complete" &&
    [...movementAccountLabels].every((accountLabel) =>
      openingAccounts.has(accountLabel),
    ) &&
    (movementAccountLabels.size > 0 || includedOpenings.length > 0);

  const transferGroups = new Map<string, NormalizedRecord[]>();
  for (const record of included) {
    if (record.category !== "internal_transfer") continue;
    const group = transferGroups.get(record.transactionId) ?? [];
    group.push(record);
    transferGroups.set(record.transactionId, group);
  }
  for (const postings of transferGroups.values()) {
    if (
      postings.length !== 2 ||
      new Set(postings.map((posting) => posting.accountLabel)).size !== 2 ||
      postings.reduce(
        (sum, posting) => addExact(sum, posting.signedAmount),
        "0",
      ) !== "0"
    ) {
      throw new Error(
        "BGC internal transfers require two distinct balanced account postings.",
      );
    }
  }

  const accounts = new Map<string, MutableAccount>();
  const getAccount = (accountLabel: string): MutableAccount => {
    const account = accounts.get(accountLabel) ?? emptyAccount(accountLabel);
    accounts.set(accountLabel, account);
    return account;
  };

  for (const record of includedOpenings) {
    getAccount(record.accountLabel).openingBalance = record.signedAmount;
  }
  for (const record of included) {
    const account = getAccount(record.accountLabel);
    switch (record.category) {
      case "burn_credit":
        account.earned = addExact(account.earned, record.signedAmount);
        account.netMovement = addExact(
          account.netMovement,
          record.signedAmount,
        );
        break;
      case "arena_fee_spend":
        account.spent = addExact(account.spent, absolute(record.signedAmount));
        account.netMovement = addExact(
          account.netMovement,
          record.signedAmount,
        );
        break;
      case "adjustment":
        account.adjustments = addExact(
          account.adjustments,
          record.signedAmount,
        );
        account.netMovement = addExact(
          account.netMovement,
          record.signedAmount,
        );
        break;
      case "internal_transfer":
        account.internalTransferNet = addExact(
          account.internalTransferNet,
          record.signedAmount,
        );
        break;
      case "opening_balance":
        break;
    }
  }

  const warnings = new Set<BgcLedgerWarning>();
  if (coverageInput.sourceCoverage !== "complete_recorded_period") {
    warnings.add("SOURCE_COVERAGE_INCOMPLETE");
  }
  if (!openingCoverageSupported) {
    warnings.add("OPENING_BALANCE_INCOMPLETE");
  }
  if (
    included.some(
      (record) => record.reconciliationStatus === "review_required",
    ) ||
    includedOpenings.some(
      (record) => record.reconciliationStatus === "review_required",
    )
  ) {
    warnings.add("UNRESOLVED_RECONCILIATION");
  }
  const dataCurrentThrough = optionalTimestamp(
    coverageInput.dataCurrentThrough,
    "Data current through",
  );
  if (dataCurrentThrough === null) warnings.add("DATA_CUTOFF_UNKNOWN");

  const balanceAvailable =
    coverageInput.sourceCoverage === "complete_recorded_period" &&
    openingCoverageSupported &&
    !warnings.has("UNRESOLVED_RECONCILIATION") &&
    dataCurrentThrough !== null;

  const accountResults = [...accounts.values()]
    .sort((left, right) => left.accountLabel.localeCompare(right.accountLabel))
    .map<BgcAccountMovement>((account) => ({
      ...account,
      derivedBalance: balanceAvailable
        ? addExact(
            addExact(account.openingBalance, account.netMovement),
            account.internalTransferNet,
          )
        : null,
    }));
  const openingBalance = sumAccounts(accountResults, "openingBalance");
  const earned = sumAccounts(accountResults, "earned");
  const spent = sumAccounts(accountResults, "spent");
  const adjustments = sumAccounts(accountResults, "adjustments");
  const netMovement = sumAccounts(accountResults, "netMovement");
  const derivedBalance = balanceAvailable
    ? addExact(openingBalance, netMovement)
    : null;

  return {
    assetCode: "BGC",
    assetKind: "game_credit",
    periodStart,
    periodEnd,
    dataCurrentThrough,
    lastImported: optionalTimestamp(
      coverageInput.lastImported,
      "Last imported",
    ),
    status: balanceAvailable ? "complete_recorded_period" : "partial",
    openingBalance,
    earned,
    spent,
    adjustments,
    netMovement,
    derivedBalance,
    accounts: accountResults,
    includedMovementCount: included.filter(
      (record) => record.category !== "internal_transfer",
    ).length,
    excludedMovementCount:
      periodRecords.filter((record) => record.category !== "internal_transfer")
        .length -
      included.filter((record) => record.category !== "internal_transfer")
        .length,
    transferPostingCount: included.filter(
      (record) => record.category === "internal_transfer",
    ).length,
    warnings: [...warnings],
    referenceUsdPerBgc: "1",
    separateReferenceUsdEquivalent: derivedBalance,
    includedInCashCryptoProfit: false,
  };
}
