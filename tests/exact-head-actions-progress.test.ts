import { describe, expect, it } from "vitest";

import {
  evaluateExactHeadActionsProgress,
  type ExactHeadActionsProgressInput,
  type ExactHeadPlanEntry,
  type HeadBoundEvidence,
} from "@/domain/exact-head-actions-progress";
import type { ExactHeadActionsPlan } from "@/domain/exact-head-actions-plan";

const mainSha = "a".repeat(40);

function evidence(
  state: HeadBoundEvidence["state"] = "not_run",
  headSha: string | null = null,
): HeadBoundEvidence {
  return { state, headSha };
}

function entry(
  order: number,
  overrides: Partial<ExactHeadPlanEntry> = {},
): ExactHeadPlanEntry {
  return {
    order,
    title: `Synthetic candidate ${order}`,
    branch: `agent/synthetic-candidate-${order}`,
    queuedHeadSha: order.toString(16).padStart(40, "0"),
    disposition: "merge_candidate",
    dependsOnOrder: null,
    migrationRequired: false,
    rebasedHeadSha: null,
    rebasedOntoMainSha: null,
    hostedValidation: evidence(),
    migrationValidation: evidence(),
    diffReview: evidence(),
    reviewResolution: evidence(),
    exactHeadCi: evidence(),
    mergedMainSha: null,
    postMergeMainVerification: evidence(),
    ...overrides,
  };
}

function input(
  entries: readonly ExactHeadPlanEntry[],
  overrides: Partial<ExactHeadActionsProgressInput> = {},
): ExactHeadActionsProgressInput {
  return {
    assessmentId: "synthetic-exact-head-plan",
    currentMainSha: mainSha,
    productionDisabled: true,
    basePlan: basePlan(entries),
    entries,
    ...overrides,
  };
}

function basePlan(
  entries: readonly ExactHeadPlanEntry[],
): ExactHeadActionsPlan {
  const candidates = entries
    .filter(({ disposition }) => disposition === "merge_candidate")
    .sort((left, right) => left.order - right.order);
  return {
    status: "ready_to_start_preflight",
    steps: candidates.map((candidate, index) => ({
      sequence: index + 1,
      queueOrder: candidate.order,
      title: candidate.title,
      branch: candidate.branch,
      queuedHeadSha: candidate.queuedHeadSha,
      expectedBase:
        index === 0
          ? { kind: "current_main", sha: mainSha }
          : {
              kind: "main_after_queue_order",
              order: candidates[index - 1]!.order,
            },
      existingPullRequestNumber: null,
      requiresMigrationVerification: candidate.migrationRequired,
      requiredChecks: [],
      migrationChecks: [],
      executionState: "pending",
    })),
    excludedPrecursorOrders: entries
      .filter(({ disposition }) => disposition === "non_merge_precursor")
      .map(({ order }) => order)
      .sort((left, right) => left - right),
    issues: [],
    nextRequiredAction: "start_first_candidate_preflight",
    executionAuthorized: false,
    workflowDispatchAuthorized: false,
    productionMutationAuthorized: false,
  };
}

describe("exact-head Actions progress", () => {
  it("excludes precursors and waits without dispatch while capacity is unavailable", () => {
    const result = evaluateExactHeadActionsProgress(
      input(
        [
          entry(51),
          entry(52, {
            disposition: "non_merge_precursor",
            dependsOnOrder: 51,
          }),
          entry(53, { dependsOnOrder: 51 }),
        ],
        {
          basePlan: {
            ...basePlan([
              entry(51),
              entry(52, {
                disposition: "non_merge_precursor",
                dependsOnOrder: 51,
              }),
              entry(53, { dependsOnOrder: 51 }),
            ]),
            status: "awaiting_actions_capacity",
            nextRequiredAction: "await_actions_capacity",
          },
        },
      ),
    );

    expect(result).toMatchObject({
      status: "waiting_for_actions_capacity",
      nextStep: "wait_for_actions_capacity",
      activeOrder: 51,
      excludedPrecursorOrders: [52],
      mergeAllowed: false,
      workflowDispatchAllowed: false,
      productionMutationAllowed: false,
    });
  });

  it("requires the first unmerged candidate to rebase onto current main", () => {
    const result = evaluateExactHeadActionsProgress(input([entry(1)]));

    expect(result).toMatchObject({
      status: "evidence_required",
      nextStep: "rebase_candidate",
      activeOrder: 1,
      activeHeadSha: null,
    });
  });

  it("invalidates evidence from a head before the latest rebase", () => {
    const oldHead = "b".repeat(40);
    const rebasedHead = "c".repeat(40);
    const result = evaluateExactHeadActionsProgress(
      input([
        entry(1, {
          rebasedHeadSha: rebasedHead,
          rebasedOntoMainSha: mainSha,
          hostedValidation: evidence("passed", oldHead),
          diffReview: evidence("passed", oldHead),
          reviewResolution: evidence("passed", oldHead),
          exactHeadCi: evidence("passed", oldHead),
        }),
      ]),
    );

    expect(result).toMatchObject({
      status: "evidence_required",
      nextStep: "run_hosted_validation",
      activeHeadSha: rebasedHead,
      staleEvidence: [
        "hosted_validation",
        "diff_review",
        "review_resolution",
        "exact_head_ci",
      ],
    });
  });

  it("requires current-head reversible migration evidence where applicable", () => {
    const head = "c".repeat(40);
    const result = evaluateExactHeadActionsProgress(
      input([
        entry(1, {
          migrationRequired: true,
          rebasedHeadSha: head,
          rebasedOntoMainSha: mainSha,
          hostedValidation: evidence("passed", head),
        }),
      ]),
    );

    expect(result).toMatchObject({
      status: "evidence_required",
      nextStep: "run_reversible_migration_validation",
      activeHeadSha: head,
    });
  });

  it("runs exact diff review before exact-head CI", () => {
    const head = "c".repeat(40);
    const review = evaluateExactHeadActionsProgress(
      input([
        entry(1, {
          rebasedHeadSha: head,
          rebasedOntoMainSha: mainSha,
          hostedValidation: evidence("passed", head),
        }),
      ]),
    );
    const ci = evaluateExactHeadActionsProgress(
      input([
        entry(1, {
          rebasedHeadSha: head,
          rebasedOntoMainSha: mainSha,
          hostedValidation: evidence("passed", head),
          diffReview: evidence("passed", head),
          reviewResolution: evidence("passed", head),
        }),
      ]),
    );

    expect(review.nextStep).toBe("review_exact_diff");
    expect(ci.nextStep).toBe("run_exact_head_ci");
  });

  it("requires review-thread resolution on the current head", () => {
    const head = "c".repeat(40);
    const result = evaluateExactHeadActionsProgress(
      input([
        entry(1, {
          rebasedHeadSha: head,
          rebasedOntoMainSha: mainSha,
          hostedValidation: evidence("passed", head),
          diffReview: evidence("passed", head),
        }),
      ]),
    );

    expect(result.nextStep).toBe("resolve_review_threads");
  });

  it("stops on the first current-head failure", () => {
    const head = "c".repeat(40);
    const result = evaluateExactHeadActionsProgress(
      input([
        entry(1, {
          rebasedHeadSha: head,
          rebasedOntoMainSha: mainSha,
          hostedValidation: evidence("failed", head),
        }),
        entry(2, { dependsOnOrder: 1 }),
      ]),
    );

    expect(result).toMatchObject({
      status: "blocked",
      nextStep: "resolve_failed_evidence",
      activeOrder: 1,
    });
  });

  it("records current-head readiness without authorizing merge", () => {
    const head = "c".repeat(40);
    const result = evaluateExactHeadActionsProgress(
      input([
        entry(1, {
          rebasedHeadSha: head,
          rebasedOntoMainSha: mainSha,
          hostedValidation: evidence("passed", head),
          diffReview: evidence("passed", head),
          reviewResolution: evidence("passed", head),
          exactHeadCi: evidence("passed", head),
        }),
      ]),
    );

    expect(result).toMatchObject({
      status: "ready_for_focused_merge",
      nextStep: "await_focused_merge",
      activeHeadSha: head,
      mergeAllowed: false,
      workflowDispatchAllowed: false,
      productionMutationAllowed: false,
    });
  });

  it("blocks dependency breaks and out-of-order merge evidence", () => {
    const brokenDependency = evaluateExactHeadActionsProgress(
      input([entry(1), entry(2)]),
    );
    const outOfOrder = evaluateExactHeadActionsProgress(
      input([
        entry(1),
        entry(2, {
          dependsOnOrder: 1,
          mergedMainSha: "d".repeat(40),
        }),
      ]),
    );

    expect(brokenDependency).toMatchObject({
      status: "blocked",
      nextStep: "resolve_offline_queue",
      activeOrder: 2,
    });
    expect(outOfOrder).toMatchObject({
      status: "blocked",
      nextStep: "resolve_failed_evidence",
      activeOrder: 2,
    });
  });

  it("advances to the next candidate only after the dependency is merged", () => {
    const result = evaluateExactHeadActionsProgress(
      input([
        entry(1, {
          rebasedHeadSha: "c".repeat(40),
          rebasedOntoMainSha: mainSha,
          hostedValidation: evidence("passed", "c".repeat(40)),
          diffReview: evidence("passed", "c".repeat(40)),
          reviewResolution: evidence("passed", "c".repeat(40)),
          exactHeadCi: evidence("passed", "c".repeat(40)),
          mergedMainSha: mainSha,
          postMergeMainVerification: evidence("passed", mainSha),
        }),
        entry(2, { dependsOnOrder: 1 }),
      ]),
    );

    expect(result).toMatchObject({
      status: "evidence_required",
      nextStep: "rebase_candidate",
      activeOrder: 2,
    });
  });

  it("requires exact-head and post-merge proof for every recorded merge", () => {
    const incomplete = evaluateExactHeadActionsProgress(
      input([entry(1, { mergedMainSha: mainSha })]),
    );
    const head = "c".repeat(40);
    const awaitingMainVerification = evaluateExactHeadActionsProgress(
      input([
        entry(1, {
          rebasedHeadSha: head,
          rebasedOntoMainSha: mainSha,
          hostedValidation: evidence("passed", head),
          diffReview: evidence("passed", head),
          reviewResolution: evidence("passed", head),
          exactHeadCi: evidence("passed", head),
          mergedMainSha: mainSha,
        }),
      ]),
    );

    expect(incomplete).toMatchObject({
      status: "blocked",
      nextStep: "resolve_failed_evidence",
    });
    expect(awaitingMainVerification).toMatchObject({
      status: "evidence_required",
      nextStep: "verify_post_merge_main",
    });
  });

  it("blocks Production and malformed runtime evidence", () => {
    expect(
      evaluateExactHeadActionsProgress(
        input([entry(1)], { productionDisabled: false }),
      ),
    ).toMatchObject({
      status: "blocked",
      productionMutationAllowed: false,
    });
    expect(() =>
      evaluateExactHeadActionsProgress(
        input([
          entry(1, {
            hostedValidation: evidence("passed", null),
          }),
        ]),
      ),
    ).toThrow("must bind its result");
    expect(() =>
      evaluateExactHeadActionsProgress(
        input([entry(1)], {
          productionDisabled: "true" as unknown as boolean,
        }),
      ),
    ).toThrow("explicit booleans");
    expect(() =>
      evaluateExactHeadActionsProgress(
        input([
          entry(1, {
            postMergeMainVerification: evidence("passed", mainSha),
          }),
        ]),
      ),
    ).toThrow("before a merge");
  });
});
