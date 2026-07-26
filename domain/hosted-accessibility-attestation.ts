const REQUIRED_SCOPES = [
  "semantic_structure",
  "keyboard_navigation",
  "focus_management",
  "assistive_technology",
  "visual_contrast_and_status",
  "responsive_reflow",
] as const;

const COMMAND_BY_SCOPE = {
  semantic_structure: "accessibility_check_semantic_structure",
  keyboard_navigation: "accessibility_check_keyboard_navigation",
  focus_management: "accessibility_check_focus_management",
  assistive_technology: "accessibility_check_assistive_technology",
  visual_contrast_and_status: "accessibility_check_visual_contrast_and_status",
  responsive_reflow: "accessibility_check_responsive_reflow",
} as const;

export type HostedAccessibilityScope = (typeof REQUIRED_SCOPES)[number];
export type HostedAccessibilityCommandId =
  (typeof COMMAND_BY_SCOPE)[HostedAccessibilityScope];

export type HostedAccessibilityScopeAttestation = Readonly<{
  attestationId: string;
  scope: HostedAccessibilityScope;
  commandId: HostedAccessibilityCommandId;
  headSha: string;
  routeManifestSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  routesCovered: number;
  checkpointsCovered: number;
  automatedViolationsCount: number;
  manualFindingsCount: number;
  coverageComplete: boolean;
  manualReviewComplete: boolean;
  authenticatedOwnerWorkspace: boolean;
  syntheticPrivateStateOnly: boolean;
  privateDataObserved: boolean;
  retainedPrivateArtifact: boolean;
}>;

export type HostedAccessibilityAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  routeManifestSha256: string;
  wcagTarget: "WCAG_2_2_AA";
  attestations: readonly HostedAccessibilityScopeAttestation[];
}>;

export type HostedAccessibilityAttestationIssue = Readonly<{
  code:
    | "SCOPE_MISSING"
    | "SCOPE_STALE"
    | "COMMAND_MISMATCH"
    | "ROUTE_MANIFEST_MISMATCH"
    | "CHECK_FAILED"
    | "COVERAGE_INCOMPLETE"
    | "MANUAL_REVIEW_INCOMPLETE"
    | "AUTOMATED_VIOLATION"
    | "MANUAL_FINDING"
    | "NON_OWNER_WORKSPACE"
    | "NON_SYNTHETIC_PRIVATE_STATE"
    | "PRIVATE_DATA_OBSERVED"
    | "PRIVATE_ARTIFACT_RETAINED"
    | "INVALID_TIME_ORDER";
  scope: HostedAccessibilityScope;
  severity: "review" | "block";
}>;

export type HostedAccessibilityAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  passedScopes: readonly HostedAccessibilityScope[];
  issues: readonly HostedAccessibilityAttestationIssue[];
  wcagTarget: "WCAG_2_2_AA";
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

function assertRuntimeShape(input: HostedAccessibilityAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.routeManifestSha256, "Route-manifest digest");
  if (input.wcagTarget !== "WCAG_2_2_AA") {
    throw new Error("WCAG target is invalid.");
  }
  if (!Array.isArray(input.attestations)) {
    throw new Error("Accessibility attestations must be an array.");
  }

  const ids = new Set<string>();
  const scopes = new Set<HostedAccessibilityScope>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_SCOPES.includes(attestation.scope)) {
      throw new Error("Accessibility attestation scope is invalid.");
    }
    if (scopes.has(attestation.scope)) {
      throw new Error(
        `Accessibility attestation ${attestation.scope} must be unique.`,
      );
    }
    scopes.add(attestation.scope);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.scope} head`);
    sha256(
      attestation.routeManifestSha256,
      `${attestation.scope} route-manifest digest`,
    );
    exactUtc(attestation.startedAt, `${attestation.scope} start`);
    exactUtc(attestation.completedAt, `${attestation.scope} completion`);
    nonNegativeInteger(attestation.exitCode, `${attestation.scope} exit code`);
    sha256(attestation.summarySha256, `${attestation.scope} summary digest`);
    positiveInteger(
      attestation.routesCovered,
      `${attestation.scope} route coverage`,
    );
    positiveInteger(
      attestation.checkpointsCovered,
      `${attestation.scope} checkpoint coverage`,
    );
    nonNegativeInteger(
      attestation.automatedViolationsCount,
      `${attestation.scope} automated violation count`,
    );
    nonNegativeInteger(
      attestation.manualFindingsCount,
      `${attestation.scope} manual finding count`,
    );
    for (const [field, value] of Object.entries({
      coverageComplete: attestation.coverageComplete,
      manualReviewComplete: attestation.manualReviewComplete,
      authenticatedOwnerWorkspace: attestation.authenticatedOwnerWorkspace,
      syntheticPrivateStateOnly: attestation.syntheticPrivateStateOnly,
      privateDataObserved: attestation.privateDataObserved,
      retainedPrivateArtifact: attestation.retainedPrivateArtifact,
    })) {
      explicitBoolean(value, `${attestation.scope} ${field}`);
    }
  }
}

function issue(
  code: HostedAccessibilityAttestationIssue["code"],
  scope: HostedAccessibilityScope,
  severity: HostedAccessibilityAttestationIssue["severity"],
): HostedAccessibilityAttestationIssue {
  return { code, scope, severity };
}

export function projectHostedAccessibilityAttestations(
  input: HostedAccessibilityAttestationInput,
): HostedAccessibilityAttestationProjection {
  assertRuntimeShape(input);
  const byScope = new Map(
    input.attestations.map((attestation) => [attestation.scope, attestation]),
  );
  const issues: HostedAccessibilityAttestationIssue[] = [];
  const passedScopes: HostedAccessibilityScope[] = [];

  for (const scope of REQUIRED_SCOPES) {
    const attestation = byScope.get(scope);
    if (attestation === undefined) {
      issues.push(issue("SCOPE_MISSING", scope, "review"));
      continue;
    }

    const blocking: HostedAccessibilityAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("SCOPE_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_SCOPE[scope]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.routeManifestSha256 !== input.routeManifestSha256) {
      blocking.push("ROUTE_MANIFEST_MISMATCH");
    }
    if (attestation.exitCode !== 0) {
      blocking.push("CHECK_FAILED");
    }
    if (!attestation.coverageComplete) {
      blocking.push("COVERAGE_INCOMPLETE");
    }
    if (!attestation.manualReviewComplete) {
      blocking.push("MANUAL_REVIEW_INCOMPLETE");
    }
    if (attestation.automatedViolationsCount !== 0) {
      blocking.push("AUTOMATED_VIOLATION");
    }
    if (attestation.manualFindingsCount !== 0) {
      blocking.push("MANUAL_FINDING");
    }
    if (!attestation.authenticatedOwnerWorkspace) {
      blocking.push("NON_OWNER_WORKSPACE");
    }
    if (!attestation.syntheticPrivateStateOnly) {
      blocking.push("NON_SYNTHETIC_PRIVATE_STATE");
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
      passedScopes.push(scope);
    } else {
      for (const code of blocking) {
        issues.push(issue(code, scope, "block"));
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
    passedScopes,
    issues,
    wcagTarget: "WCAG_2_2_AA",
    privateArtifactsRetained: false,
    workflowDispatchAllowed: false,
    mergeAllowed: false,
    productionMutationAllowed: false,
  };
}
