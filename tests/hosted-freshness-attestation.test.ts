import { describe, expect, it } from "vitest";

import {
  projectHostedFreshnessAttestations,
  type HostedFreshnessAttestationInput,
  type HostedFreshnessControlAttestation,
} from "@/domain/hosted-freshness-attestation";

const HEAD = "a".repeat(40);
const SOURCE = "b".repeat(64);
const FIXTURES = "c".repeat(64);
const SUMMARY = "d".repeat(64);

const commands = {
  accepted_version_timestamps: "freshness_verify_accepted_timestamps",
  latest_event_current_through: "freshness_verify_current_through",
  aggregate_refresh_publication: "freshness_verify_aggregate_publication",
  failed_attempt_non_advancement: "freshness_verify_failed_non_advancement",
  rollback_restoration: "freshness_verify_rollback_restoration",
  source_mode_coverage: "freshness_verify_source_mode_coverage",
  snapshot_non_live_wording: "freshness_verify_snapshot_wording",
  freshness_confidence: "freshness_verify_confidence_warnings",
  provenance_visibility: "freshness_verify_provenance",
  idempotent_rebuild: "freshness_verify_idempotent_rebuild",
} as const;

const persistenceControls = new Set([
  "accepted_version_timestamps",
  "latest_event_current_through",
  "aggregate_refresh_publication",
  "failed_attempt_non_advancement",
  "rollback_restoration",
  "source_mode_coverage",
  "provenance_visibility",
  "idempotent_rebuild",
]);

function attestations(): HostedFreshnessControlAttestation[] {
  return Object.entries(commands).map(([control, commandId], index) => ({
    attestationId: `freshness-${index + 1}`,
    control: control as HostedFreshnessControlAttestation["control"],
    commandId,
    headSha: HEAD,
    sourceContractSha256: SOURCE,
    fixtureManifestSha256: FIXTURES,
    startedAt: "2026-07-26T16:00:00.000Z",
    completedAt: "2026-07-26T16:01:00.000Z",
    exitCode: 0,
    summarySha256: SUMMARY,
    assertionsPassed: 14,
    assertionsTotal: 14,
    acceptedVersionVerified: true,
    importTimestampRetained: true,
    latestAcceptedEventTimestampRetained: true,
    aggregateRefreshTimestampRetained: true,
    failedAttemptExcluded: true,
    rollbackRestorationVerified: true,
    sourceModeCoverageVerified: true,
    nonLiveWordingVerified: true,
    confidenceWarningVerified: true,
    provenanceVerified: true,
    idempotentRebuildVerified: true,
    syntheticFixturesOnly: true,
    privateDataObserved: false,
    retainedPrivateArtifact: false,
    connectedPersistenceEvidence: persistenceControls.has(control),
  }));
}

function input(
  overrides: Partial<HostedFreshnessAttestationInput> = {},
): HostedFreshnessAttestationInput {
  return {
    evidenceId: "hosted-freshness-attestations",
    composedHeadSha: HEAD,
    sourceContractSha256: SOURCE,
    fixtureManifestSha256: FIXTURES,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted freshness attestations", () => {
  it("projects complete exact-head freshness evidence without authority", () => {
    expect(projectHostedFreshnessAttestations(input())).toMatchObject({
      status: "attested",
      passedControls: Object.keys(commands),
      check: {
        name: "freshness_snapshot_integrity",
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
    const result = projectHostedFreshnessAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result).toMatchObject({
      status: "review_required",
      check: { state: "not_run", headSha: null },
    });
    expect(result.issues).toContainEqual({
      code: "CONTROL_MISSING",
      control: "accepted_version_timestamps",
      severity: "review",
    });
  });

  it("blocks stale heads, command substitution and manifest drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "e".repeat(40),
      commandId: "freshness_verify_current_through",
      sourceContractSha256: "f".repeat(64),
      fixtureManifestSha256: "0".repeat(64),
    };

    expect(
      projectHostedFreshnessAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CONTROL_STALE",
        "COMMAND_MISMATCH",
        "SOURCE_CONTRACT_MISMATCH",
        "FIXTURE_MANIFEST_MISMATCH",
      ]),
    );
  });

  it("blocks failed, incomplete or timestamp-incomplete evidence", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      exitCode: 1,
      assertionsPassed: 13,
      importTimestampRetained: false,
      latestAcceptedEventTimestampRetained: false,
      aggregateRefreshTimestampRetained: false,
    };

    expect(
      projectHostedFreshnessAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CHECK_FAILED",
        "ASSERTIONS_INCOMPLETE",
        "IMPORT_TIMESTAMP_MISSING",
        "CURRENT_THROUGH_MISSING",
        "AGGREGATE_REFRESH_TIMESTAMP_MISSING",
      ]),
    );
  });

  it("blocks version, failure, rollback and source-coverage drift", () => {
    const values = attestations();
    values[2] = {
      ...values[2]!,
      acceptedVersionVerified: false,
      failedAttemptExcluded: false,
      rollbackRestorationVerified: false,
      sourceModeCoverageVerified: false,
    };

    expect(
      projectHostedFreshnessAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "ACCEPTED_VERSION_UNVERIFIED",
        "FAILED_ATTEMPT_ADVANCED_FRESHNESS",
        "ROLLBACK_NOT_RESTORED",
        "SOURCE_MODE_COVERAGE_INCOMPLETE",
      ]),
    );
  });

  it("blocks wording, confidence, provenance and rebuild drift", () => {
    const values = attestations();
    values[6] = {
      ...values[6]!,
      nonLiveWordingVerified: false,
      confidenceWarningVerified: false,
      provenanceVerified: false,
      idempotentRebuildVerified: false,
    };

    expect(
      projectHostedFreshnessAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "NON_LIVE_WORDING_UNVERIFIED",
        "CONFIDENCE_WARNING_UNVERIFIED",
        "PROVENANCE_UNVERIFIED",
        "IDEMPOTENT_REBUILD_UNVERIFIED",
      ]),
    );
  });

  it("blocks unsafe fixtures, private artifacts and unconnected persistence", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      syntheticFixturesOnly: false,
      privateDataObserved: true,
      retainedPrivateArtifact: true,
      connectedPersistenceEvidence: false,
    };

    expect(
      projectHostedFreshnessAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "NON_SYNTHETIC_FIXTURE",
        "PRIVATE_DATA_OBSERVED",
        "PRIVATE_ARTIFACT_RETAINED",
        "PERSISTENCE_EVIDENCE_UNCONNECTED",
      ]),
    );
  });

  it("blocks inverted times and rejects string-like booleans", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      startedAt: "2026-07-26T16:02:00.000Z",
    };
    expect(
      projectHostedFreshnessAttestations(input({ attestations: values }))
        .issues,
    ).toContainEqual({
      code: "INVALID_TIME_ORDER",
      control: "accepted_version_timestamps",
      severity: "block",
    });

    expect(() =>
      projectHostedFreshnessAttestations({
        ...input(),
        attestations: [
          {
            ...attestations()[0]!,
            acceptedVersionVerified: "true" as unknown as boolean,
          },
        ],
      }),
    ).toThrow("explicit boolean");
  });
});
