import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_SCOPES = [
  "current_tree",
  "candidate_diff",
  "reachable_history",
  "synthetic_fixtures",
  "retained_outputs",
] as const;

const COMMAND_BY_SCOPE = {
  current_tree: "privacy_scan_current_tree",
  candidate_diff: "privacy_scan_candidate_diff",
  reachable_history: "privacy_scan_reachable_history",
  synthetic_fixtures: "privacy_verify_synthetic_fixtures",
  retained_outputs: "privacy_scan_retained_outputs",
} as const;

export type HostedPrivacyScope = (typeof REQUIRED_SCOPES)[number];
export type HostedPrivacyCommandId =
  (typeof COMMAND_BY_SCOPE)[HostedPrivacyScope];

export type HostedPrivacyScopeAttestation = Readonly<{
  attestationId: string;
  scope: HostedPrivacyScope;
  commandId: HostedPrivacyCommandId;
  headSha: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  scopeSha256: string;
  summarySha256: string;
  findingsCount: number;
  coverageComplete: boolean;
  redactedSummaryOnly: boolean;
  privateDataObserved: boolean;
  privateArtifactsRetained: boolean;
  syntheticFixturesOnly: boolean;
}>;

export type HostedPrivacyAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  attestations: readonly HostedPrivacyScopeAttestation[];
}>;

export type HostedPrivacyAttestationIssue = Readonly<{
  code:
    | "SCOPE_MISSING"
    | "SCOPE_STALE"
    | "COMMAND_MISMATCH"
    | "SCAN_FAILED"
    | "SCOPE_INCOMPLETE"
    | "FINDINGS_PRESENT"
    | "UNREDACTED_SUMMARY"
    | "PRIVATE_DATA_OBSERVED"
    | "PRIVATE_ARTIFACT_RETAINED"
    | "NON_SYNTHETIC_FIXTURE"
    | "INVALID_TIME_ORDER";
  scope: HostedPrivacyScope;
  severity: "review" | "block";
}>;

export type HostedPrivacyAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  check: CumulativeRehearsalCheck;
  issues: readonly HostedPrivacyAttestationIssue[];
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

function explicitBoolean(value: boolean, field: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be an explicit boolean.`);
  }
}

function assertRuntimeShape(input: HostedPrivacyAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Privacy attestations must be an array.");
  }

  const ids = new Set<string>();
  const scopes = new Set<HostedPrivacyScope>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_SCOPES.includes(attestation.scope)) {
      throw new Error("Privacy attestation scope is invalid.");
    }
    if (scopes.has(attestation.scope)) {
      throw new Error(
        `Privacy attestation ${attestation.scope} must be unique.`,
      );
    }
    scopes.add(attestation.scope);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.scope} head`);
    exactUtc(attestation.startedAt, `${attestation.scope} start`);
    exactUtc(attestation.completedAt, `${attestation.scope} completion`);
    if (
      !Number.isSafeInteger(attestation.exitCode) ||
      attestation.exitCode < 0
    ) {
      throw new Error(`${attestation.scope} exit code is invalid.`);
    }
    sha256(attestation.scopeSha256, `${attestation.scope} scope digest`);
    sha256(attestation.summarySha256, `${attestation.scope} summary digest`);
    if (
      !Number.isSafeInteger(attestation.findingsCount) ||
      attestation.findingsCount < 0
    ) {
      throw new Error(`${attestation.scope} findings count is invalid.`);
    }
    explicitBoolean(
      attestation.coverageComplete,
      `${attestation.scope} coverage evidence`,
    );
    explicitBoolean(
      attestation.redactedSummaryOnly,
      `${attestation.scope} redaction evidence`,
    );
    explicitBoolean(
      attestation.privateDataObserved,
      `${attestation.scope} private-data evidence`,
    );
    explicitBoolean(
      attestation.privateArtifactsRetained,
      `${attestation.scope} retained-artifact evidence`,
    );
    explicitBoolean(
      attestation.syntheticFixturesOnly,
      `${attestation.scope} synthetic-fixture evidence`,
    );
  }
}

function issue(
  code: HostedPrivacyAttestationIssue["code"],
  scope: HostedPrivacyScope,
  severity: HostedPrivacyAttestationIssue["severity"],
): HostedPrivacyAttestationIssue {
  return { code, scope, severity };
}

export function projectHostedPrivacyAttestations(
  input: HostedPrivacyAttestationInput,
): HostedPrivacyAttestationProjection {
  assertRuntimeShape(input);
  const byScope = new Map(
    input.attestations.map((attestation) => [attestation.scope, attestation]),
  );
  const issues: HostedPrivacyAttestationIssue[] = [];

  for (const scope of REQUIRED_SCOPES) {
    const attestation = byScope.get(scope);
    if (attestation === undefined) {
      issues.push(issue("SCOPE_MISSING", scope, "review"));
      continue;
    }

    const blocking: HostedPrivacyAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("SCOPE_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_SCOPE[scope]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.exitCode !== 0) {
      blocking.push("SCAN_FAILED");
    }
    if (!attestation.coverageComplete) {
      blocking.push("SCOPE_INCOMPLETE");
    }
    if (attestation.findingsCount !== 0) {
      blocking.push("FINDINGS_PRESENT");
    }
    if (!attestation.redactedSummaryOnly) {
      blocking.push("UNREDACTED_SUMMARY");
    }
    if (attestation.privateDataObserved) {
      blocking.push("PRIVATE_DATA_OBSERVED");
    }
    if (attestation.privateArtifactsRetained) {
      blocking.push("PRIVATE_ARTIFACT_RETAINED");
    }
    if (scope === "synthetic_fixtures" && !attestation.syntheticFixturesOnly) {
      blocking.push("NON_SYNTHETIC_FIXTURE");
    }
    if (
      Date.parse(attestation.completedAt) < Date.parse(attestation.startedAt)
    ) {
      blocking.push("INVALID_TIME_ORDER");
    }

    for (const code of blocking) {
      issues.push(issue(code, scope, "block"));
    }
  }

  const status = issues.some(({ severity }) => severity === "block")
    ? "blocked"
    : issues.length > 0
      ? "review_required"
      : "attested";

  return {
    status,
    check: {
      name: "privacy_scan",
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
