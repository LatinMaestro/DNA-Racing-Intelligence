export const importSourceTypes = [
  "race_merge",
  "core_details",
  "current_vault",
  "current_arena",
  "manual_economic",
  "manual_pre_run_star_observation",
] as const;

export type ImportSourceType = (typeof importSourceTypes)[number];

export type ImportBatchStatus =
  | "uploaded"
  | "validating"
  | "quarantined"
  | "accepted"
  | "rolled_back";

export type ImportCounts = Readonly<{
  sourceRows: number;
  acceptedRows: number;
  rejectedRows: number;
  warningRows: number;
}>;

export type ImportManifestInput = Readonly<{
  batchId: string;
  sourceType: ImportSourceType;
  sourceFilename: string;
  checksumSha256: string;
  uploadedAt: string;
  importCompletedAt: string | null;
  minimumAcceptedEventAt: string | null;
  maximumAcceptedEventAt: string | null;
  latestAcceptedEventAt: string | null;
  counts: ImportCounts;
  schemaVersion: string;
  status: ImportBatchStatus;
}>;

export type ImportManifest = ImportManifestInput;

export type RaceEconomicTransactionType = "entry_fee" | "payout";

export type RaceMode = "bike" | "car" | "horse";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must not be empty.`);
  return normalized;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

function instant(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${field} must be a valid timestamp.`);
  }
  return parsed.toISOString();
}

function optionalInstant(value: string | null, field: string): string | null {
  return value === null ? null : instant(value, field);
}

function stableKey(namespace: string, parts: readonly string[]): string {
  const safeNamespace = nonEmpty(namespace, "namespace");
  const encodedParts = parts.map((part, index) => {
    const normalized = nonEmpty(part, `key part ${index + 1}`);
    return `${normalized.length}:${normalized}`;
  });
  return `${safeNamespace}|${encodedParts.join("|")}`;
}

export function normalizeSourceHeader(rawHeader: string): string {
  return rawHeader
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function canonicalSourceColumn(
  sourceType: ImportSourceType,
  rawHeader: string,
): string {
  const normalized = normalizeSourceHeader(rawHeader);

  if (sourceType === "core_details" && normalized === "bikeid") {
    return "core_id";
  }

  return normalized;
}

export function normalizeSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    throw new TypeError("checksumSha256 must contain exactly 64 hexadecimal characters.");
  }
  return normalized;
}

export function validateImportManifest(
  input: ImportManifestInput,
): ImportManifest {
  const sourceRows = nonNegativeInteger(
    input.counts.sourceRows,
    "counts.sourceRows",
  );
  const acceptedRows = nonNegativeInteger(
    input.counts.acceptedRows,
    "counts.acceptedRows",
  );
  const rejectedRows = nonNegativeInteger(
    input.counts.rejectedRows,
    "counts.rejectedRows",
  );
  const warningRows = nonNegativeInteger(
    input.counts.warningRows,
    "counts.warningRows",
  );

  if (acceptedRows + rejectedRows !== sourceRows) {
    throw new RangeError(
      "acceptedRows plus rejectedRows must equal sourceRows.",
    );
  }
  if (warningRows > sourceRows) {
    throw new RangeError("warningRows must not exceed sourceRows.");
  }

  const uploadedAt = instant(input.uploadedAt, "uploadedAt");
  const importCompletedAt = optionalInstant(
    input.importCompletedAt,
    "importCompletedAt",
  );
  const minimumAcceptedEventAt = optionalInstant(
    input.minimumAcceptedEventAt,
    "minimumAcceptedEventAt",
  );
  const maximumAcceptedEventAt = optionalInstant(
    input.maximumAcceptedEventAt,
    "maximumAcceptedEventAt",
  );
  const latestAcceptedEventAt = optionalInstant(
    input.latestAcceptedEventAt,
    "latestAcceptedEventAt",
  );

  if (
    importCompletedAt !== null &&
    new Date(importCompletedAt) < new Date(uploadedAt)
  ) {
    throw new RangeError("importCompletedAt must not precede uploadedAt.");
  }

  const acceptedTimestamps = [
    minimumAcceptedEventAt,
    maximumAcceptedEventAt,
    latestAcceptedEventAt,
  ];
  const populatedTimestampCount = acceptedTimestamps.filter(
    (value) => value !== null,
  ).length;

  if (
    (acceptedRows === 0 && populatedTimestampCount !== 0) ||
    (acceptedRows > 0 && populatedTimestampCount !== acceptedTimestamps.length)
  ) {
    throw new RangeError(
      "Accepted-event timestamps must be all present for accepted rows and all absent otherwise.",
    );
  }

  if (
    minimumAcceptedEventAt !== null &&
    maximumAcceptedEventAt !== null &&
    latestAcceptedEventAt !== null
  ) {
    const minimum = new Date(minimumAcceptedEventAt).getTime();
    const maximum = new Date(maximumAcceptedEventAt).getTime();
    const latest = new Date(latestAcceptedEventAt).getTime();

    if (minimum > maximum || latest < minimum || latest > maximum) {
      throw new RangeError(
        "Accepted-event timestamps must satisfy minimum <= latest <= maximum.",
      );
    }
  }

  return {
    ...input,
    batchId: nonEmpty(input.batchId, "batchId"),
    sourceFilename: nonEmpty(input.sourceFilename, "sourceFilename"),
    checksumSha256: normalizeSha256(input.checksumSha256),
    uploadedAt,
    importCompletedAt,
    minimumAcceptedEventAt,
    maximumAcceptedEventAt,
    latestAcceptedEventAt,
    schemaVersion: nonEmpty(input.schemaVersion, "schemaVersion"),
    counts: { sourceRows, acceptedRows, rejectedRows, warningRows },
  };
}

export function raceEntryNaturalKey(
  eventId: string,
  coreId: string,
): string {
  return stableKey("race_entry", [eventId, coreId]);
}

export function raceEconomicNaturalKey(
  raceEntryKey: string,
  transactionType: RaceEconomicTransactionType,
): string {
  return stableKey("race_economic", [raceEntryKey, transactionType]);
}

export type ManualObservationReconciliationInput = Readonly<{
  authoritativeEventId?: string;
  eventStartsAt: string;
  mode: RaceMode;
  distance: number;
  gateCount: number;
  enteredCoreIds: readonly string[];
}>;

export type ManualObservationReconciliationKey = Readonly<{
  key: string;
  authority: "authoritative_event_id" | "candidate_only";
}>;

export function manualObservationReconciliationKey(
  input: ManualObservationReconciliationInput,
): ManualObservationReconciliationKey {
  if (input.authoritativeEventId?.trim()) {
    return {
      key: stableKey("manual_star_event", [input.authoritativeEventId]),
      authority: "authoritative_event_id",
    };
  }

  if (!Number.isSafeInteger(input.distance) || input.distance <= 0) {
    throw new RangeError("distance must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(input.gateCount) || input.gateCount <= 0) {
    throw new RangeError("gateCount must be a positive safe integer.");
  }

  const enteredCoreIds = [...new Set(input.enteredCoreIds.map((id) => nonEmpty(id, "entered core ID")))]
    .sort((left, right) => left.localeCompare(right));

  if (enteredCoreIds.length === 0) {
    throw new RangeError("At least one entered core ID is required.");
  }

  return {
    key: stableKey("manual_star_candidate", [
      instant(input.eventStartsAt, "eventStartsAt"),
      input.mode,
      String(input.distance),
      String(input.gateCount),
      ...enteredCoreIds,
    ]),
    authority: "candidate_only",
  };
}
