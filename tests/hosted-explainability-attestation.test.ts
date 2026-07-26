import { describe, expect, it } from "vitest";

import {
  projectHostedExplainabilityAttestations,
  type HostedExplainabilityAttestationInput,
  type HostedExplainabilityControlAttestation,
} from "@/domain/hosted-explainability-attestation";

const HEAD = "a".repeat(40);
const RECOMMENDATIONS = "b".repeat(64);
const FIXTURES = "c".repeat(64);
const SUMMARY = "d".repeat(64);

const commands = {
  recommendation_evidence: "explain_verify_recommendation_evidence",
  sample_confidence_uncertainty: "explain_verify_sample_confidence",
  freshness_coverage: "explain_verify_freshness_coverage",
  rule_model_provenance: "explain_verify_rule_model_provenance",
  feature_contribution_trace: "explain_verify_feature_contributions",
  alternatives_tradeoffs: "explain_verify_alternatives_tradeoffs",
  mode_distance_context: "explain_verify_mode_distance_context",
  experimental_labelling: "explain_verify_experimental_labels",
  chronological_no_leakage: "explain_verify_chronological_cutoff",
  partial_unavailable_states: "explain_verify_partial_unavailable_states",
} as const;

function attestations(): HostedExplainabilityControlAttestation[] {
  return Object.entries(commands).map(([control, commandId], index) => ({
    attestationId: `explain-${index + 1}`,
    control: control as HostedExplainabilityControlAttestation["control"],
    commandId,
    headSha: HEAD,
    recommendationManifestSha256: RECOMMENDATIONS,
    fixtureManifestSha256: FIXTURES,
    startedAt: "2026-07-26T18:00:00.000Z",
    completedAt: "2026-07-26T18:01:00.000Z",
    exitCode: 0,
    summarySha256: SUMMARY,
    assertionsPassed: 10,
    assertionsTotal: 10,
    evidenceTraceVerified: true,
    limitationsVerified: true,
    provenanceVerified: true,
    chronologyVerified: true,
    reviewOnlyVerified: true,
    syntheticFixturesOnly: true,
    privateDataObserved: false,
    retainedPrivateArtifact: false,
  }));
}

function input(
  overrides: Partial<HostedExplainabilityAttestationInput> = {},
): HostedExplainabilityAttestationInput {
  return {
    evidenceId: "hosted-explainability-attestations",
    composedHeadSha: HEAD,
    recommendationManifestSha256: RECOMMENDATIONS,
    fixtureManifestSha256: FIXTURES,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted explainability attestations", () => {
  it("projects complete exact-head evidence without execution authority", () => {
    expect(projectHostedExplainabilityAttestations(input())).toMatchObject({
      status: "attested",
      passedControls: Object.keys(commands),
      check: {
        name: "recommendation_explainability",
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
    const result = projectHostedExplainabilityAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result).toMatchObject({
      status: "review_required",
      check: { state: "not_run", headSha: null },
    });
    expect(result.issues).toContainEqual({
      code: "CONTROL_MISSING",
      control: "recommendation_evidence",
      severity: "review",
    });
  });

  it("blocks stale heads, command substitution and manifest drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "e".repeat(40),
      commandId: "explain_verify_sample_confidence",
      recommendationManifestSha256: "f".repeat(64),
      fixtureManifestSha256: "0".repeat(64),
    };

    expect(
      projectHostedExplainabilityAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CONTROL_STALE",
        "COMMAND_MISMATCH",
        "RECOMMENDATION_MANIFEST_MISMATCH",
        "FIXTURE_MANIFEST_MISMATCH",
      ]),
    );
  });

  it("blocks failed, incomplete and unexplained evidence", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      exitCode: 1,
      assertionsPassed: 9,
      evidenceTraceVerified: false,
      limitationsVerified: false,
    };

    expect(
      projectHostedExplainabilityAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CHECK_FAILED",
        "ASSERTIONS_INCOMPLETE",
        "EVIDENCE_TRACE_UNVERIFIED",
        "LIMITATIONS_UNVERIFIED",
      ]),
    );
  });

  it("blocks missing provenance, chronology and review-only boundaries", () => {
    const values = attestations();
    values[2] = {
      ...values[2]!,
      provenanceVerified: false,
      chronologyVerified: false,
      reviewOnlyVerified: false,
    };

    expect(
      projectHostedExplainabilityAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "PROVENANCE_UNVERIFIED",
        "CHRONOLOGY_UNVERIFIED",
        "REVIEW_ONLY_BOUNDARY_UNVERIFIED",
      ]),
    );
  });

  it("blocks unsafe fixtures, private evidence and retained artifacts", () => {
    const values = attestations();
    values[3] = {
      ...values[3]!,
      syntheticFixturesOnly: false,
      privateDataObserved: true,
      retainedPrivateArtifact: true,
    };

    expect(
      projectHostedExplainabilityAttestations(
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

  it("blocks inverted evidence times", () => {
    const values = attestations();
    values[4] = {
      ...values[4]!,
      startedAt: "2026-07-26T18:02:00.000Z",
    };

    expect(
      projectHostedExplainabilityAttestations(input({ attestations: values }))
        .issues,
    ).toContainEqual({
      code: "INVALID_TIME_ORDER",
      control: "feature_contribution_trace",
      severity: "block",
    });
  });

  it("rejects duplicate controls and string-like booleans", () => {
    const duplicate = attestations();
    duplicate[1] = { ...duplicate[1]!, control: duplicate[0]!.control };
    expect(() =>
      projectHostedExplainabilityAttestations(
        input({ attestations: duplicate }),
      ),
    ).toThrow("must be unique");

    expect(() =>
      projectHostedExplainabilityAttestations({
        ...input(),
        attestations: [
          {
            ...attestations()[0]!,
            chronologyVerified: "true" as unknown as boolean,
          },
        ],
      }),
    ).toThrow("explicit boolean");
  });
});
