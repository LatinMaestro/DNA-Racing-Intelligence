import { describe, expect, it } from "vitest";

import {
  projectHostedAccountingAttestations,
  type HostedAccountingAttestationInput,
  type HostedAccountingControlAttestation,
} from "@/domain/hosted-accounting-attestation";

const HEAD = "a".repeat(40);
const ACCOUNTING = "b".repeat(64);
const FIXTURES = "c".repeat(64);
const SUMMARY = "d".repeat(64);

const commands = {
  exact_asset_balances: "accounting_verify_exact_asset_balances",
  bgc_separate_non_cash: "accounting_verify_bgc_separation",
  historical_bgc_zero_economics: "accounting_verify_historical_bgc",
  transfers_excluded: "accounting_verify_transfer_exclusion",
  manual_tournament_reconciliation:
    "accounting_verify_tournament_reconciliation",
  breeding_completed_refunded_only: "accounting_verify_breeding_evidence",
  lifecycle_sale_cost_basis: "accounting_verify_lifecycle_cost_basis",
  actual_burn_bgc_credit: "accounting_verify_actual_burn_credit",
  freshness_and_provenance: "accounting_verify_freshness_provenance",
  aggregate_rebuild_idempotency: "accounting_verify_rebuild_idempotency",
} as const;

const persistenceControls = new Set([
  "manual_tournament_reconciliation",
  "breeding_completed_refunded_only",
  "lifecycle_sale_cost_basis",
  "actual_burn_bgc_credit",
  "aggregate_rebuild_idempotency",
]);

function attestations(): HostedAccountingControlAttestation[] {
  return Object.entries(commands).map(([control, commandId], index) => ({
    attestationId: `accounting-${index + 1}`,
    control: control as HostedAccountingControlAttestation["control"],
    commandId,
    headSha: HEAD,
    accountingManifestSha256: ACCOUNTING,
    fixtureManifestSha256: FIXTURES,
    startedAt: "2026-07-26T15:00:00.000Z",
    completedAt: "2026-07-26T15:01:00.000Z",
    exitCode: 0,
    summarySha256: SUMMARY,
    assertionsPassed: 12,
    assertionsTotal: 12,
    exactDecimalsVerified: true,
    assetSeparationVerified: true,
    transferExclusionVerified: true,
    historicalBgcZeroEconomicsVerified: true,
    sourceProvenanceVerified: true,
    durableReplayVerified: true,
    syntheticFixturesOnly: true,
    privateDataObserved: false,
    retainedPrivateArtifact: false,
    connectedPersistenceEvidence: persistenceControls.has(control),
  }));
}

function input(
  overrides: Partial<HostedAccountingAttestationInput> = {},
): HostedAccountingAttestationInput {
  return {
    evidenceId: "hosted-accounting-attestations",
    composedHeadSha: HEAD,
    accountingManifestSha256: ACCOUNTING,
    fixtureManifestSha256: FIXTURES,
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted accounting attestations", () => {
  it("projects complete exact-head accounting evidence without authority", () => {
    expect(projectHostedAccountingAttestations(input())).toMatchObject({
      status: "attested",
      passedControls: Object.keys(commands),
      check: {
        name: "accounting_reconciliation",
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
    const result = projectHostedAccountingAttestations(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result).toMatchObject({
      status: "review_required",
      check: { state: "not_run", headSha: null },
    });
    expect(result.issues).toContainEqual({
      code: "CONTROL_MISSING",
      control: "exact_asset_balances",
      severity: "review",
    });
  });

  it("blocks stale heads, command substitution and manifest drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "e".repeat(40),
      commandId: "accounting_verify_bgc_separation",
      accountingManifestSha256: "f".repeat(64),
      fixtureManifestSha256: "0".repeat(64),
    };

    expect(
      projectHostedAccountingAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CONTROL_STALE",
        "COMMAND_MISMATCH",
        "ACCOUNTING_MANIFEST_MISMATCH",
        "FIXTURE_MANIFEST_MISMATCH",
      ]),
    );
  });

  it("blocks failed, incomplete or arithmetically unsafe evidence", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      exitCode: 1,
      assertionsPassed: 11,
      exactDecimalsVerified: false,
      assetSeparationVerified: false,
    };

    expect(
      projectHostedAccountingAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "CHECK_FAILED",
        "ASSERTIONS_INCOMPLETE",
        "EXACT_DECIMALS_UNVERIFIED",
        "ASSET_SEPARATION_UNVERIFIED",
      ]),
    );
  });

  it("blocks transfer, BGC, provenance and replay drift", () => {
    const values = attestations();
    values[2] = {
      ...values[2]!,
      transferExclusionVerified: false,
      historicalBgcZeroEconomicsVerified: false,
      sourceProvenanceVerified: false,
      durableReplayVerified: false,
    };

    expect(
      projectHostedAccountingAttestations(
        input({ attestations: values }),
      ).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "TRANSFER_EXCLUSION_UNVERIFIED",
        "HISTORICAL_BGC_ECONOMICS_INCLUDED",
        "PROVENANCE_UNVERIFIED",
        "DURABLE_REPLAY_UNVERIFIED",
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
      projectHostedAccountingAttestations(
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

  it("requires connected evidence for persistence-backed controls", () => {
    const values = attestations();
    values[4] = { ...values[4]!, connectedPersistenceEvidence: false };

    expect(
      projectHostedAccountingAttestations(input({ attestations: values }))
        .issues,
    ).toContainEqual({
      code: "PERSISTENCE_EVIDENCE_UNCONNECTED",
      control: "manual_tournament_reconciliation",
      severity: "block",
    });
  });

  it("rejects malformed runtime booleans", () => {
    expect(() =>
      projectHostedAccountingAttestations({
        ...input(),
        attestations: [
          {
            ...attestations()[0]!,
            exactDecimalsVerified: "true" as unknown as boolean,
          },
        ],
      }),
    ).toThrow("explicit boolean");
  });
});
