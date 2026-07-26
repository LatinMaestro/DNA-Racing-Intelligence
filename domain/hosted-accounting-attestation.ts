import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_CONTROLS = [
  "exact_asset_balances",
  "bgc_separate_non_cash",
  "historical_bgc_zero_economics",
  "transfers_excluded",
  "manual_tournament_reconciliation",
  "breeding_completed_refunded_only",
  "lifecycle_sale_cost_basis",
  "actual_burn_bgc_credit",
  "freshness_and_provenance",
  "aggregate_rebuild_idempotency",
] as const;

const COMMAND_BY_CONTROL = {
  exact_asset_balances: "accounting_verify_exact_asset_balances",
  bgc_separate_non_cash: "accounting_verify_bgc_separation",
  historical_bgc_zero_economics: "accounting_verify_historical_bgc",
  transfers_excluded: "accounting_verify_transfer_exclusion",
  manual_tournament_reconciliation:
    "accounting_verify_tournament_reconciliation",
  breeding_completed_refunded_only: "accounting_verify_breeding_evidence",
  lifecycle_sale_cost_basis: "accounting_verify_lifecycle_cost_basis",
  actual_burn_bgc_credit: "accounting_verify_actual_burn_credit",
  freshness_and_provenance: "accounting_verify_freshness_provenance",
  aggregate_rebuild_idempotency: "accounting_verify_rebuild_idempotency",
} as const;

const PERSISTENCE_CONTROLS = new Set<HostedAccountingControl>([
  "manual_tournament_reconciliation",
  "breeding_completed_refunded_only",
  "lifecycle_sale_cost_basis",
  "actual_burn_bgc_credit",
  "aggregate_rebuild_idempotency",
]);

export type HostedAccountingControl = (typeof REQUIRED_CONTROLS)[number];
export type HostedAccountingCommandId =
  (typeof COMMAND_BY_CONTROL)[HostedAccountingControl];

export type HostedAccountingControlAttestation = Readonly<{
  attestationId: string;
  control: HostedAccountingControl;
  commandId: HostedAccountingCommandId;
  headSha: string;
  accountingManifestSha256: string;
  fixtureManifestSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  assertionsPassed: number;
  assertionsTotal: number;
  exactDecimalsVerified: boolean;
  assetSeparationVerified: boolean;
  transferExclusionVerified: boolean;
  historicalBgcZeroEconomicsVerified: boolean;
  sourceProvenanceVerified: boolean;
  durableReplayVerified: boolean;
  syntheticFixturesOnly: boolean;
  privateDataObserved: boolean;
  retainedPrivateArtifact: boolean;
  connectedPersistenceEvidence: boolean;
}>;

export type HostedAccountingAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  accountingManifestSha256: string;
  fixtureManifestSha256: string;
  attestations: readonly HostedAccountingControlAttestation[];
}>;

export type HostedAccountingAttestationIssue = Readonly<{
  code:
    | "CONTROL_MISSING"
    | "CONTROL_STALE"
    | "COMMAND_MISMATCH"
    | "ACCOUNTING_MANIFEST_MISMATCH"
    | "FIXTURE_MANIFEST_MISMATCH"
    | "CHECK_FAILED"
    | "ASSERTIONS_INCOMPLETE"
    | "EXACT_DECIMALS_UNVERIFIED"
    | "ASSET_SEPARATION_UNVERIFIED"
    | "TRANSFER_EXCLUSION_UNVERIFIED"
    | "HISTORICAL_BGC_ECONOMICS_INCLUDED"
    | "PROVENANCE_UNVERIFIED"
    | "DURABLE_REPLAY_UNVERIFIED"
    | "NON_SYNTHETIC_FIXTURE"
    | "PRIVATE_DATA_OBSERVED"
    | "PRIVATE_ARTIFACT_RETAINED"
    | "PERSISTENCE_EVIDENCE_UNCONNECTED"
    | "INVALID_TIME_ORDER";
  control: HostedAccountingControl;
  severity: "review" | "block";
}>;

export type HostedAccountingAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  passedControls: readonly HostedAccountingControl[];
  check: CumulativeRehearsalCheck;
  issues: readonly HostedAccountingAttestationIssue[];
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

function assertRuntimeShape(input: HostedAccountingAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.accountingManifestSha256, "Accounting-manifest digest");
  sha256(input.fixtureManifestSha256, "Fixture-manifest digest");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Accounting attestations must be an array.");
  }

  const ids = new Set<string>();
  const controls = new Set<HostedAccountingControl>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_CONTROLS.includes(attestation.control)) {
      throw new Error("Accounting attestation control is invalid.");
    }
    if (controls.has(attestation.control)) {
      throw new Error(
        `Accounting attestation ${attestation.control} must be unique.`,
      );
    }
    controls.add(attestation.control);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.control} head`);
    sha256(
      attestation.accountingManifestSha256,
      `${attestation.control} accounting-manifest digest`,
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
      exactDecimalsVerified: attestation.exactDecimalsVerified,
      assetSeparationVerified: attestation.assetSeparationVerified,
      transferExclusionVerified: attestation.transferExclusionVerified,
      historicalBgcZeroEconomicsVerified:
        attestation.historicalBgcZeroEconomicsVerified,
      sourceProvenanceVerified: attestation.sourceProvenanceVerified,
      durableReplayVerified: attestation.durableReplayVerified,
      syntheticFixturesOnly: attestation.syntheticFixturesOnly,
      privateDataObserved: attestation.privateDataObserved,
      retainedPrivateArtifact: attestation.retainedPrivateArtifact,
      connectedPersistenceEvidence: attestation.connectedPersistenceEvidence,
    })) {
      explicitBoolean(value, `${attestation.control} ${field}`);
    }
  }
}

function issue(
  code: HostedAccountingAttestationIssue["code"],
  control: HostedAccountingControl,
  severity: HostedAccountingAttestationIssue["severity"],
): HostedAccountingAttestationIssue {
  return { code, control, severity };
}

export function projectHostedAccountingAttestations(
  input: HostedAccountingAttestationInput,
): HostedAccountingAttestationProjection {
  assertRuntimeShape(input);
  const byControl = new Map(
    input.attestations.map((attestation) => [attestation.control, attestation]),
  );
  const issues: HostedAccountingAttestationIssue[] = [];
  const passedControls: HostedAccountingControl[] = [];

  for (const control of REQUIRED_CONTROLS) {
    const attestation = byControl.get(control);
    if (attestation === undefined) {
      issues.push(issue("CONTROL_MISSING", control, "review"));
      continue;
    }

    const blocking: HostedAccountingAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("CONTROL_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_CONTROL[control]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (
      attestation.accountingManifestSha256 !== input.accountingManifestSha256
    ) {
      blocking.push("ACCOUNTING_MANIFEST_MISMATCH");
    }
    if (attestation.fixtureManifestSha256 !== input.fixtureManifestSha256) {
      blocking.push("FIXTURE_MANIFEST_MISMATCH");
    }
    if (attestation.exitCode !== 0) blocking.push("CHECK_FAILED");
    if (attestation.assertionsPassed !== attestation.assertionsTotal) {
      blocking.push("ASSERTIONS_INCOMPLETE");
    }
    if (!attestation.exactDecimalsVerified) {
      blocking.push("EXACT_DECIMALS_UNVERIFIED");
    }
    if (!attestation.assetSeparationVerified) {
      blocking.push("ASSET_SEPARATION_UNVERIFIED");
    }
    if (!attestation.transferExclusionVerified) {
      blocking.push("TRANSFER_EXCLUSION_UNVERIFIED");
    }
    if (!attestation.historicalBgcZeroEconomicsVerified) {
      blocking.push("HISTORICAL_BGC_ECONOMICS_INCLUDED");
    }
    if (!attestation.sourceProvenanceVerified) {
      blocking.push("PROVENANCE_UNVERIFIED");
    }
    if (!attestation.durableReplayVerified) {
      blocking.push("DURABLE_REPLAY_UNVERIFIED");
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
      PERSISTENCE_CONTROLS.has(control) &&
      !attestation.connectedPersistenceEvidence
    ) {
      blocking.push("PERSISTENCE_EVIDENCE_UNCONNECTED");
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
      name: "accounting_reconciliation",
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
