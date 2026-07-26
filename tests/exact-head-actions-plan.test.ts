import { describe, expect, it } from "vitest";

import {
  buildExactHeadActionsPlan,
  type ExactHeadActionsPlanInput,
} from "@/domain/exact-head-actions-plan";
import type {
  OfflineMergeQueueEntry,
  OfflineMergeReadinessInput,
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

function readiness(
  entries: readonly OfflineMergeQueueEntry[],
): OfflineMergeReadinessInput {
  return {
    assessmentId: "synthetic-readiness",
    entries,
    controls: {
      productionDisabled: true,
      providersUnchanged: true,
      privateDataInGit: false,
      publicRoutesExposed: false,
      recurringPaidInfrastructureEnabled: false,
    },
  };
}

function plan(
  overrides: Partial<ExactHeadActionsPlanInput> = {},
): ExactHeadActionsPlanInput {
  return {
    planId: "synthetic-actions-plan",
    currentMainSha: "a".repeat(40),
    actionsCapacityAvailable: false,
    readinessEvidence: readiness([
      entry(1),
      entry(2, { dependsOnOrder: 1 }),
      entry(3, {
        disposition: "non_merge_precursor",
        dependsOnOrder: 2,
      }),
      entry(4, { dependsOnOrder: 2 }),
    ]),
    migrationCandidateOrders: [2],
    existingPullRequests: [
      { order: 1, number: 29 },
      { order: 2, number: 28 },
    ],
    ...overrides,
  };
}

describe("exact-head Actions capacity plan", () => {
  it("waits for capacity with one precursor-free serial sequence", () => {
    const result = buildExactHeadActionsPlan(plan());

    expect(result).toMatchObject({
      status: "awaiting_actions_capacity",
      excludedPrecursorOrders: [3],
      nextRequiredAction: "await_actions_capacity",
      executionAuthorized: false,
      workflowDispatchAuthorized: false,
      productionMutationAuthorized: false,
    });
    expect(result.steps.map(({ queueOrder }) => queueOrder)).toEqual([1, 2, 4]);
    expect(result.steps[0]).toMatchObject({
      sequence: 1,
      expectedBase: { kind: "current_main", sha: "a".repeat(40) },
      existingPullRequestNumber: 29,
      requiresMigrationVerification: false,
      migrationChecks: [],
      executionState: "pending",
    });
    expect(result.steps[1]).toMatchObject({
      sequence: 2,
      expectedBase: { kind: "main_after_queue_order", order: 1 },
      existingPullRequestNumber: 28,
      requiresMigrationVerification: true,
      migrationChecks: ["apply", "smoke", "reverse", "removal"],
    });
    expect(result.steps[2]?.expectedBase).toEqual({
      kind: "main_after_queue_order",
      order: 2,
    });
  });

  it("permits preflight planning after capacity returns without authorising execution", () => {
    const result = buildExactHeadActionsPlan(
      plan({ actionsCapacityAvailable: true }),
    );

    expect(result.status).toBe("ready_to_start_preflight");
    expect(result.nextRequiredAction).toBe("start_first_candidate_preflight");
    expect(result.executionAuthorized).toBe(false);
    expect(result.steps[0]?.requiredChecks).toEqual(
      expect.arrayContaining([
        "rebase_on_verified_main",
        "exact_head_actions",
        "connected_provider_preflight",
        "exact_diff_review",
        "review_threads_resolved",
        "post_merge_main_verification",
      ]),
    );
  });

  it("blocks planning when offline readiness is incomplete", () => {
    const result = buildExactHeadActionsPlan(
      plan({
        readinessEvidence: readiness([
          entry(1, {
            observedHeadSha: null,
            hostedValidation: "not_run",
          }),
        ]),
        migrationCandidateOrders: [],
        existingPullRequests: [],
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.nextRequiredAction).toBe("resolve_offline_readiness");
    expect(result.issues).toEqual([
      "REMOTE_HEAD:1: The remote branch head has not been verified.",
      "HOSTED_VALIDATION:1: Hosted validation has not run for the queued exact head.",
    ]);
  });

  it("requires migration and pull-request metadata to reference candidates", () => {
    expect(() =>
      buildExactHeadActionsPlan(
        plan({
          migrationCandidateOrders: [3],
        }),
      ),
    ).toThrow("Migration candidate order 3 is not a merge candidate");
    expect(() =>
      buildExactHeadActionsPlan(
        plan({
          existingPullRequests: [{ order: 3, number: 30 }],
        }),
      ),
    ).toThrow("Pull-request order 3 is not a merge candidate");
  });

  it("rejects duplicate or malformed execution metadata", () => {
    expect(() =>
      buildExactHeadActionsPlan(
        plan({
          migrationCandidateOrders: [2, 2],
        }),
      ),
    ).toThrow("Migration candidate order 2 must be unique");
    expect(() =>
      buildExactHeadActionsPlan(
        plan({
          existingPullRequests: [
            { order: 1, number: 29 },
            { order: 1, number: 30 },
          ],
        }),
      ),
    ).toThrow("Pull-request order 1 must be unique");
    expect(() =>
      buildExactHeadActionsPlan({
        ...plan(),
        actionsCapacityAvailable: "true" as unknown as boolean,
      }),
    ).toThrow("explicit boolean");
  });
});
