import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_ITEMS = [
  "authoritative_source_contracts",
  "private_real_file_import_assurance",
  "durable_vault_identity",
  "historical_bgc_zero_economics",
  "core_lineage_persistence",
  "full_integration_rehearsal",
  "application_services_interfaces",
  "private_chronological_validation",
  "merge_queue_readiness",
] as const;

const COMMAND_BY_ITEM = {
  authoritative_source_contracts: "programme_verify_source_contracts",
  private_real_file_import_assurance: "programme_verify_private_imports",
  durable_vault_identity: "programme_verify_vault_identity",
  historical_bgc_zero_economics: "programme_verify_bgc_economics",
  core_lineage_persistence: "programme_verify_lineage_persistence",
  full_integration_rehearsal: "programme_verify_integration_rehearsal",
  application_services_interfaces: "programme_verify_application_surfaces",
  private_chronological_validation: "programme_verify_chronological_validation",
  merge_queue_readiness: "programme_verify_merge_queue",
} as const;

const PRIVATE_EXECUTION_ITEMS = new Set<ProgrammeItem>([
  "private_real_file_import_assurance",
  "durable_vault_identity",
  "historical_bgc_zero_economics",
  "private_chronological_validation",
]);

const CONNECTED_PERSISTENCE_ITEMS = new Set<ProgrammeItem>([
  "durable_vault_identity",
  "core_lineage_persistence",
  "application_services_interfaces",
]);

const EXACT_HEAD_ACTIONS_ITEMS = new Set<ProgrammeItem>([
  "full_integration_rehearsal",
  "merge_queue_readiness",
]);

export type ProgrammeItem = (typeof REQUIRED_ITEMS)[number];
export type ProgrammeCommandId = (typeof COMMAND_BY_ITEM)[ProgrammeItem];
export type ProgrammeEvidenceState =
  "not_required" | "unavailable" | "verified";

export type ProgrammeItemAttestation = Readonly<{
  attestationId: string;
  item: ProgrammeItem;
  commandId: ProgrammeCommandId;
  headSha: string;
  programmeManifestSha256: string;
  evidenceManifestSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  assertionsPassed: number;
  assertionsTotal: number;
  implementationVerified: boolean;
  syntheticRegressionVerified: boolean;
  privateExecutionState: ProgrammeEvidenceState;
  connectedPersistenceState: ProgrammeEvidenceState;
  exactHeadActionsState: ProgrammeEvidenceState;
  limitationsRecorded: boolean;
  privateDataInGit: boolean;
  productionDisabled: boolean;
}>;

export type HostedProgrammeCompletionAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  programmeManifestSha256: string;
  evidenceManifestSha256: string;
  attestations: readonly ProgrammeItemAttestation[];
}>;

export type HostedProgrammeCompletionIssue = Readonly<{
  code:
    | "ITEM_MISSING"
    | "ITEM_STALE"
    | "COMMAND_MISMATCH"
    | "PROGRAMME_MANIFEST_MISMATCH"
    | "EVIDENCE_MANIFEST_MISMATCH"
    | "CHECK_FAILED"
    | "ASSERTIONS_INCOMPLETE"
    | "IMPLEMENTATION_UNVERIFIED"
    | "SYNTHETIC_REGRESSION_UNVERIFIED"
    | "PRIVATE_EXECUTION_PENDING"
    | "PERSISTENCE_PENDING"
    | "EXACT_HEAD_ACTIONS_PENDING"
    | "LIMITATIONS_UNRECORDED"
    | "PRIVATE_DATA_IN_GIT"
    | "PRODUCTION_ENABLED"
    | "INVALID_TIME_ORDER";
  item: ProgrammeItem;
  severity: "review" | "block";
}>;

export type HostedProgrammeCompletionProjection = Readonly<{
  status:
    "blocked" | "completion_evidence_pending" | "ready_for_formal_acceptance";
  technicallyVerifiedItems: readonly ProgrammeItem[];
  pendingItems: readonly ProgrammeItem[];
  check: CumulativeRehearsalCheck;
  issues: readonly HostedProgrammeCompletionIssue[];
  allNineItemsComplete: boolean;
  formalAcceptanceStillRequired: true;
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

function evidenceState(value: ProgrammeEvidenceState, field: string): void {
  if (!["not_required", "unavailable", "verified"].includes(value)) {
    throw new Error(`${field} is invalid.`);
  }
}

function assertRuntimeShape(
  input: HostedProgrammeCompletionAttestationInput,
): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.programmeManifestSha256, "Programme-manifest digest");
  sha256(input.evidenceManifestSha256, "Evidence-manifest digest");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Programme attestations must be an array.");
  }

  const ids = new Set<string>();
  const items = new Set<ProgrammeItem>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_ITEMS.includes(attestation.item)) {
      throw new Error("Programme item is invalid.");
    }
    if (items.has(attestation.item)) {
      throw new Error(`Programme item ${attestation.item} must be unique.`);
    }
    items.add(attestation.item);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.item} head`);
    sha256(
      attestation.programmeManifestSha256,
      `${attestation.item} programme-manifest digest`,
    );
    sha256(
      attestation.evidenceManifestSha256,
      `${attestation.item} evidence-manifest digest`,
    );
    exactUtc(attestation.startedAt, `${attestation.item} start`);
    exactUtc(attestation.completedAt, `${attestation.item} completion`);
    nonNegativeInteger(attestation.exitCode, `${attestation.item} exit code`);
    nonNegativeInteger(
      attestation.assertionsPassed,
      `${attestation.item} passed assertions`,
    );
    positiveInteger(
      attestation.assertionsTotal,
      `${attestation.item} total assertions`,
    );
    for (const [field, value] of Object.entries({
      implementationVerified: attestation.implementationVerified,
      syntheticRegressionVerified: attestation.syntheticRegressionVerified,
      limitationsRecorded: attestation.limitationsRecorded,
      privateDataInGit: attestation.privateDataInGit,
      productionDisabled: attestation.productionDisabled,
    })) {
      explicitBoolean(value, `${attestation.item} ${field}`);
    }
    evidenceState(
      attestation.privateExecutionState,
      `${attestation.item} private-execution state`,
    );
    evidenceState(
      attestation.connectedPersistenceState,
      `${attestation.item} persistence state`,
    );
    evidenceState(
      attestation.exactHeadActionsState,
      `${attestation.item} exact-head Actions state`,
    );
  }
}

function issue(
  code: HostedProgrammeCompletionIssue["code"],
  item: ProgrammeItem,
  severity: HostedProgrammeCompletionIssue["severity"],
): HostedProgrammeCompletionIssue {
  return { code, item, severity };
}

export function projectHostedProgrammeCompletion(
  input: HostedProgrammeCompletionAttestationInput,
): HostedProgrammeCompletionProjection {
  assertRuntimeShape(input);
  const byItem = new Map(
    input.attestations.map((attestation) => [attestation.item, attestation]),
  );
  const issues: HostedProgrammeCompletionIssue[] = [];
  const technicallyVerifiedItems: ProgrammeItem[] = [];

  for (const item of REQUIRED_ITEMS) {
    const attestation = byItem.get(item);
    if (attestation === undefined) {
      issues.push(issue("ITEM_MISSING", item, "review"));
      continue;
    }

    const blocking: HostedProgrammeCompletionIssue["code"][] = [];
    const review: HostedProgrammeCompletionIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("ITEM_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_ITEM[item]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.programmeManifestSha256 !== input.programmeManifestSha256) {
      blocking.push("PROGRAMME_MANIFEST_MISMATCH");
    }
    if (attestation.evidenceManifestSha256 !== input.evidenceManifestSha256) {
      blocking.push("EVIDENCE_MANIFEST_MISMATCH");
    }
    if (attestation.exitCode !== 0) {
      blocking.push("CHECK_FAILED");
    }
    if (attestation.assertionsPassed !== attestation.assertionsTotal) {
      blocking.push("ASSERTIONS_INCOMPLETE");
    }
    if (!attestation.implementationVerified) {
      blocking.push("IMPLEMENTATION_UNVERIFIED");
    }
    if (!attestation.syntheticRegressionVerified) {
      blocking.push("SYNTHETIC_REGRESSION_UNVERIFIED");
    }
    if (
      PRIVATE_EXECUTION_ITEMS.has(item) &&
      attestation.privateExecutionState !== "verified"
    ) {
      review.push("PRIVATE_EXECUTION_PENDING");
    }
    if (
      !PRIVATE_EXECUTION_ITEMS.has(item) &&
      attestation.privateExecutionState !== "not_required"
    ) {
      blocking.push("PRIVATE_EXECUTION_PENDING");
    }
    if (
      CONNECTED_PERSISTENCE_ITEMS.has(item) &&
      attestation.connectedPersistenceState !== "verified"
    ) {
      review.push("PERSISTENCE_PENDING");
    }
    if (
      !CONNECTED_PERSISTENCE_ITEMS.has(item) &&
      attestation.connectedPersistenceState !== "not_required"
    ) {
      blocking.push("PERSISTENCE_PENDING");
    }
    if (
      EXACT_HEAD_ACTIONS_ITEMS.has(item) &&
      attestation.exactHeadActionsState !== "verified"
    ) {
      review.push("EXACT_HEAD_ACTIONS_PENDING");
    }
    if (
      !EXACT_HEAD_ACTIONS_ITEMS.has(item) &&
      attestation.exactHeadActionsState !== "not_required"
    ) {
      blocking.push("EXACT_HEAD_ACTIONS_PENDING");
    }
    if (!attestation.limitationsRecorded) {
      blocking.push("LIMITATIONS_UNRECORDED");
    }
    if (attestation.privateDataInGit) {
      blocking.push("PRIVATE_DATA_IN_GIT");
    }
    if (!attestation.productionDisabled) {
      blocking.push("PRODUCTION_ENABLED");
    }
    if (
      Date.parse(attestation.completedAt) < Date.parse(attestation.startedAt)
    ) {
      blocking.push("INVALID_TIME_ORDER");
    }

    for (const code of blocking) issues.push(issue(code, item, "block"));
    for (const code of review) issues.push(issue(code, item, "review"));
    if (blocking.length === 0 && review.length === 0) {
      technicallyVerifiedItems.push(item);
    }
  }

  const pendingItems = REQUIRED_ITEMS.filter(
    (item) => !technicallyVerifiedItems.includes(item),
  );
  const blocked = issues.some(({ severity }) => severity === "block");
  const allNineItemsComplete =
    issues.length === 0 && technicallyVerifiedItems.length === 9;

  return {
    status: blocked
      ? "blocked"
      : allNineItemsComplete
        ? "ready_for_formal_acceptance"
        : "completion_evidence_pending",
    technicallyVerifiedItems,
    pendingItems,
    check: {
      name: "nine_item_programme_completion",
      state: allNineItemsComplete ? "passed" : blocked ? "failed" : "not_run",
      headSha: allNineItemsComplete || blocked ? input.composedHeadSha : null,
    },
    issues,
    allNineItemsComplete,
    formalAcceptanceStillRequired: true,
    workflowDispatchAllowed: false,
    mergeAllowed: false,
    providerMutationAllowed: false,
    productionMutationAllowed: false,
  };
}
