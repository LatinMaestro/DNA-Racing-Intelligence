import { describe, expect, it } from "vitest";

import {
  projectHostedPrivateImportAssuranceAttestations,
  type HostedPrivateImportAssuranceAttestationInput,
  type HostedPrivateImportAssuranceControlAttestation,
} from "@/domain/hosted-private-import-assurance-attestation";

const HEAD = "a".repeat(40);
const SOURCES = "b".repeat(64);
const CONTRACT = "c".repeat(64);
const PROFILE = "d".repeat(64);
const SUMMARY = "e".repeat(64);

const commands = {
  core_details_lineage_file: "private_import_verify_core_details",
  windows_1252_vault_file: "private_import_verify_windows_1252_vault",
  arena_snapshot_file: "private_import_verify_arena",
  six_race_merge_full_volume: "private_import_verify_race_full_volume",
  append_order_boundary_deduplication:
    "private_import_verify_append_boundary_dedup",
  replay_older_backfill: "private_import_verify_replay_backfill",
  replacement_snapshots: "private_import_verify_snapshot_replacement",
  rollback_recovery: "private_import_verify_rollback",
  malformed_conflict_quarantine: "private_import_verify_quarantine",
  freshness_provenance: "private_import_verify_freshness_provenance",
  bounded_memory_processing: "private_import_verify_bounded_memory",
} as const;

function attestations(): HostedPrivateImportAssuranceControlAttestation[] {
  return Object.entries(commands).map(([control, commandId], index) => ({
    attestationId: `private-import-${index + 1}`,
    control:
      control as HostedPrivateImportAssuranceControlAttestation["control"],
    commandId,
    headSha: HEAD,
    sourceManifestSha256: SOURCES,
    importContractSha256: CONTRACT,
    aggregateProfileSha256: PROFILE,
    startedAt: "2026-07-26T22:00:00.000Z",
    completedAt: "2026-07-26T22:01:00.000Z",
    exitCode: 0,
    summarySha256: SUMMARY,
    assertionsPassed: 12,
    assertionsTotal: 12,
    authenticatedOwnerWorkspace: true,
    realSourceFilesUsed: true,
    expectedCoverageVerified: true,
    exactReplayVerified: true,
    failureIsolationVerified: true,
    rollbackVerified: true,
    freshnessProvenanceVerified: true,
    boundedMemoryVerified: true,
    rawSourcesPreservedInPrivateBoundary: true,
    routineLogsRedacted: true,
    aggregateEvidenceOnly: true,
    privateDataCommittedToGit: false,
    retainedPrivateEvidenceArtifact: false,
  }));
}

function input(
  overrides: Partial<HostedPrivateImportAssuranceAttestationInput> = {},
): HostedPrivateImportAssuranceAttestationInput {
  return {
    evidenceId: "hosted-private-import-assurance",
    composedHeadSha: HEAD,
    sourceManifestSha256: SOURCES,
    importContractSha256: CONTRACT,
    aggregateProfileSha256: PROFILE,
    coverage: {
      coreDetailsRows: 18_127,
      vaultRows: 195,
      arenaRows: 792,
      raceMergeFiles: 6,
      raceMergeRows: 2_536_710,
      windows1252VaultVerified: true,
    },
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted private import assurance attestations", () => {
  it("projects complete real-file evidence without activation authority", () => {
    expect(
      projectHostedPrivateImportAssuranceAttestations(input()),
    ).toMatchObject({
      status: "attested",
      passedControls: Object.keys(commands),
      check: {
        name: "private_real_file_import_assurance",
        state: "passed",
        headSha: HEAD,
      },
      issues: [],
      privateEvidenceArtifactsRetained: false,
      sourceActivationAllowed: false,
      workflowDispatchAllowed: false,
      mergeAllowed: false,
      providerMutationAllowed: false,
      productionMutationAllowed: false,
    });
  });

  it("keeps missing controls review-required", () => {
    const result = projectHostedPrivateImportAssuranceAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result).toMatchObject({
      status: "review_required",
      check: { state: "not_run", headSha: null },
    });
    expect(result.issues).toContainEqual({
      code: "CONTROL_MISSING",
      control: "core_details_lineage_file",
      severity: "review",
    });
  });

  it("blocks unexpected aggregate coverage and unverified encoding", () => {
    const result = projectHostedPrivateImportAssuranceAttestations(
      input({
        coverage: {
          coreDetailsRows: 18_127,
          vaultRows: 195,
          arenaRows: 792,
          raceMergeFiles: 6,
          raceMergeRows: 2_536_709,
          windows1252VaultVerified: false,
        },
      }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["COVERAGE_MISMATCH", "WINDOWS_1252_UNVERIFIED"]),
    );
  });

  it("blocks stale heads, command substitution and manifest drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "f".repeat(40),
      commandId: "private_import_verify_arena",
      sourceManifestSha256: "0".repeat(64),
      importContractSha256: "1".repeat(64),
      aggregateProfileSha256: "2".repeat(64),
    };

    expect(
      projectHostedPrivateImportAssuranceAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CONTROL_STALE",
        "COMMAND_MISMATCH",
        "SOURCE_MANIFEST_MISMATCH",
        "IMPORT_CONTRACT_MISMATCH",
        "AGGREGATE_PROFILE_MISMATCH",
      ]),
    );
  });

  it("blocks incomplete and unverified real-file execution", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      exitCode: 1,
      assertionsPassed: 11,
      authenticatedOwnerWorkspace: false,
      realSourceFilesUsed: false,
      expectedCoverageVerified: false,
    };

    expect(
      projectHostedPrivateImportAssuranceAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CHECK_FAILED",
        "ASSERTIONS_INCOMPLETE",
        "OWNER_WORKSPACE_UNVERIFIED",
        "REAL_SOURCE_FILES_UNVERIFIED",
        "EXPECTED_COVERAGE_UNVERIFIED",
      ]),
    );
  });

  it("blocks recovery, freshness and bounded-memory gaps", () => {
    const values = attestations();
    values[2] = {
      ...values[2]!,
      exactReplayVerified: false,
      failureIsolationVerified: false,
      rollbackVerified: false,
      freshnessProvenanceVerified: false,
      boundedMemoryVerified: false,
    };

    expect(
      projectHostedPrivateImportAssuranceAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "REPLAY_UNVERIFIED",
        "FAILURE_ISOLATION_UNVERIFIED",
        "ROLLBACK_UNVERIFIED",
        "FRESHNESS_PROVENANCE_UNVERIFIED",
        "BOUNDED_MEMORY_UNVERIFIED",
      ]),
    );
  });

  it("blocks unsafe raw retention, logs and repository evidence", () => {
    const values = attestations();
    values[3] = {
      ...values[3]!,
      rawSourcesPreservedInPrivateBoundary: false,
      routineLogsRedacted: false,
      aggregateEvidenceOnly: false,
      privateDataCommittedToGit: true,
      retainedPrivateEvidenceArtifact: true,
    };

    expect(
      projectHostedPrivateImportAssuranceAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "PRIVATE_RAW_RETENTION_UNVERIFIED",
        "ROUTINE_LOG_REDACTION_UNVERIFIED",
        "NON_AGGREGATE_EVIDENCE",
        "PRIVATE_DATA_IN_GIT",
        "PRIVATE_EVIDENCE_ARTIFACT_RETAINED",
      ]),
    );
  });

  it("blocks inverted times and malformed runtime values", () => {
    const values = attestations();
    values[4] = {
      ...values[4]!,
      startedAt: "2026-07-26T22:02:00.000Z",
    };
    expect(
      projectHostedPrivateImportAssuranceAttestations(
        input({ attestations: values }),
      ).issues,
    ).toContainEqual({
      code: "INVALID_TIME_ORDER",
      control: "append_order_boundary_deduplication",
      severity: "block",
    });

    expect(() =>
      projectHostedPrivateImportAssuranceAttestations({
        ...input(),
        coverage: {
          ...input().coverage,
          raceMergeRows: -1,
        },
      }),
    ).toThrow("Coverage raceMergeRows must be a positive safe integer.");

    expect(() =>
      projectHostedPrivateImportAssuranceAttestations({
        ...input(),
        attestations: [
          ...attestations().slice(0, -1),
          {
            ...attestations().at(-1)!,
            aggregateEvidenceOnly: "true" as unknown as boolean,
          },
        ],
      }),
    ).toThrow(
      "bounded_memory_processing aggregateEvidenceOnly must be an explicit boolean.",
    );
  });
});
