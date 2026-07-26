import { describe, expect, it } from "vitest";

import {
  assessCumulativeRehearsalEvidence,
  type CumulativeRehearsalEvidenceInput,
} from "@/domain/cumulative-rehearsal-evidence";

const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);

function input(): CumulativeRehearsalEvidenceInput {
  return {
    rehearsalId: "pre-actions-20260726",
    composedHeadSha: HEAD,
    latestCandidateHeadSha: HEAD,
    checks: [
      "dependency_chain",
      "shared_document_reconciliation",
      "format",
      "lint",
      "strict_typecheck",
      "all_ts_tsx_tests",
      "production_build",
      "dependency_audit",
      "privacy_scan",
      "security_privacy",
      "performance_capacity",
      "end_to_end_workflows",
      "accounting_reconciliation",
      "freshness_snapshot_integrity",
      "confirmed_game_rules",
      "recommendation_explainability",
      "authoritative_source_contracts",
      "identity_lineage_integrity",
      "synthetic_import_replay_rollback_reconciliation",
    ].map((name) => ({
      name,
      state: "passed",
      headSha: HEAD,
    })) as CumulativeRehearsalEvidenceInput["checks"],
    migration: {
      state: "passed",
      headSha: HEAD,
      nonProductionTarget: true,
      applyPassed: true,
      smokePassed: true,
      reversePassed: true,
      removalPassed: true,
    },
    controls: {
      productionDisabled: true,
      providersUnchanged: true,
      privateDataInGit: false,
      publicRoutesExposed: false,
      actionsDispatched: false,
    },
  };
}

describe("cumulative rehearsal evidence", () => {
  it("records complete offline evidence without granting execution authority", () => {
    const result = assessCumulativeRehearsalEvidence(input());

    expect(result).toMatchObject({
      status: "rehearsed_with_limitations",
      migrationEvidenceComplete: true,
      exactHeadActionsStillRequired: true,
      connectedProviderEvidenceStillRequired: true,
      mergeAllowed: false,
      workflowDispatchAllowed: false,
      productionMutationAllowed: false,
    });
    expect(result.passedChecks).toHaveLength(19);
    expect(result.issues).toEqual([]);
  });

  it("keeps unavailable PostgreSQL evidence visible without fabricating failure", () => {
    const value = input();
    const result = assessCumulativeRehearsalEvidence({
      ...value,
      migration: {
        state: "unavailable",
        headSha: null,
        nonProductionTarget: false,
        applyPassed: false,
        smokePassed: false,
        reversePassed: false,
        removalPassed: false,
      },
    });

    expect(result.status).toBe("review_required");
    expect(result.migrationEvidenceComplete).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "MIGRATION_NOT_RUN" }),
    );
  });

  it("blocks partial migration success", () => {
    const value = input();
    const result = assessCumulativeRehearsalEvidence({
      ...value,
      migration: { ...value.migration, reversePassed: false },
    });

    expect(result.status).toBe("blocked");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "MIGRATION_INCOMPLETE" }),
    );
  });

  it("blocks stale check evidence", () => {
    const value = input();
    const result = assessCumulativeRehearsalEvidence({
      ...value,
      checks: value.checks.map((check) =>
        check.name === "production_build"
          ? { ...check, headSha: OTHER_HEAD }
          : check,
      ),
    });

    expect(result.status).toBe("blocked");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "CHECK_STALE",
        check: "production_build",
      }),
    );
  });

  it("blocks a composition that does not use the latest candidate", () => {
    const value = input();
    const result = assessCumulativeRehearsalEvidence({
      ...value,
      latestCandidateHeadSha: OTHER_HEAD,
    });

    expect(result.status).toBe("blocked");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "COMPOSITION_HEAD" }),
    );
  });

  it("requires every cumulative check", () => {
    const value = input();
    const result = assessCumulativeRehearsalEvidence({
      ...value,
      checks: value.checks.filter(({ name }) => name !== "privacy_scan"),
    });

    expect(result.status).toBe("review_required");
    expect(result.pendingChecks).toContain("privacy_scan");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "CHECK_MISSING",
        check: "privacy_scan",
      }),
    );
  });

  it("blocks any no-Actions or Production control drift", () => {
    const value = input();
    const result = assessCumulativeRehearsalEvidence({
      ...value,
      controls: { ...value.controls, actionsDispatched: true },
    });

    expect(result.status).toBe("blocked");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "CONTROL_DRIFT" }),
    );
  });

  it("rejects string-like runtime booleans", () => {
    const value = input();

    expect(() =>
      assessCumulativeRehearsalEvidence({
        ...value,
        controls: {
          ...value.controls,
          productionDisabled: "true" as unknown as boolean,
        },
      }),
    ).toThrow("Rehearsal controls must be explicit booleans.");
  });
});
