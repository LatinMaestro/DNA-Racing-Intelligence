import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_CONTROLS = [
  "nine_authoritative_inputs",
  "core_details_cross_mode",
  "vault_owned_me",
  "arena_replacement_snapshot",
  "race_merge_sequence",
  "durable_id_resolution",
  "periodic_update_workflow",
  "aggregate_coverage",
  "historical_bgc_provenance",
  "private_raw_boundary",
] as const;

const COMMAND_BY_CONTROL = {
  nine_authoritative_inputs: "source_verify_nine_inputs",
  core_details_cross_mode: "source_verify_core_details",
  vault_owned_me: "source_verify_vault_ownership_me",
  arena_replacement_snapshot: "source_verify_arena_snapshot",
  race_merge_sequence: "source_verify_race_merge_sequence",
  durable_id_resolution: "source_verify_durable_identity",
  periodic_update_workflow: "source_verify_periodic_workflow",
  aggregate_coverage: "source_verify_aggregate_coverage",
  historical_bgc_provenance: "source_verify_historical_bgc",
  private_raw_boundary: "source_verify_private_raw_boundary",
} as const;

export type HostedSourceContractControl = (typeof REQUIRED_CONTROLS)[number];
export type HostedSourceContractCommandId =
  (typeof COMMAND_BY_CONTROL)[HostedSourceContractControl];

export type HostedSourceContractControlAttestation = Readonly<{
  attestationId: string;
  control: HostedSourceContractControl;
  commandId: HostedSourceContractCommandId;
  headSha: string;
  sourceContractSha256: string;
  aggregateProfileSha256: string;
  fixtureManifestSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  assertionsPassed: number;
  assertionsTotal: number;
  contractVerified: boolean;
  periodicSemanticsVerified: boolean;
  durableIdentityVerified: boolean;
  provenanceVerified: boolean;
  analyticalFieldRetentionVerified: boolean;
  privateBoundaryVerified: boolean;
  syntheticFixturesOnly: boolean;
  privateDataObserved: boolean;
  retainedPrivateArtifact: boolean;
}>;

export type HostedSourceContractAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  sourceContractSha256: string;
  aggregateProfileSha256: string;
  fixtureManifestSha256: string;
  attestations: readonly HostedSourceContractControlAttestation[];
}>;

export type HostedSourceContractAttestationIssue = Readonly<{
  code:
    | "CONTROL_MISSING"
    | "CONTROL_STALE"
    | "COMMAND_MISMATCH"
    | "SOURCE_CONTRACT_MISMATCH"
    | "AGGREGATE_PROFILE_MISMATCH"
    | "FIXTURE_MANIFEST_MISMATCH"
    | "CHECK_FAILED"
    | "ASSERTIONS_INCOMPLETE"
    | "CONTRACT_UNVERIFIED"
    | "PERIODIC_SEMANTICS_UNVERIFIED"
    | "DURABLE_IDENTITY_UNVERIFIED"
    | "PROVENANCE_UNVERIFIED"
    | "ANALYTICAL_FIELD_RETENTION_UNVERIFIED"
    | "PRIVATE_BOUNDARY_UNVERIFIED"
    | "NON_SYNTHETIC_FIXTURE"
    | "PRIVATE_DATA_OBSERVED"
    | "PRIVATE_ARTIFACT_RETAINED"
    | "INVALID_TIME_ORDER";
  control: HostedSourceContractControl;
  severity: "review" | "block";
}>;

export type HostedSourceContractAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  passedControls: readonly HostedSourceContractControl[];
  check: CumulativeRehearsalCheck;
  issues: readonly HostedSourceContractAttestationIssue[];
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

function assertRuntimeShape(input: HostedSourceContractAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.sourceContractSha256, "Source-contract digest");
  sha256(input.aggregateProfileSha256, "Aggregate-profile digest");
  sha256(input.fixtureManifestSha256, "Fixture-manifest digest");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Source-contract attestations must be an array.");
  }

  const ids = new Set<string>();
  const controls = new Set<HostedSourceContractControl>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_CONTROLS.includes(attestation.control)) {
      throw new Error("Source-contract attestation control is invalid.");
    }
    if (controls.has(attestation.control)) {
      throw new Error(
        `Source-contract attestation ${attestation.control} must be unique.`,
      );
    }
    controls.add(attestation.control);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.control} head`);
    sha256(
      attestation.sourceContractSha256,
      `${attestation.control} source-contract digest`,
    );
    sha256(
      attestation.aggregateProfileSha256,
      `${attestation.control} aggregate-profile digest`,
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
      contractVerified: attestation.contractVerified,
      periodicSemanticsVerified: attestation.periodicSemanticsVerified,
      durableIdentityVerified: attestation.durableIdentityVerified,
      provenanceVerified: attestation.provenanceVerified,
      analyticalFieldRetentionVerified:
        attestation.analyticalFieldRetentionVerified,
      privateBoundaryVerified: attestation.privateBoundaryVerified,
      syntheticFixturesOnly: attestation.syntheticFixturesOnly,
      privateDataObserved: attestation.privateDataObserved,
      retainedPrivateArtifact: attestation.retainedPrivateArtifact,
    })) {
      explicitBoolean(value, `${attestation.control} ${field}`);
    }
  }
}

function issue(
  code: HostedSourceContractAttestationIssue["code"],
  control: HostedSourceContractControl,
  severity: HostedSourceContractAttestationIssue["severity"],
): HostedSourceContractAttestationIssue {
  return { code, control, severity };
}

export function projectHostedSourceContractAttestations(
  input: HostedSourceContractAttestationInput,
): HostedSourceContractAttestationProjection {
  assertRuntimeShape(input);
  const byControl = new Map(
    input.attestations.map((attestation) => [attestation.control, attestation]),
  );
  const issues: HostedSourceContractAttestationIssue[] = [];
  const passedControls: HostedSourceContractControl[] = [];

  for (const control of REQUIRED_CONTROLS) {
    const attestation = byControl.get(control);
    if (attestation === undefined) {
      issues.push(issue("CONTROL_MISSING", control, "review"));
      continue;
    }

    const blocking: HostedSourceContractAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("CONTROL_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_CONTROL[control]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.sourceContractSha256 !== input.sourceContractSha256) {
      blocking.push("SOURCE_CONTRACT_MISMATCH");
    }
    if (attestation.aggregateProfileSha256 !== input.aggregateProfileSha256) {
      blocking.push("AGGREGATE_PROFILE_MISMATCH");
    }
    if (attestation.fixtureManifestSha256 !== input.fixtureManifestSha256) {
      blocking.push("FIXTURE_MANIFEST_MISMATCH");
    }
    if (attestation.exitCode !== 0) blocking.push("CHECK_FAILED");
    if (attestation.assertionsPassed !== attestation.assertionsTotal) {
      blocking.push("ASSERTIONS_INCOMPLETE");
    }
    if (!attestation.contractVerified) {
      blocking.push("CONTRACT_UNVERIFIED");
    }
    if (!attestation.periodicSemanticsVerified) {
      blocking.push("PERIODIC_SEMANTICS_UNVERIFIED");
    }
    if (!attestation.durableIdentityVerified) {
      blocking.push("DURABLE_IDENTITY_UNVERIFIED");
    }
    if (!attestation.provenanceVerified) {
      blocking.push("PROVENANCE_UNVERIFIED");
    }
    if (!attestation.analyticalFieldRetentionVerified) {
      blocking.push("ANALYTICAL_FIELD_RETENTION_UNVERIFIED");
    }
    if (!attestation.privateBoundaryVerified) {
      blocking.push("PRIVATE_BOUNDARY_UNVERIFIED");
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
      name: "authoritative_source_contracts",
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
