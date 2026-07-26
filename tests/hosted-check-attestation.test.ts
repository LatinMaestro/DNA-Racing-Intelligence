import { describe, expect, it } from "vitest";

import {
  projectHostedCheckAttestations,
  type HostedCheckAttestation,
  type HostedCheckAttestationInput,
} from "@/domain/hosted-check-attestation";

const HEAD = "a".repeat(40);
const DIGEST = "b".repeat(64);

const commands = {
  dependency_chain: "offline_merge_readiness",
  shared_document_reconciliation: "shared_document_diff",
  format: "npm_format_check",
  lint: "npm_lint",
  strict_typecheck: "npm_typecheck",
  all_ts_tsx_tests: "npm_test_all",
  production_build: "npm_build",
  dependency_audit: "npm_audit_production",
  privacy_scan: "repository_privacy_scan",
  security_privacy: "security_privacy_attestation",
  performance_capacity: "performance_capacity_attestation",
  end_to_end_workflows: "end_to_end_workflow_attestation",
  accounting_reconciliation: "accounting_reconciliation_attestation",
  freshness_snapshot_integrity: "freshness_snapshot_attestation",
  confirmed_game_rules: "confirmed_game_rules_attestation",
  recommendation_explainability: "recommendation_explainability_attestation",
  authoritative_source_contracts: "authoritative_source_contracts_attestation",
  synthetic_import_replay_rollback_reconciliation:
    "synthetic_import_recovery_suite",
} as const;

function attestations(): HostedCheckAttestation[] {
  return Object.entries(commands).map(([check, commandId], index) => ({
    attestationId: `attestation-${index + 1}`,
    check: check as HostedCheckAttestation["check"],
    commandId,
    headSha: HEAD,
    startedAt: "2026-07-26T08:00:00.000Z",
    completedAt: "2026-07-26T08:01:00.000Z",
    exitCode: 0,
    summarySha256: DIGEST,
    hostedWorkspace: true,
    redactedSummaryOnly: true,
    privateDataObserved: false,
    syntheticFixturesOnly:
      check === "end_to_end_workflows" ||
      check === "accounting_reconciliation" ||
      check === "freshness_snapshot_integrity" ||
      check === "confirmed_game_rules" ||
      check === "recommendation_explainability" ||
      check === "authoritative_source_contracts" ||
      check === "synthetic_import_replay_rollback_reconciliation",
  }));
}

function input(
  overrides: Partial<HostedCheckAttestationInput> = {},
): HostedCheckAttestationInput {
  return {
    evidenceId: "hosted-rehearsal-attestations",
    composedHeadSha: HEAD,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted check attestations", () => {
  it("projects exact passing evidence without execution authority", () => {
    const result = projectHostedCheckAttestations(input());

    expect(result).toMatchObject({
      status: "attested",
      privateArtifactsRetained: false,
      workflowDispatchAllowed: false,
      productionMutationAllowed: false,
    });
    expect(result.checks).toHaveLength(18);
    expect(result.checks.every(({ state }) => state === "passed")).toBe(true);
  });

  it("keeps a missing attestation review-required", () => {
    const values = attestations();
    const result = projectHostedCheckAttestations(
      input({ attestations: values.slice(1) }),
    );

    expect(result.status).toBe("review_required");
    expect(result.issues).toContainEqual({
      code: "ATTESTATION_MISSING",
      check: "dependency_chain",
      severity: "review",
    });
  });

  it("blocks stale heads and unapproved commands", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "c".repeat(40),
      commandId: "npm_lint",
    };
    const result = projectHostedCheckAttestations(
      input({ attestations: values }),
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["ATTESTATION_STALE", "COMMAND_MISMATCH"]),
    );
  });

  it("blocks failed or non-hosted checks", () => {
    const values = attestations();
    values[2] = {
      ...values[2]!,
      exitCode: 1,
      hostedWorkspace: false,
    };
    const result = projectHostedCheckAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["CHECK_FAILED", "NON_HOSTED_EXECUTION"]),
    );
  });

  it("blocks unredacted or private evidence", () => {
    const values = attestations();
    values[8] = {
      ...values[8]!,
      redactedSummaryOnly: false,
      privateDataObserved: true,
    };
    const result = projectHostedCheckAttestations(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["UNREDACTED_SUMMARY", "PRIVATE_DATA_OBSERVED"]),
    );
  });

  it("requires synthetic import and recovery fixtures", () => {
    const values = attestations();
    const index = values.findIndex(
      ({ check }) =>
        check === "synthetic_import_replay_rollback_reconciliation",
    );
    values[index] = { ...values[index]!, syntheticFixturesOnly: false };
    const result = projectHostedCheckAttestations(
      input({ attestations: values }),
    );

    expect(result.issues).toContainEqual({
      code: "NON_SYNTHETIC_FIXTURE",
      check: "synthetic_import_replay_rollback_reconciliation",
      severity: "block",
    });
  });

  it("blocks inverted timestamps", () => {
    const values = attestations();
    values[4] = {
      ...values[4]!,
      startedAt: "2026-07-26T08:02:00.000Z",
    };
    const result = projectHostedCheckAttestations(
      input({ attestations: values }),
    );

    expect(result.issues).toContainEqual({
      code: "INVALID_TIME_ORDER",
      check: "strict_typecheck",
      severity: "block",
    });
  });

  it("rejects duplicate checks and malformed runtime facts", () => {
    const values = attestations();
    expect(() =>
      projectHostedCheckAttestations(
        input({ attestations: [...values, values[0]!] }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      projectHostedCheckAttestations(
        input({
          attestations: [
            {
              ...values[0]!,
              hostedWorkspace: "true" as unknown as boolean,
            },
          ],
        }),
      ),
    ).toThrow("explicit boolean");
  });
});
