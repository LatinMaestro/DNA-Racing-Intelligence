import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_SCENARIOS = [
  "grouped_race_append_ordering",
  "boundary_deduplication_replay",
  "older_backfill",
  "vault_arena_replacement",
  "core_details_upsert_lineage_refresh",
  "malformed_conflict_quarantine",
  "rollback_restore",
  "aggregate_retry_reconciliation",
  "freshness_provenance",
  "bounded_memory_processing",
] as const;

const COMMAND_BY_SCENARIO = {
  grouped_race_append_ordering: "recovery_verify_grouped_race_append",
  boundary_deduplication_replay: "recovery_verify_deduplication_replay",
  older_backfill: "recovery_verify_older_backfill",
  vault_arena_replacement: "recovery_verify_snapshot_replacement",
  core_details_upsert_lineage_refresh:
    "recovery_verify_core_details_lineage_refresh",
  malformed_conflict_quarantine: "recovery_verify_conflict_quarantine",
  rollback_restore: "recovery_verify_rollback_restore",
  aggregate_retry_reconciliation: "recovery_verify_aggregate_retry",
  freshness_provenance: "recovery_verify_freshness_provenance",
  bounded_memory_processing: "recovery_verify_bounded_memory",
} as const;

export type HostedRecoveryScenario = (typeof REQUIRED_SCENARIOS)[number];
export type HostedRecoveryCommandId =
  (typeof COMMAND_BY_SCENARIO)[HostedRecoveryScenario];

export type HostedRecoveryScenarioAttestation = Readonly<{
  attestationId: string;
  scenario: HostedRecoveryScenario;
  commandId: HostedRecoveryCommandId;
  headSha: string;
  sourceContractSha256: string;
  fixtureManifestSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  assertionsPassed: number;
  assertionsTotal: number;
  idempotencyVerified: boolean;
  activeVersionUnchangedOnFailure: boolean;
  rollbackRestoredPreviousVersion: boolean;
  freshnessBoundToAcceptedVersion: boolean;
  provenanceComplete: boolean;
  boundedMemoryVerified: boolean;
  syntheticFixturesOnly: boolean;
  privateDataObserved: boolean;
  retainedPrivateArtifact: boolean;
}>;

export type HostedRecoveryAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  sourceContractSha256: string;
  fixtureManifestSha256: string;
  attestations: readonly HostedRecoveryScenarioAttestation[];
}>;

export type HostedRecoveryAttestationIssue = Readonly<{
  code:
    | "SCENARIO_MISSING"
    | "SCENARIO_STALE"
    | "COMMAND_MISMATCH"
    | "SOURCE_CONTRACT_MISMATCH"
    | "FIXTURE_MANIFEST_MISMATCH"
    | "CHECK_FAILED"
    | "ASSERTIONS_INCOMPLETE"
    | "IDEMPOTENCY_UNVERIFIED"
    | "FAILURE_ACTIVATED_VERSION"
    | "ROLLBACK_NOT_RESTORED"
    | "FRESHNESS_NOT_VERSION_BOUND"
    | "PROVENANCE_INCOMPLETE"
    | "BOUNDED_MEMORY_UNVERIFIED"
    | "NON_SYNTHETIC_FIXTURE"
    | "PRIVATE_DATA_OBSERVED"
    | "PRIVATE_ARTIFACT_RETAINED"
    | "INVALID_TIME_ORDER";
  scenario: HostedRecoveryScenario;
  severity: "review" | "block";
}>;

export type HostedRecoveryAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  passedScenarios: readonly HostedRecoveryScenario[];
  check: CumulativeRehearsalCheck;
  issues: readonly HostedRecoveryAttestationIssue[];
  privateArtifactsRetained: false;
  workflowDispatchAllowed: false;
  mergeAllowed: false;
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

function assertRuntimeShape(input: HostedRecoveryAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.sourceContractSha256, "Source-contract digest");
  sha256(input.fixtureManifestSha256, "Fixture-manifest digest");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Recovery attestations must be an array.");
  }

  const ids = new Set<string>();
  const scenarios = new Set<HostedRecoveryScenario>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_SCENARIOS.includes(attestation.scenario)) {
      throw new Error("Recovery attestation scenario is invalid.");
    }
    if (scenarios.has(attestation.scenario)) {
      throw new Error(
        `Recovery attestation ${attestation.scenario} must be unique.`,
      );
    }
    scenarios.add(attestation.scenario);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.scenario} head`);
    sha256(
      attestation.sourceContractSha256,
      `${attestation.scenario} source-contract digest`,
    );
    sha256(
      attestation.fixtureManifestSha256,
      `${attestation.scenario} fixture-manifest digest`,
    );
    exactUtc(attestation.startedAt, `${attestation.scenario} start`);
    exactUtc(attestation.completedAt, `${attestation.scenario} completion`);
    nonNegativeInteger(attestation.exitCode, `${attestation.scenario} exit`);
    sha256(attestation.summarySha256, `${attestation.scenario} summary`);
    nonNegativeInteger(
      attestation.assertionsPassed,
      `${attestation.scenario} passed assertions`,
    );
    positiveInteger(
      attestation.assertionsTotal,
      `${attestation.scenario} total assertions`,
    );
    for (const [field, value] of Object.entries({
      idempotencyVerified: attestation.idempotencyVerified,
      activeVersionUnchangedOnFailure:
        attestation.activeVersionUnchangedOnFailure,
      rollbackRestoredPreviousVersion:
        attestation.rollbackRestoredPreviousVersion,
      freshnessBoundToAcceptedVersion:
        attestation.freshnessBoundToAcceptedVersion,
      provenanceComplete: attestation.provenanceComplete,
      boundedMemoryVerified: attestation.boundedMemoryVerified,
      syntheticFixturesOnly: attestation.syntheticFixturesOnly,
      privateDataObserved: attestation.privateDataObserved,
      retainedPrivateArtifact: attestation.retainedPrivateArtifact,
    })) {
      explicitBoolean(value, `${attestation.scenario} ${field}`);
    }
  }
}

function issue(
  code: HostedRecoveryAttestationIssue["code"],
  scenario: HostedRecoveryScenario,
  severity: HostedRecoveryAttestationIssue["severity"],
): HostedRecoveryAttestationIssue {
  return { code, scenario, severity };
}

export function projectHostedRecoveryAttestations(
  input: HostedRecoveryAttestationInput,
): HostedRecoveryAttestationProjection {
  assertRuntimeShape(input);
  const byScenario = new Map(
    input.attestations.map((attestation) => [
      attestation.scenario,
      attestation,
    ]),
  );
  const issues: HostedRecoveryAttestationIssue[] = [];
  const passedScenarios: HostedRecoveryScenario[] = [];

  for (const scenario of REQUIRED_SCENARIOS) {
    const attestation = byScenario.get(scenario);
    if (attestation === undefined) {
      issues.push(issue("SCENARIO_MISSING", scenario, "review"));
      continue;
    }

    const blocking: HostedRecoveryAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("SCENARIO_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_SCENARIO[scenario]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.sourceContractSha256 !== input.sourceContractSha256) {
      blocking.push("SOURCE_CONTRACT_MISMATCH");
    }
    if (attestation.fixtureManifestSha256 !== input.fixtureManifestSha256) {
      blocking.push("FIXTURE_MANIFEST_MISMATCH");
    }
    if (attestation.exitCode !== 0) {
      blocking.push("CHECK_FAILED");
    }
    if (attestation.assertionsPassed !== attestation.assertionsTotal) {
      blocking.push("ASSERTIONS_INCOMPLETE");
    }
    if (
      (scenario === "boundary_deduplication_replay" ||
        scenario === "aggregate_retry_reconciliation") &&
      !attestation.idempotencyVerified
    ) {
      blocking.push("IDEMPOTENCY_UNVERIFIED");
    }
    if (
      scenario === "malformed_conflict_quarantine" &&
      !attestation.activeVersionUnchangedOnFailure
    ) {
      blocking.push("FAILURE_ACTIVATED_VERSION");
    }
    if (
      scenario === "rollback_restore" &&
      !attestation.rollbackRestoredPreviousVersion
    ) {
      blocking.push("ROLLBACK_NOT_RESTORED");
    }
    if (
      scenario === "freshness_provenance" &&
      !attestation.freshnessBoundToAcceptedVersion
    ) {
      blocking.push("FRESHNESS_NOT_VERSION_BOUND");
    }
    if (
      scenario === "freshness_provenance" &&
      !attestation.provenanceComplete
    ) {
      blocking.push("PROVENANCE_INCOMPLETE");
    }
    if (
      scenario === "bounded_memory_processing" &&
      !attestation.boundedMemoryVerified
    ) {
      blocking.push("BOUNDED_MEMORY_UNVERIFIED");
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
      Date.parse(attestation.completedAt) < Date.parse(attestation.startedAt)
    ) {
      blocking.push("INVALID_TIME_ORDER");
    }

    if (blocking.length === 0) {
      passedScenarios.push(scenario);
    } else {
      for (const code of blocking) {
        issues.push(issue(code, scenario, "block"));
      }
    }
  }

  const status = issues.some(({ severity }) => severity === "block")
    ? "blocked"
    : issues.length > 0
      ? "review_required"
      : "attested";

  return {
    status,
    passedScenarios,
    check: {
      name: "synthetic_import_replay_rollback_reconciliation",
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
    productionMutationAllowed: false,
  };
}
