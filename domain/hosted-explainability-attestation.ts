import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_CONTROLS = [
  "recommendation_evidence",
  "sample_confidence_uncertainty",
  "freshness_coverage",
  "rule_model_provenance",
  "feature_contribution_trace",
  "alternatives_tradeoffs",
  "mode_distance_context",
  "experimental_labelling",
  "chronological_no_leakage",
  "partial_unavailable_states",
] as const;

const COMMAND_BY_CONTROL = {
  recommendation_evidence: "explain_verify_recommendation_evidence",
  sample_confidence_uncertainty: "explain_verify_sample_confidence",
  freshness_coverage: "explain_verify_freshness_coverage",
  rule_model_provenance: "explain_verify_rule_model_provenance",
  feature_contribution_trace: "explain_verify_feature_contributions",
  alternatives_tradeoffs: "explain_verify_alternatives_tradeoffs",
  mode_distance_context: "explain_verify_mode_distance_context",
  experimental_labelling: "explain_verify_experimental_labels",
  chronological_no_leakage: "explain_verify_chronological_cutoff",
  partial_unavailable_states: "explain_verify_partial_unavailable_states",
} as const;

export type HostedExplainabilityControl = (typeof REQUIRED_CONTROLS)[number];
export type HostedExplainabilityCommandId =
  (typeof COMMAND_BY_CONTROL)[HostedExplainabilityControl];

export type HostedExplainabilityControlAttestation = Readonly<{
  attestationId: string;
  control: HostedExplainabilityControl;
  commandId: HostedExplainabilityCommandId;
  headSha: string;
  recommendationManifestSha256: string;
  fixtureManifestSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  assertionsPassed: number;
  assertionsTotal: number;
  evidenceTraceVerified: boolean;
  limitationsVerified: boolean;
  provenanceVerified: boolean;
  chronologyVerified: boolean;
  reviewOnlyVerified: boolean;
  syntheticFixturesOnly: boolean;
  privateDataObserved: boolean;
  retainedPrivateArtifact: boolean;
}>;

export type HostedExplainabilityAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  recommendationManifestSha256: string;
  fixtureManifestSha256: string;
  attestations: readonly HostedExplainabilityControlAttestation[];
}>;

export type HostedExplainabilityAttestationIssue = Readonly<{
  code:
    | "CONTROL_MISSING"
    | "CONTROL_STALE"
    | "COMMAND_MISMATCH"
    | "RECOMMENDATION_MANIFEST_MISMATCH"
    | "FIXTURE_MANIFEST_MISMATCH"
    | "CHECK_FAILED"
    | "ASSERTIONS_INCOMPLETE"
    | "EVIDENCE_TRACE_UNVERIFIED"
    | "LIMITATIONS_UNVERIFIED"
    | "PROVENANCE_UNVERIFIED"
    | "CHRONOLOGY_UNVERIFIED"
    | "REVIEW_ONLY_BOUNDARY_UNVERIFIED"
    | "NON_SYNTHETIC_FIXTURE"
    | "PRIVATE_DATA_OBSERVED"
    | "PRIVATE_ARTIFACT_RETAINED"
    | "INVALID_TIME_ORDER";
  control: HostedExplainabilityControl;
  severity: "review" | "block";
}>;

export type HostedExplainabilityAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  passedControls: readonly HostedExplainabilityControl[];
  check: CumulativeRehearsalCheck;
  issues: readonly HostedExplainabilityAttestationIssue[];
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

function assertRuntimeShape(input: HostedExplainabilityAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.recommendationManifestSha256, "Recommendation-manifest digest");
  sha256(input.fixtureManifestSha256, "Fixture-manifest digest");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Explainability attestations must be an array.");
  }

  const ids = new Set<string>();
  const controls = new Set<HostedExplainabilityControl>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_CONTROLS.includes(attestation.control)) {
      throw new Error("Explainability attestation control is invalid.");
    }
    if (controls.has(attestation.control)) {
      throw new Error(
        `Explainability attestation ${attestation.control} must be unique.`,
      );
    }
    controls.add(attestation.control);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.control} head`);
    sha256(
      attestation.recommendationManifestSha256,
      `${attestation.control} recommendation-manifest digest`,
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
      evidenceTraceVerified: attestation.evidenceTraceVerified,
      limitationsVerified: attestation.limitationsVerified,
      provenanceVerified: attestation.provenanceVerified,
      chronologyVerified: attestation.chronologyVerified,
      reviewOnlyVerified: attestation.reviewOnlyVerified,
      syntheticFixturesOnly: attestation.syntheticFixturesOnly,
      privateDataObserved: attestation.privateDataObserved,
      retainedPrivateArtifact: attestation.retainedPrivateArtifact,
    })) {
      explicitBoolean(value, `${attestation.control} ${field}`);
    }
  }
}

function issue(
  code: HostedExplainabilityAttestationIssue["code"],
  control: HostedExplainabilityControl,
  severity: HostedExplainabilityAttestationIssue["severity"],
): HostedExplainabilityAttestationIssue {
  return { code, control, severity };
}

export function projectHostedExplainabilityAttestations(
  input: HostedExplainabilityAttestationInput,
): HostedExplainabilityAttestationProjection {
  assertRuntimeShape(input);
  const byControl = new Map(
    input.attestations.map((attestation) => [attestation.control, attestation]),
  );
  const issues: HostedExplainabilityAttestationIssue[] = [];
  const passedControls: HostedExplainabilityControl[] = [];

  for (const control of REQUIRED_CONTROLS) {
    const attestation = byControl.get(control);
    if (attestation === undefined) {
      issues.push(issue("CONTROL_MISSING", control, "review"));
      continue;
    }

    const blocking: HostedExplainabilityAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("CONTROL_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_CONTROL[control]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (
      attestation.recommendationManifestSha256 !==
      input.recommendationManifestSha256
    ) {
      blocking.push("RECOMMENDATION_MANIFEST_MISMATCH");
    }
    if (attestation.fixtureManifestSha256 !== input.fixtureManifestSha256) {
      blocking.push("FIXTURE_MANIFEST_MISMATCH");
    }
    if (attestation.exitCode !== 0) blocking.push("CHECK_FAILED");
    if (attestation.assertionsPassed !== attestation.assertionsTotal) {
      blocking.push("ASSERTIONS_INCOMPLETE");
    }
    if (!attestation.evidenceTraceVerified) {
      blocking.push("EVIDENCE_TRACE_UNVERIFIED");
    }
    if (!attestation.limitationsVerified) {
      blocking.push("LIMITATIONS_UNVERIFIED");
    }
    if (!attestation.provenanceVerified) {
      blocking.push("PROVENANCE_UNVERIFIED");
    }
    if (!attestation.chronologyVerified) {
      blocking.push("CHRONOLOGY_UNVERIFIED");
    }
    if (!attestation.reviewOnlyVerified) {
      blocking.push("REVIEW_ONLY_BOUNDARY_UNVERIFIED");
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
      name: "recommendation_explainability",
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
