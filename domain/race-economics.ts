import { raceEconomicNaturalKey } from "@/domain/import-contract";
import {
  isNegativeExactDecimal,
  isZeroExactDecimal,
  negateExactDecimal,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";

export const supportedRaceAssets = ["ETH", "DEZ"] as const;
export type RaceAsset = (typeof supportedRaceAssets)[number];

export type RaceEconomicDataStatus =
  | "ready"
  | "missing"
  | "invalid"
  | "unsupported_asset";

export type RaceEconomicIssueCode =
  | "MISSING_ECONOMIC_VALUE"
  | "INVALID_ECONOMIC_DECIMAL"
  | "UNSUPPORTED_RACE_ASSET";

export type ValidatedRaceEconomics = Readonly<{
  status: RaceEconomicDataStatus;
  asset: RaceAsset | null;
  entryFee: string | null;
  grossPayout: string | null;
  feeSourceValue: string | null;
  prizeSourceValue: string | null;
  assetSourceValue: string | null;
  payoutMechanismSourceValue: string | null;
  raceTagsSourceValue: string | null;
  issueCodes: readonly RaceEconomicIssueCode[];
}>;

function trimmed(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function exactNonNegative(value: string | null): string | null {
  if (value === null) return null;
  try {
    const normalized = normalizeExactDecimal(value);
    return isNegativeExactDecimal(normalized) ? null : normalized;
  } catch {
    return null;
  }
}

export function validateRaceEconomics(
  input: Readonly<{
    feeSourceValue?: string | null;
    prizeSourceValue?: string | null;
    assetSourceValue?: string | null;
    payoutMechanismSourceValue?: string | null;
    raceTagsSourceValue?: string | null;
  }>,
): ValidatedRaceEconomics {
  const feeSourceValue = trimmed(input.feeSourceValue);
  const prizeSourceValue = trimmed(input.prizeSourceValue);
  const assetSourceValue = trimmed(input.assetSourceValue);
  const payoutMechanismSourceValue = trimmed(
    input.payoutMechanismSourceValue,
  );
  const raceTagsSourceValue = trimmed(input.raceTagsSourceValue);

  if (
    feeSourceValue === null &&
    prizeSourceValue === null &&
    assetSourceValue === null
  ) {
    return {
      status: "missing",
      asset: null,
      entryFee: null,
      grossPayout: null,
      feeSourceValue,
      prizeSourceValue,
      assetSourceValue,
      payoutMechanismSourceValue,
      raceTagsSourceValue,
      issueCodes: [],
    };
  }

  const issueCodes: RaceEconomicIssueCode[] = [];
  if (
    feeSourceValue === null ||
    prizeSourceValue === null ||
    assetSourceValue === null
  ) {
    issueCodes.push("MISSING_ECONOMIC_VALUE");
  }

  const entryFee = exactNonNegative(feeSourceValue);
  const grossPayout = exactNonNegative(prizeSourceValue);
  if (
    (feeSourceValue !== null && entryFee === null) ||
    (prizeSourceValue !== null && grossPayout === null)
  ) {
    issueCodes.push("INVALID_ECONOMIC_DECIMAL");
  }

  const normalizedAsset = assetSourceValue?.toUpperCase() ?? null;
  const asset = supportedRaceAssets.find((item) => item === normalizedAsset) ?? null;
  if (assetSourceValue !== null && asset === null) {
    issueCodes.push("UNSUPPORTED_RACE_ASSET");
  }

  const status: RaceEconomicDataStatus = issueCodes.includes(
    "INVALID_ECONOMIC_DECIMAL",
  )
    ? "invalid"
    : issueCodes.includes("UNSUPPORTED_RACE_ASSET")
      ? "unsupported_asset"
      : issueCodes.length > 0
        ? "missing"
        : "ready";

  return {
    status,
    asset,
    entryFee,
    grossPayout,
    feeSourceValue,
    prizeSourceValue,
    assetSourceValue,
    payoutMechanismSourceValue,
    raceTagsSourceValue,
    issueCodes,
  };
}

export type RaceEconomicTransaction = Readonly<{
  naturalKey: string;
  transactionType: "entry_fee" | "payout";
  direction: "debit" | "credit";
  asset: RaceAsset;
  signedAmount: string;
}>;

export function deriveRaceEconomicTransactions(
  raceEntryKey: string,
  economics: ValidatedRaceEconomics,
): readonly RaceEconomicTransaction[] {
  if (
    economics.status !== "ready" ||
    economics.asset === null ||
    economics.entryFee === null ||
    economics.grossPayout === null
  ) {
    return [];
  }

  const transactions: RaceEconomicTransaction[] = [];
  if (!isZeroExactDecimal(economics.entryFee)) {
    transactions.push({
      naturalKey: raceEconomicNaturalKey(raceEntryKey, "entry_fee"),
      transactionType: "entry_fee",
      direction: "debit",
      asset: economics.asset,
      signedAmount: negateExactDecimal(economics.entryFee),
    });
  }
  if (!isZeroExactDecimal(economics.grossPayout)) {
    transactions.push({
      naturalKey: raceEconomicNaturalKey(raceEntryKey, "payout"),
      transactionType: "payout",
      direction: "credit",
      asset: economics.asset,
      signedAmount: economics.grossPayout,
    });
  }
  return transactions;
}
