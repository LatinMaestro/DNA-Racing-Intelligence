const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type EconomicAuditRecord = {
  transactionId: string;
  assetCode: string;
  assetKind: "cash" | "crypto" | "game_credit";
  signedAmount: string;
  category:
    | "operating"
    | "deposit"
    | "withdrawal"
    | "transfer"
    | "opening_balance"
    | "reconciliation";
  sourceType:
    | "race_import"
    | "manual_entry"
    | "manual_tournament_payout"
    | "authoritative_export"
    | "reversal";
  aggregateStatus: "included" | "excluded" | "review";
  duplicateOfTransactionId: string | null;
  tournamentId: string | null;
  coreSale: boolean;
  acquisitionCostKnown: boolean;
};

export type EconomicReportedTotal = {
  assetCode: string;
  assetKind: "cash" | "crypto" | "game_credit";
  operatingIncome: string;
  operatingExpense: string;
  operatingNet: string;
};

export type EconomicReconciliationAuditInput = {
  records: readonly EconomicAuditRecord[];
  reportedTotals: readonly EconomicReportedTotal[];
  combinedAssetTotalClaimed: boolean;
  bgcIncludedInCashCryptoClaimed: boolean;
  reportStatusClaimed: "complete" | "partial" | "estimated";
  unclassifiedCount: number;
  unresolvedReconciliationCount: number;
  conversionUsed: boolean;
  conversionCoverage: "not_requested" | "complete" | "partial";
  manualExternalPayoutCoverage:
    "confirmed_complete" | "confirmed_none" | "unknown";
};

export type EconomicReconciliationIssue = {
  code:
    | "REPORTED_TOTAL_MISMATCH"
    | "NON_OPERATING_INCLUDED"
    | "BGC_MIXED_WITH_CASH_CRYPTO"
    | "COMBINED_ASSET_TOTAL"
    | "DUPLICATE_LINK_INVALID"
    | "MANUAL_PAYOUT_UNLINKED"
    | "CORE_SALE_COST_BASIS_MISSING"
    | "UNRESOLVED_RECORD_INCLUDED"
    | "COMPLETE_STATUS_UNSUPPORTED"
    | "CONVERSION_COVERAGE_INCONSISTENT";
  severity: "review" | "block";
  transactionId: string | null;
  assetCode: string | null;
};

export type EconomicReconciliationAudit = {
  status: "reconciled_contract" | "review_required" | "blocked";
  calculatedTotals: readonly EconomicReportedTotal[];
  issues: readonly EconomicReconciliationIssue[];
  dependableTotalsEstablished: false;
  gateCStatus: "not_assessed";
  automaticLedgerMutationAllowed: false;
};

type Decimal = { negative: boolean; digits: bigint; scale: number };

function parseDecimal(value: string, label: string): Decimal {
  const trimmed = value.trim();
  if (!decimalPattern.test(trimmed)) {
    throw new Error(`${label} must be a plain base-10 decimal.`);
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  return {
    negative,
    digits: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function formatDecimal(value: Decimal): string {
  if (value.digits === 0n) return "0";
  const raw = value.digits.toString().padStart(value.scale + 1, "0");
  const whole =
    value.scale === 0
      ? raw
      : raw.slice(0, Math.max(1, raw.length - value.scale));
  const fraction =
    value.scale === 0
      ? ""
      : raw.slice(raw.length - value.scale).replace(/0+$/, "");
  const unsigned = fraction ? `${whole}.${fraction}` : whole;
  return value.negative ? `-${unsigned}` : unsigned;
}

function addDecimals(left: string, right: string): string {
  const parsedLeft = parseDecimal(left, "Left amount");
  const parsedRight = parseDecimal(right, "Right amount");
  const scale = Math.max(parsedLeft.scale, parsedRight.scale);
  const leftSigned =
    (parsedLeft.negative ? -1n : 1n) *
    parsedLeft.digits *
    10n ** BigInt(scale - parsedLeft.scale);
  const rightSigned =
    (parsedRight.negative ? -1n : 1n) *
    parsedRight.digits *
    10n ** BigInt(scale - parsedRight.scale);
  const total = leftSigned + rightSigned;
  return formatDecimal({
    negative: total < 0n,
    digits: total < 0n ? -total : total,
    scale,
  });
}

function normalizeDecimal(value: string, label: string): string {
  return formatDecimal(parseDecimal(value, label));
}

function issue(
  code: EconomicReconciliationIssue["code"],
  severity: EconomicReconciliationIssue["severity"],
  transactionId: string | null = null,
  assetCode: string | null = null,
): EconomicReconciliationIssue {
  return { code, severity, transactionId, assetCode };
}

function assertRecord(record: EconomicAuditRecord): void {
  if (
    record.transactionId.trim() === "" ||
    !/^[A-Z][A-Z0-9_]{1,15}$/.test(record.assetCode) ||
    !["cash", "crypto", "game_credit"].includes(record.assetKind) ||
    ![
      "operating",
      "deposit",
      "withdrawal",
      "transfer",
      "opening_balance",
      "reconciliation",
    ].includes(record.category) ||
    !["included", "excluded", "review"].includes(record.aggregateStatus)
  ) {
    throw new Error("Economic audit record is invalid.");
  }
  parseDecimal(record.signedAmount, "Economic record amount");
}

export function auditEconomicReconciliation(
  input: EconomicReconciliationAuditInput,
): EconomicReconciliationAudit {
  if (
    !Number.isSafeInteger(input.unclassifiedCount) ||
    input.unclassifiedCount < 0 ||
    !Number.isSafeInteger(input.unresolvedReconciliationCount) ||
    input.unresolvedReconciliationCount < 0
  ) {
    throw new Error("Economic audit counts must be non-negative integers.");
  }
  for (const record of input.records) assertRecord(record);
  const transactionIds = input.records.map((record) => record.transactionId);
  if (new Set(transactionIds).size !== transactionIds.length) {
    throw new Error("Economic audit transaction IDs must be unique.");
  }
  const byId = new Map(
    input.records.map((record) => [record.transactionId, record]),
  );
  const issues: EconomicReconciliationIssue[] = [];

  const totals = new Map<
    string,
    {
      assetCode: string;
      assetKind: EconomicAuditRecord["assetKind"];
      operatingIncome: string;
      operatingExpense: string;
    }
  >();

  for (const record of input.records) {
    if (record.duplicateOfTransactionId !== null) {
      const survivor = byId.get(record.duplicateOfTransactionId);
      const duplicateLinkValid =
        survivor !== undefined &&
        survivor.transactionId !== record.transactionId &&
        record.aggregateStatus === "excluded" &&
        survivor.assetCode === record.assetCode &&
        survivor.assetKind === record.assetKind &&
        normalizeDecimal(survivor.signedAmount, "Duplicate survivor amount") ===
          normalizeDecimal(record.signedAmount, "Duplicate amount");
      if (!duplicateLinkValid) {
        issues.push(
          issue("DUPLICATE_LINK_INVALID", "block", record.transactionId),
        );
      }
    }
    if (
      record.sourceType === "manual_tournament_payout" &&
      record.tournamentId === null
    ) {
      issues.push(
        issue("MANUAL_PAYOUT_UNLINKED", "review", record.transactionId),
      );
    }
    if (record.coreSale && !record.acquisitionCostKnown) {
      issues.push(
        issue("CORE_SALE_COST_BASIS_MISSING", "review", record.transactionId),
      );
    }
    if (record.aggregateStatus === "review") {
      issues.push(
        issue("UNRESOLVED_RECORD_INCLUDED", "review", record.transactionId),
      );
    }
    if (record.aggregateStatus !== "included") continue;
    if (record.category !== "operating") {
      issues.push(
        issue("NON_OPERATING_INCLUDED", "block", record.transactionId),
      );
      continue;
    }

    const key = JSON.stringify([record.assetCode, record.assetKind]);
    const current = totals.get(key) ?? {
      assetCode: record.assetCode,
      assetKind: record.assetKind,
      operatingIncome: "0",
      operatingExpense: "0",
    };
    const amount = normalizeDecimal(
      record.signedAmount,
      "Economic record amount",
    );
    if (amount.startsWith("-")) {
      current.operatingExpense = addDecimals(
        current.operatingExpense,
        amount.slice(1),
      );
    } else {
      current.operatingIncome = addDecimals(current.operatingIncome, amount);
    }
    totals.set(key, current);
  }

  const calculatedTotals = [...totals.values()]
    .map((total) => ({
      ...total,
      operatingNet: addDecimals(
        total.operatingIncome,
        total.operatingExpense === "0" ? "0" : `-${total.operatingExpense}`,
      ),
    }))
    .sort(
      (left, right) =>
        left.assetCode.localeCompare(right.assetCode) ||
        left.assetKind.localeCompare(right.assetKind),
    );

  const reportedKeys = new Set<string>();
  for (const reported of input.reportedTotals) {
    const key = JSON.stringify([reported.assetCode, reported.assetKind]);
    if (reportedKeys.has(key)) {
      throw new Error("Reported economic totals must be unique by asset.");
    }
    reportedKeys.add(key);
    const calculated = calculatedTotals.find(
      (total) =>
        total.assetCode === reported.assetCode &&
        total.assetKind === reported.assetKind,
    );
    const matches =
      calculated !== undefined &&
      calculated.operatingIncome ===
        normalizeDecimal(reported.operatingIncome, "Reported income") &&
      calculated.operatingExpense ===
        normalizeDecimal(reported.operatingExpense, "Reported expense") &&
      calculated.operatingNet ===
        normalizeDecimal(reported.operatingNet, "Reported net");
    if (!matches) {
      issues.push(
        issue("REPORTED_TOTAL_MISMATCH", "block", null, reported.assetCode),
      );
    }
  }
  for (const calculated of calculatedTotals) {
    const key = JSON.stringify([calculated.assetCode, calculated.assetKind]);
    if (!reportedKeys.has(key)) {
      issues.push(
        issue("REPORTED_TOTAL_MISMATCH", "block", null, calculated.assetCode),
      );
    }
  }

  if (input.bgcIncludedInCashCryptoClaimed) {
    issues.push(issue("BGC_MIXED_WITH_CASH_CRYPTO", "block"));
  }
  if (input.combinedAssetTotalClaimed && calculatedTotals.length > 1) {
    issues.push(issue("COMBINED_ASSET_TOTAL", "block"));
  }
  if (
    (input.conversionUsed && input.conversionCoverage === "not_requested") ||
    (!input.conversionUsed && input.conversionCoverage !== "not_requested")
  ) {
    issues.push(issue("CONVERSION_COVERAGE_INCONSISTENT", "block"));
  }

  const completeUnsupported =
    input.reportStatusClaimed === "complete" &&
    (input.unclassifiedCount > 0 ||
      input.unresolvedReconciliationCount > 0 ||
      input.manualExternalPayoutCoverage === "unknown" ||
      input.conversionCoverage === "partial" ||
      issues.some((item) =>
        [
          "CORE_SALE_COST_BASIS_MISSING",
          "MANUAL_PAYOUT_UNLINKED",
          "UNRESOLVED_RECORD_INCLUDED",
        ].includes(item.code),
      ));
  if (completeUnsupported) {
    issues.push(issue("COMPLETE_STATUS_UNSUPPORTED", "block"));
  }

  return {
    status: issues.some((item) => item.severity === "block")
      ? "blocked"
      : issues.length > 0
        ? "review_required"
        : "reconciled_contract",
    calculatedTotals,
    issues,
    dependableTotalsEstablished: false,
    gateCStatus: "not_assessed",
    automaticLedgerMutationAllowed: false,
  };
}
