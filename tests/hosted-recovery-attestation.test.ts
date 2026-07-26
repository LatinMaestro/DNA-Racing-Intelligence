import { describe, expect, it } from "vitest";

import {
  projectHostedRecoveryAttestations,
  type HostedRecoveryAttestationInput,
  type HostedRecoveryScenarioAttestation,
} from "@/domain/hosted-recovery-attestation";

const HEAD = "a".repeat(40);
const SOURCE = "b".repeat(64);
const FIXTURES = "c".repeat(64);
const SUMMARY = "d".repeat(64);

const commands = {
  grouped_race_append_ordering: "recovery_verify_grouped_race_append",
  boundary_deduplication_replay: "recovery_verify_deduplication_replay",
  older_backfill: "recovery_verify_older_backfill",
  vault_arena_replacement: "recovery_verify_snapshot_replacement",
  core_details_upsert_lineage_refresh:
    "recovery_verify_core_details_lineage_refresh",
  malformed_conflict_quarantine: "recovery_verify_conflict_quarantine",
  rollback_restore: "recovery_verify_rollback_restore",
  aggregate_retry_reconciliation: "recovery_verify_aggregate_retry",
  freshness_provenance: "recovery_verify_freshness_provenance",
  bounded_memory_processing: "recovery_verify_bounded_memory",
} as const;

function attestations(): HostedRecoveryScenarioAttestation[] {
  return Object.entries(commands).map(([scenario, commandId], index) => ({
    attestationId: `recovery-${index + 1}`,
    scenario: scenario as HostedRecoveryScenarioAttestation["scenario"],
    commandId,
    headSha: HEAD,
    sourceContractSha256: SOURCE,
    fixtureManifestSha256: FIXTURES,
    startedAt: "2026-07-26T11:00:00.000Z",
    completedAt: "2026-07-26T11:01:00.000Z",
    exitCode: 0,
    summarySha256: SUMMARY,
    assertionsPassed: 12,
    assertionsTotal: 12,
    idempotencyVerified:
      scenario === "boundary_deduplication_replay" ||
      scenario === "aggregate_retry_reconciliation",
    activeVersionUnchangedOnFailure:
      scenario === "malformed_conflict_quarantine",
    rollbackRestoredPreviousVersion: scenario === "rollback_restore",
    freshnessBoundToAcceptedVersion: scenario === "freshness_provenance",
    provenanceComplete: scenario === "freshness_provenance",
    boundedMemoryVerified: scenario === "bounded_memory_processing",
    syntheticFixturesOnly: true,
    privateDataObserved: false,
    retainedPrivateArtifact: false,
  }));
}

function input(
  overrides: Partial<HostedRecoveryAttestationInput> = {},
): HostedRecoveryAttestationInput {
  return {
    evidenceId: "hosted-recovery-attestations",
    composedHeadSha: HEAD,
    sourceContractSha256: SOURCE,
    fixtureManifestSha256: FIXTURES,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted recovery attestations", () => {
  it("projects complete recovery evidence without delivery authority", () => {
    expect(projectHostedRecoveryAttestations(input())).toMatchObject({
      status: "attested",
      passedScenarios: Object.keys(commands),
      check: {
        name: "synthetic_import_replay_rollback_reconciliation",
        state: "passed",
        headSha: HEAD,
      },
      issues: [],
      privateArtifactsRetained: false,
      workflowDispatchAllowed: false,
      mergeAllowed: false,
      productionMutationAllowed: false,
    });
  });

  it("keeps a missing scenario review-required", () => {
    const result = projectHostedRecoveryAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result.status).toBe("review_required");
    expect(result.check).toMatchObject({ state: "not_run", headSha: null });
    expect(result.issues).toContainEqual({
      code: "SCENARIO_MISSING",
      scenario: "grouped_race_append_ordering",
      severity: "review",
    });
  });

  it("blocks stale heads, command substitution and manifest drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "e".repeat(40),
      commandId: "recovery_verify_older_backfill",
      sourceContractSha256: "f".repeat(64),
      fixtureManifestSha256: "0".repeat(64),
    };
    const result = projectHostedRecoveryAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "SCENARIO_STALE",
        "COMMAND_MISMATCH",
        "SOURCE_CONTRACT_MISMATCH",
        "FIXTURE_MANIFEST_MISMATCH",
      ]),
    );
  });

  it("blocks failed or incomplete assertions", () => {
    const values = attestations();
    values[2] = {
      ...values[2]!,
      exitCode: 1,
      assertionsPassed: 11,
    };
    const result = projectHostedRecoveryAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["CHECK_FAILED", "ASSERTIONS_INCOMPLETE"]),
    );
  });

  it("requires idempotent replay and aggregate retry", () => {
    const values = attestations();
    values[1] = { ...values[1]!, idempotencyVerified: false };
    values[7] = { ...values[7]!, idempotencyVerified: false };
    const result = projectHostedRecoveryAttestations(
      input({ attestations: values }),
    );

    expect(
      result.issues.filter(({ code }) => code === "IDEMPOTENCY_UNVERIFIED"),
    ).toHaveLength(2);
  });

  it("requires quarantine and rollback to preserve active state", () => {
    const values = attestations();
    values[5] = {
      ...values[5]!,
      activeVersionUnchangedOnFailure: false,
    };
    values[6] = {
      ...values[6]!,
      rollbackRestoredPreviousVersion: false,
    };
    const result = projectHostedRecoveryAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "FAILURE_ACTIVATED_VERSION",
        "ROLLBACK_NOT_RESTORED",
      ]),
    );
  });

  it("requires accepted-version freshness and complete provenance", () => {
    const values = attestations();
    values[8] = {
      ...values[8]!,
      freshnessBoundToAcceptedVersion: false,
      provenanceComplete: false,
    };
    const result = projectHostedRecoveryAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "FRESHNESS_NOT_VERSION_BOUND",
        "PROVENANCE_INCOMPLETE",
      ]),
    );
  });

  it("requires bounded memory and synthetic private-safe evidence", () => {
    const values = attestations();
    values[9] = {
      ...values[9]!,
      boundedMemoryVerified: false,
      syntheticFixturesOnly: false,
      privateDataObserved: true,
      retainedPrivateArtifact: true,
    };
    const result = projectHostedRecoveryAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "BOUNDED_MEMORY_UNVERIFIED",
        "NON_SYNTHETIC_FIXTURE",
        "PRIVATE_DATA_OBSERVED",
        "PRIVATE_ARTIFACT_RETAINED",
      ]),
    );
  });

  it("blocks inverted execution times", () => {
    const values = attestations();
    values[4] = {
      ...values[4]!,
      startedAt: "2026-07-26T11:02:00.000Z",
    };
    const result = projectHostedRecoveryAttestations(
      input({ attestations: values }),
    );

    expect(result.issues).toContainEqual({
      code: "INVALID_TIME_ORDER",
      scenario: "core_details_upsert_lineage_refresh",
      severity: "block",
    });
  });

  it("rejects duplicates and malformed runtime facts", () => {
    const values = attestations();
    expect(() =>
      projectHostedRecoveryAttestations(
        input({ attestations: [...values, values[0]!] }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      projectHostedRecoveryAttestations(
        input({
          attestations: [
            {
              ...values[0]!,
              syntheticFixturesOnly: "true" as unknown as boolean,
            },
          ],
        }),
      ),
    ).toThrow("explicit boolean");
    expect(() =>
      projectHostedRecoveryAttestations(
        input({
          attestations: [{ ...values[0]!, assertionsTotal: 0 }],
        }),
      ),
    ).toThrow("positive safe integer");
  });
});
