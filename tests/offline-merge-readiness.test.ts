import { describe, expect, it } from "vitest";

import {
  assessOfflineMergeReadiness,
  type OfflineMergeQueueEntry,
  type OfflineMergeReadinessInput,
} from "@/domain/offline-merge-readiness";

function entry(
  order: number,
  overrides: Partial<OfflineMergeQueueEntry> = {},
): OfflineMergeQueueEntry {
  const sha = order.toString(16).padStart(40, "0");
  return {
    order,
    title: `Synthetic queue ${order}`,
    branch: `agent/synthetic-queue-${order}`,
    expectedHeadSha: sha,
    observedHeadSha: sha,
    disposition: "merge_candidate",
    dependsOnOrder: null,
    hostedValidation: "passed",
    workflowRunCount: 0,
    statusContextCount: 0,
    pullRequestCount: 0,
    ...overrides,
  };
}

function evidence(
  entries: readonly OfflineMergeQueueEntry[],
  controls: Partial<OfflineMergeReadinessInput["controls"]> = {},
): OfflineMergeReadinessInput {
  return {
    assessmentId: "synthetic-offline-queue",
    entries,
    controls: {
      productionDisabled: true,
      providersUnchanged: true,
      privateDataInGit: false,
      publicRoutesExposed: false,
      recurringPaidInfrastructureEnabled: false,
      ...controls,
    },
  };
}

describe("offline merge readiness", () => {
  it("builds one exact-head candidate chain and excludes a precursor", () => {
    const result = assessOfflineMergeReadiness(
      evidence([
        entry(51),
        entry(52, {
          disposition: "non_merge_precursor",
          dependsOnOrder: 51,
        }),
        entry(53, { dependsOnOrder: 51 }),
        entry(54, { dependsOnOrder: 53 }),
      ]),
    );

    expect(result).toMatchObject({
      status: "ready_for_exact_head_ci",
      excludedPrecursorOrders: [52],
      nextRequiredAction: "await_actions_capacity",
      mergeAllowed: false,
      workflowDispatchAllowed: false,
      productionMutationAllowed: false,
    });
    expect(result.mergeCandidates.map(({ order }) => order)).toEqual([
      51, 53, 54,
    ]);
    expect(result.issues).toEqual([]);
  });

  it("blocks a broken candidate dependency chain", () => {
    const result = assessOfflineMergeReadiness(
      evidence([entry(1), entry(2, { dependsOnOrder: null })]),
    );

    expect(result.status).toBe("blocked");
    expect(result.issues).toContainEqual({
      code: "DEPENDENCY_ORDER",
      order: 2,
      status: "block",
      detail: "The merge candidate must depend on prior merge candidate 1.",
    });
  });

  it("distinguishes missing evidence from failed or mismatched evidence", () => {
    const review = assessOfflineMergeReadiness(
      evidence([
        entry(1, {
          observedHeadSha: null,
          hostedValidation: "not_run",
        }),
      ]),
    );
    const blocked = assessOfflineMergeReadiness(
      evidence([
        entry(1, {
          observedHeadSha: "f".repeat(40),
          hostedValidation: "failed",
        }),
      ]),
    );

    expect(review.status).toBe("review_required");
    expect(review.nextRequiredAction).toBe("complete_missing_evidence");
    expect(review.issues.map(({ status }) => status)).toEqual([
      "review",
      "review",
    ]);
    expect(blocked.status).toBe("blocked");
    expect(blocked.issues.map(({ code }) => code)).toEqual([
      "REMOTE_HEAD",
      "HOSTED_VALIDATION",
    ]);
  });

  it("blocks any Actions, status or pull-request evidence in staging", () => {
    const result = assessOfflineMergeReadiness(
      evidence([
        entry(1, {
          workflowRunCount: 1,
          statusContextCount: 1,
          pullRequestCount: 1,
        }),
      ]),
    );

    expect(result.status).toBe("blocked");
    expect(result.issues).toContainEqual({
      code: "NO_ACTIONS_STAGING",
      order: 1,
      status: "block",
      detail:
        "The staging branch has a workflow run, status context or pull request.",
    });
  });

  it("blocks provider, privacy, paid-infrastructure or Production exposure", () => {
    const result = assessOfflineMergeReadiness(
      evidence([entry(1)], {
        productionDisabled: false,
        providersUnchanged: false,
        privateDataInGit: true,
        publicRoutesExposed: true,
        recurringPaidInfrastructureEnabled: true,
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.issues).toContainEqual({
      code: "PRODUCTION_FAIL_CLOSED",
      order: null,
      status: "block",
      detail:
        "Production, providers, privacy and paid-infrastructure controls must remain fail-closed.",
    });
  });

  it("rejects malformed runtime queue evidence", () => {
    expect(() =>
      assessOfflineMergeReadiness(evidence([entry(1), entry(1)])),
    ).toThrow("Queue order 1 must be unique");
    expect(() =>
      assessOfflineMergeReadiness(
        evidence([
          entry(1, {
            branch: "main",
          }),
        ]),
      ),
    ).toThrow("branch is invalid");
    expect(() =>
      assessOfflineMergeReadiness(
        evidence([
          entry(1, {
            expectedHeadSha: "ABC",
          }),
        ]),
      ),
    ).toThrow("lowercase hexadecimal");
    expect(() =>
      assessOfflineMergeReadiness({
        ...evidence([entry(1)]),
        controls: {
          ...evidence([entry(1)]).controls,
          productionDisabled: "true" as unknown as boolean,
        },
      }),
    ).toThrow("explicit booleans");
  });
});
