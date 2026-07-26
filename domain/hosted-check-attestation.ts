import type {
  CumulativeRehearsalCheck,
  CumulativeRehearsalCheckName,
} from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_CHECKS = [
  "dependency_chain",
  "shared_document_reconciliation",
  "format",
  "lint",
  "strict_typecheck",
  "all_ts_tsx_tests",
  "production_build",
  "dependency_audit",
  "privacy_scan",
  "security_privacy",
  "performance_capacity",
  "end_to_end_workflows",
  "accounting_reconciliation",
  "freshness_snapshot_integrity",
  "synthetic_import_replay_rollback_reconciliation",
] as const satisfies readonly CumulativeRehearsalCheckName[];

const COMMAND_BY_CHECK = {
  dependency_chain: "offline_merge_readiness",
  shared_document_reconciliation: "shared_document_diff",
  format: "npm_format_check",
  lint: "npm_lint",
  strict_typecheck: "npm_typecheck",
  all_ts_tsx_tests: "npm_test_all",
  production_build: "npm_build",
  dependency_audit: "npm_audit_production",
  privacy_scan: "repository_privacy_scan",
  security_privacy: "security_privacy_attestation",
  performance_capacity: "performance_capacity_attestation",
  end_to_end_workflows: "end_to_end_workflow_attestation",
  accounting_reconciliation: "accounting_reconciliation_attestation",
  freshness_snapshot_integrity: "freshness_snapshot_attestation",
  synthetic_import_replay_rollback_reconciliation:
    "synthetic_import_recovery_suite",
} as const;

export type HostedCheckCommandId =
  (typeof COMMAND_BY_CHECK)[CumulativeRehearsalCheckName];

export type HostedCheckAttestation = Readonly<{
  attestationId: string;
  check: CumulativeRehearsalCheckName;
  commandId: HostedCheckCommandId;
  headSha: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  hostedWorkspace: boolean;
  redactedSummaryOnly: boolean;
  privateDataObserved: boolean;
  syntheticFixturesOnly: boolean;
}>;

export type HostedCheckAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  attestations: readonly HostedCheckAttestation[];
}>;

export type HostedCheckAttestationIssue = Readonly<{
  code:
    | "ATTESTATION_MISSING"
    | "ATTESTATION_STALE"
    | "COMMAND_MISMATCH"
    | "CHECK_FAILED"
    | "NON_HOSTED_EXECUTION"
    | "UNREDACTED_SUMMARY"
    | "PRIVATE_DATA_OBSERVED"
    | "NON_SYNTHETIC_FIXTURE"
    | "INVALID_TIME_ORDER";
  check: CumulativeRehearsalCheckName;
  severity: "review" | "block";
}>;

export type HostedCheckAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  checks: readonly CumulativeRehearsalCheck[];
  issues: readonly HostedCheckAttestationIssue[];
  privateArtifactsRetained: false;
  workflowDispatchAllowed: false;
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
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid timestamp.`);
  }
  return parsed;
}

function explicitBoolean(value: boolean, field: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be an explicit boolean.`);
  }
}

function assertRuntimeShape(input: HostedCheckAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Hosted attestations must be an array.");
  }

  const ids = new Set<string>();
  const checks = new Set<CumulativeRehearsalCheckName>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_CHECKS.includes(attestation.check)) {
      throw new Error("Hosted attestation check is invalid.");
    }
    if (checks.has(attestation.check)) {
      throw new Error(
        `Hosted attestation ${attestation.check} must be unique.`,
      );
    }
    checks.add(attestation.check);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.check} head`);
    exactUtc(attestation.startedAt, `${attestation.check} start`);
    exactUtc(attestation.completedAt, `${attestation.check} completion`);
    if (
      !Number.isSafeInteger(attestation.exitCode) ||
      attestation.exitCode < 0
    ) {
      throw new Error(`${attestation.check} exit code is invalid.`);
    }
    sha256(attestation.summarySha256, `${attestation.check} summary digest`);
    explicitBoolean(
      attestation.hostedWorkspace,
      `${attestation.check} hosted-workspace evidence`,
    );
    explicitBoolean(
      attestation.redactedSummaryOnly,
      `${attestation.check} redaction evidence`,
    );
    explicitBoolean(
      attestation.privateDataObserved,
      `${attestation.check} private-data evidence`,
    );
    explicitBoolean(
      attestation.syntheticFixturesOnly,
      `${attestation.check} synthetic-fixture evidence`,
    );
  }
}

function issue(
  code: HostedCheckAttestationIssue["code"],
  check: CumulativeRehearsalCheckName,
  severity: HostedCheckAttestationIssue["severity"],
): HostedCheckAttestationIssue {
  return { code, check, severity };
}

export function projectHostedCheckAttestations(
  input: HostedCheckAttestationInput,
): HostedCheckAttestationProjection {
  assertRuntimeShape(input);
  const byCheck = new Map(
    input.attestations.map((attestation) => [attestation.check, attestation]),
  );
  const issues: HostedCheckAttestationIssue[] = [];
  const checks: CumulativeRehearsalCheck[] = [];

  for (const name of REQUIRED_CHECKS) {
    const attestation = byCheck.get(name);
    if (attestation === undefined) {
      issues.push(issue("ATTESTATION_MISSING", name, "review"));
      checks.push({ name, state: "not_run", headSha: null });
      continue;
    }

    const blockingCodes: HostedCheckAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blockingCodes.push("ATTESTATION_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_CHECK[name]) {
      blockingCodes.push("COMMAND_MISMATCH");
    }
    if (attestation.exitCode !== 0) {
      blockingCodes.push("CHECK_FAILED");
    }
    if (!attestation.hostedWorkspace) {
      blockingCodes.push("NON_HOSTED_EXECUTION");
    }
    if (!attestation.redactedSummaryOnly) {
      blockingCodes.push("UNREDACTED_SUMMARY");
    }
    if (attestation.privateDataObserved) {
      blockingCodes.push("PRIVATE_DATA_OBSERVED");
    }
    if (
      (name === "end_to_end_workflows" ||
        name === "accounting_reconciliation" ||
        name === "synthetic_import_replay_rollback_reconciliation") &&
      !attestation.syntheticFixturesOnly
    ) {
      blockingCodes.push("NON_SYNTHETIC_FIXTURE");
    }
    if (
      Date.parse(attestation.completedAt) < Date.parse(attestation.startedAt)
    ) {
      blockingCodes.push("INVALID_TIME_ORDER");
    }

    for (const code of blockingCodes) {
      issues.push(issue(code, name, "block"));
    }
    checks.push({
      name,
      state: blockingCodes.length === 0 ? "passed" : "failed",
      headSha: input.composedHeadSha,
    });
  }

  return {
    status: issues.some(({ severity }) => severity === "block")
      ? "blocked"
      : issues.length > 0
        ? "review_required"
        : "attested",
    checks,
    issues,
    privateArtifactsRetained: false,
    workflowDispatchAllowed: false,
    productionMutationAllowed: false,
  };
}
