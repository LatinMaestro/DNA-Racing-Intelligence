const REQUIRED_ANALYSES = [
  "performance_distributions",
  "lineage_lift",
  "breeding_validation",
  "gold_blue_era_detection",
  "tournament_maiden_calibration",
  "recommendation_calibration",
  "capacity_projection",
  "economic_reconciliation",
] as const;

const COMMAND_BY_ANALYSIS = {
  performance_distributions: "analytics_validate_performance_distributions",
  lineage_lift: "analytics_validate_lineage_lift",
  breeding_validation: "analytics_validate_breeding",
  gold_blue_era_detection: "analytics_validate_gold_blue_eras",
  tournament_maiden_calibration: "analytics_validate_tournament_maiden",
  recommendation_calibration: "analytics_validate_recommendations",
  capacity_projection: "analytics_validate_capacity",
  economic_reconciliation: "analytics_reconcile_economics",
} as const;

const APPROVED_LIMITATION_BY_ANALYSIS = {
  breeding_validation: "breeding_timestamps_unavailable",
  tournament_maiden_calibration: "historical_me_unavailable",
} as const;

const VALIDATION_STATES = [
  "passed",
  "limited",
  "unavailable",
  "failed",
] as const;

export type HostedAnalyticalValidationName = (typeof REQUIRED_ANALYSES)[number];
export type HostedAnalyticalValidationCommandId =
  (typeof COMMAND_BY_ANALYSIS)[HostedAnalyticalValidationName];
export type HostedAnalyticalValidationState =
  (typeof VALIDATION_STATES)[number];

export type HostedAnalyticalValidationAttestation = Readonly<{
  attestationId: string;
  analysis: HostedAnalyticalValidationName;
  commandId: HostedAnalyticalValidationCommandId;
  headSha: string;
  sourceManifestSha256: string;
  chronologicalCutoffAt: string;
  startedAt: string;
  completedAt: string;
  state: HostedAnalyticalValidationState;
  exitCode: number | null;
  summarySha256: string | null;
  limitationCode: string | null;
  ownerAuthenticatedWorkspace: boolean;
  aggregateEvidenceOnly: boolean;
  coverageDocumented: boolean;
  experimentalLabelRetained: boolean;
  futureLeakageDetected: boolean;
  rawPrivateRowsRetained: boolean;
  historicalBgcEconomicsExcluded: boolean;
  transfersExcluded: boolean;
}>;

export type HostedAnalyticalValidationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  sourceManifestSha256: string;
  currentThroughAt: string;
  attestations: readonly HostedAnalyticalValidationAttestation[];
}>;

export type HostedAnalyticalValidationIssue = Readonly<{
  code:
    | "ANALYSIS_MISSING"
    | "ANALYSIS_STALE"
    | "COMMAND_MISMATCH"
    | "SOURCE_MISMATCH"
    | "VALIDATION_FAILED"
    | "UNAPPROVED_LIMITATION"
    | "APPROVED_UNAVAILABLE"
    | "EVIDENCE_LIMITED"
    | "NON_OWNER_WORKSPACE"
    | "NON_AGGREGATE_EVIDENCE"
    | "COVERAGE_UNDOCUMENTED"
    | "EXPERIMENTAL_LABEL_MISSING"
    | "LEAKAGE_DETECTED"
    | "RAW_PRIVATE_ROWS_RETAINED"
    | "BGC_ECONOMICS_INCLUDED"
    | "TRANSFERS_INCLUDED"
    | "INVALID_TIME_ORDER"
    | "CUTOFF_AFTER_CURRENT_THROUGH";
  analysis: HostedAnalyticalValidationName;
  severity: "review" | "block";
}>;

export type HostedAnalyticalValidationProjection = Readonly<{
  status:
    "blocked" | "review_required" | "validated_with_limitations" | "validated";
  passed: readonly HostedAnalyticalValidationName[];
  limited: readonly HostedAnalyticalValidationName[];
  unavailable: readonly HostedAnalyticalValidationName[];
  issues: readonly HostedAnalyticalValidationIssue[];
  aggregateEvidenceOnly: true;
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

function assertRuntimeShape(input: HostedAnalyticalValidationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.sourceManifestSha256, "Source-manifest digest");
  exactUtc(input.currentThroughAt, "Current-through time");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Analytical attestations must be an array.");
  }

  const ids = new Set<string>();
  const analyses = new Set<HostedAnalyticalValidationName>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_ANALYSES.includes(attestation.analysis)) {
      throw new Error("Analytical attestation name is invalid.");
    }
    if (analyses.has(attestation.analysis)) {
      throw new Error(
        `Analytical attestation ${attestation.analysis} must be unique.`,
      );
    }
    analyses.add(attestation.analysis);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.analysis} head`);
    sha256(
      attestation.sourceManifestSha256,
      `${attestation.analysis} source-manifest digest`,
    );
    exactUtc(
      attestation.chronologicalCutoffAt,
      `${attestation.analysis} chronological cutoff`,
    );
    exactUtc(attestation.startedAt, `${attestation.analysis} start`);
    exactUtc(attestation.completedAt, `${attestation.analysis} completion`);
    if (!VALIDATION_STATES.includes(attestation.state)) {
      throw new Error(`${attestation.analysis} state is invalid.`);
    }
    if (attestation.state === "unavailable") {
      if (attestation.exitCode !== null || attestation.summarySha256 !== null) {
        throw new Error(
          `${attestation.analysis} unavailable evidence must not claim execution.`,
        );
      }
    } else {
      if (
        !Number.isSafeInteger(attestation.exitCode) ||
        (attestation.exitCode ?? -1) < 0
      ) {
        throw new Error(`${attestation.analysis} exit code is invalid.`);
      }
      if (attestation.summarySha256 === null) {
        throw new Error(`${attestation.analysis} summary digest is required.`);
      }
      sha256(
        attestation.summarySha256,
        `${attestation.analysis} summary digest`,
      );
    }
    if (
      (attestation.state === "limited" ||
        attestation.state === "unavailable") !==
      (attestation.limitationCode !== null)
    ) {
      throw new Error(
        `${attestation.analysis} limitation evidence is inconsistent.`,
      );
    }
    if (attestation.limitationCode !== null) {
      requiredText(attestation.limitationCode, "Limitation code");
    }
    for (const [field, value] of Object.entries({
      ownerAuthenticatedWorkspace: attestation.ownerAuthenticatedWorkspace,
      aggregateEvidenceOnly: attestation.aggregateEvidenceOnly,
      coverageDocumented: attestation.coverageDocumented,
      experimentalLabelRetained: attestation.experimentalLabelRetained,
      futureLeakageDetected: attestation.futureLeakageDetected,
      rawPrivateRowsRetained: attestation.rawPrivateRowsRetained,
      historicalBgcEconomicsExcluded:
        attestation.historicalBgcEconomicsExcluded,
      transfersExcluded: attestation.transfersExcluded,
    })) {
      explicitBoolean(value, `${attestation.analysis} ${field}`);
    }
  }
}

function issue(
  code: HostedAnalyticalValidationIssue["code"],
  analysis: HostedAnalyticalValidationName,
  severity: HostedAnalyticalValidationIssue["severity"],
): HostedAnalyticalValidationIssue {
  return { code, analysis, severity };
}

function approvedLimitation(
  analysis: HostedAnalyticalValidationName,
): string | undefined {
  return APPROVED_LIMITATION_BY_ANALYSIS[
    analysis as keyof typeof APPROVED_LIMITATION_BY_ANALYSIS
  ];
}

export function projectHostedAnalyticalValidation(
  input: HostedAnalyticalValidationInput,
): HostedAnalyticalValidationProjection {
  assertRuntimeShape(input);
  const byAnalysis = new Map(
    input.attestations.map((attestation) => [
      attestation.analysis,
      attestation,
    ]),
  );
  const issues: HostedAnalyticalValidationIssue[] = [];
  const passed: HostedAnalyticalValidationName[] = [];
  const limited: HostedAnalyticalValidationName[] = [];
  const unavailable: HostedAnalyticalValidationName[] = [];

  for (const analysis of REQUIRED_ANALYSES) {
    const attestation = byAnalysis.get(analysis);
    if (attestation === undefined) {
      issues.push(issue("ANALYSIS_MISSING", analysis, "review"));
      continue;
    }

    const blocking: HostedAnalyticalValidationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("ANALYSIS_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_ANALYSIS[analysis]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.sourceManifestSha256 !== input.sourceManifestSha256) {
      blocking.push("SOURCE_MISMATCH");
    }
    if (
      attestation.state === "failed" ||
      (attestation.exitCode !== null && attestation.exitCode !== 0)
    ) {
      blocking.push("VALIDATION_FAILED");
    }
    const approved = approvedLimitation(analysis);
    if (
      (attestation.state === "limited" ||
        attestation.state === "unavailable") &&
      attestation.limitationCode !== approved
    ) {
      blocking.push("UNAPPROVED_LIMITATION");
    }
    if (!attestation.ownerAuthenticatedWorkspace) {
      blocking.push("NON_OWNER_WORKSPACE");
    }
    if (!attestation.aggregateEvidenceOnly) {
      blocking.push("NON_AGGREGATE_EVIDENCE");
    }
    if (!attestation.coverageDocumented) {
      blocking.push("COVERAGE_UNDOCUMENTED");
    }
    if (!attestation.experimentalLabelRetained) {
      blocking.push("EXPERIMENTAL_LABEL_MISSING");
    }
    if (attestation.futureLeakageDetected) {
      blocking.push("LEAKAGE_DETECTED");
    }
    if (attestation.rawPrivateRowsRetained) {
      blocking.push("RAW_PRIVATE_ROWS_RETAINED");
    }
    if (
      analysis === "economic_reconciliation" &&
      !attestation.historicalBgcEconomicsExcluded
    ) {
      blocking.push("BGC_ECONOMICS_INCLUDED");
    }
    if (
      analysis === "economic_reconciliation" &&
      !attestation.transfersExcluded
    ) {
      blocking.push("TRANSFERS_INCLUDED");
    }
    if (
      Date.parse(attestation.completedAt) < Date.parse(attestation.startedAt)
    ) {
      blocking.push("INVALID_TIME_ORDER");
    }
    if (
      Date.parse(attestation.chronologicalCutoffAt) >
      Date.parse(input.currentThroughAt)
    ) {
      blocking.push("CUTOFF_AFTER_CURRENT_THROUGH");
    }
    for (const code of blocking) {
      issues.push(issue(code, analysis, "block"));
    }

    if (blocking.length === 0) {
      if (attestation.state === "passed") {
        passed.push(analysis);
      } else if (attestation.state === "limited") {
        limited.push(analysis);
        issues.push(issue("EVIDENCE_LIMITED", analysis, "review"));
      } else if (attestation.state === "unavailable") {
        unavailable.push(analysis);
        issues.push(issue("APPROVED_UNAVAILABLE", analysis, "review"));
      }
    }
  }

  const hasBlock = issues.some(({ severity }) => severity === "block");
  const hasMissing = issues.some(({ code }) => code === "ANALYSIS_MISSING");
  const hasLimitations = limited.length > 0 || unavailable.length > 0;

  return {
    status: hasBlock
      ? "blocked"
      : hasMissing
        ? "review_required"
        : hasLimitations
          ? "validated_with_limitations"
          : "validated",
    passed,
    limited,
    unavailable,
    issues,
    aggregateEvidenceOnly: true,
    privateArtifactsRetained: false,
    workflowDispatchAllowed: false,
    mergeAllowed: false,
    productionMutationAllowed: false,
  };
}
