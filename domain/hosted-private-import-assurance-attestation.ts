import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_CONTROLS = [
  "core_details_lineage_file",
  "windows_1252_vault_file",
  "arena_snapshot_file",
  "six_race_merge_full_volume",
  "append_order_boundary_deduplication",
  "replay_older_backfill",
  "replacement_snapshots",
  "rollback_recovery",
  "malformed_conflict_quarantine",
  "freshness_provenance",
  "bounded_memory_processing",
] as const;

const COMMAND_BY_CONTROL = {
  core_details_lineage_file: "private_import_verify_core_details",
  windows_1252_vault_file: "private_import_verify_windows_1252_vault",
  arena_snapshot_file: "private_import_verify_arena",
  six_race_merge_full_volume: "private_import_verify_race_full_volume",
  append_order_boundary_deduplication:
    "private_import_verify_append_boundary_dedup",
  replay_older_backfill: "private_import_verify_replay_backfill",
  replacement_snapshots: "private_import_verify_snapshot_replacement",
  rollback_recovery: "private_import_verify_rollback",
  malformed_conflict_quarantine: "private_import_verify_quarantine",
  freshness_provenance: "private_import_verify_freshness_provenance",
  bounded_memory_processing: "private_import_verify_bounded_memory",
} as const;

const EXPECTED_COVERAGE = {
  coreDetailsRows: 18_127,
  vaultRows: 195,
  arenaRows: 792,
  raceMergeFiles: 6,
  raceMergeRows: 2_536_710,
} as const;

export type HostedPrivateImportAssuranceControl =
  (typeof REQUIRED_CONTROLS)[number];
export type HostedPrivateImportAssuranceCommandId =
  (typeof COMMAND_BY_CONTROL)[HostedPrivateImportAssuranceControl];

export type HostedPrivateImportAssuranceControlAttestation = Readonly<{
  attestationId: string;
  control: HostedPrivateImportAssuranceControl;
  commandId: HostedPrivateImportAssuranceCommandId;
  headSha: string;
  sourceManifestSha256: string;
  importContractSha256: string;
  aggregateProfileSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  assertionsPassed: number;
  assertionsTotal: number;
  authenticatedOwnerWorkspace: boolean;
  realSourceFilesUsed: boolean;
  expectedCoverageVerified: boolean;
  exactReplayVerified: boolean;
  failureIsolationVerified: boolean;
  rollbackVerified: boolean;
  freshnessProvenanceVerified: boolean;
  boundedMemoryVerified: boolean;
  rawSourcesPreservedInPrivateBoundary: boolean;
  routineLogsRedacted: boolean;
  aggregateEvidenceOnly: boolean;
  privateDataCommittedToGit: boolean;
  retainedPrivateEvidenceArtifact: boolean;
}>;

export type HostedPrivateImportAssuranceAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  sourceManifestSha256: string;
  importContractSha256: string;
  aggregateProfileSha256: string;
  coverage: Readonly<{
    coreDetailsRows: number;
    vaultRows: number;
    arenaRows: number;
    raceMergeFiles: number;
    raceMergeRows: number;
    windows1252VaultVerified: boolean;
  }>;
  attestations: readonly HostedPrivateImportAssuranceControlAttestation[];
}>;

export type HostedPrivateImportAssuranceAttestationIssue = Readonly<{
  code:
    | "CONTROL_MISSING"
    | "CONTROL_STALE"
    | "COMMAND_MISMATCH"
    | "SOURCE_MANIFEST_MISMATCH"
    | "IMPORT_CONTRACT_MISMATCH"
    | "AGGREGATE_PROFILE_MISMATCH"
    | "COVERAGE_MISMATCH"
    | "WINDOWS_1252_UNVERIFIED"
    | "CHECK_FAILED"
    | "ASSERTIONS_INCOMPLETE"
    | "OWNER_WORKSPACE_UNVERIFIED"
    | "REAL_SOURCE_FILES_UNVERIFIED"
    | "EXPECTED_COVERAGE_UNVERIFIED"
    | "REPLAY_UNVERIFIED"
    | "FAILURE_ISOLATION_UNVERIFIED"
    | "ROLLBACK_UNVERIFIED"
    | "FRESHNESS_PROVENANCE_UNVERIFIED"
    | "BOUNDED_MEMORY_UNVERIFIED"
    | "PRIVATE_RAW_RETENTION_UNVERIFIED"
    | "ROUTINE_LOG_REDACTION_UNVERIFIED"
    | "NON_AGGREGATE_EVIDENCE"
    | "PRIVATE_DATA_IN_GIT"
    | "PRIVATE_EVIDENCE_ARTIFACT_RETAINED"
    | "INVALID_TIME_ORDER";
  control: HostedPrivateImportAssuranceControl | "coverage";
  severity: "review" | "block";
}>;

export type HostedPrivateImportAssuranceAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  passedControls: readonly HostedPrivateImportAssuranceControl[];
  check: CumulativeRehearsalCheck;
  issues: readonly HostedPrivateImportAssuranceAttestationIssue[];
  privateEvidenceArtifactsRetained: false;
  sourceActivationAllowed: false;
  workflowDispatchAllowed: false;
  mergeAllowed: false;
  providerMutationAllowed: false;
  productionMutationAllowed: false;
}>;

function requiredText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required.`);
  }
}

function exactSha(value: string, field: string): void {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(
      `${field} must contain 40 lowercase hexadecimal characters.`,
    );
  }
}

function sha256(value: string, field: string): void {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(
      `${field} must contain 64 lowercase hexadecimal characters.`,
    );
  }
}

function exactUtc(value: string, field: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new Error(`${field} must be an exact UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${field} must be a valid UTC timestamp.`);
  }
  return parsed;
}

function nonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
}

function explicitBoolean(value: boolean, field: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be an explicit boolean.`);
  }
}

function assertRuntimeShape(
  input: HostedPrivateImportAssuranceAttestationInput,
): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.sourceManifestSha256, "Source-manifest digest");
  sha256(input.importContractSha256, "Import-contract digest");
  sha256(input.aggregateProfileSha256, "Aggregate-profile digest");

  for (const [field, value] of Object.entries({
    coreDetailsRows: input.coverage.coreDetailsRows,
    vaultRows: input.coverage.vaultRows,
    arenaRows: input.coverage.arenaRows,
    raceMergeFiles: input.coverage.raceMergeFiles,
    raceMergeRows: input.coverage.raceMergeRows,
  })) {
    positiveInteger(value, `Coverage ${field}`);
  }
  explicitBoolean(
    input.coverage.windows1252VaultVerified,
    "Windows-1252 Vault verification",
  );

  if (!Array.isArray(input.attestations)) {
    throw new Error("Private import assurance attestations must be an array.");
  }

  const ids = new Set<string>();
  const controls = new Set<HostedPrivateImportAssuranceControl>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_CONTROLS.includes(attestation.control)) {
      throw new Error("Private import assurance control is invalid.");
    }
    if (controls.has(attestation.control)) {
      throw new Error(
        `Private import assurance control ${attestation.control} must be unique.`,
      );
    }
    controls.add(attestation.control);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.control} head`);
    sha256(
      attestation.sourceManifestSha256,
      `${attestation.control} source-manifest digest`,
    );
    sha256(
      attestation.importContractSha256,
      `${attestation.control} import-contract digest`,
    );
    sha256(
      attestation.aggregateProfileSha256,
      `${attestation.control} aggregate-profile digest`,
    );
    exactUtc(attestation.startedAt, `${attestation.control} start`);
    exactUtc(attestation.completedAt, `${attestation.control} completion`);
    nonNegativeInteger(attestation.exitCode, `${attestation.control} exit`);
    sha256(attestation.summarySha256, `${attestation.control} summary`);
    nonNegativeInteger(
      attestation.assertionsPassed,
      `${attestation.control} passed assertions`,
    );
    positiveInteger(
      attestation.assertionsTotal,
      `${attestation.control} total assertions`,
    );
    for (const [field, value] of Object.entries({
      authenticatedOwnerWorkspace: attestation.authenticatedOwnerWorkspace,
      realSourceFilesUsed: attestation.realSourceFilesUsed,
      expectedCoverageVerified: attestation.expectedCoverageVerified,
      exactReplayVerified: attestation.exactReplayVerified,
      failureIsolationVerified: attestation.failureIsolationVerified,
      rollbackVerified: attestation.rollbackVerified,
      freshnessProvenanceVerified: attestation.freshnessProvenanceVerified,
      boundedMemoryVerified: attestation.boundedMemoryVerified,
      rawSourcesPreservedInPrivateBoundary:
        attestation.rawSourcesPreservedInPrivateBoundary,
      routineLogsRedacted: attestation.routineLogsRedacted,
      aggregateEvidenceOnly: attestation.aggregateEvidenceOnly,
      privateDataCommittedToGit: attestation.privateDataCommittedToGit,
      retainedPrivateEvidenceArtifact:
        attestation.retainedPrivateEvidenceArtifact,
    })) {
      explicitBoolean(value, `${attestation.control} ${field}`);
    }
  }
}

function issue(
  code: HostedPrivateImportAssuranceAttestationIssue["code"],
  control: HostedPrivateImportAssuranceAttestationIssue["control"],
  severity: HostedPrivateImportAssuranceAttestationIssue["severity"],
): HostedPrivateImportAssuranceAttestationIssue {
  return { code, control, severity };
}

export function projectHostedPrivateImportAssuranceAttestations(
  input: HostedPrivateImportAssuranceAttestationInput,
): HostedPrivateImportAssuranceAttestationProjection {
  assertRuntimeShape(input);
  const issues: HostedPrivateImportAssuranceAttestationIssue[] = [];
  const coverageMismatch = Object.entries(EXPECTED_COVERAGE).some(
    ([field, expected]) =>
      input.coverage[field as keyof typeof EXPECTED_COVERAGE] !== expected,
  );
  if (coverageMismatch) {
    issues.push(issue("COVERAGE_MISMATCH", "coverage", "block"));
  }
  if (!input.coverage.windows1252VaultVerified) {
    issues.push(issue("WINDOWS_1252_UNVERIFIED", "coverage", "block"));
  }

  const byControl = new Map(
    input.attestations.map((attestation) => [attestation.control, attestation]),
  );
  const passedControls: HostedPrivateImportAssuranceControl[] = [];

  for (const control of REQUIRED_CONTROLS) {
    const attestation = byControl.get(control);
    if (attestation === undefined) {
      issues.push(issue("CONTROL_MISSING", control, "review"));
      continue;
    }

    const blocking: HostedPrivateImportAssuranceAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("CONTROL_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_CONTROL[control]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.sourceManifestSha256 !== input.sourceManifestSha256) {
      blocking.push("SOURCE_MANIFEST_MISMATCH");
    }
    if (attestation.importContractSha256 !== input.importContractSha256) {
      blocking.push("IMPORT_CONTRACT_MISMATCH");
    }
    if (attestation.aggregateProfileSha256 !== input.aggregateProfileSha256) {
      blocking.push("AGGREGATE_PROFILE_MISMATCH");
    }
    if (attestation.exitCode !== 0) blocking.push("CHECK_FAILED");
    if (attestation.assertionsPassed !== attestation.assertionsTotal) {
      blocking.push("ASSERTIONS_INCOMPLETE");
    }
    if (!attestation.authenticatedOwnerWorkspace) {
      blocking.push("OWNER_WORKSPACE_UNVERIFIED");
    }
    if (!attestation.realSourceFilesUsed) {
      blocking.push("REAL_SOURCE_FILES_UNVERIFIED");
    }
    if (!attestation.expectedCoverageVerified) {
      blocking.push("EXPECTED_COVERAGE_UNVERIFIED");
    }
    if (!attestation.exactReplayVerified) {
      blocking.push("REPLAY_UNVERIFIED");
    }
    if (!attestation.failureIsolationVerified) {
      blocking.push("FAILURE_ISOLATION_UNVERIFIED");
    }
    if (!attestation.rollbackVerified) {
      blocking.push("ROLLBACK_UNVERIFIED");
    }
    if (!attestation.freshnessProvenanceVerified) {
      blocking.push("FRESHNESS_PROVENANCE_UNVERIFIED");
    }
    if (!attestation.boundedMemoryVerified) {
      blocking.push("BOUNDED_MEMORY_UNVERIFIED");
    }
    if (!attestation.rawSourcesPreservedInPrivateBoundary) {
      blocking.push("PRIVATE_RAW_RETENTION_UNVERIFIED");
    }
    if (!attestation.routineLogsRedacted) {
      blocking.push("ROUTINE_LOG_REDACTION_UNVERIFIED");
    }
    if (!attestation.aggregateEvidenceOnly) {
      blocking.push("NON_AGGREGATE_EVIDENCE");
    }
    if (attestation.privateDataCommittedToGit) {
      blocking.push("PRIVATE_DATA_IN_GIT");
    }
    if (attestation.retainedPrivateEvidenceArtifact) {
      blocking.push("PRIVATE_EVIDENCE_ARTIFACT_RETAINED");
    }
    if (
      Date.parse(attestation.completedAt) < Date.parse(attestation.startedAt)
    ) {
      blocking.push("INVALID_TIME_ORDER");
    }

    if (blocking.length === 0) {
      passedControls.push(control);
    } else {
      issues.push(...blocking.map((code) => issue(code, control, "block")));
    }
  }

  const status = issues.some(({ severity }) => severity === "block")
    ? "blocked"
    : issues.length > 0
      ? "review_required"
      : "attested";

  return {
    status,
    passedControls,
    check: {
      name: "private_real_file_import_assurance",
      state:
        status === "attested"
          ? "passed"
          : status === "blocked"
            ? "failed"
            : "not_run",
      headSha: status === "review_required" ? null : input.composedHeadSha,
    },
    issues,
    privateEvidenceArtifactsRetained: false,
    sourceActivationAllowed: false,
    workflowDispatchAllowed: false,
    mergeAllowed: false,
    providerMutationAllowed: false,
    productionMutationAllowed: false,
  };
}
