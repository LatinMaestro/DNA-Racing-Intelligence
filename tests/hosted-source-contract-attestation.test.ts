import { describe, expect, it } from "vitest";

import {
  projectHostedSourceContractAttestations,
  type HostedSourceContractAttestationInput,
  type HostedSourceContractControlAttestation,
} from "@/domain/hosted-source-contract-attestation";

const HEAD = "a".repeat(40);
const CONTRACT = "b".repeat(64);
const PROFILE = "c".repeat(64);
const FIXTURES = "d".repeat(64);
const SUMMARY = "e".repeat(64);

const commands = {
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

function attestations(): HostedSourceContractControlAttestation[] {
  return Object.entries(commands).map(([control, commandId], index) => ({
    attestationId: `source-${index + 1}`,
    control: control as HostedSourceContractControlAttestation["control"],
    commandId,
    headSha: HEAD,
    sourceContractSha256: CONTRACT,
    aggregateProfileSha256: PROFILE,
    fixtureManifestSha256: FIXTURES,
    startedAt: "2026-07-26T19:00:00.000Z",
    completedAt: "2026-07-26T19:01:00.000Z",
    exitCode: 0,
    summarySha256: SUMMARY,
    assertionsPassed: 10,
    assertionsTotal: 10,
    contractVerified: true,
    periodicSemanticsVerified: true,
    durableIdentityVerified: true,
    provenanceVerified: true,
    analyticalFieldRetentionVerified: true,
    privateBoundaryVerified: true,
    syntheticFixturesOnly: true,
    privateDataObserved: false,
    retainedPrivateArtifact: false,
  }));
}

function input(
  overrides: Partial<HostedSourceContractAttestationInput> = {},
): HostedSourceContractAttestationInput {
  return {
    evidenceId: "hosted-source-contract-attestations",
    composedHeadSha: HEAD,
    sourceContractSha256: CONTRACT,
    aggregateProfileSha256: PROFILE,
    fixtureManifestSha256: FIXTURES,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted source-contract attestations", () => {
  it("projects complete exact-head evidence without execution authority", () => {
    expect(projectHostedSourceContractAttestations(input())).toMatchObject({
      status: "attested",
      passedControls: Object.keys(commands),
      check: {
        name: "authoritative_source_contracts",
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
    const result = projectHostedSourceContractAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result).toMatchObject({
      status: "review_required",
      check: { state: "not_run", headSha: null },
    });
    expect(result.issues).toContainEqual({
      code: "CONTROL_MISSING",
      control: "nine_authoritative_inputs",
      severity: "review",
    });
  });

  it("blocks stale heads, command substitution and manifest drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "f".repeat(40),
      commandId: "source_verify_core_details",
      sourceContractSha256: "0".repeat(64),
      aggregateProfileSha256: "1".repeat(64),
      fixtureManifestSha256: "2".repeat(64),
    };

    expect(
      projectHostedSourceContractAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CONTROL_STALE",
        "COMMAND_MISMATCH",
        "SOURCE_CONTRACT_MISMATCH",
        "AGGREGATE_PROFILE_MISMATCH",
        "FIXTURE_MANIFEST_MISMATCH",
      ]),
    );
  });

  it("blocks failed, incomplete or unverified source contracts", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      exitCode: 1,
      assertionsPassed: 9,
      contractVerified: false,
      periodicSemanticsVerified: false,
    };

    expect(
      projectHostedSourceContractAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CHECK_FAILED",
        "ASSERTIONS_INCOMPLETE",
        "CONTRACT_UNVERIFIED",
        "PERIODIC_SEMANTICS_UNVERIFIED",
      ]),
    );
  });

  it("blocks missing identity, provenance or field-retention evidence", () => {
    const values = attestations();
    values[2] = {
      ...values[2]!,
      durableIdentityVerified: false,
      provenanceVerified: false,
      analyticalFieldRetentionVerified: false,
      privateBoundaryVerified: false,
    };

    expect(
      projectHostedSourceContractAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "DURABLE_IDENTITY_UNVERIFIED",
        "PROVENANCE_UNVERIFIED",
        "ANALYTICAL_FIELD_RETENTION_UNVERIFIED",
        "PRIVATE_BOUNDARY_UNVERIFIED",
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
      projectHostedSourceContractAttestations(
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
      startedAt: "2026-07-26T19:02:00.000Z",
    };

    expect(
      projectHostedSourceContractAttestations(input({ attestations: values }))
        .issues,
    ).toContainEqual({
      code: "INVALID_TIME_ORDER",
      control: "race_merge_sequence",
      severity: "block",
    });
  });

  it("rejects duplicate controls and string-like booleans", () => {
    const duplicate = attestations();
    duplicate[1] = { ...duplicate[1]!, control: duplicate[0]!.control };
    expect(() =>
      projectHostedSourceContractAttestations(
        input({ attestations: duplicate }),
      ),
    ).toThrow("must be unique");

    expect(() =>
      projectHostedSourceContractAttestations({
        ...input(),
        attestations: [
          {
            ...attestations()[0]!,
            contractVerified: "true" as unknown as boolean,
          },
        ],
      }),
    ).toThrow("explicit boolean");
  });
});
