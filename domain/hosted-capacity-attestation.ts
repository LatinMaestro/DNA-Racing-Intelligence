import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_CONTROLS = [
  "streaming_memory_bound",
  "preview_row_budget",
  "queue_throughput",
  "queue_retry_and_dlq",
  "database_capacity",
  "object_storage_capacity",
  "request_latency",
  "aggregate_refresh_latency",
  "provider_quota_headroom",
  "fail_closed_degradation",
] as const;

const COMMAND_BY_CONTROL = {
  streaming_memory_bound: "capacity_verify_streaming_memory",
  preview_row_budget: "capacity_verify_preview_rows",
  queue_throughput: "capacity_verify_queue_throughput",
  queue_retry_and_dlq: "capacity_verify_queue_retry_dlq",
  database_capacity: "capacity_verify_database",
  object_storage_capacity: "capacity_verify_object_storage",
  request_latency: "capacity_verify_request_latency",
  aggregate_refresh_latency: "capacity_verify_aggregate_refresh",
  provider_quota_headroom: "capacity_verify_provider_quota",
  fail_closed_degradation: "capacity_verify_fail_closed_degradation",
} as const;

const PROVIDER_CONTROLS = new Set<HostedCapacityControl>([
  "queue_throughput",
  "queue_retry_and_dlq",
  "database_capacity",
  "object_storage_capacity",
  "request_latency",
  "aggregate_refresh_latency",
  "provider_quota_headroom",
]);

export type HostedCapacityControl = (typeof REQUIRED_CONTROLS)[number];
export type HostedCapacityCommandId =
  (typeof COMMAND_BY_CONTROL)[HostedCapacityControl];

export type HostedCapacityControlAttestation = Readonly<{
  attestationId: string;
  control: HostedCapacityControl;
  commandId: HostedCapacityCommandId;
  headSha: string;
  capacityManifestSha256: string;
  workloadManifestSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  assertionsPassed: number;
  assertionsTotal: number;
  observedUnits: number;
  approvedLimitUnits: number;
  workloadComplete: boolean;
  redactedSummaryOnly: boolean;
  syntheticFixturesOnly: boolean;
  privateDataObserved: boolean;
  retainedPrivateArtifact: boolean;
  connectedProviderEvidence: boolean;
  failClosedVerified: boolean;
}>;

export type HostedCapacityAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  capacityManifestSha256: string;
  workloadManifestSha256: string;
  attestations: readonly HostedCapacityControlAttestation[];
}>;

export type HostedCapacityAttestationIssue = Readonly<{
  code:
    | "CONTROL_MISSING"
    | "CONTROL_STALE"
    | "COMMAND_MISMATCH"
    | "CAPACITY_MANIFEST_MISMATCH"
    | "WORKLOAD_MANIFEST_MISMATCH"
    | "CHECK_FAILED"
    | "ASSERTIONS_INCOMPLETE"
    | "WORKLOAD_INCOMPLETE"
    | "APPROVED_LIMIT_EXCEEDED"
    | "UNREDACTED_SUMMARY"
    | "NON_SYNTHETIC_FIXTURE"
    | "PRIVATE_DATA_OBSERVED"
    | "PRIVATE_ARTIFACT_RETAINED"
    | "PROVIDER_EVIDENCE_UNCONNECTED"
    | "FAIL_CLOSED_UNVERIFIED"
    | "INVALID_TIME_ORDER";
  control: HostedCapacityControl;
  severity: "review" | "block";
}>;

export type HostedCapacityAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  passedControls: readonly HostedCapacityControl[];
  check: CumulativeRehearsalCheck;
  issues: readonly HostedCapacityAttestationIssue[];
  privateArtifactsRetained: false;
  workflowDispatchAllowed: false;
  mergeAllowed: false;
  providerMutationAllowed: false;
  productionMutationAllowed: false;
  paidServiceActivationAllowed: false;
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

function assertRuntimeShape(input: HostedCapacityAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.capacityManifestSha256, "Capacity-manifest digest");
  sha256(input.workloadManifestSha256, "Workload-manifest digest");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Capacity attestations must be an array.");
  }

  const ids = new Set<string>();
  const controls = new Set<HostedCapacityControl>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_CONTROLS.includes(attestation.control)) {
      throw new Error("Capacity attestation control is invalid.");
    }
    if (controls.has(attestation.control)) {
      throw new Error(
        `Capacity attestation ${attestation.control} must be unique.`,
      );
    }
    controls.add(attestation.control);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.control} head`);
    sha256(
      attestation.capacityManifestSha256,
      `${attestation.control} capacity-manifest digest`,
    );
    sha256(
      attestation.workloadManifestSha256,
      `${attestation.control} workload-manifest digest`,
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
    nonNegativeInteger(
      attestation.observedUnits,
      `${attestation.control} observed units`,
    );
    positiveInteger(
      attestation.approvedLimitUnits,
      `${attestation.control} approved limit`,
    );
    for (const [field, value] of Object.entries({
      workloadComplete: attestation.workloadComplete,
      redactedSummaryOnly: attestation.redactedSummaryOnly,
      syntheticFixturesOnly: attestation.syntheticFixturesOnly,
      privateDataObserved: attestation.privateDataObserved,
      retainedPrivateArtifact: attestation.retainedPrivateArtifact,
      connectedProviderEvidence: attestation.connectedProviderEvidence,
      failClosedVerified: attestation.failClosedVerified,
    })) {
      explicitBoolean(value, `${attestation.control} ${field}`);
    }
  }
}

function issue(
  code: HostedCapacityAttestationIssue["code"],
  control: HostedCapacityControl,
  severity: HostedCapacityAttestationIssue["severity"],
): HostedCapacityAttestationIssue {
  return { code, control, severity };
}

export function projectHostedCapacityAttestations(
  input: HostedCapacityAttestationInput,
): HostedCapacityAttestationProjection {
  assertRuntimeShape(input);
  const byControl = new Map(
    input.attestations.map((attestation) => [attestation.control, attestation]),
  );
  const issues: HostedCapacityAttestationIssue[] = [];
  const passedControls: HostedCapacityControl[] = [];

  for (const control of REQUIRED_CONTROLS) {
    const attestation = byControl.get(control);
    if (attestation === undefined) {
      issues.push(issue("CONTROL_MISSING", control, "review"));
      continue;
    }

    const blocking: HostedCapacityAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("CONTROL_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_CONTROL[control]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.capacityManifestSha256 !== input.capacityManifestSha256) {
      blocking.push("CAPACITY_MANIFEST_MISMATCH");
    }
    if (attestation.workloadManifestSha256 !== input.workloadManifestSha256) {
      blocking.push("WORKLOAD_MANIFEST_MISMATCH");
    }
    if (attestation.exitCode !== 0) {
      blocking.push("CHECK_FAILED");
    }
    if (attestation.assertionsPassed !== attestation.assertionsTotal) {
      blocking.push("ASSERTIONS_INCOMPLETE");
    }
    if (!attestation.workloadComplete) {
      blocking.push("WORKLOAD_INCOMPLETE");
    }
    if (attestation.observedUnits > attestation.approvedLimitUnits) {
      blocking.push("APPROVED_LIMIT_EXCEEDED");
    }
    if (!attestation.redactedSummaryOnly) {
      blocking.push("UNREDACTED_SUMMARY");
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
      PROVIDER_CONTROLS.has(control) &&
      !attestation.connectedProviderEvidence
    ) {
      blocking.push("PROVIDER_EVIDENCE_UNCONNECTED");
    }
    if (
      control === "fail_closed_degradation" &&
      !attestation.failClosedVerified
    ) {
      blocking.push("FAIL_CLOSED_UNVERIFIED");
    }
    if (
      Date.parse(attestation.completedAt) < Date.parse(attestation.startedAt)
    ) {
      blocking.push("INVALID_TIME_ORDER");
    }

    if (blocking.length === 0) {
      passedControls.push(control);
    } else {
      for (const code of blocking) {
        issues.push(issue(code, control, "block"));
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
    passedControls,
    check: {
      name: "performance_capacity",
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
    paidServiceActivationAllowed: false,
  };
}
