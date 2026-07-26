import { describe, expect, it } from "vitest";

import {
  projectHostedGameRulesAttestations,
  type HostedGameRuleControlAttestation,
  type HostedGameRulesAttestationInput,
} from "@/domain/hosted-game-rules-attestation";

const HEAD = "a".repeat(40);
const RULES = "b".repeat(64);
const FIXTURES = "c".repeat(64);
const SUMMARY = "d".repeat(64);

const commands = {
  distance_metres: "rules_verify_distance_metres",
  gold_gate_eligibility: "rules_verify_gold_gate_eligibility",
  open_race_star_timing: "rules_verify_open_race_star_timing",
  fifty_percent_gate_cap: "rules_verify_fifty_percent_cap",
  maiden_mode_preservation: "rules_verify_maiden_mode_preservation",
  breeding_separate_rankings: "rules_verify_breeding_separate_rankings",
  durable_identity_lineage: "rules_verify_durable_identity_lineage",
  historical_bgc_zero_economics: "rules_verify_historical_bgc",
  asset_separation_transfer_exclusion: "rules_verify_asset_transfer_accounting",
  genesis_burn_exclusion: "rules_verify_genesis_burn_exclusion",
  configurable_qualification: "rules_verify_configurable_qualification",
  discovery_minimum_sample: "rules_verify_discovery_minimum_sample",
} as const;

function attestations(): HostedGameRuleControlAttestation[] {
  return Object.entries(commands).map(([control, commandId], index) => ({
    attestationId: `rules-${index + 1}`,
    control: control as HostedGameRuleControlAttestation["control"],
    commandId,
    headSha: HEAD,
    ruleManifestSha256: RULES,
    fixtureManifestSha256: FIXTURES,
    startedAt: "2026-07-26T17:00:00.000Z",
    completedAt: "2026-07-26T17:01:00.000Z",
    exitCode: 0,
    summarySha256: SUMMARY,
    assertionsPassed: 12,
    assertionsTotal: 12,
    authoritativeRuleVerified: true,
    boundaryCasesVerified: true,
    negativeCasesVerified: true,
    noRuleSubstitutionVerified: true,
    provenanceVerified: true,
    noLiveStateClaimVerified: true,
    nonActionableVerified: true,
    syntheticFixturesOnly: true,
    privateDataObserved: false,
    retainedPrivateArtifact: false,
  }));
}

function input(
  overrides: Partial<HostedGameRulesAttestationInput> = {},
): HostedGameRulesAttestationInput {
  return {
    evidenceId: "hosted-game-rules-attestations",
    composedHeadSha: HEAD,
    ruleManifestSha256: RULES,
    fixtureManifestSha256: FIXTURES,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted game-rules attestations", () => {
  it("projects complete exact-head rule evidence without authority", () => {
    expect(projectHostedGameRulesAttestations(input())).toMatchObject({
      status: "attested",
      passedControls: Object.keys(commands),
      check: {
        name: "confirmed_game_rules",
        state: "passed",
        headSha: HEAD,
      },
      issues: [],
      privateArtifactsRetained: false,
      workflowDispatchAllowed: false,
      mergeAllowed: false,
      providerMutationAllowed: false,
      productionMutationAllowed: false,
    });
  });

  it("keeps missing controls review-required", () => {
    const result = projectHostedGameRulesAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result).toMatchObject({
      status: "review_required",
      check: { state: "not_run", headSha: null },
    });
    expect(result.issues).toContainEqual({
      code: "CONTROL_MISSING",
      control: "distance_metres",
      severity: "review",
    });
  });

  it("blocks stale heads, command substitution and manifest drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "e".repeat(40),
      commandId: "rules_verify_gold_gate_eligibility",
      ruleManifestSha256: "f".repeat(64),
      fixtureManifestSha256: "0".repeat(64),
    };

    expect(
      projectHostedGameRulesAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CONTROL_STALE",
        "COMMAND_MISMATCH",
        "RULE_MANIFEST_MISMATCH",
        "FIXTURE_MANIFEST_MISMATCH",
      ]),
    );
  });

  it("blocks failed, incomplete or unverified authoritative rules", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      exitCode: 1,
      assertionsPassed: 11,
      authoritativeRuleVerified: false,
    };

    expect(
      projectHostedGameRulesAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CHECK_FAILED",
        "ASSERTIONS_INCOMPLETE",
        "AUTHORITATIVE_RULE_UNVERIFIED",
      ]),
    );
  });

  it("blocks missing boundary, negative and substitution evidence", () => {
    const values = attestations();
    values[2] = {
      ...values[2]!,
      boundaryCasesVerified: false,
      negativeCasesVerified: false,
      noRuleSubstitutionVerified: false,
    };

    expect(
      projectHostedGameRulesAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "BOUNDARY_CASES_UNVERIFIED",
        "NEGATIVE_CASES_UNVERIFIED",
        "RULE_SUBSTITUTION_UNVERIFIED",
      ]),
    );
  });

  it("blocks provenance, live-state and action-boundary drift", () => {
    const values = attestations();
    values[3] = {
      ...values[3]!,
      provenanceVerified: false,
      noLiveStateClaimVerified: false,
      nonActionableVerified: false,
    };

    expect(
      projectHostedGameRulesAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "PROVENANCE_UNVERIFIED",
        "LIVE_STATE_CLAIM_UNVERIFIED",
        "NON_ACTIONABLE_BOUNDARY_UNVERIFIED",
      ]),
    );
  });

  it("blocks unsafe fixtures, private evidence and retained artifacts", () => {
    const values = attestations();
    values[4] = {
      ...values[4]!,
      syntheticFixturesOnly: false,
      privateDataObserved: true,
      retainedPrivateArtifact: true,
    };

    expect(
      projectHostedGameRulesAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "NON_SYNTHETIC_FIXTURE",
        "PRIVATE_DATA_OBSERVED",
        "PRIVATE_ARTIFACT_RETAINED",
      ]),
    );
  });

  it("blocks inverted times and rejects string-like booleans", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      startedAt: "2026-07-26T17:02:00.000Z",
    };
    expect(
      projectHostedGameRulesAttestations(input({ attestations: values }))
        .issues,
    ).toContainEqual({
      code: "INVALID_TIME_ORDER",
      control: "distance_metres",
      severity: "block",
    });

    expect(() =>
      projectHostedGameRulesAttestations({
        ...input(),
        attestations: [
          {
            ...attestations()[0]!,
            authoritativeRuleVerified: "true" as unknown as boolean,
          },
        ],
      }),
    ).toThrow("explicit boolean");
  });
});
