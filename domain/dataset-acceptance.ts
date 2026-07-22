import type { DetectableSourceType } from "@/domain/source-schema";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type CandidateRecord = Readonly<{
  naturalKey: string;
  fingerprintSha256: string;
}>;

export type AcceptedRecord = Readonly<{
  naturalKey: string;
  fingerprintSha256: string;
  firstAcceptedBatchId: string;
  contributingBatchIds: readonly string[];
}>;

export type DatasetVersion = Readonly<{
  versionNumber: number;
  batchId: string;
  status: "active" | "inactive" | "rolled_back";
  activatedAt: string;
  importCompletedAt: string;
  dataCurrentThrough: string | null;
  aggregateRefreshedAt: string | null;
  records: readonly AcceptedRecord[];
  rolledBackAt: string | null;
  rollbackReason: string | null;
}>;

export type DatasetAcceptanceState = Readonly<{
  sourceType: DetectableSourceType;
  acceptedBatches: readonly Readonly<{
    batchId: string;
    checksumSha256: string;
    versionNumber: number;
  }>[];
  activeVersionNumber: number | null;
  versions: readonly DatasetVersion[];
}>;

export type AcceptanceBatch = Readonly<{
  sourceType: DetectableSourceType;
  batchId: string;
  checksumSha256: string;
  activatedAt: string;
  importCompletedAt: string;
  dataCurrentThrough: string | null;
  aggregateRefreshedAt: string | null;
  records: readonly CandidateRecord[];
}>;

export type AcceptanceIssueCode =
  | "BATCH_CHECKSUM_ALREADY_ACCEPTED"
  | "FINGERPRINT_CONFLICT"
  | "INTRA_BATCH_FINGERPRINT_CONFLICT"
  | "NO_ACCEPTABLE_ROWS"
  | "STALE_DATA_CURRENT_THROUGH";

export type AcceptanceIssue = Readonly<{
  code: AcceptanceIssueCode;
  occurrenceCount: number;
  naturalKeys: readonly string[];
}>;

export type AcceptanceSummary = Readonly<{
  status: "accepted" | "idempotent" | "quarantined";
  sourceRows: number;
  acceptedRows: number;
  newRecords: number;
  changedRecords: number;
  exactDuplicateRows: number;
  quarantinedRows: number;
  issueCodes: readonly AcceptanceIssueCode[];
}>;

export type DatasetAcceptancePlan = Readonly<{
  status: AcceptanceSummary["status"];
  previousActiveVersionNumber: number | null;
  activatedVersionNumber: number | null;
  issues: readonly AcceptanceIssue[];
  summary: AcceptanceSummary;
  nextState: DatasetAcceptanceState;
}>;

function cloneRecord(record: AcceptedRecord): AcceptedRecord {
  return {
    ...record,
    contributingBatchIds: [...record.contributingBatchIds],
  };
}

function cloneVersion(version: DatasetVersion): DatasetVersion {
  return {
    ...version,
    records: version.records.map(cloneRecord),
  };
}

function cloneState(state: DatasetAcceptanceState): DatasetAcceptanceState {
  return {
    ...state,
    acceptedBatches: state.acceptedBatches.map((batch) => ({ ...batch })),
    versions: state.versions.map(cloneVersion),
  };
}

function assertIsoTimestamp(value: string, fieldName: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${fieldName} must be a canonical ISO-8601 timestamp`);
  }
}

function assertSha256(value: string, fieldName: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a lowercase SHA-256 digest`);
  }
}

function assertState(state: DatasetAcceptanceState): void {
  const activeVersions = state.versions.filter(
    (version) => version.status === "active",
  );
  const hasValidActiveVersion =
    state.activeVersionNumber === null
      ? activeVersions.length === 0
      : activeVersions.length === 1 &&
        activeVersions[0]?.versionNumber === state.activeVersionNumber;
  if (!hasValidActiveVersion) {
    throw new Error(
      "dataset state must have exactly one declared active version",
    );
  }

  const versionNumbers = state.versions.map(
    ({ versionNumber }) => versionNumber,
  );
  if (new Set(versionNumbers).size !== versionNumbers.length) {
    throw new Error("dataset version numbers must be unique");
  }
}

function assertBatch(
  state: DatasetAcceptanceState,
  batch: AcceptanceBatch,
): void {
  if (batch.sourceType !== state.sourceType) {
    throw new Error("batch source type must match dataset state");
  }
  if (batch.batchId.trim() === "") throw new Error("batchId is required");
  assertSha256(batch.checksumSha256, "checksumSha256");
  assertIsoTimestamp(batch.activatedAt, "activatedAt");
  assertIsoTimestamp(batch.importCompletedAt, "importCompletedAt");
  if (batch.dataCurrentThrough !== null) {
    assertIsoTimestamp(batch.dataCurrentThrough, "dataCurrentThrough");
  }
  if (batch.aggregateRefreshedAt !== null) {
    assertIsoTimestamp(batch.aggregateRefreshedAt, "aggregateRefreshedAt");
    if (
      Date.parse(batch.aggregateRefreshedAt) <
      Date.parse(batch.importCompletedAt)
    ) {
      throw new Error("aggregate refresh cannot precede import completion");
    }
  }
  if (Date.parse(batch.activatedAt) < Date.parse(batch.importCompletedAt)) {
    throw new Error("dataset activation cannot precede import completion");
  }
  if (
    batch.aggregateRefreshedAt !== null &&
    Date.parse(batch.aggregateRefreshedAt) < Date.parse(batch.activatedAt)
  ) {
    throw new Error("aggregate refresh cannot precede dataset activation");
  }

  for (const record of batch.records) {
    if (record.naturalKey.trim() === "") {
      throw new Error("record naturalKey is required");
    }
    assertSha256(record.fingerprintSha256, "record fingerprintSha256");
  }
}

function addIssue(
  issues: Map<AcceptanceIssueCode, Set<string>>,
  code: AcceptanceIssueCode,
  naturalKey: string,
): void {
  const keys = issues.get(code) ?? new Set<string>();
  keys.add(naturalKey);
  issues.set(code, keys);
}

function publicIssues(
  issues: Map<AcceptanceIssueCode, Set<string>>,
): AcceptanceIssue[] {
  return [...issues.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, keys]) => ({
      code,
      occurrenceCount: keys.size,
      naturalKeys: [...keys].sort(),
    }));
}

export function emptyDatasetAcceptanceState(
  sourceType: DetectableSourceType,
): DatasetAcceptanceState {
  return {
    sourceType,
    acceptedBatches: [],
    activeVersionNumber: null,
    versions: [],
  };
}

export function planDatasetAcceptance(
  state: DatasetAcceptanceState,
  batch: AcceptanceBatch,
): DatasetAcceptancePlan {
  assertState(state);
  assertBatch(state, batch);

  const previousActiveVersionNumber = state.activeVersionNumber;
  const repeatedBatch = state.acceptedBatches.find(
    ({ checksumSha256 }) => checksumSha256 === batch.checksumSha256,
  );
  if (repeatedBatch !== undefined) {
    const issue: AcceptanceIssue = {
      code: "BATCH_CHECKSUM_ALREADY_ACCEPTED",
      occurrenceCount: 1,
      naturalKeys: [],
    };
    return {
      status: "idempotent",
      previousActiveVersionNumber,
      activatedVersionNumber: null,
      issues: [issue],
      summary: {
        status: "idempotent",
        sourceRows: batch.records.length,
        acceptedRows: 0,
        newRecords: 0,
        changedRecords: 0,
        exactDuplicateRows: 0,
        quarantinedRows: 0,
        issueCodes: [issue.code],
      },
      nextState: cloneState(state),
    };
  }

  const activeVersion = state.versions.find(
    ({ versionNumber }) => versionNumber === state.activeVersionNumber,
  );
  if (
    activeVersion?.dataCurrentThrough !== null &&
    activeVersion?.dataCurrentThrough !== undefined &&
    batch.dataCurrentThrough !== null &&
    Date.parse(batch.dataCurrentThrough) <
      Date.parse(activeVersion.dataCurrentThrough)
  ) {
    const issue: AcceptanceIssue = {
      code: "STALE_DATA_CURRENT_THROUGH",
      occurrenceCount: 1,
      naturalKeys: [],
    };
    return {
      status: "quarantined",
      previousActiveVersionNumber,
      activatedVersionNumber: null,
      issues: [issue],
      summary: {
        status: "quarantined",
        sourceRows: batch.records.length,
        acceptedRows: 0,
        newRecords: 0,
        changedRecords: 0,
        exactDuplicateRows: 0,
        quarantinedRows: batch.records.length,
        issueCodes: [issue.code],
      },
      nextState: cloneState(state),
    };
  }

  const previousRecords = new Map(
    (activeVersion?.records ?? []).map((record) => [
      record.naturalKey,
      cloneRecord(record),
    ]),
  );
  const cumulativeSource =
    state.sourceType === "race_merge" || state.sourceType === "core_details";
  const currentRecords = new Map(
    cumulativeSource
      ? [...previousRecords].map(([key, record]) => [key, cloneRecord(record)])
      : [],
  );
  const candidates = new Map<string, string>();
  const conflictedBatchKeys = new Set<string>();
  const issues = new Map<AcceptanceIssueCode, Set<string>>();
  let exactDuplicateRows = 0;

  for (const record of batch.records) {
    const existingFingerprint = candidates.get(record.naturalKey);
    if (existingFingerprint === undefined) {
      candidates.set(record.naturalKey, record.fingerprintSha256);
    } else if (existingFingerprint === record.fingerprintSha256) {
      exactDuplicateRows += 1;
    } else {
      conflictedBatchKeys.add(record.naturalKey);
      addIssue(issues, "INTRA_BATCH_FINGERPRINT_CONFLICT", record.naturalKey);
    }
  }

  let newRecords = 0;
  let changedRecords = 0;
  for (const [naturalKey, fingerprintSha256] of candidates) {
    if (conflictedBatchKeys.has(naturalKey)) continue;

    const accepted = previousRecords.get(naturalKey);
    if (accepted === undefined) {
      currentRecords.set(naturalKey, {
        naturalKey,
        fingerprintSha256,
        firstAcceptedBatchId: batch.batchId,
        contributingBatchIds: [batch.batchId],
      });
      newRecords += 1;
    } else if (accepted.fingerprintSha256 === fingerprintSha256) {
      exactDuplicateRows += 1;
      currentRecords.set(naturalKey, {
        ...accepted,
        contributingBatchIds: accepted.contributingBatchIds.includes(
          batch.batchId,
        )
          ? [...accepted.contributingBatchIds]
          : [...accepted.contributingBatchIds, batch.batchId],
      });
    } else if (cumulativeSource) {
      addIssue(issues, "FINGERPRINT_CONFLICT", naturalKey);
    } else {
      currentRecords.set(naturalKey, {
        naturalKey,
        fingerprintSha256,
        firstAcceptedBatchId: batch.batchId,
        contributingBatchIds: [batch.batchId],
      });
      changedRecords += 1;
    }
  }

  const quarantinedKeys = new Set(
    [...issues.values()].flatMap((keys) => [...keys]),
  );
  const quarantinedRows = batch.records.filter((record) =>
    quarantinedKeys.has(record.naturalKey),
  ).length;
  const acceptedRows = batch.records.length - quarantinedRows;
  if (batch.records.length > 0 && acceptedRows === 0) {
    const issueList = [
      ...publicIssues(issues),
      {
        code: "NO_ACCEPTABLE_ROWS" as const,
        occurrenceCount: 1,
        naturalKeys: [],
      },
    ].sort((left, right) => left.code.localeCompare(right.code));
    return {
      status: "quarantined",
      previousActiveVersionNumber,
      activatedVersionNumber: null,
      issues: issueList,
      summary: {
        status: "quarantined",
        sourceRows: batch.records.length,
        acceptedRows: 0,
        newRecords: 0,
        changedRecords: 0,
        exactDuplicateRows,
        quarantinedRows,
        issueCodes: issueList.map(({ code }) => code),
      },
      nextState: cloneState(state),
    };
  }
  const nextVersionNumber =
    Math.max(0, ...state.versions.map(({ versionNumber }) => versionNumber)) +
    1;
  const nextVersions = state.versions.map((version) =>
    version.status === "active"
      ? ({ ...cloneVersion(version), status: "inactive" } as const)
      : cloneVersion(version),
  );
  nextVersions.push({
    versionNumber: nextVersionNumber,
    batchId: batch.batchId,
    status: "active",
    activatedAt: batch.activatedAt,
    importCompletedAt: batch.importCompletedAt,
    dataCurrentThrough:
      batch.dataCurrentThrough ?? activeVersion?.dataCurrentThrough ?? null,
    aggregateRefreshedAt: batch.aggregateRefreshedAt,
    records: [...currentRecords.values()].sort((left, right) =>
      left.naturalKey.localeCompare(right.naturalKey),
    ),
    rolledBackAt: null,
    rollbackReason: null,
  });

  const issueList = publicIssues(issues);
  const nextState: DatasetAcceptanceState = {
    sourceType: state.sourceType,
    acceptedBatches: [
      ...state.acceptedBatches.map((acceptedBatch) => ({ ...acceptedBatch })),
      {
        batchId: batch.batchId,
        checksumSha256: batch.checksumSha256,
        versionNumber: nextVersionNumber,
      },
    ],
    activeVersionNumber: nextVersionNumber,
    versions: nextVersions,
  };

  return {
    status: "accepted",
    previousActiveVersionNumber,
    activatedVersionNumber: nextVersionNumber,
    issues: issueList,
    summary: {
      status: "accepted",
      sourceRows: batch.records.length,
      acceptedRows,
      newRecords,
      changedRecords,
      exactDuplicateRows,
      quarantinedRows,
      issueCodes: issueList.map(({ code }) => code),
    },
    nextState,
  };
}

export function rollbackActiveDatasetVersion(
  state: DatasetAcceptanceState,
  input: Readonly<{
    versionNumber: number;
    rolledBackAt: string;
    reason: string;
  }>,
): DatasetAcceptanceState {
  assertState(state);
  assertIsoTimestamp(input.rolledBackAt, "rolledBackAt");
  if (input.reason.trim() === "")
    throw new Error("rollback reason is required");
  if (state.activeVersionNumber !== input.versionNumber) {
    throw new Error("only the active dataset version can be rolled back");
  }

  const restoredVersion = [...state.versions]
    .filter(
      (version) =>
        version.versionNumber < input.versionNumber &&
        version.status !== "rolled_back",
    )
    .sort((left, right) => right.versionNumber - left.versionNumber)[0];

  return {
    sourceType: state.sourceType,
    acceptedBatches: state.acceptedBatches.map((batch) => ({ ...batch })),
    activeVersionNumber: restoredVersion?.versionNumber ?? null,
    versions: state.versions.map((version) => {
      if (version.versionNumber === input.versionNumber) {
        return {
          ...cloneVersion(version),
          status: "rolled_back",
          rolledBackAt: input.rolledBackAt,
          rollbackReason: input.reason.trim(),
        };
      }
      if (version.versionNumber === restoredVersion?.versionNumber) {
        return { ...cloneVersion(version), status: "active" };
      }
      return cloneVersion(version);
    }),
  };
}

export function redactAcceptanceSummary(
  plan: DatasetAcceptancePlan,
): AcceptanceSummary {
  return {
    ...plan.summary,
    issueCodes: [...plan.summary.issueCodes],
  };
}
