import { describe, expect, it } from "vitest";

import {
  projectHostedIdentityLineageAttestations,
  type HostedIdentityLineageAttestationInput,
  type HostedIdentityLineageControlAttestation,
} from "@/domain/hosted-identity-lineage-attestation";

const HEAD = "a".repeat(40);
const IDENTITY = "b".repeat(64);
const LINEAGE = "c".repeat(64);
const FIXTURES = "d".repeat(64);
const SUMMARY = "e".repeat(64);

const commands = {
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

function attestations(): HostedIdentityLineageControlAttestation[] {
  return Object.entries(commands).map(([control, commandId], index) => ({
    attestationId: `identity-lineage-${index + 1}`,
    control: control as HostedIdentityLineageControlAttestation["control"],
    commandId,
    headSha: HEAD,
    identityContractSha256: IDENTITY,
    lineageContractSha256: LINEAGE,
    fixtureManifestSha256: FIXTURES,
    startedAt: "2026-07-26T20:00:00.000Z",
    completedAt: "2026-07-26T20:01:00.000Z",
    exitCode: 0,
    summarySha256: SUMMARY,
    assertionsPassed: 10,
    assertionsTotal: 10,
    ownershipVerified: true,
    durableIdVerified: true,
    matchingEvidenceOnlyVerified: true,
    meStateVerified: true,
    provenanceVerified: true,
    noNameLineageVerified: true,
    persistenceBoundaryVerified: true,
    syntheticFixturesOnly: true,
    privateDataObserved: false,
    retainedPrivateArtifact: false,
  }));
}

function input(
  overrides: Partial<HostedIdentityLineageAttestationInput> = {},
): HostedIdentityLineageAttestationInput {
  return {
    evidenceId: "hosted-identity-lineage-attestations",
    composedHeadSha: HEAD,
    identityContractSha256: IDENTITY,
    lineageContractSha256: LINEAGE,
    fixtureManifestSha256: FIXTURES,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted identity-lineage attestations", () => {
  it("projects complete exact-head evidence without execution authority", () => {
    expect(projectHostedIdentityLineageAttestations(input())).toMatchObject({
      status: "attested",
      passedControls: Object.keys(commands),
      check: {
        name: "identity_lineage_integrity",
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
    const result = projectHostedIdentityLineageAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result).toMatchObject({
      status: "review_required",
      check: { state: "not_run", headSha: null },
    });
    expect(result.issues).toContainEqual({
      code: "CONTROL_MISSING",
      control: "confirmed_vault_ownership",
      severity: "review",
    });
  });

  it("blocks stale heads, command substitution and manifest drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "f".repeat(40),
      commandId: "identity_verify_core_id_resolution",
      identityContractSha256: "0".repeat(64),
      lineageContractSha256: "1".repeat(64),
      fixtureManifestSha256: "2".repeat(64),
    };

    expect(
      projectHostedIdentityLineageAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CONTROL_STALE",
        "COMMAND_MISMATCH",
        "IDENTITY_CONTRACT_MISMATCH",
        "LINEAGE_CONTRACT_MISMATCH",
        "FIXTURE_MANIFEST_MISMATCH",
      ]),
    );
  });

  it("blocks failed, incomplete, ownership and durable-ID evidence", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      exitCode: 1,
      assertionsPassed: 9,
      ownershipVerified: false,
      durableIdVerified: false,
    };

    expect(
      projectHostedIdentityLineageAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CHECK_FAILED",
        "ASSERTIONS_INCOMPLETE",
        "OWNERSHIP_UNVERIFIED",
        "DURABLE_ID_UNVERIFIED",
      ]),
    );
  });

  it("blocks identity, ME, provenance and lineage-boundary drift", () => {
    const values = attestations();
    values[2] = {
      ...values[2]!,
      matchingEvidenceOnlyVerified: false,
      meStateVerified: false,
      provenanceVerified: false,
      noNameLineageVerified: false,
      persistenceBoundaryVerified: false,
    };

    expect(
      projectHostedIdentityLineageAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "MATCHING_EVIDENCE_BOUNDARY_UNVERIFIED",
        "ME_STATE_UNVERIFIED",
        "PROVENANCE_UNVERIFIED",
        "NO_NAME_LINEAGE_UNVERIFIED",
        "PERSISTENCE_BOUNDARY_UNVERIFIED",
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
      projectHostedIdentityLineageAttestations(
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
      startedAt: "2026-07-26T20:02:00.000Z",
    };

    expect(
      projectHostedIdentityLineageAttestations(input({ attestations: values }))
        .issues,
    ).toContainEqual({
      code: "INVALID_TIME_ORDER",
      control: "me_true_false_preservation",
      severity: "block",
    });
  });

  it("rejects duplicate controls and string-like booleans", () => {
    const duplicate = attestations();
    duplicate[1] = { ...duplicate[1]!, control: duplicate[0]!.control };
    expect(() =>
      projectHostedIdentityLineageAttestations(
        input({ attestations: duplicate }),
      ),
    ).toThrow("must be unique");

    expect(() =>
      projectHostedIdentityLineageAttestations({
        ...input(),
        attestations: [
          {
            ...attestations()[0]!,
            durableIdVerified: "true" as unknown as boolean,
          },
        ],
      }),
    ).toThrow("explicit boolean");
  });
});
