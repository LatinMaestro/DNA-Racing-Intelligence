import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_CONTROLS = [
  "confirmed_vault_ownership",
  "authoritative_core_id_resolution",
  "deterministic_matching_evidence",
  "mapping_reuse",
  "me_true_false_preservation",
  "future_review_queue",
  "versioned_core_persistence",
  "parent_child_graph_refresh",
  "family_queries_restrictions",
  "partial_no_history_states",
] as const;

const COMMAND_BY_CONTROL = {
  confirmed_vault_ownership: "identity_verify_vault_ownership",
  authoritative_core_id_resolution: "identity_verify_core_id_resolution",
  deterministic_matching_evidence: "identity_verify_matching_evidence",
  mapping_reuse: "identity_verify_mapping_reuse",
  me_true_false_preservation: "identity_verify_me_states",
  future_review_queue: "identity_verify_future_review",
  versioned_core_persistence: "lineage_verify_core_versions",
  parent_child_graph_refresh: "lineage_verify_graph_refresh",
  family_queries_restrictions: "lineage_verify_family_restrictions",
  partial_no_history_states: "lineage_verify_coverage_states",
} as const;

export type HostedIdentityLineageControl = (typeof REQUIRED_CONTROLS)[number];
export type HostedIdentityLineageCommandId =
  (typeof COMMAND_BY_CONTROL)[HostedIdentityLineageControl];

export type HostedIdentityLineageControlAttestation = Readonly<{
  attestationId: string;
  control: HostedIdentityLineageControl;
  commandId: HostedIdentityLineageCommandId;
  headSha: string;
  identityContractSha256: string;
  lineageContractSha256: string;
  fixtureManifestSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  assertionsPassed: number;
  assertionsTotal: number;
  ownershipVerified: boolean;
  durableIdVerified: boolean;
  matchingEvidenceOnlyVerified: boolean;
  meStateVerified: boolean;
  provenanceVerified: boolean;
  noNameLineageVerified: boolean;
  persistenceBoundaryVerified: boolean;
  syntheticFixturesOnly: boolean;
  privateDataObserved: boolean;
  retainedPrivateArtifact: boolean;
}>;

export type HostedIdentityLineageAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  identityContractSha256: string;
  lineageContractSha256: string;
  fixtureManifestSha256: string;
  attestations: readonly HostedIdentityLineageControlAttestation[];
}>;

export type HostedIdentityLineageAttestationIssue = Readonly<{
  code:
    | "CONTROL_MISSING"
    | "CONTROL_STALE"
    | "COMMAND_MISMATCH"
    | "IDENTITY_CONTRACT_MISMATCH"
    | "LINEAGE_CONTRACT_MISMATCH"
    | "FIXTURE_MANIFEST_MISMATCH"
    | "CHECK_FAILED"
    | "ASSERTIONS_INCOMPLETE"
    | "OWNERSHIP_UNVERIFIED"
    | "DURABLE_ID_UNVERIFIED"
    | "MATCHING_EVIDENCE_BOUNDARY_UNVERIFIED"
    | "ME_STATE_UNVERIFIED"
    | "PROVENANCE_UNVERIFIED"
    | "NO_NAME_LINEAGE_UNVERIFIED"
    | "PERSISTENCE_BOUNDARY_UNVERIFIED"
    | "NON_SYNTHETIC_FIXTURE"
    | "PRIVATE_DATA_OBSERVED"
    | "PRIVATE_ARTIFACT_RETAINED"
    | "INVALID_TIME_ORDER";
  control: HostedIdentityLineageControl;
  severity: "review" | "block";
}>;

export type HostedIdentityLineageAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  passedControls: readonly HostedIdentityLineageControl[];
  check: CumulativeRehearsalCheck;
  issues: readonly HostedIdentityLineageAttestationIssue[];
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

function assertRuntimeShape(
  input: HostedIdentityLineageAttestationInput,
): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.identityContractSha256, "Identity-contract digest");
  sha256(input.lineageContractSha256, "Lineage-contract digest");
  sha256(input.fixtureManifestSha256, "Fixture-manifest digest");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Identity-lineage attestations must be an array.");
  }

  const ids = new Set<string>();
  const controls = new Set<HostedIdentityLineageControl>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_CONTROLS.includes(attestation.control)) {
      throw new Error("Identity-lineage attestation control is invalid.");
    }
    if (controls.has(attestation.control)) {
      throw new Error(
        `Identity-lineage attestation ${attestation.control} must be unique.`,
      );
    }
    controls.add(attestation.control);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.control} head`);
    sha256(
      attestation.identityContractSha256,
      `${attestation.control} identity-contract digest`,
    );
    sha256(
      attestation.lineageContractSha256,
      `${attestation.control} lineage-contract digest`,
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
      ownershipVerified: attestation.ownershipVerified,
      durableIdVerified: attestation.durableIdVerified,
      matchingEvidenceOnlyVerified: attestation.matchingEvidenceOnlyVerified,
      meStateVerified: attestation.meStateVerified,
      provenanceVerified: attestation.provenanceVerified,
      noNameLineageVerified: attestation.noNameLineageVerified,
      persistenceBoundaryVerified: attestation.persistenceBoundaryVerified,
      syntheticFixturesOnly: attestation.syntheticFixturesOnly,
      privateDataObserved: attestation.privateDataObserved,
      retainedPrivateArtifact: attestation.retainedPrivateArtifact,
    })) {
      explicitBoolean(value, `${attestation.control} ${field}`);
    }
  }
}

function issue(
  code: HostedIdentityLineageAttestationIssue["code"],
  control: HostedIdentityLineageControl,
  severity: HostedIdentityLineageAttestationIssue["severity"],
): HostedIdentityLineageAttestationIssue {
  return { code, control, severity };
}

export function projectHostedIdentityLineageAttestations(
  input: HostedIdentityLineageAttestationInput,
): HostedIdentityLineageAttestationProjection {
  assertRuntimeShape(input);
  const byControl = new Map(
    input.attestations.map((attestation) => [attestation.control, attestation]),
  );
  const issues: HostedIdentityLineageAttestationIssue[] = [];
  const passedControls: HostedIdentityLineageControl[] = [];

  for (const control of REQUIRED_CONTROLS) {
    const attestation = byControl.get(control);
    if (attestation === undefined) {
      issues.push(issue("CONTROL_MISSING", control, "review"));
      continue;
    }

    const blocking: HostedIdentityLineageAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("CONTROL_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_CONTROL[control]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.identityContractSha256 !== input.identityContractSha256) {
      blocking.push("IDENTITY_CONTRACT_MISMATCH");
    }
    if (attestation.lineageContractSha256 !== input.lineageContractSha256) {
      blocking.push("LINEAGE_CONTRACT_MISMATCH");
    }
    if (attestation.fixtureManifestSha256 !== input.fixtureManifestSha256) {
      blocking.push("FIXTURE_MANIFEST_MISMATCH");
    }
    if (attestation.exitCode !== 0) blocking.push("CHECK_FAILED");
    if (attestation.assertionsPassed !== attestation.assertionsTotal) {
      blocking.push("ASSERTIONS_INCOMPLETE");
    }
    if (!attestation.ownershipVerified) {
      blocking.push("OWNERSHIP_UNVERIFIED");
    }
    if (!attestation.durableIdVerified) {
      blocking.push("DURABLE_ID_UNVERIFIED");
    }
    if (!attestation.matchingEvidenceOnlyVerified) {
      blocking.push("MATCHING_EVIDENCE_BOUNDARY_UNVERIFIED");
    }
    if (!attestation.meStateVerified) {
      blocking.push("ME_STATE_UNVERIFIED");
    }
    if (!attestation.provenanceVerified) {
      blocking.push("PROVENANCE_UNVERIFIED");
    }
    if (!attestation.noNameLineageVerified) {
      blocking.push("NO_NAME_LINEAGE_UNVERIFIED");
    }
    if (!attestation.persistenceBoundaryVerified) {
      blocking.push("PERSISTENCE_BOUNDARY_UNVERIFIED");
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
      name: "identity_lineage_integrity",
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
