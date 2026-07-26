import type { CumulativeRehearsalCheck } from "@/domain/cumulative-rehearsal-evidence";

const REQUIRED_CONTROLS = [
  "distance_metres",
  "gold_gate_eligibility",
  "open_race_star_timing",
  "fifty_percent_gate_cap",
  "maiden_mode_preservation",
  "breeding_dual_ranking",
  "durable_identity_lineage",
  "historical_bgc_zero_economics",
  "asset_separation_transfer_exclusion",
  "genesis_burn_exclusion",
  "configurable_qualification",
  "discovery_minimum_sample",
] as const;

const COMMAND_BY_CONTROL = {
  distance_metres: "rules_verify_distance_metres",
  gold_gate_eligibility: "rules_verify_gold_gate_eligibility",
  open_race_star_timing: "rules_verify_open_race_star_timing",
  fifty_percent_gate_cap: "rules_verify_fifty_percent_cap",
  maiden_mode_preservation: "rules_verify_maiden_mode_preservation",
  breeding_dual_ranking: "rules_verify_breeding_dual_ranking",
  durable_identity_lineage: "rules_verify_durable_identity_lineage",
  historical_bgc_zero_economics: "rules_verify_historical_bgc",
  asset_separation_transfer_exclusion: "rules_verify_asset_transfer_accounting",
  genesis_burn_exclusion: "rules_verify_genesis_burn_exclusion",
  configurable_qualification: "rules_verify_configurable_qualification",
  discovery_minimum_sample: "rules_verify_discovery_minimum_sample",
} as const;

export type HostedGameRuleControl = (typeof REQUIRED_CONTROLS)[number];
export type HostedGameRuleCommandId =
  (typeof COMMAND_BY_CONTROL)[HostedGameRuleControl];

export type HostedGameRuleControlAttestation = Readonly<{
  attestationId: string;
  control: HostedGameRuleControl;
  commandId: HostedGameRuleCommandId;
  headSha: string;
  ruleManifestSha256: string;
  fixtureManifestSha256: string;
  startedAt: string;
  completedAt: string;
  exitCode: number;
  summarySha256: string;
  assertionsPassed: number;
  assertionsTotal: number;
  authoritativeRuleVerified: boolean;
  boundaryCasesVerified: boolean;
  negativeCasesVerified: boolean;
  noRuleSubstitutionVerified: boolean;
  provenanceVerified: boolean;
  noLiveStateClaimVerified: boolean;
  nonActionableVerified: boolean;
  syntheticFixturesOnly: boolean;
  privateDataObserved: boolean;
  retainedPrivateArtifact: boolean;
}>;

export type HostedGameRulesAttestationInput = Readonly<{
  evidenceId: string;
  composedHeadSha: string;
  ruleManifestSha256: string;
  fixtureManifestSha256: string;
  attestations: readonly HostedGameRuleControlAttestation[];
}>;

export type HostedGameRulesAttestationIssue = Readonly<{
  code:
    | "CONTROL_MISSING"
    | "CONTROL_STALE"
    | "COMMAND_MISMATCH"
    | "RULE_MANIFEST_MISMATCH"
    | "FIXTURE_MANIFEST_MISMATCH"
    | "CHECK_FAILED"
    | "ASSERTIONS_INCOMPLETE"
    | "AUTHORITATIVE_RULE_UNVERIFIED"
    | "BOUNDARY_CASES_UNVERIFIED"
    | "NEGATIVE_CASES_UNVERIFIED"
    | "RULE_SUBSTITUTION_UNVERIFIED"
    | "PROVENANCE_UNVERIFIED"
    | "LIVE_STATE_CLAIM_UNVERIFIED"
    | "NON_ACTIONABLE_BOUNDARY_UNVERIFIED"
    | "NON_SYNTHETIC_FIXTURE"
    | "PRIVATE_DATA_OBSERVED"
    | "PRIVATE_ARTIFACT_RETAINED"
    | "INVALID_TIME_ORDER";
  control: HostedGameRuleControl;
  severity: "review" | "block";
}>;

export type HostedGameRulesAttestationProjection = Readonly<{
  status: "blocked" | "review_required" | "attested";
  passedControls: readonly HostedGameRuleControl[];
  check: CumulativeRehearsalCheck;
  issues: readonly HostedGameRulesAttestationIssue[];
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

function assertRuntimeShape(input: HostedGameRulesAttestationInput): void {
  requiredText(input.evidenceId, "Evidence ID");
  exactSha(input.composedHeadSha, "Composed head");
  sha256(input.ruleManifestSha256, "Rule-manifest digest");
  sha256(input.fixtureManifestSha256, "Fixture-manifest digest");
  if (!Array.isArray(input.attestations)) {
    throw new Error("Game-rule attestations must be an array.");
  }

  const ids = new Set<string>();
  const controls = new Set<HostedGameRuleControl>();
  for (const attestation of input.attestations) {
    requiredText(attestation.attestationId, "Attestation ID");
    if (ids.has(attestation.attestationId)) {
      throw new Error(
        `Attestation ID ${attestation.attestationId} must be unique.`,
      );
    }
    ids.add(attestation.attestationId);
    if (!REQUIRED_CONTROLS.includes(attestation.control)) {
      throw new Error("Game-rule attestation control is invalid.");
    }
    if (controls.has(attestation.control)) {
      throw new Error(
        `Game-rule attestation ${attestation.control} must be unique.`,
      );
    }
    controls.add(attestation.control);
    requiredText(attestation.commandId, "Command ID");
    exactSha(attestation.headSha, `${attestation.control} head`);
    sha256(
      attestation.ruleManifestSha256,
      `${attestation.control} rule-manifest digest`,
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
      authoritativeRuleVerified: attestation.authoritativeRuleVerified,
      boundaryCasesVerified: attestation.boundaryCasesVerified,
      negativeCasesVerified: attestation.negativeCasesVerified,
      noRuleSubstitutionVerified: attestation.noRuleSubstitutionVerified,
      provenanceVerified: attestation.provenanceVerified,
      noLiveStateClaimVerified: attestation.noLiveStateClaimVerified,
      nonActionableVerified: attestation.nonActionableVerified,
      syntheticFixturesOnly: attestation.syntheticFixturesOnly,
      privateDataObserved: attestation.privateDataObserved,
      retainedPrivateArtifact: attestation.retainedPrivateArtifact,
    })) {
      explicitBoolean(value, `${attestation.control} ${field}`);
    }
  }
}

function issue(
  code: HostedGameRulesAttestationIssue["code"],
  control: HostedGameRuleControl,
  severity: HostedGameRulesAttestationIssue["severity"],
): HostedGameRulesAttestationIssue {
  return { code, control, severity };
}

export function projectHostedGameRulesAttestations(
  input: HostedGameRulesAttestationInput,
): HostedGameRulesAttestationProjection {
  assertRuntimeShape(input);
  const byControl = new Map(
    input.attestations.map((attestation) => [attestation.control, attestation]),
  );
  const issues: HostedGameRulesAttestationIssue[] = [];
  const passedControls: HostedGameRuleControl[] = [];

  for (const control of REQUIRED_CONTROLS) {
    const attestation = byControl.get(control);
    if (attestation === undefined) {
      issues.push(issue("CONTROL_MISSING", control, "review"));
      continue;
    }

    const blocking: HostedGameRulesAttestationIssue["code"][] = [];
    if (attestation.headSha !== input.composedHeadSha) {
      blocking.push("CONTROL_STALE");
    }
    if (attestation.commandId !== COMMAND_BY_CONTROL[control]) {
      blocking.push("COMMAND_MISMATCH");
    }
    if (attestation.ruleManifestSha256 !== input.ruleManifestSha256) {
      blocking.push("RULE_MANIFEST_MISMATCH");
    }
    if (attestation.fixtureManifestSha256 !== input.fixtureManifestSha256) {
      blocking.push("FIXTURE_MANIFEST_MISMATCH");
    }
    if (attestation.exitCode !== 0) blocking.push("CHECK_FAILED");
    if (attestation.assertionsPassed !== attestation.assertionsTotal) {
      blocking.push("ASSERTIONS_INCOMPLETE");
    }
    if (!attestation.authoritativeRuleVerified) {
      blocking.push("AUTHORITATIVE_RULE_UNVERIFIED");
    }
    if (!attestation.boundaryCasesVerified) {
      blocking.push("BOUNDARY_CASES_UNVERIFIED");
    }
    if (!attestation.negativeCasesVerified) {
      blocking.push("NEGATIVE_CASES_UNVERIFIED");
    }
    if (!attestation.noRuleSubstitutionVerified) {
      blocking.push("RULE_SUBSTITUTION_UNVERIFIED");
    }
    if (!attestation.provenanceVerified) {
      blocking.push("PROVENANCE_UNVERIFIED");
    }
    if (!attestation.noLiveStateClaimVerified) {
      blocking.push("LIVE_STATE_CLAIM_UNVERIFIED");
    }
    if (!attestation.nonActionableVerified) {
      blocking.push("NON_ACTIONABLE_BOUNDARY_UNVERIFIED");
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
      name: "confirmed_game_rules",
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
