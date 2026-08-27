const MAXIMUM_EQUIVALENCE_FIELDS = 128;
const FIELD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export type DnaCsvEquivalenceEntityType = "race" | "core" | "arena";

export type DnaCsvEquivalenceComparison =
  | "canonical_json"
  | "unordered_scalar_multiset";

export type DnaCsvEquivalenceStatus =
  | "match"
  | "mismatch"
  | "api_only"
  | "csv_only"
  | "both_missing";

export type DnaCsvEquivalenceImplication =
  | "equivalent_fact"
  | "api_supplement_candidate"
  | "csv_fallback_candidate"
  | "requires_source_authority_decision"
  | "unverified";

export type DnaCsvEquivalenceFieldSpec = Readonly<{
  canonicalField: string;
  apiPath: readonly string[];
  csvPath: readonly string[];
  comparison?: DnaCsvEquivalenceComparison;
  requiredForApiReplacement?: boolean;
}>;

export type DnaCsvEquivalenceEntity = Readonly<{
  entityType: DnaCsvEquivalenceEntityType;
  entityKey: string;
  facts: Readonly<Record<string, unknown>>;
}>;

export type DnaCsvEquivalenceFieldResult = Readonly<{
  canonicalField: string;
  comparison: DnaCsvEquivalenceComparison;
  apiPath: readonly string[];
  csvPath: readonly string[];
  apiPresent: boolean;
  csvPresent: boolean;
  status: DnaCsvEquivalenceStatus;
  implication: DnaCsvEquivalenceImplication;
  requiredForApiReplacement: boolean;
}>;

export type DnaCsvEquivalenceSummary = Readonly<{
  comparedFieldCount: number;
  matchedFieldCount: number;
  mismatchedFieldCount: number;
  apiOnlyFieldCount: number;
  csvOnlyFieldCount: number;
  unverifiedFieldCount: number;
  requiredFieldCount: number;
  requiredMatchedFieldCount: number;
}>;

export type DnaCsvEquivalenceReport = Readonly<{
  entityType: DnaCsvEquivalenceEntityType;
  entityKey: string;
  fields: readonly DnaCsvEquivalenceFieldResult[];
  summary: DnaCsvEquivalenceSummary;
  apiReplacementEvidenceReady: boolean;
}>;

export class DnaCsvEquivalenceError extends Error {
  constructor(message: string) {
    super(`DNA Open Lab / CSV equivalence: ${message}`);
    this.name = "DnaCsvEquivalenceError";
  }
}

type PathValue = Readonly<{
  present: boolean;
  value: unknown;
}>;

function fail(message: string): never {
  throw new DnaCsvEquivalenceError(message);
}

function safeText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1) fail(`${field} is required`);
  return normalized;
}

function safeFieldName(value: string): string {
  const normalized = safeText(value, "canonicalField");
  if (!FIELD_NAME_PATTERN.test(normalized)) {
    fail(`canonical field ${normalized} is invalid`);
  }
  return normalized;
}

function safePath(path: readonly string[], field: string): readonly string[] {
  if (path.length < 1) fail(`${field} requires at least one path segment`);
  return Object.freeze(
    path.map((segment) => safeText(segment, `${field} path segment`)),
  );
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("comparison value contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return fail("comparison value must be JSON-compatible");
}

function scalarCanonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return canonicalJson(value);
  }
  return fail("unordered scalar comparison accepts scalar array entries only");
}

function comparableValue(
  value: unknown,
  comparison: DnaCsvEquivalenceComparison,
): string {
  if (comparison === "canonical_json") return canonicalJson(value);
  if (!Array.isArray(value)) {
    return fail("unordered scalar comparison requires an array");
  }
  return `[${value.map(scalarCanonicalJson).sort().join(",")}]`;
}

function readPath(
  facts: Readonly<Record<string, unknown>>,
  path: readonly string[],
): PathValue {
  let current: unknown = facts;
  for (const segment of path) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return Object.freeze({ present: false, value: undefined });
    }
    const record = current as Readonly<Record<string, unknown>>;
    if (!Object.hasOwn(record, segment)) {
      return Object.freeze({ present: false, value: undefined });
    }
    current = record[segment];
  }
  if (current === undefined) {
    fail(`present path ${path.join(".")} contains undefined`);
  }
  return Object.freeze({ present: true, value: current });
}

function statusFor(input: {
  api: PathValue;
  csv: PathValue;
  comparison: DnaCsvEquivalenceComparison;
}): DnaCsvEquivalenceStatus {
  if (!input.api.present && !input.csv.present) return "both_missing";
  if (input.api.present && !input.csv.present) return "api_only";
  if (!input.api.present && input.csv.present) return "csv_only";
  return comparableValue(input.api.value, input.comparison) ===
    comparableValue(input.csv.value, input.comparison)
    ? "match"
    : "mismatch";
}

function implicationFor(
  status: DnaCsvEquivalenceStatus,
): DnaCsvEquivalenceImplication {
  if (status === "match") return "equivalent_fact";
  if (status === "api_only") return "api_supplement_candidate";
  if (status === "csv_only") return "csv_fallback_candidate";
  if (status === "mismatch") return "requires_source_authority_decision";
  return "unverified";
}

function validateSpecs(
  specs: readonly DnaCsvEquivalenceFieldSpec[],
): readonly DnaCsvEquivalenceFieldSpec[] {
  if (specs.length < 1 || specs.length > MAXIMUM_EQUIVALENCE_FIELDS) {
    fail(`field specification count must be between 1 and ${MAXIMUM_EQUIVALENCE_FIELDS}`);
  }
  const seen = new Set<string>();
  return Object.freeze(
    specs.map((spec) => {
      const canonicalField = safeFieldName(spec.canonicalField);
      if (seen.has(canonicalField)) {
        fail(`duplicate canonical field ${canonicalField}`);
      }
      seen.add(canonicalField);
      const comparison = spec.comparison ?? "canonical_json";
      if (
        comparison !== "canonical_json" &&
        comparison !== "unordered_scalar_multiset"
      ) {
        fail(`unsupported comparison for ${canonicalField}`);
      }
      return Object.freeze({
        canonicalField,
        apiPath: safePath(spec.apiPath, `${canonicalField}.apiPath`),
        csvPath: safePath(spec.csvPath, `${canonicalField}.csvPath`),
        comparison,
        requiredForApiReplacement: spec.requiredForApiReplacement === true,
      });
    }),
  );
}

/**
 * Compares one API observation with one canonical CSV observation without
 * choosing a source of truth. The caller supplies field paths only after the
 * relevant API shape has been observed. This deliberately keeps P2 free of
 * assumptions about undocumented race-document, telemetry or splice semantics.
 *
 * A `match` is equivalence evidence, not an authority decision. A mismatch is
 * always left unresolved for P3 source-authority review. The function is pure:
 * it performs no logging, persistence, network access or payload serialization.
 */
export function compareDnaOpenLabToCsv(input: {
  api: DnaCsvEquivalenceEntity;
  csv: DnaCsvEquivalenceEntity;
  fields: readonly DnaCsvEquivalenceFieldSpec[];
}): DnaCsvEquivalenceReport {
  if (input.api.entityType !== input.csv.entityType) {
    fail("API and CSV entity types must match");
  }
  const apiEntityKey = safeText(input.api.entityKey, "api.entityKey");
  const csvEntityKey = safeText(input.csv.entityKey, "csv.entityKey");
  if (apiEntityKey !== csvEntityKey) {
    fail("API and CSV entity keys must match");
  }

  const specs = validateSpecs(input.fields);
  const results = Object.freeze(
    specs.map((spec) => {
      const api = readPath(input.api.facts, spec.apiPath);
      const csv = readPath(input.csv.facts, spec.csvPath);
      const status = statusFor({ api, csv, comparison: spec.comparison! });
      return Object.freeze({
        canonicalField: spec.canonicalField,
        comparison: spec.comparison!,
        apiPath: spec.apiPath,
        csvPath: spec.csvPath,
        apiPresent: api.present,
        csvPresent: csv.present,
        status,
        implication: implicationFor(status),
        requiredForApiReplacement: spec.requiredForApiReplacement === true,
      });
    }),
  );

  const required = results.filter((field) => field.requiredForApiReplacement);
  const summary: DnaCsvEquivalenceSummary = Object.freeze({
    comparedFieldCount: results.length,
    matchedFieldCount: results.filter((field) => field.status === "match").length,
    mismatchedFieldCount: results.filter((field) => field.status === "mismatch")
      .length,
    apiOnlyFieldCount: results.filter((field) => field.status === "api_only").length,
    csvOnlyFieldCount: results.filter((field) => field.status === "csv_only").length,
    unverifiedFieldCount: results.filter((field) => field.status === "both_missing")
      .length,
    requiredFieldCount: required.length,
    requiredMatchedFieldCount: required.filter((field) => field.status === "match")
      .length,
  });

  return Object.freeze({
    entityType: input.api.entityType,
    entityKey: apiEntityKey,
    fields: results,
    summary,
    apiReplacementEvidenceReady:
      required.length > 0 && required.every((field) => field.status === "match"),
  });
}
