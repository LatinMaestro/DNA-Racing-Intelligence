import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

export type HostedConnectedProviderPreflightInput = Readonly<{
  evidenceId: string;
  headSha: string;
  evidenceSha256: string;
  observedAt: string;
  neon: Readonly<{
    projectId: string;
    previewBranchId: string;
    postgresVersion: string;
    rowSecurity: "on" | "off";
    publicTableCount: number;
    defaultBranchUntouched: boolean;
    readOnlyPreflight: boolean;
    migrationsRun: boolean;
    secretsAltered: boolean;
  }>;
  vercel: Readonly<{
    projectAccess: "available" | "unavailable";
    observedGitBranch: string;
    observedDeploymentTarget: "preview" | "production";
    deploymentGuardResult: "blocked" | "passed";
    retryHeld: boolean;
    allowProductionDeployment: boolean;
    domainAttached: boolean;
  }>;
  ownerDirection: Readonly<{
    waitForVerifiedMain: boolean;
    exactHeadActionsFirst: boolean;
    productionGateStillRequired: boolean;
  }>;
}>;

export type HostedConnectedProviderPreflightIssue = Readonly<{
  code:
    | "NEON_PREVIEW_IDENTITY_MISSING"
    | "POSTGRES_VERSION_UNVERIFIED"
    | "ROW_SECURITY_DISABLED"
    | "PREVIEW_SCHEMA_NOT_EMPTY"
    | "NEON_DEFAULT_BRANCH_TOUCHED"
    | "NON_READ_ONLY_PREFLIGHT"
    | "MIGRATION_EXECUTED"
    | "SECRETS_ALTERED"
    | "VERCEL_PROJECT_ACCESS_PENDING"
    | "UNEXPECTED_DEPLOYMENT_TARGET"
    | "UNEXPECTED_GIT_BRANCH"
    | "PRODUCTION_GUARD_NOT_BLOCKED"
    | "VERCEL_RETRY_NOT_HELD"
    | "PRODUCTION_OVERRIDE_ENABLED"
    | "DOMAIN_ATTACHED"
    | "OWNER_DIRECTION_MISMATCH";
  severity: "review" | "block";
}>;

export type HostedConnectedProviderPreflightProjection = Readonly<{
  status:
    "blocked" | "recorded_with_limitations" | "ready_for_preview_preparation";
  issues: readonly HostedConnectedProviderPreflightIssue[];
  check: CumulativeRehearsalCheck;
  previewDatabaseCapabilityVerified: boolean;
  vercelProjectAccessPending: boolean;
  migrationAllowed: false;
  deploymentAllowed: false;
  workflowDispatchAllowed: false;
  secretMutationAllowed: false;
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

function exactUtc(value: string, field: string): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${field} must be a valid exact UTC timestamp.`);
  }
}

function explicitBoolean(value: boolean, field: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be an explicit boolean.`);
  }
}

function issue(
  code: HostedConnectedProviderPreflightIssue["code"],
  severity: HostedConnectedProviderPreflightIssue["severity"],
): HostedConnectedProviderPreflightIssue {
  return { code, severity };
}

function assertRuntimeShape(
  input: HostedConnectedProviderPreflightInput,
): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.headSha, "Evidence head");
  sha256(input.evidenceSha256, "Evidence digest");
  exactUtc(input.observedAt, "Observation time");
  requiredText(input.neon.projectId, "Neon project ID");
  requiredText(input.neon.previewBranchId, "Neon Preview branch ID");
  requiredText(input.neon.postgresVersion, "PostgreSQL version");
  if (!["on", "off"].includes(input.neon.rowSecurity)) {
    throw new Error("Row-security state is invalid.");
  }
  if (
    !Number.isSafeInteger(input.neon.publicTableCount) ||
    input.neon.publicTableCount < 0
  ) {
    throw new Error("Public-table count must be a non-negative safe integer.");
  }
  if (!["available", "unavailable"].includes(input.vercel.projectAccess)) {
    throw new Error("Vercel project-access state is invalid.");
  }
  requiredText(input.vercel.observedGitBranch, "Observed Git branch");
  if (
    !["preview", "production"].includes(input.vercel.observedDeploymentTarget)
  ) {
    throw new Error("Observed deployment target is invalid.");
  }
  if (!["blocked", "passed"].includes(input.vercel.deploymentGuardResult)) {
    throw new Error("Deployment-guard result is invalid.");
  }
  for (const [field, value] of Object.entries({
    defaultBranchUntouched: input.neon.defaultBranchUntouched,
    readOnlyPreflight: input.neon.readOnlyPreflight,
    migrationsRun: input.neon.migrationsRun,
    secretsAltered: input.neon.secretsAltered,
    retryHeld: input.vercel.retryHeld,
    allowProductionDeployment: input.vercel.allowProductionDeployment,
    domainAttached: input.vercel.domainAttached,
    waitForVerifiedMain: input.ownerDirection.waitForVerifiedMain,
    exactHeadActionsFirst: input.ownerDirection.exactHeadActionsFirst,
    productionGateStillRequired:
      input.ownerDirection.productionGateStillRequired,
  })) {
    explicitBoolean(value, field);
  }
}

export function projectHostedConnectedProviderPreflight(
  input: HostedConnectedProviderPreflightInput,
): HostedConnectedProviderPreflightProjection {
  assertRuntimeShape(input);
  const issues: HostedConnectedProviderPreflightIssue[] = [];

  if (
    input.neon.projectId.trim() === "" ||
    input.neon.previewBranchId.trim() === ""
  ) {
    issues.push(issue("NEON_PREVIEW_IDENTITY_MISSING", "block"));
  }
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(input.neon.postgresVersion)) {
    issues.push(issue("POSTGRES_VERSION_UNVERIFIED", "block"));
  }
  if (input.neon.rowSecurity !== "on") {
    issues.push(issue("ROW_SECURITY_DISABLED", "block"));
  }
  if (input.neon.publicTableCount !== 0) {
    issues.push(issue("PREVIEW_SCHEMA_NOT_EMPTY", "block"));
  }
  if (!input.neon.defaultBranchUntouched) {
    issues.push(issue("NEON_DEFAULT_BRANCH_TOUCHED", "block"));
  }
  if (!input.neon.readOnlyPreflight) {
    issues.push(issue("NON_READ_ONLY_PREFLIGHT", "block"));
  }
  if (input.neon.migrationsRun) {
    issues.push(issue("MIGRATION_EXECUTED", "block"));
  }
  if (input.neon.secretsAltered) {
    issues.push(issue("SECRETS_ALTERED", "block"));
  }

  if (input.vercel.projectAccess === "unavailable") {
    issues.push(issue("VERCEL_PROJECT_ACCESS_PENDING", "review"));
  }
  if (input.vercel.observedDeploymentTarget !== "production") {
    issues.push(issue("UNEXPECTED_DEPLOYMENT_TARGET", "block"));
  }
  if (input.vercel.observedGitBranch !== "main") {
    issues.push(issue("UNEXPECTED_GIT_BRANCH", "block"));
  }
  if (input.vercel.deploymentGuardResult !== "blocked") {
    issues.push(issue("PRODUCTION_GUARD_NOT_BLOCKED", "block"));
  }
  if (!input.vercel.retryHeld) {
    issues.push(issue("VERCEL_RETRY_NOT_HELD", "block"));
  }
  if (input.vercel.allowProductionDeployment) {
    issues.push(issue("PRODUCTION_OVERRIDE_ENABLED", "block"));
  }
  if (input.vercel.domainAttached) {
    issues.push(issue("DOMAIN_ATTACHED", "block"));
  }
  if (
    !input.ownerDirection.waitForVerifiedMain ||
    !input.ownerDirection.exactHeadActionsFirst ||
    !input.ownerDirection.productionGateStillRequired
  ) {
    issues.push(issue("OWNER_DIRECTION_MISMATCH", "block"));
  }

  const blocked = issues.some(({ severity }) => severity === "block");
  const accessPending = input.vercel.projectAccess === "unavailable";
  const previewDatabaseCapabilityVerified =
    input.neon.rowSecurity === "on" &&
    input.neon.publicTableCount === 0 &&
    input.neon.defaultBranchUntouched &&
    input.neon.readOnlyPreflight &&
    !input.neon.migrationsRun &&
    !input.neon.secretsAltered;

  return {
    status: blocked
      ? "blocked"
      : accessPending
        ? "recorded_with_limitations"
        : "ready_for_preview_preparation",
    issues,
    check: {
      name: "connected_provider_preflight",
      state: blocked ? "failed" : "passed",
      headSha: input.headSha,
    },
    previewDatabaseCapabilityVerified,
    vercelProjectAccessPending: accessPending,
    migrationAllowed: false,
    deploymentAllowed: false,
    workflowDispatchAllowed: false,
    secretMutationAllowed: false,
    productionMutationAllowed: false,
  };
}
