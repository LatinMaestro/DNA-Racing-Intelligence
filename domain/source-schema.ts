import {
  normalizeSourceHeader,
  type ImportSourceType,
} from "@/domain/import-contract";

export const detectableSourceTypes = [
  "race_merge",
  "core_details",
  "current_vault",
  "current_arena",
] as const satisfies readonly ImportSourceType[];

export type DetectableSourceType = (typeof detectableSourceTypes)[number];
export type SourceEncoding = "utf_8" | "windows_1252" | "other" | "unknown";
export type SourceSchemaStatus = "ready" | "quarantined";

export type SourceColumnProvenance = Readonly<{
  sourceIndex: number;
  rawHeader: string;
  normalizedHeader: string;
  canonicalColumn: string;
  recognized: boolean;
}>;

export type SourceSchemaIssue = Readonly<{
  code:
    | "AMBIGUOUS_SCHEMA"
    | "DUPLICATE_CANONICAL_COLUMN"
    | "MALFORMED_HEADER"
    | "MISSING_REQUIRED_COLUMNS"
    | "SOURCE_SELECTION_MISMATCH"
    | "UNKNOWN_COLUMNS"
    | "UNSUPPORTED_ENCODING"
    | "UNSUPPORTED_SCHEMA";
  severity: "info" | "warning" | "error";
  occurrenceCount: number;
}>;

export type StagedSourceSchema = Readonly<{
  status: SourceSchemaStatus;
  sourceType: DetectableSourceType | null;
  schemaVersion: string | null;
  encoding: SourceEncoding;
  columns: readonly SourceColumnProvenance[];
  issues: readonly SourceSchemaIssue[];
}>;

type SourceSchemaDefinition = Readonly<{
  schemaVersion: string;
  requiredColumns: readonly string[];
  aliases: Readonly<Record<string, string>>;
}>;

export const sourceSchemaRegistry: Readonly<
  Record<DetectableSourceType, SourceSchemaDefinition>
> = {
  race_merge: {
    schemaVersion: "race-merge/v1",
    requiredColumns: [
      "event_id",
      "event_at",
      "mode",
      "distance",
      "core_id",
      "gate_count",
      "gold_star",
      "blue_star",
      "finish_position",
      "elapsed_time",
    ],
    aliases: {
      event_id: "event_id",
      event_datetime: "source_event_datetime",
      rstart_time: "event_at",
      rmode: "mode",
      rclass: "source_race_class",
      rcb: "distance",
      token_id: "core_id",
      name: "core_name",
      gate: "gate",
      rgate_count: "gate_count",
      gold_star: "gold_star",
      blue_star: "blue_star",
      pos: "finish_position",
      time: "elapsed_time",
      rformat: "source_format",
      rpayout: "payout_source_value",
      rfee: "fee_source_value",
      prize: "prize_source_value",
      toke_curr: "asset_source_value",
      r_tags: "source_tags",
    },
  },
  core_details: {
    schemaVersion: "core-details/v1",
    requiredColumns: [
      "core_id",
      "core_name",
      "core_type",
      "sex",
      "f_number",
      "element",
    ],
    aliases: {
      bikeid: "core_id",
      core_id: "core_id",
      core_name: "core_name",
      core_type: "core_type",
      gender: "sex",
      f_no: "f_number",
      element: "element",
      color: "color",
      father_name: "father_name",
      father_id: "father_id",
      mother_name: "mother_name",
      mother_id: "mother_id",
    },
  },
  current_vault: {
    schemaVersion: "current-vault/v1",
    requiredColumns: [
      "core_name",
      "f_number",
      "core_type",
      "element",
      "sex",
      "maiden_eligible",
    ],
    aliases: {
      core_name: "core_name",
      f_no: "f_number",
      core_type: "core_type",
      element: "element",
      gender: "sex",
      me: "maiden_eligible",
    },
  },
  current_arena: {
    schemaVersion: "current-arena/v1",
    requiredColumns: ["core_id", "price_usd_source_value"],
    aliases: {
      token_id: "core_id",
      price_usd: "price_usd_source_value",
    },
  },
};

function issue(
  code: SourceSchemaIssue["code"],
  severity: SourceSchemaIssue["severity"],
  occurrenceCount = 1,
): SourceSchemaIssue {
  return { code, severity, occurrenceCount };
}

function containsUnsupportedControls(sample: Uint8Array): boolean {
  return sample.some(
    (byte) => byte === 0 || (byte < 32 && ![9, 10, 13].includes(byte)),
  );
}

export function detectSourceEncoding(sample: Uint8Array): SourceEncoding {
  if (sample.length === 0 || containsUnsupportedControls(sample)) {
    return "unknown";
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return "utf_8";
  } catch {
    try {
      new TextDecoder("windows-1252", { fatal: true }).decode(sample);
      return "windows_1252";
    } catch {
      return "other";
    }
  }
}

function decodeHeader(
  headerBytes: Uint8Array,
  encoding: SourceEncoding,
): string | null {
  if (encoding !== "utf_8" && encoding !== "windows_1252") return null;

  try {
    return new TextDecoder(encoding === "utf_8" ? "utf-8" : "windows-1252", {
      fatal: true,
    }).decode(headerBytes);
  } catch {
    return null;
  }
}

function parseCsvHeader(headerText: string): string[] | null {
  const columns: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < headerText.length; index += 1) {
    const character = headerText[index];
    if (character === undefined) return null;

    if (character === '"') {
      if (quoted && headerText[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && character === ",") {
      columns.push(value);
      value = "";
      continue;
    }

    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && headerText[index + 1] === "\n") index += 1;
      break;
    }

    value += character;
  }

  if (quoted) return null;
  columns.push(value);

  return columns.length > 0 && columns.every((column) => column.trim())
    ? columns
    : null;
}

function mapColumns(
  rawHeaders: readonly string[],
  definition: SourceSchemaDefinition,
): readonly SourceColumnProvenance[] {
  return rawHeaders.map((rawHeader, sourceIndex) => {
    const normalizedHeader = normalizeSourceHeader(rawHeader);
    const canonicalColumn =
      definition.aliases[normalizedHeader] ?? normalizedHeader;
    return {
      sourceIndex,
      rawHeader,
      normalizedHeader,
      canonicalColumn,
      recognized: normalizedHeader in definition.aliases,
    };
  });
}

function missingRequiredColumns(
  columns: readonly SourceColumnProvenance[],
  definition: SourceSchemaDefinition,
): readonly string[] {
  const available = new Set(columns.map((column) => column.canonicalColumn));
  return definition.requiredColumns.filter((column) => !available.has(column));
}

function duplicateCanonicalColumnCount(
  columns: readonly SourceColumnProvenance[],
): number {
  const counts = new Map<string, number>();
  for (const column of columns) {
    counts.set(
      column.canonicalColumn,
      (counts.get(column.canonicalColumn) ?? 0) + 1,
    );
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function schemaCandidate(
  rawHeaders: readonly string[],
  sourceType: DetectableSourceType,
): boolean {
  const definition = sourceSchemaRegistry[sourceType];
  return (
    missingRequiredColumns(mapColumns(rawHeaders, definition), definition)
      .length === 0
  );
}

export function stageSourceHeader(
  input: Readonly<{
    headerBytes: Uint8Array;
    encodingProbeBytes?: Uint8Array;
    selectedSourceType?: ImportSourceType;
  }>,
): StagedSourceSchema {
  const encoding = detectSourceEncoding(
    input.encodingProbeBytes ?? input.headerBytes,
  );
  const decodedHeader = decodeHeader(input.headerBytes, encoding);
  if (decodedHeader === null) {
    return {
      status: "quarantined",
      sourceType: null,
      schemaVersion: null,
      encoding,
      columns: [],
      issues: [issue("UNSUPPORTED_ENCODING", "error")],
    };
  }

  const rawHeaders = parseCsvHeader(decodedHeader);
  if (rawHeaders === null) {
    return {
      status: "quarantined",
      sourceType: null,
      schemaVersion: null,
      encoding,
      columns: [],
      issues: [issue("MALFORMED_HEADER", "error")],
    };
  }

  const candidates = detectableSourceTypes.filter((sourceType) =>
    schemaCandidate(rawHeaders, sourceType),
  );
  const selected = input.selectedSourceType;
  let sourceType: DetectableSourceType | null = null;

  if (selected !== undefined) {
    if (
      !(detectableSourceTypes as readonly ImportSourceType[]).includes(selected)
    ) {
      return {
        status: "quarantined",
        sourceType: null,
        schemaVersion: null,
        encoding,
        columns: [],
        issues: [issue("UNSUPPORTED_SCHEMA", "error")],
      };
    }
    sourceType = selected as DetectableSourceType;
  } else if (candidates.length === 1) {
    sourceType = candidates[0] ?? null;
  } else {
    return {
      status: "quarantined",
      sourceType: null,
      schemaVersion: null,
      encoding,
      columns: [],
      issues: [
        issue(
          candidates.length > 1 ? "AMBIGUOUS_SCHEMA" : "UNSUPPORTED_SCHEMA",
          "error",
          Math.max(candidates.length, 1),
        ),
      ],
    };
  }

  if (sourceType === null) {
    throw new TypeError(
      "Source schema resolution did not select a source type.",
    );
  }

  const definition = sourceSchemaRegistry[sourceType];
  const columns = mapColumns(rawHeaders, definition);
  const missingCount = missingRequiredColumns(columns, definition).length;
  const duplicateCount = duplicateCanonicalColumnCount(columns);
  const unknownCount = columns.filter((column) => !column.recognized).length;
  const issues: SourceSchemaIssue[] = [];

  if (selected !== undefined && !candidates.includes(sourceType)) {
    issues.push(issue("SOURCE_SELECTION_MISMATCH", "error"));
  }
  if (missingCount > 0) {
    issues.push(issue("MISSING_REQUIRED_COLUMNS", "error", missingCount));
  }
  if (duplicateCount > 0) {
    issues.push(issue("DUPLICATE_CANONICAL_COLUMN", "error", duplicateCount));
  }
  if (unknownCount > 0) {
    issues.push(issue("UNKNOWN_COLUMNS", "warning", unknownCount));
  }

  return {
    status: issues.some(({ severity }) => severity === "error")
      ? "quarantined"
      : "ready",
    sourceType,
    schemaVersion: definition.schemaVersion,
    encoding,
    columns,
    issues,
  };
}

export type RedactedSourceSchemaSummary = Readonly<{
  status: SourceSchemaStatus;
  sourceType: DetectableSourceType | null;
  schemaVersion: string | null;
  encoding: SourceEncoding;
  headerCount: number;
  recognizedColumnCount: number;
  unknownColumnCount: number;
  issueCodes: readonly SourceSchemaIssue["code"][];
}>;

export function redactSourceSchemaSummary(
  staged: StagedSourceSchema,
): RedactedSourceSchemaSummary {
  const recognizedColumnCount = staged.columns.filter(
    (column) => column.recognized,
  ).length;
  return {
    status: staged.status,
    sourceType: staged.sourceType,
    schemaVersion: staged.schemaVersion,
    encoding: staged.encoding,
    headerCount: staged.columns.length,
    recognizedColumnCount,
    unknownColumnCount: staged.columns.length - recognizedColumnCount,
    issueCodes: staged.issues.map(({ code }) => code),
  };
}
