export type PrivateChronologicalValidationInput = Readonly<{
  evidenceId: string;
  exactHeadSha: string;
  sourceRows: number;
  uniqueRows: number;
  duplicateRowsIgnored: number;
  uniqueEvents: number;
  completeEvents: number;
  partialEvents: number;
  partialEventsExcludedFromOutcomeScoring: boolean;
  externallyChronologicallyOrdered: boolean;
  featureCutoffStrictlyBeforeEvent: boolean;
  sameEventHistoryUpdatedAfterPrediction: boolean;
  baselinePartitions: Readonly<{
    mode: boolean;
    exactDistanceMetres: boolean;
    gateCount: boolean;
  }>;
  pairedHoldoutCases: number;
  historicalStarHoldoutCases: number;
  directHistoryBrierImprovementMillionths: number;
  historicalStarBrierImprovementMillionths: number;
  lineageProxyCases: number;
  lineageProxyBrierImprovementMillionths: number;
  breedingTimestampCoverageAvailable: boolean;
  pointInTimeMaidenEntitlementAvailable: boolean;
  eraReviewCandidateCount: number;
  algorithmChangeClaimed: boolean;
  capacity: Readonly<{
    evidenceSource: "synthetic" | "sanitized_representative" | "private_hosted";
    repetitions: number;
    peakMemoryMegabytes: number;
    memoryBudgetMegabytes: number;
    runsOffRequestPath: boolean;
    routineRequestP95Measured: boolean;
  }>;
  economics: Readonly<{
    historicalBgcRows: number;
    raceLedgerTransactionsFromHistoricalBgc: number;
    unknownRaceAssetRows: number;
  }>;
}>;

export type PrivateChronologicalValidationAssessment = Readonly<{
  status: "blocked" | "review_required";
  chronologyStatus: "valid" | "invalid";
  directHistoryStatus:
    "review_candidate" | "not_supported" | "insufficient_evidence";
  historicalStarStatus:
    "review_candidate" | "not_supported" | "insufficient_evidence";
  lineageProxyStatus:
    "review_candidate" | "not_supported" | "insufficient_evidence";
  breedingStatus: "blocked_missing_timestamps" | "evidence_only";
  maidenStatus: "blocked_missing_point_in_time_entitlement" | "evidence_only";
  eraStatus: "review_candidates_present" | "no_review_candidates";
  capacityStatus: "representative_background_only" | "incomplete";
  economicsStatus: "bgc_exception_verified" | "invalid";
  warnings: readonly (
    | "CHRONOLOGICAL_ORDER_INVALID"
    | "PARTIAL_EVENTS_INCLUDED_IN_OUTCOMES"
    | "BASELINE_CONTEXT_INCOMPLETE"
    | "DIRECT_HISTORY_NOT_SUPPORTED"
    | "HISTORICAL_STAR_FEATURE_NOT_SUPPORTED"
    | "LINEAGE_PROXY_NOT_SUPPORTED"
    | "BREEDING_TIMESTAMPS_UNAVAILABLE"
    | "POINT_IN_TIME_ME_UNAVAILABLE"
    | "ALGORITHM_CHANGE_CAUSALITY_NOT_ESTABLISHED"
    | "ROUTINE_REQUEST_CAPACITY_NOT_MEASURED"
    | "BGC_EXCEPTION_INVALID"
  )[];
  gateCStatus: "not_accepted";
  gateEStatus: "not_accepted";
  recommendationActivationAllowed: false;
  productionMutationAllowed: false;
}>;

const SAFE_EVIDENCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function signedSafeInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a signed safe integer.`);
  }
}

function positiveFinite(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive and finite.`);
  }
}

function strictBoolean(value: unknown, label: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be Boolean.`);
  }
}

export function assessPrivateChronologicalValidation(
  input: PrivateChronologicalValidationInput,
): PrivateChronologicalValidationAssessment {
  const root = object(input, "Chronological evidence");
  const baseline = object(root.baselinePartitions, "Baseline partitions");
  const capacity = object(root.capacity, "Capacity evidence");
  const economics = object(root.economics, "Economics evidence");
  if (
    typeof root.evidenceId !== "string" ||
    root.evidenceId.trim() !== root.evidenceId ||
    !SAFE_EVIDENCE_ID.test(root.evidenceId)
  ) {
    throw new Error("Evidence ID must be canonical.");
  }
  if (
    typeof root.exactHeadSha !== "string" ||
    !/^[0-9a-f]{40}$/.test(root.exactHeadSha)
  ) {
    throw new Error(
      "Exact-head SHA must contain 40 lowercase hexadecimal characters.",
    );
  }
  for (const [value, label] of [
    [input.sourceRows, "Source rows"],
    [input.uniqueRows, "Unique rows"],
    [input.duplicateRowsIgnored, "Duplicate rows"],
    [input.uniqueEvents, "Unique events"],
    [input.completeEvents, "Complete events"],
    [input.partialEvents, "Partial events"],
    [input.pairedHoldoutCases, "Paired holdout cases"],
    [input.historicalStarHoldoutCases, "Historical-star holdout cases"],
    [input.lineageProxyCases, "Lineage proxy cases"],
    [input.eraReviewCandidateCount, "Era review candidates"],
    [input.capacity.repetitions, "Capacity repetitions"],
    [input.economics.historicalBgcRows, "Historical BGC rows"],
    [
      input.economics.raceLedgerTransactionsFromHistoricalBgc,
      "Historical BGC ledger transactions",
    ],
    [input.economics.unknownRaceAssetRows, "Unknown race-asset rows"],
  ] as const) {
    nonNegativeInteger(value, label);
  }
  for (const [value, label] of [
    [
      input.directHistoryBrierImprovementMillionths,
      "Direct-history Brier improvement",
    ],
    [
      input.historicalStarBrierImprovementMillionths,
      "Historical-star Brier improvement",
    ],
    [
      input.lineageProxyBrierImprovementMillionths,
      "Lineage-proxy Brier improvement",
    ],
  ] as const) {
    signedSafeInteger(value, label);
  }
  for (const [value, label] of [
    [input.capacity.peakMemoryMegabytes, "Peak memory"],
    [input.capacity.memoryBudgetMegabytes, "Memory budget"],
  ] as const) {
    positiveFinite(value, label);
  }
  for (const [value, label] of [
    [root.partialEventsExcludedFromOutcomeScoring, "Partial-event exclusion"],
    [root.externallyChronologicallyOrdered, "Chronological ordering"],
    [root.featureCutoffStrictlyBeforeEvent, "Feature cutoff"],
    [root.sameEventHistoryUpdatedAfterPrediction, "Same-event update order"],
    [baseline.mode, "Mode baseline partition"],
    [baseline.exactDistanceMetres, "Exact-distance baseline partition"],
    [baseline.gateCount, "Gate-count baseline partition"],
    [root.breedingTimestampCoverageAvailable, "Breeding timestamp coverage"],
    [root.pointInTimeMaidenEntitlementAvailable, "Maiden entitlement coverage"],
    [root.algorithmChangeClaimed, "Algorithm-change claim"],
    [capacity.runsOffRequestPath, "Off-request-path capacity"],
    [capacity.routineRequestP95Measured, "Routine request p95"],
  ] as const) {
    strictBoolean(value, label);
  }
  const reconciledRows = input.uniqueRows + input.duplicateRowsIgnored;
  const reconciledEvents = input.completeEvents + input.partialEvents;
  if (
    !Number.isSafeInteger(reconciledRows) ||
    !Number.isSafeInteger(reconciledEvents) ||
    reconciledRows !== input.sourceRows ||
    reconciledEvents !== input.uniqueEvents
  ) {
    throw new Error("Source and event coverage counts must reconcile.");
  }
  if (input.historicalStarHoldoutCases > input.pairedHoldoutCases) {
    throw new Error(
      "Historical-star holdout cases cannot exceed paired holdout cases.",
    );
  }
  if (
    typeof capacity.evidenceSource !== "string" ||
    !["synthetic", "sanitized_representative", "private_hosted"].some(
      (value) => value === capacity.evidenceSource,
    )
  ) {
    throw new Error("Capacity evidence source is invalid.");
  }

  const warnings: PrivateChronologicalValidationAssessment["warnings"][number][] =
    [];
  const chronologyValid =
    input.externallyChronologicallyOrdered &&
    input.featureCutoffStrictlyBeforeEvent &&
    input.sameEventHistoryUpdatedAfterPrediction;
  if (!chronologyValid) warnings.push("CHRONOLOGICAL_ORDER_INVALID");
  if (!input.partialEventsExcludedFromOutcomeScoring) {
    warnings.push("PARTIAL_EVENTS_INCLUDED_IN_OUTCOMES");
  }
  const baselineComplete = Object.values(input.baselinePartitions).every(
    Boolean,
  );
  if (!baselineComplete) warnings.push("BASELINE_CONTEXT_INCOMPLETE");

  const evidenceUsable =
    chronologyValid &&
    input.partialEventsExcludedFromOutcomeScoring &&
    baselineComplete;
  const directHistoryStatus =
    !evidenceUsable || input.pairedHoldoutCases === 0
      ? "insufficient_evidence"
      : input.directHistoryBrierImprovementMillionths > 0
        ? "review_candidate"
        : "not_supported";
  if (directHistoryStatus === "not_supported") {
    warnings.push("DIRECT_HISTORY_NOT_SUPPORTED");
  }
  const historicalStarStatus =
    !evidenceUsable || input.historicalStarHoldoutCases === 0
      ? "insufficient_evidence"
      : input.historicalStarBrierImprovementMillionths > 0
        ? "review_candidate"
        : "not_supported";
  if (historicalStarStatus === "not_supported") {
    warnings.push("HISTORICAL_STAR_FEATURE_NOT_SUPPORTED");
  }
  const lineageProxyStatus =
    !evidenceUsable || input.lineageProxyCases === 0
      ? "insufficient_evidence"
      : input.lineageProxyBrierImprovementMillionths > 0
        ? "review_candidate"
        : "not_supported";
  if (lineageProxyStatus === "not_supported") {
    warnings.push("LINEAGE_PROXY_NOT_SUPPORTED");
  }

  const breedingStatus = input.breedingTimestampCoverageAvailable
    ? "evidence_only"
    : "blocked_missing_timestamps";
  if (!input.breedingTimestampCoverageAvailable) {
    warnings.push("BREEDING_TIMESTAMPS_UNAVAILABLE");
  }
  const maidenStatus = input.pointInTimeMaidenEntitlementAvailable
    ? "evidence_only"
    : "blocked_missing_point_in_time_entitlement";
  if (!input.pointInTimeMaidenEntitlementAvailable) {
    warnings.push("POINT_IN_TIME_ME_UNAVAILABLE");
  }
  if (input.algorithmChangeClaimed || input.eraReviewCandidateCount > 0) {
    warnings.push("ALGORITHM_CHANGE_CAUSALITY_NOT_ESTABLISHED");
  }

  const representativeCapacity =
    input.capacity.evidenceSource !== "synthetic" &&
    input.uniqueRows >= 2_000_000 &&
    input.capacity.repetitions >= 3 &&
    input.capacity.peakMemoryMegabytes <=
      input.capacity.memoryBudgetMegabytes &&
    input.capacity.runsOffRequestPath;
  const capacityStatus = representativeCapacity
    ? "representative_background_only"
    : "incomplete";
  if (!input.capacity.routineRequestP95Measured) {
    warnings.push("ROUTINE_REQUEST_CAPACITY_NOT_MEASURED");
  }

  const bgcExceptionValid =
    input.economics.historicalBgcRows > 0 &&
    input.economics.raceLedgerTransactionsFromHistoricalBgc === 0 &&
    input.economics.unknownRaceAssetRows === 0;
  if (!bgcExceptionValid) warnings.push("BGC_EXCEPTION_INVALID");

  const blocked =
    !evidenceUsable ||
    breedingStatus === "blocked_missing_timestamps" ||
    maidenStatus === "blocked_missing_point_in_time_entitlement" ||
    !bgcExceptionValid;
  return {
    status: blocked ? "blocked" : "review_required",
    chronologyStatus: chronologyValid ? "valid" : "invalid",
    directHistoryStatus,
    historicalStarStatus,
    lineageProxyStatus,
    breedingStatus,
    maidenStatus,
    eraStatus:
      input.eraReviewCandidateCount > 0
        ? "review_candidates_present"
        : "no_review_candidates",
    capacityStatus,
    economicsStatus: bgcExceptionValid ? "bgc_exception_verified" : "invalid",
    warnings,
    gateCStatus: "not_accepted",
    gateEStatus: "not_accepted",
    recommendationActivationAllowed: false,
    productionMutationAllowed: false,
  };
}
