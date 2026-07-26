import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_CONTROLS = [
  "accepted_version_timestamps",
  "latest_event_current_through",
  "aggregate_refresh_publication",
  "failed_attempt_non_advancement",
  "rollback_restoration",
  "source_mode_coverage",
  "snapshot_non_live_wording",
  "freshness_confidence",
  "provenance_visibility",
  "idempotent_rebuild",
] as const;

const COMMAND_BY_CONTROL = {
  accepted_version_timestamps: "freshness_verify_accepted_timestamps",
  latest_event_current_through: "freshness_verify_current_through",
  aggregate_refresh_publication: "freshness_verify_aggregate_publication",
  failed_attempt_non_advancement: "freshness_verify_failed_non_advancement",
  rollback_restoration: "freshness_verify_rollback_restoration",
  source_mode_coverage: "freshness_verify_source_mode_coverage",
  snapshot_non_live_wording: "freshness_verify_snapshot_wording",
  freshness_confidence: "freshness_verify_confidence_warnings",
  provenance_visibility: "freshness_verify_provenance",
  idempotent_rebuild: "freshness_verify_idempotent_rebuild",
} as const;

const PERSISTENCE_CONTROLS = new Set<HostedFreshnessControl>([
  "accepted_version_timestamps",
  "latest_event_current_through",
  "aggregate_refresh_publication",
  "failed_attempt_non_advancement",
  "rollback_restoration",
  "source_mode_coverage",
  "provenance_visibility",
  "idempotent_rebuild",
]);

export type HostedFreshnessControl = (typeof REQUIRED_CONTROLS)[number];
export type HostedFreshnessCommandId =
  (typeof COMMAND_BY_CONTROL)[HostedFreshnessControl];

export type HostedFreshnessControlAttestation = Readonly<{
  attestationId: string;
  control: HostedFreshnessControl;
  commandId: HostedFreshnessCommandId;
  headSha: string;
  sourceContractSha256: string;
  fixtureManifestSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  assertionsPassed: number;
  assertionsTotal: number;
  acceptedVersionVerified: boolean;
  importTimestampRetained: boolean;
  latestAcceptedEventTimestampRetained: boolean;
  aggregateRefreshTimestampRetained: boolean;
  failedAttemptExcluded: boolean;
  rollbackRestorationVerified: boolean;
  sourceModeCoverageVerified: boolean;
  nonLiveWordingVerified: boolean;
  confidenceWarningVerified: boolean;
  provenanceVerified: boolean;
  idempotentRebuildVerified: boolean;
  syntheticFixturesOnly: boolean;
  privateDataObserved: boolean;
  retainedPrivateArtifact: boolean;
  connectedPersistenceEvidence: boolean;
}>;

export type HostedFreshnessAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  sourceContractSha256: string;
  fixtureManifestSha256: string;
  attestations: readonly HostedFreshnessControlAttestation[];
}>;

export type HostedFreshnessAttestationIssue = Readonly<{
  code:
    | "CONTROL_MISSING"
    | "CONTROL_STALE"
    | "COMMAND_MISMATCH"
    | "SOURCE_CONTRACT_MISMATCH"
    | "FIXTURE_MANIFEST_MISMATCH"
    | "CHECK_FAILED"
    | "ASSERTIONS_INCOMPLETE"
    | "ACCEPTED_VERSION_UNVERIFIED"
    | "IMPORT_TIMESTAMP_MISSING"
    | "CURRENT_THROUGH_MISSING"
    | "AGGREGATE_REFRESH_TIMESTAMP_MISSING"
    | "FAILED_ATTEMPT_ADVANCED_FRESHNESS"
    | "ROLLBACK_NOT_RESTORED"
    | "SOURCE_MODE_COVERAGE_INCOMPLETE"
    | "NON_LIVE_WORDING_UNVERIFIED"
    | "CONFIDENCE_WARNING_UNVERIFIED"
    | "PROVENANCE_UNVERIFIED"
    | "IDEMPOTENT_REBUILD_UNVERIFIED"
    | "NON_SYNTHETIC_FIXTURE"
    | "PRIVATE_DATA_OBSERVED"
    | "PRIVATE_ARTIFACT_RETAINED"
    | "PERSISTENCE_EVIDENCE_UNCONNECTED"
    | "INVALID_TIME_ORDER";
  control: HostedFreshnessControl;
  severity: "review" | "block";
}>;

export type HostedFreshnessAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  passedControls: readonly HostedFreshnessControl[];
  check: CumulativeRehearsalCheck;
  issues: readonly HostedFreshnessAttestationIssue[];
  privateArtifactsRetained: false;
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

function assertRuntimeShape(input: HostedFreshnessAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.sourceContractSha256, "Source-contract digest");
  sha256(input.fixtureManifestSha256, "Fixture-manifest digest");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Freshness attestations must be an array.");
  }

  const ids = new Set<string>();
  const controls = new Set<HostedFreshnessControl>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_CONTROLS.includes(attestation.control)) {
      throw new Error("Freshness attestation control is invalid.");
    }
    if (controls.has(attestation.control)) {
      throw new Error(
        `Freshness attestation ${attestation.control} must be unique.`,
      );
    }
    controls.add(attestation.control);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.control} head`);
    sha256(
      attestation.sourceContractSha256,
      `${attestation.control} source-contract digest`,
    );
    sha256(
      attestation.fixtureManifestSha256,
      `${attestation.control} fixture-manifest digest`,
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
      acceptedVersionVerified: attestation.acceptedVersionVerified,
      importTimestampRetained: attestation.importTimestampRetained,
      latestAcceptedEventTimestampRetained:
        attestation.latestAcceptedEventTimestampRetained,
      aggregateRefreshTimestampRetained:
        attestation.aggregateRefreshTimestampRetained,
      failedAttemptExcluded: attestation.failedAttemptExcluded,
      rollbackRestorationVerified: attestation.rollbackRestorationVerified,
      sourceModeCoverageVerified: attestation.sourceModeCoverageVerified,
      nonLiveWordingVerified: attestation.nonLiveWordingVerified,
      confidenceWarningVerified: attestation.confidenceWarningVerified,
      provenanceVerified: attestation.provenanceVerified,
      idempotentRebuildVerified: attestation.idempotentRebuildVerified,
      syntheticFixturesOnly: attestation.syntheticFixturesOnly,
      privateDataObserved: attestation.privateDataObserved,
      retainedPrivateArtifact: attestation.retainedPrivateArtifact,
      connectedPersistenceEvidence: attestation.connectedPersistenceEvidence,
    })) {
      explicitBoolean(value, `${attestation.control} ${field}`);
    }
  }
}

function issue(
  code: HostedFreshnessAttestationIssue["code"],
  control: HostedFreshnessControl,
  severity: HostedFreshnessAttestationIssue["severity"],
): HostedFreshnessAttestationIssue {
  return { code, control, severity };
}

export function projectHostedFreshnessAttestations(
  input: HostedFreshnessAttestationInput,
): HostedFreshnessAttestationProjection {
  assertRuntimeShape(input);
  const byControl = new Map(
    input.attestations.map((attestation) => [attestation.control, attestation]),
  );
  const issues: HostedFreshnessAttestationIssue[] = [];
  const passedControls: HostedFreshnessControl[] = [];

  for (const control of REQUIRED_CONTROLS) {
    const attestation = byControl.get(control);
    if (attestation === undefined) {
      issues.push(issue("CONTROL_MISSING", control, "review"));
      continue;
    }

    const blocking: HostedFreshnessAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("CONTROL_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_CONTROL[control]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.sourceContractSha256 !== input.sourceContractSha256) {
      blocking.push("SOURCE_CONTRACT_MISMATCH");
    }
    if (attestation.fixtureManifestSha256 !== input.fixtureManifestSha256) {
      blocking.push("FIXTURE_MANIFEST_MISMATCH");
    }
    if (attestation.exitCode !== 0) blocking.push("CHECK_FAILED");
    if (attestation.assertionsPassed !== attestation.assertionsTotal) {
      blocking.push("ASSERTIONS_INCOMPLETE");
    }
    if (!attestation.acceptedVersionVerified) {
      blocking.push("ACCEPTED_VERSION_UNVERIFIED");
    }
    if (!attestation.importTimestampRetained) {
      blocking.push("IMPORT_TIMESTAMP_MISSING");
    }
    if (!attestation.latestAcceptedEventTimestampRetained) {
      blocking.push("CURRENT_THROUGH_MISSING");
    }
    if (!attestation.aggregateRefreshTimestampRetained) {
      blocking.push("AGGREGATE_REFRESH_TIMESTAMP_MISSING");
    }
    if (!attestation.failedAttemptExcluded) {
      blocking.push("FAILED_ATTEMPT_ADVANCED_FRESHNESS");
    }
    if (!attestation.rollbackRestorationVerified) {
      blocking.push("ROLLBACK_NOT_RESTORED");
    }
    if (!attestation.sourceModeCoverageVerified) {
      blocking.push("SOURCE_MODE_COVERAGE_INCOMPLETE");
    }
    if (!attestation.nonLiveWordingVerified) {
      blocking.push("NON_LIVE_WORDING_UNVERIFIED");
    }
    if (!attestation.confidenceWarningVerified) {
      blocking.push("CONFIDENCE_WARNING_UNVERIFIED");
    }
    if (!attestation.provenanceVerified) {
      blocking.push("PROVENANCE_UNVERIFIED");
    }
    if (!attestation.idempotentRebuildVerified) {
      blocking.push("IDEMPOTENT_REBUILD_UNVERIFIED");
    }
    if (!attestation.syntheticFixturesOnly) {
      blocking.push("NON_SYNTHETIC_FIXTURE");
    }
    if (attestation.privateDataObserved) {
      blocking.push("PRIVATE_DATA_OBSERVED");
    }
    if (attestation.retainedPrivateArtifact) {
      blocking.push("PRIVATE_ARTIFACT_RETAINED");
    }
    if (
      PERSISTENCE_CONTROLS.has(control) &&
      !attestation.connectedPersistenceEvidence
    ) {
      blocking.push("PERSISTENCE_EVIDENCE_UNCONNECTED");
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
      name: "freshness_snapshot_integrity",
      state:
        status === "attested"
          ? "passed"
          : status === "blocked"
            ? "failed"
            : "not_run",
      headSha: status === "review_required" ? null : input.composedHeadSha,
    },
    issues,
    privateArtifactsRetained: false,
    workflowDispatchAllowed: false,
    mergeAllowed: false,
    providerMutationAllowed: false,
    productionMutationAllowed: false,
  };
}
