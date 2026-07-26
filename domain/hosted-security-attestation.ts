import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_CONTROLS = [
  "single_user_auth_fail_closed",
  "owner_allowlist",
  "private_route_protection",
  "forced_owner_rls",
  "public_database_access_revoked",
  "private_object_storage",
  "no_secret_client_exposure",
  "redacted_logging",
  "no_real_data_in_git",
  "no_crypto_signing_secret_storage",
  "no_public_indexing",
  "dependency_and_config_review",
] as const;

const COMMAND_BY_CONTROL = {
  single_user_auth_fail_closed: "security_verify_single_user_auth",
  owner_allowlist: "security_verify_owner_allowlist",
  private_route_protection: "security_verify_private_routes",
  forced_owner_rls: "security_verify_forced_owner_rls",
  public_database_access_revoked: "security_verify_public_db_revoked",
  private_object_storage: "security_verify_private_object_storage",
  no_secret_client_exposure: "security_verify_client_secret_boundary",
  redacted_logging: "security_verify_log_redaction",
  no_real_data_in_git: "security_verify_repository_privacy",
  no_crypto_signing_secret_storage: "security_verify_no_signing_secrets",
  no_public_indexing: "security_verify_no_indexing",
  dependency_and_config_review: "security_verify_dependencies_and_config",
} as const;

const OWNER_ISOLATION_CONTROLS = new Set<HostedSecurityControl>([
  "single_user_auth_fail_closed",
  "owner_allowlist",
  "private_route_protection",
  "forced_owner_rls",
]);

const PUBLIC_ACCESS_CONTROLS = new Set<HostedSecurityControl>([
  "public_database_access_revoked",
  "private_object_storage",
  "no_public_indexing",
]);

const PROVIDER_CONTROLS = new Set<HostedSecurityControl>([
  "forced_owner_rls",
  "public_database_access_revoked",
  "private_object_storage",
]);

export type HostedSecurityControl = (typeof REQUIRED_CONTROLS)[number];
export type HostedSecurityCommandId =
  (typeof COMMAND_BY_CONTROL)[HostedSecurityControl];

export type HostedSecurityControlAttestation = Readonly<{
  attestationId: string;
  control: HostedSecurityControl;
  commandId: HostedSecurityCommandId;
  headSha: string;
  routeManifestSha256: string;
  configurationManifestSha256: string;
  providerContractSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  assertionsPassed: number;
  assertionsTotal: number;
  redactedSummaryOnly: boolean;
  syntheticFixturesOnly: boolean;
  privateDataObserved: boolean;
  retainedPrivateArtifact: boolean;
  ownerIsolationVerified: boolean;
  publicAccessDenied: boolean;
  clientSecretExposureDetected: boolean;
  loggingRedactionVerified: boolean;
  repositoryPrivacyVerified: boolean;
  dependencyReviewComplete: boolean;
  connectedProviderEvidence: boolean;
}>;

export type HostedSecurityAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  routeManifestSha256: string;
  configurationManifestSha256: string;
  providerContractSha256: string;
  attestations: readonly HostedSecurityControlAttestation[];
}>;

export type HostedSecurityAttestationIssue = Readonly<{
  code:
    | "CONTROL_MISSING"
    | "CONTROL_STALE"
    | "COMMAND_MISMATCH"
    | "ROUTE_MANIFEST_MISMATCH"
    | "CONFIGURATION_MANIFEST_MISMATCH"
    | "PROVIDER_CONTRACT_MISMATCH"
    | "CHECK_FAILED"
    | "ASSERTIONS_INCOMPLETE"
    | "UNREDACTED_SUMMARY"
    | "NON_SYNTHETIC_FIXTURE"
    | "PRIVATE_DATA_OBSERVED"
    | "PRIVATE_ARTIFACT_RETAINED"
    | "OWNER_ISOLATION_UNVERIFIED"
    | "PUBLIC_ACCESS_NOT_DENIED"
    | "CLIENT_SECRET_EXPOSURE"
    | "LOG_REDACTION_UNVERIFIED"
    | "REPOSITORY_PRIVACY_UNVERIFIED"
    | "DEPENDENCY_REVIEW_INCOMPLETE"
    | "PROVIDER_EVIDENCE_UNCONNECTED"
    | "INVALID_TIME_ORDER";
  control: HostedSecurityControl;
  severity: "review" | "block";
}>;

export type HostedSecurityAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  passedControls: readonly HostedSecurityControl[];
  check: CumulativeRehearsalCheck;
  issues: readonly HostedSecurityAttestationIssue[];
  privateArtifactsRetained: false;
  workflowDispatchAllowed: false;
  mergeAllowed: false;
  productionMutationAllowed: false;
  publicExposureAllowed: false;
  secretCollectionAllowed: false;
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

function assertRuntimeShape(input: HostedSecurityAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.routeManifestSha256, "Route-manifest digest");
  sha256(input.configurationManifestSha256, "Configuration-manifest digest");
  sha256(input.providerContractSha256, "Provider-contract digest");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Security attestations must be an array.");
  }

  const ids = new Set<string>();
  const controls = new Set<HostedSecurityControl>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_CONTROLS.includes(attestation.control)) {
      throw new Error("Security attestation control is invalid.");
    }
    if (controls.has(attestation.control)) {
      throw new Error(
        `Security attestation ${attestation.control} must be unique.`,
      );
    }
    controls.add(attestation.control);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.control} head`);
    sha256(
      attestation.routeManifestSha256,
      `${attestation.control} route-manifest digest`,
    );
    sha256(
      attestation.configurationManifestSha256,
      `${attestation.control} configuration-manifest digest`,
    );
    sha256(
      attestation.providerContractSha256,
      `${attestation.control} provider-contract digest`,
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
      redactedSummaryOnly: attestation.redactedSummaryOnly,
      syntheticFixturesOnly: attestation.syntheticFixturesOnly,
      privateDataObserved: attestation.privateDataObserved,
      retainedPrivateArtifact: attestation.retainedPrivateArtifact,
      ownerIsolationVerified: attestation.ownerIsolationVerified,
      publicAccessDenied: attestation.publicAccessDenied,
      clientSecretExposureDetected: attestation.clientSecretExposureDetected,
      loggingRedactionVerified: attestation.loggingRedactionVerified,
      repositoryPrivacyVerified: attestation.repositoryPrivacyVerified,
      dependencyReviewComplete: attestation.dependencyReviewComplete,
      connectedProviderEvidence: attestation.connectedProviderEvidence,
    })) {
      explicitBoolean(value, `${attestation.control} ${field}`);
    }
  }
}

function issue(
  code: HostedSecurityAttestationIssue["code"],
  control: HostedSecurityControl,
  severity: HostedSecurityAttestationIssue["severity"],
): HostedSecurityAttestationIssue {
  return { code, control, severity };
}

export function projectHostedSecurityAttestations(
  input: HostedSecurityAttestationInput,
): HostedSecurityAttestationProjection {
  assertRuntimeShape(input);
  const byControl = new Map(
    input.attestations.map((attestation) => [attestation.control, attestation]),
  );
  const issues: HostedSecurityAttestationIssue[] = [];
  const passedControls: HostedSecurityControl[] = [];

  for (const control of REQUIRED_CONTROLS) {
    const attestation = byControl.get(control);
    if (attestation === undefined) {
      issues.push(issue("CONTROL_MISSING", control, "review"));
      continue;
    }

    const blocking: HostedSecurityAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("CONTROL_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_CONTROL[control]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.routeManifestSha256 !== input.routeManifestSha256) {
      blocking.push("ROUTE_MANIFEST_MISMATCH");
    }
    if (
      attestation.configurationManifestSha256 !==
      input.configurationManifestSha256
    ) {
      blocking.push("CONFIGURATION_MANIFEST_MISMATCH");
    }
    if (attestation.providerContractSha256 !== input.providerContractSha256) {
      blocking.push("PROVIDER_CONTRACT_MISMATCH");
    }
    if (attestation.exitCode !== 0) {
      blocking.push("CHECK_FAILED");
    }
    if (attestation.assertionsPassed !== attestation.assertionsTotal) {
      blocking.push("ASSERTIONS_INCOMPLETE");
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
      OWNER_ISOLATION_CONTROLS.has(control) &&
      !attestation.ownerIsolationVerified
    ) {
      blocking.push("OWNER_ISOLATION_UNVERIFIED");
    }
    if (
      PUBLIC_ACCESS_CONTROLS.has(control) &&
      !attestation.publicAccessDenied
    ) {
      blocking.push("PUBLIC_ACCESS_NOT_DENIED");
    }
    if (attestation.clientSecretExposureDetected) {
      blocking.push("CLIENT_SECRET_EXPOSURE");
    }
    if (
      control === "redacted_logging" &&
      !attestation.loggingRedactionVerified
    ) {
      blocking.push("LOG_REDACTION_UNVERIFIED");
    }
    if (
      control === "no_real_data_in_git" &&
      !attestation.repositoryPrivacyVerified
    ) {
      blocking.push("REPOSITORY_PRIVACY_UNVERIFIED");
    }
    if (
      control === "dependency_and_config_review" &&
      !attestation.dependencyReviewComplete
    ) {
      blocking.push("DEPENDENCY_REVIEW_INCOMPLETE");
    }
    if (
      PROVIDER_CONTROLS.has(control) &&
      !attestation.connectedProviderEvidence
    ) {
      blocking.push("PROVIDER_EVIDENCE_UNCONNECTED");
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
      name: "security_privacy",
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
    publicExposureAllowed: false,
    secretCollectionAllowed: false,
    paidServiceActivationAllowed: false,
  };
}
