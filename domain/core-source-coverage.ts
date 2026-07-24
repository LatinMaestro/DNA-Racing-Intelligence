import type { CoreClass } from "@/domain/source-adapters";

export type CoreCoverageDetails = Readonly<{
  coreId: string;
  coreClass: CoreClass;
  parentCoreIds: readonly string[];
}>;

export type CoreCoverageContext =
  "current_vault" | "current_arena" | "race_history";

export type CoreSourceCoverage = Readonly<{
  coreId: string;
  contexts: readonly CoreCoverageContext[];
  coreDetailsStatus: "available" | "missing";
  raceHistoryStatus: "available" | "no_imported_racing_history";
  lineageStatus:
    | "available"
    | "founder"
    | "missing_core_details"
    | "incomplete_or_inconsistent";
  analyticalProfileStatus:
    | "ready"
    | "performance_only"
    | "no_imported_racing_history"
    | "source_identity_only";
  familyRestrictionStatus: "checkable" | "review_required";
}>;

export type CoreSourceCoverageResult = Readonly<{
  cores: readonly CoreSourceCoverage[];
  counts: Readonly<{
    total: number;
    ready: number;
    performanceOnly: number;
    noImportedRacingHistory: number;
    sourceIdentityOnly: number;
    familyReviewRequired: number;
  }>;
}>;

const contextOrder: readonly CoreCoverageContext[] = [
  "current_vault",
  "current_arena",
  "race_history",
];

function requireId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function sorted(values: Iterable<string>): readonly string[] {
  return [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function uniqueIds(values: readonly string[], field: string): Set<string> {
  const normalized = values.map((value) => requireId(value, field));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${field} must be unique`);
  }
  return new Set(normalized);
}

function lineageStatus(
  details: CoreCoverageDetails | undefined,
  knownCoreIds: ReadonlySet<string>,
): CoreSourceCoverage["lineageStatus"] {
  if (details === undefined) return "missing_core_details";

  const parentIds = details.parentCoreIds.map((parentId) =>
    requireId(parentId, "parentCoreId"),
  );
  if (new Set(parentIds).size !== parentIds.length) {
    return "incomplete_or_inconsistent";
  }
  if (details.coreClass === "Genesis") {
    return parentIds.length === 0 ? "founder" : "incomplete_or_inconsistent";
  }
  return parentIds.length === 2 &&
    parentIds.every((parentId) => knownCoreIds.has(parentId))
    ? "available"
    : "incomplete_or_inconsistent";
}

export function projectCoreSourceCoverage(
  input: Readonly<{
    coreDetails: readonly CoreCoverageDetails[];
    ownedCoreIds: readonly string[];
    arenaCoreIds: readonly string[];
    racedCoreIds: readonly string[];
  }>,
): CoreSourceCoverageResult {
  const detailIds = input.coreDetails.map(({ coreId }) =>
    requireId(coreId, "Core Details coreId"),
  );
  if (new Set(detailIds).size !== detailIds.length) {
    throw new TypeError("Core Details coreId must be unique");
  }

  const detailsById = new Map(
    input.coreDetails.map((details, index) => [detailIds[index]!, details]),
  );
  const knownCoreIds = new Set(detailIds);
  const owned = uniqueIds(input.ownedCoreIds, "ownedCoreId");
  const arena = uniqueIds(input.arenaCoreIds, "arenaCoreId");
  const raced = uniqueIds(input.racedCoreIds, "racedCoreId");
  const allIds = new Set([...detailIds, ...owned, ...arena, ...raced]);

  const cores = sorted(allIds).map((coreId): CoreSourceCoverage => {
    const details = detailsById.get(coreId);
    const hasRaceHistory = raced.has(coreId);
    const lineage = lineageStatus(details, knownCoreIds);
    const contexts = contextOrder.filter(
      (context) =>
        (context === "current_vault" && owned.has(coreId)) ||
        (context === "current_arena" && arena.has(coreId)) ||
        (context === "race_history" && hasRaceHistory),
    );

    const analyticalProfileStatus =
      details === undefined
        ? hasRaceHistory
          ? "performance_only"
          : "source_identity_only"
        : hasRaceHistory
          ? "ready"
          : "no_imported_racing_history";

    return {
      coreId,
      contexts,
      coreDetailsStatus: details === undefined ? "missing" : "available",
      raceHistoryStatus: hasRaceHistory
        ? "available"
        : "no_imported_racing_history",
      lineageStatus: lineage,
      analyticalProfileStatus,
      familyRestrictionStatus:
        lineage === "available" || lineage === "founder"
          ? "checkable"
          : "review_required",
    };
  });

  return {
    cores,
    counts: {
      total: cores.length,
      ready: cores.filter(
        ({ analyticalProfileStatus }) => analyticalProfileStatus === "ready",
      ).length,
      performanceOnly: cores.filter(
        ({ analyticalProfileStatus }) =>
          analyticalProfileStatus === "performance_only",
      ).length,
      noImportedRacingHistory: cores.filter(
        ({ analyticalProfileStatus }) =>
          analyticalProfileStatus === "no_imported_racing_history",
      ).length,
      sourceIdentityOnly: cores.filter(
        ({ analyticalProfileStatus }) =>
          analyticalProfileStatus === "source_identity_only",
      ).length,
      familyReviewRequired: cores.filter(
        ({ familyRestrictionStatus }) =>
          familyRestrictionStatus === "review_required",
      ).length,
    },
  };
}
