import { describe, expect, it } from "vitest";

import {
  projectHostedEndToEndAttestations,
  type HostedEndToEndAttestationInput,
  type HostedEndToEndJourneyAttestation,
} from "@/domain/hosted-end-to-end-attestation";

const HEAD = "a".repeat(40);
const ROUTES = "b".repeat(64);
const FIXTURES = "c".repeat(64);
const SUMMARY = "d".repeat(64);

const commands = {
  fail_closed_access: "e2e_verify_fail_closed_access",
  import_upload_preview_confirmation: "e2e_verify_import_upload_preview",
  import_processing_completion_recovery: "e2e_verify_import_recovery",
  vault_core_discovery_reads: "e2e_verify_intelligence_reads",
  tournament_maiden_reads: "e2e_verify_tournament_maiden",
  breeding_lifecycle_reads: "e2e_verify_breeding_lifecycle",
  vault_performance_economics: "e2e_verify_vault_performance",
  open_race_stage_boundary: "e2e_verify_open_race_boundary",
  readiness_non_activation: "e2e_verify_readiness_non_activation",
} as const;

const providerJourneys = new Set([
  "import_upload_preview_confirmation",
  "import_processing_completion_recovery",
  "vault_performance_economics",
]);

function attestations(): HostedEndToEndJourneyAttestation[] {
  return Object.entries(commands).map(([journey, commandId], index) => ({
    attestationId: `e2e-${index + 1}`,
    journey: journey as HostedEndToEndJourneyAttestation["journey"],
    commandId,
    headSha: HEAD,
    routeManifestSha256: ROUTES,
    fixtureManifestSha256: FIXTURES,
    startedAt: "2026-07-26T14:00:00.000Z",
    completedAt: "2026-07-26T14:01:00.000Z",
    exitCode: 0,
    summarySha256: SUMMARY,
    checkpointsPassed: 8,
    checkpointsTotal: 8,
    browserExecutionComplete: true,
    ownerBoundaryVerified: true,
    syntheticFixturesOnly: true,
    privateDataObserved: false,
    retainedPrivateArtifact: false,
    connectedProviderEvidence: providerJourneys.has(journey),
    productionDisabled: true,
    publicRouteExposed: false,
    productionMutationObserved: false,
  }));
}

function input(
  overrides: Partial<HostedEndToEndAttestationInput> = {},
): HostedEndToEndAttestationInput {
  return {
    evidenceId: "hosted-end-to-end-attestations",
    composedHeadSha: HEAD,
    routeManifestSha256: ROUTES,
    fixtureManifestSha256: FIXTURES,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted end-to-end attestations", () => {
  it("projects complete exact-head browser journeys without authority", () => {
    expect(projectHostedEndToEndAttestations(input())).toMatchObject({
      status: "attested",
      passedJourneys: Object.keys(commands),
      check: { name: "end_to_end_workflows", state: "passed", headSha: HEAD },
      issues: [],
      privateArtifactsRetained: false,
      workflowDispatchAllowed: false,
      mergeAllowed: false,
      providerMutationAllowed: false,
      productionMutationAllowed: false,
    });
  });

  it("keeps a missing journey review-required", () => {
    const result = projectHostedEndToEndAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result).toMatchObject({
      status: "review_required",
      check: { state: "not_run", headSha: null },
    });
    expect(result.issues).toContainEqual({
      code: "JOURNEY_MISSING",
      journey: "fail_closed_access",
      severity: "review",
    });
  });

  it("blocks stale heads, substituted commands and manifest drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "e".repeat(40),
      commandId: "e2e_verify_import_upload_preview",
      routeManifestSha256: "f".repeat(64),
      fixtureManifestSha256: "0".repeat(64),
    };

    expect(
      projectHostedEndToEndAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "JOURNEY_STALE",
        "COMMAND_MISMATCH",
        "ROUTE_MANIFEST_MISMATCH",
        "FIXTURE_MANIFEST_MISMATCH",
      ]),
    );
  });

  it("blocks failed or incomplete browser evidence", () => {
    const values = attestations();
    values[3] = {
      ...values[3]!,
      exitCode: 1,
      checkpointsPassed: 7,
      browserExecutionComplete: false,
      ownerBoundaryVerified: false,
    };

    expect(
      projectHostedEndToEndAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CHECK_FAILED",
        "CHECKPOINTS_INCOMPLETE",
        "BROWSER_EXECUTION_INCOMPLETE",
        "OWNER_BOUNDARY_UNVERIFIED",
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
      projectHostedEndToEndAttestations(
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

  it("requires connected evidence for provider-backed journeys", () => {
    const values = attestations();
    values[1] = { ...values[1]!, connectedProviderEvidence: false };

    expect(
      projectHostedEndToEndAttestations(input({ attestations: values })).issues,
    ).toContainEqual({
      code: "PROVIDER_EVIDENCE_UNCONNECTED",
      journey: "import_upload_preview_confirmation",
      severity: "block",
    });
  });

  it("blocks Production or public-exposure drift", () => {
    const values = attestations();
    values[8] = {
      ...values[8]!,
      productionDisabled: false,
      publicRouteExposed: true,
      productionMutationObserved: true,
    };

    expect(
      projectHostedEndToEndAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "PRODUCTION_NOT_DISABLED",
        "PUBLIC_ROUTE_EXPOSED",
        "PRODUCTION_MUTATION_OBSERVED",
      ]),
    );
  });

  it("rejects malformed runtime booleans", () => {
    expect(() =>
      projectHostedEndToEndAttestations({
        ...input(),
        attestations: [
          {
            ...attestations()[0]!,
            productionDisabled: "true" as unknown as boolean,
          },
        ],
      }),
    ).toThrow("explicit boolean");
  });
});
