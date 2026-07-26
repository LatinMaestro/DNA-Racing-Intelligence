import {
  assessOfflineMergeReadiness,
  type OfflineMergeReadinessInput,
} from "@/domain/offline-merge-readiness";

const REQUIRED_CHECKS = [
  "rebase_on_verified_main",
  "reconcile_shared_documents",
  "format",
  "lint",
  "strict_typecheck",
  "all_ts_tsx_tests",
  "production_build",
  "dependency_audit",
  "privacy_scan",
  "security_privacy",
  "performance_capacity",
  "accounting_reconciliation",
  "freshness_snapshot_integrity",
  "confirmed_game_rules",
  "recommendation_explainability",
  "authoritative_source_contracts",
  "exact_head_actions",
  "exact_diff_review",
  "review_threads_resolved",
  "post_merge_main_verification",
] as const;

export type ExactHeadRequiredCheck = (typeof REQUIRED_CHECKS)[number];

export type ExactHeadActionsPlanInput = Readonly<{
  planId: string;
  currentMainSha: string;
  actionsCapacityAvailable: boolean;
  readinessEvidence: OfflineMergeReadinessInput;
  migrationCandidateOrders: readonly number[];
  existingPullRequests: readonly Readonly<{
    order: number;
    number: number;
  }>[];
}>;

export type ExactHeadActionsStep = Readonly<{
  sequence: number;
  queueOrder: number;
  title: string;
  branch: string;
  queuedHeadSha: string;
  expectedBase:
    | Readonly<{ kind: "current_main"; sha: string }>
    | Readonly<{ kind: "main_after_queue_order"; order: number }>;
  existingPullRequestNumber: number | null;
  requiresMigrationVerification: boolean;
  requiredChecks: readonly ExactHeadRequiredCheck[];
  migrationChecks: readonly ("apply" | "smoke" | "reverse" | "removal")[];
  executionState: "pending";
}>;

export type ExactHeadActionsPlan = Readonly<{
  status: "blocked" | "awaiting_actions_capacity" | "ready_to_start_preflight";
  steps: readonly ExactHeadActionsStep[];
  excludedPrecursorOrders: readonly number[];
  issues: readonly string[];
  nextRequiredAction:
    | "resolve_offline_readiness"
    | "await_actions_capacity"
    | "start_first_candidate_preflight";
  executionAuthorized: false;
  workflowDispatchAuthorized: false;
  productionMutationAuthorized: false;
}>;

function requiredText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required.`);
  }
}

function exactSha(value: string, field: string): void {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(
      `${field} must contain 40 lowercase hexadecimal characters.`,
    );
  }
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
}

function uniqueOrders(
  values: readonly number[],
  field: string,
): ReadonlySet<number> {
  if (!Array.isArray(values)) {
    throw new Error(`${field} must be an array.`);
  }
  const orders = new Set<number>();
  for (const value of values) {
    positiveInteger(value, `${field} order`);
    if (orders.has(value)) {
      throw new Error(`${field} order ${value} must be unique.`);
    }
    orders.add(value);
  }
  return orders;
}

export function buildExactHeadActionsPlan(
  input: ExactHeadActionsPlanInput,
): ExactHeadActionsPlan {
  requiredText(input.planId, "Plan ID");
  exactSha(input.currentMainSha, "Current main SHA");
  if (typeof input.actionsCapacityAvailable !== "boolean") {
    throw new Error("Actions capacity evidence must be an explicit boolean.");
  }

  const readiness = assessOfflineMergeReadiness(input.readinessEvidence);
  const migrationOrders = uniqueOrders(
    input.migrationCandidateOrders,
    "Migration candidate",
  );
  if (!Array.isArray(input.existingPullRequests)) {
    throw new Error("Existing pull requests must be an array.");
  }

  const candidateOrders = new Set(
    readiness.mergeCandidates.map(({ order }) => order),
  );
  for (const order of migrationOrders) {
    if (!candidateOrders.has(order)) {
      throw new Error(
        `Migration candidate order ${order} is not a merge candidate.`,
      );
    }
  }

  const pullRequests = new Map<number, number>();
  for (const pullRequest of input.existingPullRequests) {
    positiveInteger(pullRequest.order, "Pull-request queue order");
    positiveInteger(pullRequest.number, "Pull-request number");
    if (!candidateOrders.has(pullRequest.order)) {
      throw new Error(
        `Pull-request order ${pullRequest.order} is not a merge candidate.`,
      );
    }
    if (pullRequests.has(pullRequest.order)) {
      throw new Error(
        `Pull-request order ${pullRequest.order} must be unique.`,
      );
    }
    pullRequests.set(pullRequest.order, pullRequest.number);
  }

  const steps = readiness.mergeCandidates.map((candidate, index) => {
    const previous = readiness.mergeCandidates[index - 1];
    const requiresMigrationVerification = migrationOrders.has(candidate.order);
    return {
      sequence: index + 1,
      queueOrder: candidate.order,
      title: candidate.title,
      branch: candidate.branch,
      queuedHeadSha: candidate.exactHeadSha,
      expectedBase:
        previous === undefined
          ? ({ kind: "current_main", sha: input.currentMainSha } as const)
          : ({
              kind: "main_after_queue_order",
              order: previous.order,
            } as const),
      existingPullRequestNumber: pullRequests.get(candidate.order) ?? null,
      requiresMigrationVerification,
      requiredChecks: REQUIRED_CHECKS,
      migrationChecks: requiresMigrationVerification
        ? (["apply", "smoke", "reverse", "removal"] as const)
        : [],
      executionState: "pending" as const,
    };
  });

  const issues = readiness.issues.map(
    ({ code, order, detail }) =>
      `${code}${order === null ? "" : `:${order}`}: ${detail}`,
  );

  if (readiness.status !== "ready_for_exact_head_ci") {
    return {
      status: "blocked",
      steps,
      excludedPrecursorOrders: readiness.excludedPrecursorOrders,
      issues,
      nextRequiredAction: "resolve_offline_readiness",
      executionAuthorized: false,
      workflowDispatchAuthorized: false,
      productionMutationAuthorized: false,
    };
  }

  return {
    status: input.actionsCapacityAvailable
      ? "ready_to_start_preflight"
      : "awaiting_actions_capacity",
    steps,
    excludedPrecursorOrders: readiness.excludedPrecursorOrders,
    issues,
    nextRequiredAction: input.actionsCapacityAvailable
      ? "start_first_candidate_preflight"
      : "await_actions_capacity",
    executionAuthorized: false,
    workflowDispatchAuthorized: false,
    productionMutationAuthorized: false,
  };
}
