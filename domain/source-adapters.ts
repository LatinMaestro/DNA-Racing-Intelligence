import type { RaceMode } from "@/domain/import-contract";
import type {
  DetectableSourceType,
  SourceColumnProvenance,
  StagedSourceSchema,
} from "@/domain/source-schema";

export type CoreClass = "Genesis" | "Morphed" | "Freak" | "X-Class";
export type CoreElement = "Metal" | "Fire" | "Earth" | "Water";
export type CoreSex = "male" | "female";
export type StarDataStatus = "complete" | "partial" | "missing" | "invalid";

export type SourceValueProvenance = Readonly<{
  sourceIndex: number;
  rawHeader: string;
  canonicalColumn: string;
  rawValue: string;
}>;

export type SourceRowIssue = Readonly<{
  code:
    | "GOLD_INELIGIBLE_ASSIGNMENT"
    | "INVALID_BOOLEAN"
    | "INVALID_CLASS"
    | "INVALID_DECIMAL"
    | "INVALID_ELEMENT"
    | "INVALID_F_NUMBER"
    | "INVALID_INTEGER"
    | "INVALID_MODE"
    | "INVALID_SEX"
    | "INVALID_TIMESTAMP"
    | "MISSING_REQUIRED_VALUE"
    | "ROW_COLUMN_COUNT_MISMATCH"
    | "SCHEMA_NOT_READY";
  severity: "warning" | "error";
  canonicalColumn: string | null;
}>;

export type AdaptedRaceMergeRow = Readonly<{
  sourceType: "race_merge";
  sourceEventId: string;
  eventAt: string;
  sourceEventDatetime: string | null;
  mode: RaceMode;
  distance: number;
  sourceCoreId: string;
  coreNameSourceValue: string | null;
  gate: number | null;
  gateCount: number;
  goldStar: boolean | null;
  blueStar: boolean | null;
  goldStarEligible: boolean;
  goldStarSourceValue: string;
  blueStarSourceValue: string;
  starDataStatus: StarDataStatus;
  finishPosition: number;
  elapsedTimeSourceValue: string;
  sourceRaceClass: string | null;
  sourceFormat: string | null;
  feeSourceValue: string | null;
  payoutSourceValue: string | null;
  prizeSourceValue: string | null;
  assetSourceValue: string | null;
  economicDataStatus: "unvalidated";
}>;

export type AdaptedCoreDetailsRow = Readonly<{
  sourceType: "core_details";
  sourceCoreId: string;
  displayName: string;
  coreClass: CoreClass;
  element: CoreElement;
  fNumber: number;
  sex: CoreSex;
  colorSourceValue: string | null;
  fatherSourceCoreId: string | null;
  fatherNameSourceValue: string | null;
  motherSourceCoreId: string | null;
  motherNameSourceValue: string | null;
}>;

export type AdaptedCurrentVaultRow = Readonly<{
  sourceType: "current_vault";
  sourceCoreId: null;
  displayName: string;
  coreClass: CoreClass;
  element: CoreElement;
  fNumber: number;
  sex: CoreSex;
  maidenEligible: boolean | null;
  maidenSourceValue: string;
  maidenDataStatus: "valid" | "missing" | "invalid";
  identityResolutionStatus: "review_required";
}>;

export type AdaptedCurrentArenaRow = Readonly<{
  sourceType: "current_arena";
  sourceCoreId: string;
  priceUsdSourceValue: string;
  createsEconomicTransaction: false;
}>;

export type AdaptedSourceRecord =
  | AdaptedRaceMergeRow
  | AdaptedCoreDetailsRow
  | AdaptedCurrentVaultRow
  | AdaptedCurrentArenaRow;

export type AdaptedSourceRow = Readonly<{
  status: "ready" | "quarantined";
  sourceType: DetectableSourceType | null;
  record: AdaptedSourceRecord | null;
  provenance: readonly SourceValueProvenance[];
  issues: readonly SourceRowIssue[];
}>;

type CanonicalValues = Readonly<Record<string, string>>;

function rowIssue(
  code: SourceRowIssue["code"],
  severity: SourceRowIssue["severity"],
  canonicalColumn: string | null,
): SourceRowIssue {
  return { code, severity, canonicalColumn };
}

function nonEmpty(
  values: CanonicalValues,
  column: string,
  issues: SourceRowIssue[],
): string | null {
  const value = values[column]?.trim() ?? "";
  if (!value) {
    issues.push(rowIssue("MISSING_REQUIRED_VALUE", "error", column));
    return null;
  }
  return value;
}

function optional(values: CanonicalValues, column: string): string | null {
  const value = values[column]?.trim() ?? "";
  return value || null;
}

function positiveInteger(
  values: CanonicalValues,
  column: string,
  issues: SourceRowIssue[],
): number | null {
  const value = nonEmpty(values, column, issues);
  if (value === null) return null;
  if (!/^\d+$/.test(value)) {
    issues.push(rowIssue("INVALID_INTEGER", "error", column));
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    issues.push(rowIssue("INVALID_INTEGER", "error", column));
    return null;
  }
  return parsed;
}

function optionalPositiveInteger(
  values: CanonicalValues,
  column: string,
  issues: SourceRowIssue[],
): number | null {
  if (!optional(values, column)) return null;
  return positiveInteger(values, column, issues);
}

function timestamp(
  values: CanonicalValues,
  column: string,
  issues: SourceRowIssue[],
  required: boolean,
): string | null {
  const value = optional(values, column);
  if (value === null) {
    if (required)
      issues.push(rowIssue("MISSING_REQUIRED_VALUE", "error", column));
    return null;
  }

  let epochMilliseconds: number | null = null;
  if (/^\d{10}$/.test(value)) epochMilliseconds = Number(value) * 1_000;
  if (/^\d{13}$/.test(value)) epochMilliseconds = Number(value);
  const timezoneQualifiedIso =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    );
  if (epochMilliseconds === null && !timezoneQualifiedIso) {
    issues.push(rowIssue("INVALID_TIMESTAMP", "error", column));
    return null;
  }
  const parsed =
    epochMilliseconds === null ? new Date(value) : new Date(epochMilliseconds);
  if (Number.isNaN(parsed.getTime())) {
    issues.push(rowIssue("INVALID_TIMESTAMP", "error", column));
    return null;
  }
  return parsed.toISOString();
}

function nullableBoolean(
  values: CanonicalValues,
  column: string,
  issues: SourceRowIssue[],
): { value: boolean | null; invalid: boolean; raw: string } {
  const raw = values[column]?.trim() ?? "";
  if (!raw) return { value: null, invalid: false, raw };
  const normalized = raw.toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) {
    return { value: true, invalid: false, raw };
  }
  if (["false", "0", "no"].includes(normalized)) {
    return { value: false, invalid: false, raw };
  }
  issues.push(rowIssue("INVALID_BOOLEAN", "warning", column));
  return { value: null, invalid: true, raw };
}

function mode(
  values: CanonicalValues,
  issues: SourceRowIssue[],
): RaceMode | null {
  const value = nonEmpty(values, "mode", issues)?.toLowerCase();
  if (value === "bike" || value === "car" || value === "horse") return value;
  if (value !== undefined && value !== null) {
    issues.push(rowIssue("INVALID_MODE", "error", "mode"));
  }
  return null;
}

function coreClass(
  values: CanonicalValues,
  issues: SourceRowIssue[],
): CoreClass | null {
  const raw = nonEmpty(values, "core_type", issues);
  if (raw === null) return null;
  const normalized = raw.toLowerCase().replace(/[^a-z]/g, "");
  const classes: Record<string, CoreClass> = {
    genesis: "Genesis",
    morphed: "Morphed",
    freak: "Freak",
    xclass: "X-Class",
  };
  const value = classes[normalized];
  if (value === undefined) {
    issues.push(rowIssue("INVALID_CLASS", "error", "core_type"));
    return null;
  }
  return value;
}

function element(
  values: CanonicalValues,
  issues: SourceRowIssue[],
): CoreElement | null {
  const raw = nonEmpty(values, "element", issues);
  if (raw === null) return null;
  const elements: Record<string, CoreElement> = {
    metal: "Metal",
    fire: "Fire",
    earth: "Earth",
    water: "Water",
  };
  const value = elements[raw.toLowerCase()];
  if (value === undefined) {
    issues.push(rowIssue("INVALID_ELEMENT", "error", "element"));
    return null;
  }
  return value;
}

function sex(
  values: CanonicalValues,
  issues: SourceRowIssue[],
): CoreSex | null {
  const raw = nonEmpty(values, "sex", issues)?.toLowerCase();
  if (raw === "male" || raw === "female") return raw;
  if (raw !== undefined && raw !== null) {
    issues.push(rowIssue("INVALID_SEX", "error", "sex"));
  }
  return null;
}

function fNumber(
  values: CanonicalValues,
  issues: SourceRowIssue[],
): number | null {
  const raw = nonEmpty(values, "f_number", issues);
  if (raw === null) return null;
  const match = /^f?(\d+)$/i.exec(raw);
  const parsed = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    issues.push(rowIssue("INVALID_F_NUMBER", "error", "f_number"));
    return null;
  }
  return parsed;
}

function exactNonNegativeDecimal(
  values: CanonicalValues,
  column: string,
  issues: SourceRowIssue[],
  allowZero = true,
): string | null {
  const value = nonEmpty(values, column, issues);
  if (value === null) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    issues.push(rowIssue("INVALID_DECIMAL", "error", column));
    return null;
  }
  if (!allowZero && /^0(?:\.0+)?$/.test(value)) {
    issues.push(rowIssue("INVALID_DECIMAL", "error", column));
    return null;
  }
  return value;
}

function hasErrors(issues: readonly SourceRowIssue[]): boolean {
  return issues.some(({ severity }) => severity === "error");
}

function raceRow(
  values: CanonicalValues,
  issues: SourceRowIssue[],
): AdaptedRaceMergeRow | null {
  const sourceEventId = nonEmpty(values, "event_id", issues);
  const eventAt = timestamp(values, "event_at", issues, true);
  const sourceEventDatetime = timestamp(
    values,
    "source_event_datetime",
    issues,
    false,
  );
  const raceMode = mode(values, issues);
  const distance = positiveInteger(values, "distance", issues);
  const sourceCoreId = nonEmpty(values, "core_id", issues);
  const gate = optionalPositiveInteger(values, "gate", issues);
  const gateCount = positiveInteger(values, "gate_count", issues);
  const finishPosition = positiveInteger(values, "finish_position", issues);
  const elapsedTimeSourceValue = exactNonNegativeDecimal(
    values,
    "elapsed_time",
    issues,
    false,
  );
  const gold = nullableBoolean(values, "gold_star", issues);
  const blue = nullableBoolean(values, "blue_star", issues);
  const goldStarEligible = gateCount !== null && gateCount > 3;
  if (gold.value === true && !goldStarEligible) {
    issues.push(rowIssue("GOLD_INELIGIBLE_ASSIGNMENT", "warning", "gold_star"));
  }

  const starDataStatus: StarDataStatus =
    gold.invalid || blue.invalid
      ? "invalid"
      : gold.value === null && blue.value === null
        ? "missing"
        : gold.value === null || blue.value === null
          ? "partial"
          : "complete";

  if (
    hasErrors(issues) ||
    sourceEventId === null ||
    eventAt === null ||
    raceMode === null ||
    distance === null ||
    sourceCoreId === null ||
    gateCount === null ||
    finishPosition === null ||
    elapsedTimeSourceValue === null
  ) {
    return null;
  }

  return {
    sourceType: "race_merge",
    sourceEventId,
    eventAt,
    sourceEventDatetime,
    mode: raceMode,
    distance,
    sourceCoreId,
    coreNameSourceValue: optional(values, "core_name"),
    gate,
    gateCount,
    goldStar: gold.value,
    blueStar: blue.value,
    goldStarEligible,
    goldStarSourceValue: gold.raw,
    blueStarSourceValue: blue.raw,
    starDataStatus,
    finishPosition,
    elapsedTimeSourceValue,
    sourceRaceClass: optional(values, "source_race_class"),
    sourceFormat: optional(values, "source_format"),
    feeSourceValue: optional(values, "fee_source_value"),
    payoutSourceValue: optional(values, "payout_source_value"),
    prizeSourceValue: optional(values, "prize_source_value"),
    assetSourceValue: optional(values, "asset_source_value"),
    economicDataStatus: "unvalidated",
  };
}

function coreDetailsRow(
  values: CanonicalValues,
  issues: SourceRowIssue[],
): AdaptedCoreDetailsRow | null {
  const sourceCoreId = nonEmpty(values, "core_id", issues);
  const displayName = nonEmpty(values, "core_name", issues);
  const normalizedClass = coreClass(values, issues);
  const normalizedElement = element(values, issues);
  const normalizedFNumber = fNumber(values, issues);
  const normalizedSex = sex(values, issues);
  if (
    hasErrors(issues) ||
    sourceCoreId === null ||
    displayName === null ||
    normalizedClass === null ||
    normalizedElement === null ||
    normalizedFNumber === null ||
    normalizedSex === null
  )
    return null;
  return {
    sourceType: "core_details",
    sourceCoreId,
    displayName,
    coreClass: normalizedClass,
    element: normalizedElement,
    fNumber: normalizedFNumber,
    sex: normalizedSex,
    colorSourceValue: optional(values, "color"),
    fatherSourceCoreId: optional(values, "father_id"),
    fatherNameSourceValue: optional(values, "father_name"),
    motherSourceCoreId: optional(values, "mother_id"),
    motherNameSourceValue: optional(values, "mother_name"),
  };
}

function vaultRow(
  values: CanonicalValues,
  issues: SourceRowIssue[],
): AdaptedCurrentVaultRow | null {
  const displayName = nonEmpty(values, "core_name", issues);
  const normalizedClass = coreClass(values, issues);
  const normalizedElement = element(values, issues);
  const normalizedFNumber = fNumber(values, issues);
  const normalizedSex = sex(values, issues);
  const maiden = nullableBoolean(values, "maiden_eligible", issues);
  if (
    hasErrors(issues) ||
    displayName === null ||
    normalizedClass === null ||
    normalizedElement === null ||
    normalizedFNumber === null ||
    normalizedSex === null
  )
    return null;
  return {
    sourceType: "current_vault",
    sourceCoreId: null,
    displayName,
    coreClass: normalizedClass,
    element: normalizedElement,
    fNumber: normalizedFNumber,
    sex: normalizedSex,
    maidenEligible: maiden.value,
    maidenSourceValue: maiden.raw,
    maidenDataStatus: maiden.invalid
      ? "invalid"
      : maiden.value === null
        ? "missing"
        : "valid",
    identityResolutionStatus: "review_required",
  };
}

function arenaRow(
  values: CanonicalValues,
  issues: SourceRowIssue[],
): AdaptedCurrentArenaRow | null {
  const sourceCoreId = nonEmpty(values, "core_id", issues);
  const priceUsdSourceValue = exactNonNegativeDecimal(
    values,
    "price_usd_source_value",
    issues,
  );
  if (
    hasErrors(issues) ||
    sourceCoreId === null ||
    priceUsdSourceValue === null
  ) {
    return null;
  }
  return {
    sourceType: "current_arena",
    sourceCoreId,
    priceUsdSourceValue,
    createsEconomicTransaction: false,
  };
}

function canonicalize(
  columns: readonly SourceColumnProvenance[],
  rawValues: readonly string[],
): { values: CanonicalValues; provenance: readonly SourceValueProvenance[] } {
  const values: Record<string, string> = {};
  const provenance = columns.map((column, sourceIndex) => {
    const rawValue = rawValues[sourceIndex] ?? "";
    values[column.canonicalColumn] = rawValue;
    return {
      sourceIndex,
      rawHeader: column.rawHeader,
      canonicalColumn: column.canonicalColumn,
      rawValue,
    };
  });
  return { values, provenance };
}

export function adaptSourceRow(
  schema: StagedSourceSchema,
  rawValues: readonly string[],
): AdaptedSourceRow {
  if (schema.status !== "ready" || schema.sourceType === null) {
    return {
      status: "quarantined",
      sourceType: schema.sourceType,
      record: null,
      provenance: [],
      issues: [rowIssue("SCHEMA_NOT_READY", "error", null)],
    };
  }
  if (rawValues.length !== schema.columns.length) {
    return {
      status: "quarantined",
      sourceType: schema.sourceType,
      record: null,
      provenance: [],
      issues: [rowIssue("ROW_COLUMN_COUNT_MISMATCH", "error", null)],
    };
  }

  const { values, provenance } = canonicalize(schema.columns, rawValues);
  const issues: SourceRowIssue[] = [];
  const record =
    schema.sourceType === "race_merge"
      ? raceRow(values, issues)
      : schema.sourceType === "core_details"
        ? coreDetailsRow(values, issues)
        : schema.sourceType === "current_vault"
          ? vaultRow(values, issues)
          : arenaRow(values, issues);

  return {
    status: record === null || hasErrors(issues) ? "quarantined" : "ready",
    sourceType: schema.sourceType,
    record,
    provenance,
    issues,
  };
}

export type RedactedSourceRowSummary = Readonly<{
  status: AdaptedSourceRow["status"];
  sourceType: DetectableSourceType | null;
  sourceColumnCount: number;
  issueCodes: readonly SourceRowIssue["code"][];
}>;

export function redactSourceRowSummary(
  row: AdaptedSourceRow,
): RedactedSourceRowSummary {
  return {
    status: row.status,
    sourceType: row.sourceType,
    sourceColumnCount: row.provenance.length,
    issueCodes: row.issues.map(({ code }) => code),
  };
}
