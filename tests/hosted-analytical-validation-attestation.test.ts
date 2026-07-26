import { describe, expect, it } from "vitest";

import {
  projectHostedAnalyticalValidation,
  type HostedAnalyticalValidationAttestation,
  type HostedAnalyticalValidationInput,
} from "@/domain/hosted-analytical-validation-attestation";

const HEAD = "a".repeat(40);
const SOURCE = "b".repeat(64);
const SUMMARY = "c".repeat(64);

const commands = {
  performance_distributions: "analytics_validate_performance_distributions",
  lineage_lift: "analytics_validate_lineage_lift",
  breeding_validation: "analytics_validate_breeding",
  gold_blue_era_detection: "analytics_validate_gold_blue_eras",
  tournament_maiden_calibration: "analytics_validate_tournament_maiden",
  recommendation_calibration: "analytics_validate_recommendations",
  capacity_projection: "analytics_validate_capacity",
  economic_reconciliation: "analytics_reconcile_economics",
} as const;

function attestations(): HostedAnalyticalValidationAttestation[] {
  return Object.entries(commands).map(([analysis, commandId], index) => ({
    attestationId: `analytical-${index + 1}`,
    analysis: analysis as HostedAnalyticalValidationAttestation["analysis"],
    commandId,
    headSha: HEAD,
    sourceManifestSha256: SOURCE,
    chronologicalCutoffAt: "2026-07-25T00:00:00.000Z",
    startedAt: "2026-07-26T10:00:00.000Z",
    completedAt: "2026-07-26T10:01:00.000Z",
    state: "passed",
    exitCode: 0,
    summarySha256: SUMMARY,
    limitationCode: null,
    ownerAuthenticatedWorkspace: true,
    aggregateEvidenceOnly: true,
    coverageDocumented: true,
    experimentalLabelRetained: true,
    futureLeakageDetected: false,
    rawPrivateRowsRetained: false,
    historicalBgcEconomicsExcluded: analysis === "economic_reconciliation",
    transfersExcluded: analysis === "economic_reconciliation",
  }));
}

function input(
  overrides: Partial<HostedAnalyticalValidationInput> = {},
): HostedAnalyticalValidationInput {
  return {
    evidenceId: "hosted-analytical-validation",
    composedHeadSha: HEAD,
    sourceManifestSha256: SOURCE,
    currentThroughAt: "2026-07-25T00:00:00.000Z",
    attestations: attestations(),
    ...overrides,
  };
}

describe("hosted analytical validation attestations", () => {
  it("projects complete validation without execution authority", () => {
    expect(projectHostedAnalyticalValidation(input())).toMatchObject({
      status: "validated",
      passed: Object.keys(commands),
      limited: [],
      unavailable: [],
      issues: [],
      aggregateEvidenceOnly: true,
      privateArtifactsRetained: false,
      workflowDispatchAllowed: false,
      mergeAllowed: false,
      productionMutationAllowed: false,
    });
  });

  it("keeps missing analysis review-required", () => {
    const result = projectHostedAnalyticalValidation(
      input({ attestations: attestations().slice(1) }),
    );

    expect(result.status).toBe("review_required");
    expect(result.issues).toContainEqual({
      code: "ANALYSIS_MISSING",
      analysis: "performance_distributions",
      severity: "review",
    });
  });

  it("preserves approved breeding and historical-ME limitations", () => {
    const values = attestations();
    values[2] = {
      ...values[2]!,
      state: "unavailable",
      exitCode: null,
      summarySha256: null,
      limitationCode: "breeding_timestamps_unavailable",
    };
    values[4] = {
      ...values[4]!,
      state: "limited",
      limitationCode: "historical_me_unavailable",
    };
    const result = projectHostedAnalyticalValidation(
      input({ attestations: values }),
    );

    expect(result.status).toBe("validated_with_limitations");
    expect(result.unavailable).toEqual(["breeding_validation"]);
    expect(result.limited).toEqual(["tournament_maiden_calibration"]);
  });

  it("blocks stale heads, command substitution and source drift", () => {
    const values = attestations();
    values[0] = {
      ...values[0]!,
      headSha: "d".repeat(40),
      commandId: "analytics_validate_lineage_lift",
      sourceManifestSha256: "e".repeat(64),
    };
    const result = projectHostedAnalyticalValidation(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "ANALYSIS_STALE",
        "COMMAND_MISMATCH",
        "SOURCE_MISMATCH",
      ]),
    );
  });

  it("blocks failed and unapproved limitation states", () => {
    const values = attestations();
    values[1] = {
      ...values[1]!,
      state: "failed",
      exitCode: 1,
    };
    values[3] = {
      ...values[3]!,
      state: "limited",
      limitationCode: "unsupported_limit",
    };
    const result = projectHostedAnalyticalValidation(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["VALIDATION_FAILED", "UNAPPROVED_LIMITATION"]),
    );
  });

  it("blocks non-owner, row-level, undocumented or unlabelled evidence", () => {
    const values = attestations();
    values[5] = {
      ...values[5]!,
      ownerAuthenticatedWorkspace: false,
      aggregateEvidenceOnly: false,
      coverageDocumented: false,
      experimentalLabelRetained: false,
      rawPrivateRowsRetained: true,
    };
    const result = projectHostedAnalyticalValidation(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "NON_OWNER_WORKSPACE",
        "NON_AGGREGATE_EVIDENCE",
        "COVERAGE_UNDOCUMENTED",
        "EXPERIMENTAL_LABEL_MISSING",
        "RAW_PRIVATE_ROWS_RETAINED",
      ]),
    );
  });

  it("blocks leakage and invalid chronological bounds", () => {
    const values = attestations();
    values[6] = {
      ...values[6]!,
      futureLeakageDetected: true,
      chronologicalCutoffAt: "2026-07-26T00:00:00.000Z",
      startedAt: "2026-07-26T10:02:00.000Z",
      completedAt: "2026-07-26T10:01:00.000Z",
    };
    const result = projectHostedAnalyticalValidation(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "LEAKAGE_DETECTED",
        "INVALID_TIME_ORDER",
        "CUTOFF_AFTER_CURRENT_THROUGH",
      ]),
    );
  });

  it("requires BGC and transfer exclusion from economic reconciliation", () => {
    const values = attestations();
    values[7] = {
      ...values[7]!,
      historicalBgcEconomicsExcluded: false,
      transfersExcluded: false,
    };
    const result = projectHostedAnalyticalValidation(
      input({ attestations: values }),
    );

    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["BGC_ECONOMICS_INCLUDED", "TRANSFERS_INCLUDED"]),
    );
  });

  it("rejects duplicate analyses and malformed runtime facts", () => {
    const values = attestations();
    expect(() =>
      projectHostedAnalyticalValidation(
        input({ attestations: [...values, values[0]!] }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      projectHostedAnalyticalValidation(
        input({
          attestations: [
            {
              ...values[0]!,
              aggregateEvidenceOnly: "true" as unknown as boolean,
            },
          ],
        }),
      ),
    ).toThrow("explicit boolean");
    expect(() =>
      projectHostedAnalyticalValidation(
        input({
          attestations: [
            {
              ...values[0]!,
              state: "unavailable",
              limitationCode: "breeding_timestamps_unavailable",
            },
          ],
        }),
      ),
    ).toThrow("must not claim execution");
  });
});
