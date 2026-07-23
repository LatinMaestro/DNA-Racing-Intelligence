import { normalizeExactDecimal } from "@/domain/exact-decimal";
import { raceModes, type RaceMode } from "@/domain/core-performance";

export const economicDistanceBands = ["sprint", "middle", "marathon"] as const;
export type EconomicDistanceBand = (typeof economicDistanceBands)[number];

export type FilterableEconomicRecordInput = {
  transactionId: string;
  occurredAt: string;
  assetCode: string;
  signedAmount: string;
  aggregateStatus: "included" | "excluded";
  category: string;
  subcategory: string;
  coreIds?: readonly string[];
  mode?: RaceMode | null;
  distanceMetres?: number | null;
  tournamentId?: string | null;
  bracketId?: string | null;
};

export type EconomicLedgerFilterInput = {
  periodStart?: string | null;
  periodEnd?: string | null;
  assetCodes?: readonly string[];
  categories?: readonly string[];
  subcategories?: readonly string[];
  coreIds?: readonly string[];
  modes?: readonly RaceMode[];
  exactDistancesMetres?: readonly number[];
  distanceBands?: readonly EconomicDistanceBand[];
  tournamentIds?: readonly string[];
  bracketIds?: readonly string[];
  includeExcluded?: boolean;
};

export type FilteredEconomicRecord = {
  transactionId: string;
  occurredAt: string;
  assetCode: string;
  signedAmount: string;
  aggregateStatus: "included" | "excluded";
  category: string;
  subcategory: string;
  coreIds: readonly string[];
  mode: RaceMode | null;
  distanceMetres: number | null;
  tournamentId: string | null;
  bracketId: string | null;
};

export type EconomicLedgerFilterResult = {
  records: readonly FilteredEconomicRecord[];
  matchedTransactionCount: number;
  unallocatedTransactionCount: number;
  excludedTransactionCount: number;
  filterStatus: "all_included_records" | "filtered";
};

const distanceBandRanges: Readonly<
  Record<EconomicDistanceBand, { minimum: number; maximum: number }>
> = {
  sprint: { minimum: 900, maximum: 1400 },
  middle: { minimum: 1400, maximum: 1800 },
  marathon: { minimum: 1800, maximum: 2200 },
};

function requiredTrimmed(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(`${label} is required.`);
  return trimmed;
}

function optionalTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function normalizeTimestamp(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = requiredTrimmed(value, label);
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) throw new Error(`${label} must be valid.`);
  return new Date(timestamp).toISOString();
}

function normalizedStrings(
  values: readonly string[] | undefined,
  label: string,
  transform: (value: string) => string = (value) => value,
): string[] {
  const normalized = (values ?? []).map((value) =>
    transform(requiredTrimmed(value, label)),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} values must be unique.`);
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

function normalizeDistances(values: readonly number[] | undefined): number[] {
  const normalized = [...(values ?? [])];
  if (
    normalized.some(
      (distance) => !Number.isSafeInteger(distance) || distance <= 0,
    ) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error(
      "Exact distance filters must be unique positive integers in metres.",
    );
  }
  return normalized.sort((left, right) => left - right);
}

function normalizeRecord(
  input: FilterableEconomicRecordInput,
): FilteredEconomicRecord {
  if (!["included", "excluded"].includes(input.aggregateStatus)) {
    throw new Error("Economic aggregate status is invalid.");
  }
  if (
    input.mode !== null &&
    input.mode !== undefined &&
    !raceModes.includes(input.mode)
  ) {
    throw new Error("Economic record mode is invalid.");
  }
  if (
    input.distanceMetres !== null &&
    input.distanceMetres !== undefined &&
    (!Number.isSafeInteger(input.distanceMetres) || input.distanceMetres <= 0)
  ) {
    throw new Error("Economic record distance must be positive metres.");
  }
  const assetCode = input.assetCode.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(assetCode)) {
    throw new Error("Economic record asset identity is invalid.");
  }
  const signedAmount = normalizeExactDecimal(input.signedAmount);
  if (signedAmount === "0") {
    throw new Error("Economic records cannot use a zero amount.");
  }
  return {
    transactionId: requiredTrimmed(input.transactionId, "Transaction ID"),
    occurredAt:
      normalizeTimestamp(input.occurredAt, "Occurred at") ??
      /* c8 ignore next -- required input cannot reach null */
      "",
    assetCode,
    signedAmount,
    aggregateStatus: input.aggregateStatus,
    category: requiredTrimmed(input.category, "Category"),
    subcategory: requiredTrimmed(input.subcategory, "Subcategory"),
    coreIds: normalizedStrings(input.coreIds, "Core ID"),
    mode: input.mode ?? null,
    distanceMetres: input.distanceMetres ?? null,
    tournamentId: optionalTrimmed(input.tournamentId),
    bracketId: optionalTrimmed(input.bracketId),
  };
}

function matchesAny<T>(value: T, accepted: readonly T[]): boolean {
  return accepted.length === 0 || accepted.includes(value);
}

function matchesDistanceBand(
  distanceMetres: number | null,
  bands: readonly EconomicDistanceBand[],
): boolean {
  if (bands.length === 0) return true;
  if (distanceMetres === null) return false;
  return bands.some((band) => {
    const range = distanceBandRanges[band];
    return distanceMetres >= range.minimum && distanceMetres <= range.maximum;
  });
}

export function filterEconomicLedger(
  recordInputs: readonly FilterableEconomicRecordInput[],
  filterInput: EconomicLedgerFilterInput = {},
): EconomicLedgerFilterResult {
  if (
    filterInput.includeExcluded !== undefined &&
    typeof filterInput.includeExcluded !== "boolean"
  ) {
    throw new Error("Include-excluded filter must be Boolean.");
  }

  const periodStart = normalizeTimestamp(
    filterInput.periodStart,
    "Filter period start",
  );
  const periodEnd = normalizeTimestamp(
    filterInput.periodEnd,
    "Filter period end",
  );
  if (periodStart !== null && periodEnd !== null && periodStart > periodEnd) {
    throw new Error("Filter period start must not be after its end.");
  }
  const assetCodes = normalizedStrings(
    filterInput.assetCodes,
    "Asset code",
    (value) => value.toUpperCase(),
  );
  if (
    assetCodes.some((assetCode) => !/^[A-Z][A-Z0-9_]{1,15}$/.test(assetCode))
  ) {
    throw new Error("Asset-code filter is invalid.");
  }
  const categories = normalizedStrings(filterInput.categories, "Category");
  const subcategories = normalizedStrings(
    filterInput.subcategories,
    "Subcategory",
  );
  const coreIds = normalizedStrings(filterInput.coreIds, "Core ID");
  const modes = [...(filterInput.modes ?? [])];
  if (
    modes.some((mode) => !raceModes.includes(mode)) ||
    new Set(modes).size !== modes.length
  ) {
    throw new Error("Mode filters must be unique supported modes.");
  }
  const exactDistances = normalizeDistances(filterInput.exactDistancesMetres);
  const distanceBands = [...(filterInput.distanceBands ?? [])];
  if (
    distanceBands.some((band) => !economicDistanceBands.includes(band)) ||
    new Set(distanceBands).size !== distanceBands.length
  ) {
    throw new Error("Distance-band filters must be unique supported bands.");
  }
  const tournamentIds = normalizedStrings(
    filterInput.tournamentIds,
    "Tournament ID",
  );
  const bracketIds = normalizedStrings(filterInput.bracketIds, "Bracket ID");
  const includeExcluded = filterInput.includeExcluded ?? false;

  const records = recordInputs.map(normalizeRecord);
  if (
    new Set(records.map(({ transactionId }) => transactionId)).size !==
    records.length
  ) {
    throw new Error("Economic transaction IDs must be unique.");
  }

  const matched = records
    .filter((record) => {
      if (!includeExcluded && record.aggregateStatus === "excluded") {
        return false;
      }
      if (periodStart !== null && record.occurredAt < periodStart) return false;
      if (periodEnd !== null && record.occurredAt > periodEnd) return false;
      if (!matchesAny(record.assetCode, assetCodes)) return false;
      if (!matchesAny(record.category, categories)) return false;
      if (!matchesAny(record.subcategory, subcategories)) return false;
      if (
        coreIds.length > 0 &&
        !record.coreIds.some((coreId) => coreIds.includes(coreId))
      ) {
        return false;
      }
      if (
        modes.length > 0 &&
        (record.mode === null || !modes.includes(record.mode))
      ) {
        return false;
      }
      if (
        exactDistances.length > 0 &&
        (record.distanceMetres === null ||
          !exactDistances.includes(record.distanceMetres))
      ) {
        return false;
      }
      if (!matchesDistanceBand(record.distanceMetres, distanceBands)) {
        return false;
      }
      if (
        tournamentIds.length > 0 &&
        (record.tournamentId === null ||
          !tournamentIds.includes(record.tournamentId))
      ) {
        return false;
      }
      if (
        bracketIds.length > 0 &&
        (record.bracketId === null || !bracketIds.includes(record.bracketId))
      ) {
        return false;
      }
      return true;
    })
    .sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.transactionId.localeCompare(right.transactionId),
    );

  const filterStatus =
    periodStart === null &&
    periodEnd === null &&
    assetCodes.length === 0 &&
    categories.length === 0 &&
    subcategories.length === 0 &&
    coreIds.length === 0 &&
    modes.length === 0 &&
    exactDistances.length === 0 &&
    distanceBands.length === 0 &&
    tournamentIds.length === 0 &&
    bracketIds.length === 0 &&
    !includeExcluded
      ? "all_included_records"
      : "filtered";

  return {
    records: matched,
    matchedTransactionCount: matched.length,
    unallocatedTransactionCount: matched.filter(
      ({ coreIds: linkedCoreIds }) => linkedCoreIds.length === 0,
    ).length,
    excludedTransactionCount: matched.filter(
      ({ aggregateStatus }) => aggregateStatus === "excluded",
    ).length,
    filterStatus,
  };
}
