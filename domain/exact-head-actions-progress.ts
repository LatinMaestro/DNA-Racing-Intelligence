import type { ExactHeadActionsPlan } from "@/domain/exact-head-actions-plan";

const DISPOSITIONS = ["merge_candidate", "non_merge_precursor"] as const;
const EVIDENCE_STATES = ["not_run", "passed", "failed"] as const;

export type ExactHeadPlanDisposition = (typeof DISPOSITIONS)[number];
export type ExactHeadPlanEvidenceState = (typeof EVIDENCE_STATES)[number];

export type HeadBoundEvidence = Readonly<{
  state: ExactHeadPlanEvidenceState;
  headSha: string | null;
}>;

export type ExactHeadPlanEntry = Readonly<{
  order: number;
  title: string;
  branch: string;
  queuedHeadSha: string;
  disposition: ExactHeadPlanDisposition;
  dependsOnOrder: number | null;
  migrationRequired: boolean;
  rebasedHeadSha: string | null;
  rebasedOntoMainSha: string | null;
  hostedValidation: HeadBoundEvidence;
  migrationValidation: HeadBoundEvidence;
  diffReview: HeadBoundEvidence;
  reviewResolution: HeadBoundEvidence;
  exactHeadCi: HeadBoundEvidence;
  mergedMainSha: string | null;
  postMergeMainVerification: HeadBoundEvidence;
}>;

export type ExactHeadActionsProgressInput = Readonly<{
  assessmentId: string;
  currentMainSha: string;
  productionDisabled: boolean;
  basePlan: ExactHeadActionsPlan;
  entries: readonly ExactHeadPlanEntry[];
}>;

export type ExactHeadPlanStep =
  | "resolve_offline_queue"
  | "wait_for_actions_capacity"
  | "rebase_candidate"
  | "run_hosted_validation"
  | "run_reversible_migration_validation"
  | "review_exact_diff"
  | "resolve_review_threads"
  | "run_exact_head_ci"
  | "resolve_failed_evidence"
  | "await_focused_merge"
  | "verify_post_merge_main"
  | "sequence_complete";

export type ExactHeadActionsProgress = Readonly<{
  status:
    | "blocked"
    | "waiting_for_actions_capacity"
    | "evidence_required"
    | "ready_for_focused_merge"
    | "complete";
  nextStep: ExactHeadPlanStep;
  activeOrder: number | null;
  activeBranch: string | null;
  activeHeadSha: string | null;
  excludedPrecursorOrders: readonly number[];
  staleEvidence: readonly (
    | "hosted_validation"
    | "migration_validation"
    | "diff_review"
    | "review_resolution"
    | "exact_head_ci"
    | "post_merge_main_verification"
  )[];
  detail: string;
  mergeAllowed: false;
  workflowDispatchAllowed: false;
  productionMutationAllowed: false;
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

function optionalSha(value: string | null, field: string): void {
  if (value !== null) exactSha(value, field);
}

function assertEvidence(evidence: HeadBoundEvidence, field: string): void {
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    !EVIDENCE_STATES.includes(evidence.state)
  ) {
    throw new Error(`${field} evidence state is invalid.`);
  }
  optionalSha(evidence.headSha, `${field} head`);
  if (evidence.state === "not_run" && evidence.headSha !== null) {
    throw new Error(`${field} cannot bind an unrun result to a head.`);
  }
  if (evidence.state !== "not_run" && evidence.headSha === null) {
    throw new Error(`${field} must bind its result to an exact head.`);
  }
}

function result(
  values: Omit<
    ExactHeadActionsProgress,
    "mergeAllowed" | "workflowDispatchAllowed" | "productionMutationAllowed"
  >,
): ExactHeadActionsProgress {
  return {
    ...values,
    mergeAllowed: false,
    workflowDispatchAllowed: false,
    productionMutationAllowed: false,
  };
}

function assertRuntimeShape(input: ExactHeadActionsProgressInput): void {
  requiredText(input.assessmentId, "Assessment ID");
  exactSha(input.currentMainSha, "Current main SHA");
  if (typeof input.productionDisabled !== "boolean") {
    throw new Error("Exact-head plan controls must be explicit booleans.");
  }
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new Error("At least one exact-head queue entry is required.");
  }

  const orders = new Set<number>();
  for (const entry of input.entries) {
    if (!Number.isSafeInteger(entry.order) || entry.order <= 0) {
      throw new Error(
        "Exact-head queue order must be a positive safe integer.",
      );
    }
    if (orders.has(entry.order)) {
      throw new Error(`Exact-head queue order ${entry.order} must be unique.`);
    }
    orders.add(entry.order);
    requiredText(entry.title, `Queue ${entry.order} title`);
    if (
      typeof entry.branch !== "string" ||
      !/^agent\/[a-z0-9][a-z0-9._/-]*$/.test(entry.branch)
    ) {
      throw new Error(`Queue ${entry.order} branch is invalid.`);
    }
    exactSha(entry.queuedHeadSha, `Queue ${entry.order} queued head`);
    if (!DISPOSITIONS.includes(entry.disposition)) {
      throw new Error(`Queue ${entry.order} disposition is invalid.`);
    }
    if (
      entry.dependsOnOrder !== null &&
      (!Number.isSafeInteger(entry.dependsOnOrder) || entry.dependsOnOrder <= 0)
    ) {
      throw new Error(`Queue ${entry.order} dependency is invalid.`);
    }
    if (typeof entry.migrationRequired !== "boolean") {
      throw new Error(`Queue ${entry.order} migration flag is invalid.`);
    }
    optionalSha(entry.rebasedHeadSha, `Queue ${entry.order} rebased head`);
    optionalSha(
      entry.rebasedOntoMainSha,
      `Queue ${entry.order} rebase main head`,
    );
    if (
      (entry.rebasedHeadSha === null) !==
      (entry.rebasedOntoMainSha === null)
    ) {
      throw new Error(
        `Queue ${entry.order} rebase head and main evidence must be paired.`,
      );
    }
    assertEvidence(
      entry.hostedValidation,
      `Queue ${entry.order} hosted validation`,
    );
    assertEvidence(
      entry.migrationValidation,
      `Queue ${entry.order} migration validation`,
    );
    assertEvidence(entry.diffReview, `Queue ${entry.order} diff review`);
    assertEvidence(
      entry.reviewResolution,
      `Queue ${entry.order} review resolution`,
    );
    assertEvidence(entry.exactHeadCi, `Queue ${entry.order} exact-head CI`);
    optionalSha(entry.mergedMainSha, `Queue ${entry.order} merged main head`);
    assertEvidence(
      entry.postMergeMainVerification,
      `Queue ${entry.order} post-merge main verification`,
    );
    if (
      entry.mergedMainSha === null &&
      entry.postMergeMainVerification.state !== "not_run"
    ) {
      throw new Error(
        `Queue ${entry.order} cannot record post-merge evidence before a merge.`,
      );
    }
  }
}

function staleEvidence(
  entry: ExactHeadPlanEntry,
): ExactHeadActionsProgress["staleEvidence"] {
  if (entry.rebasedHeadSha === null) return [];
  const stale: ExactHeadActionsProgress["staleEvidence"][number][] = [];
  if (
    entry.hostedValidation.headSha !== null &&
    entry.hostedValidation.headSha !== entry.rebasedHeadSha
  ) {
    stale.push("hosted_validation");
  }
  if (
    entry.migrationValidation.headSha !== null &&
    entry.migrationValidation.headSha !== entry.rebasedHeadSha
  ) {
    stale.push("migration_validation");
  }
  if (
    entry.diffReview.headSha !== null &&
    entry.diffReview.headSha !== entry.rebasedHeadSha
  ) {
    stale.push("diff_review");
  }
  if (
    entry.reviewResolution.headSha !== null &&
    entry.reviewResolution.headSha !== entry.rebasedHeadSha
  ) {
    stale.push("review_resolution");
  }
  if (
    entry.exactHeadCi.headSha !== null &&
    entry.exactHeadCi.headSha !== entry.rebasedHeadSha
  ) {
    stale.push("exact_head_ci");
  }
  if (
    entry.postMergeMainVerification.headSha !== null &&
    entry.postMergeMainVerification.headSha !== entry.mergedMainSha
  ) {
    stale.push("post_merge_main_verification");
  }
  return stale;
}

function isCurrentFailure(
  evidence: HeadBoundEvidence,
  headSha: string,
): boolean {
  return evidence.state === "failed" && evidence.headSha === headSha;
}

function isCurrentPass(evidence: HeadBoundEvidence, headSha: string): boolean {
  return evidence.state === "passed" && evidence.headSha === headSha;
}

export function evaluateExactHeadActionsProgress(
  input: ExactHeadActionsProgressInput,
): ExactHeadActionsProgress {
  assertRuntimeShape(input);
  const sorted = [...input.entries].sort(
    (left, right) => left.order - right.order,
  );
  const candidates = sorted.filter(
    ({ disposition }) => disposition === "merge_candidate",
  );
  const excludedPrecursorOrders = sorted
    .filter(({ disposition }) => disposition === "non_merge_precursor")
    .map(({ order }) => order);
  const plan = input.basePlan;

  if (
    typeof plan !== "object" ||
    plan === null ||
    ![
      "blocked",
      "awaiting_actions_capacity",
      "ready_to_start_preflight",
    ].includes(plan.status) ||
    !Array.isArray(plan.steps) ||
    !Array.isArray(plan.excludedPrecursorOrders) ||
    plan.executionAuthorized !== false ||
    plan.workflowDispatchAuthorized !== false ||
    plan.productionMutationAuthorized !== false
  ) {
    throw new Error(
      "The base exact-head plan must preserve every non-execution boundary.",
    );
  }
  if (candidates.length === 0) {
    throw new Error("The base exact-head plan must contain a merge candidate.");
  }

  if (
    plan.steps.length !== candidates.length ||
    plan.steps.some((step, index) => {
      const candidate = candidates[index];
      return (
        candidate === undefined ||
        step.queueOrder !== candidate.order ||
        step.branch !== candidate.branch ||
        step.queuedHeadSha !== candidate.queuedHeadSha
      );
    })
  ) {
    throw new Error(
      "Progress entries must match the base plan candidate order, branch and queued head.",
    );
  }
  if (
    plan.excludedPrecursorOrders.length !== excludedPrecursorOrders.length ||
    plan.excludedPrecursorOrders.some(
      (order, index) => order !== excludedPrecursorOrders[index],
    )
  ) {
    throw new Error(
      "Progress precursor exclusions must match the base exact-head plan.",
    );
  }

  if (!input.productionDisabled) {
    return result({
      status: "blocked",
      nextStep: "resolve_failed_evidence",
      activeOrder: null,
      activeBranch: null,
      activeHeadSha: null,
      excludedPrecursorOrders,
      staleEvidence: [],
      detail: "Production must remain disabled before sequence planning.",
    });
  }
  if (plan.status === "blocked") {
    return result({
      status: "blocked",
      nextStep: "resolve_offline_queue",
      activeOrder: null,
      activeBranch: null,
      activeHeadSha: null,
      excludedPrecursorOrders,
      staleEvidence: [],
      detail: "The offline exact-head queue must pass before Actions planning.",
    });
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const entry = candidates[index]!;
    const previous = candidates[index - 1];
    const expectedDependency = previous?.order ?? null;
    if (entry.dependsOnOrder !== expectedDependency) {
      return result({
        status: "blocked",
        nextStep: "resolve_offline_queue",
        activeOrder: entry.order,
        activeBranch: entry.branch,
        activeHeadSha: entry.rebasedHeadSha,
        excludedPrecursorOrders,
        staleEvidence: staleEvidence(entry),
        detail:
          expectedDependency === null
            ? "The first merge candidate must not declare a dependency."
            : `Candidate ${entry.order} must depend on prior merge candidate ${expectedDependency}.`,
      });
    }
  }

  const firstUnmergedIndex = candidates.findIndex(
    ({ mergedMainSha }) => mergedMainSha === null,
  );
  if (
    firstUnmergedIndex !== -1 &&
    candidates
      .slice(firstUnmergedIndex + 1)
      .some(({ mergedMainSha }) => mergedMainSha !== null)
  ) {
    const outOfOrder = candidates
      .slice(firstUnmergedIndex + 1)
      .find(({ mergedMainSha }) => mergedMainSha !== null)!;
    return result({
      status: "blocked",
      nextStep: "resolve_failed_evidence",
      activeOrder: outOfOrder.order,
      activeBranch: outOfOrder.branch,
      activeHeadSha: outOfOrder.rebasedHeadSha,
      excludedPrecursorOrders,
      staleEvidence: staleEvidence(outOfOrder),
      detail: "A later candidate cannot be merged before its dependency.",
    });
  }

  const mergedCount =
    firstUnmergedIndex === -1 ? candidates.length : firstUnmergedIndex;
  for (let index = 0; index < mergedCount; index += 1) {
    const merged = candidates[index]!;
    const headSha = merged.rebasedHeadSha;
    const mergedMainSha = merged.mergedMainSha!;
    const previousMerged = candidates[index - 1];
    const expectedBase = plan.steps[index]?.expectedBase;
    const expectedBaseSha =
      previousMerged?.mergedMainSha ??
      (expectedBase?.kind === "current_main" ? expectedBase.sha : null);
    if (
      headSha === null ||
      merged.rebasedOntoMainSha !== expectedBaseSha ||
      !isCurrentPass(merged.hostedValidation, headSha) ||
      (merged.migrationRequired &&
        !isCurrentPass(merged.migrationValidation, headSha)) ||
      !isCurrentPass(merged.diffReview, headSha) ||
      !isCurrentPass(merged.reviewResolution, headSha) ||
      !isCurrentPass(merged.exactHeadCi, headSha)
    ) {
      return result({
        status: "blocked",
        nextStep: "resolve_failed_evidence",
        activeOrder: merged.order,
        activeBranch: merged.branch,
        activeHeadSha: headSha,
        excludedPrecursorOrders,
        staleEvidence: staleEvidence(merged),
        detail:
          "A recorded merge is missing passing evidence for its exact rebased head.",
      });
    }
    if (isCurrentFailure(merged.postMergeMainVerification, mergedMainSha)) {
      return result({
        status: "blocked",
        nextStep: "resolve_failed_evidence",
        activeOrder: merged.order,
        activeBranch: merged.branch,
        activeHeadSha: mergedMainSha,
        excludedPrecursorOrders,
        staleEvidence: staleEvidence(merged),
        detail: "Post-merge main verification failed. Stop the sequence.",
      });
    }
    if (!isCurrentPass(merged.postMergeMainVerification, mergedMainSha)) {
      return result({
        status: "evidence_required",
        nextStep: "verify_post_merge_main",
        activeOrder: merged.order,
        activeBranch: merged.branch,
        activeHeadSha: mergedMainSha,
        excludedPrecursorOrders,
        staleEvidence: staleEvidence(merged),
        detail:
          "Verify the merged main head before advancing to the next candidate.",
      });
    }
  }

  const latestMerged =
    mergedCount === 0 ? undefined : candidates[mergedCount - 1];
  if (
    latestMerged !== undefined &&
    latestMerged.mergedMainSha !== input.currentMainSha
  ) {
    return result({
      status: "blocked",
      nextStep: "resolve_failed_evidence",
      activeOrder: latestMerged.order,
      activeBranch: latestMerged.branch,
      activeHeadSha: latestMerged.mergedMainSha,
      excludedPrecursorOrders,
      staleEvidence: staleEvidence(latestMerged),
      detail:
        "Current main no longer matches the last verified serial merge head.",
    });
  }

  if (firstUnmergedIndex === -1) {
    return result({
      status: "complete",
      nextStep: "sequence_complete",
      activeOrder: null,
      activeBranch: null,
      activeHeadSha: null,
      excludedPrecursorOrders,
      staleEvidence: [],
      detail:
        "Every merge candidate and resulting main head has exact passing evidence; formal gate acceptance remains separate.",
    });
  }

  const firstStep = plan.steps[0];
  if (
    firstUnmergedIndex === 0 &&
    (firstStep?.expectedBase.kind !== "current_main" ||
      firstStep.expectedBase.sha !== input.currentMainSha)
  ) {
    return result({
      status: "blocked",
      nextStep: "resolve_offline_queue",
      activeOrder: candidates[0]!.order,
      activeBranch: candidates[0]!.branch,
      activeHeadSha: candidates[0]!.rebasedHeadSha,
      excludedPrecursorOrders,
      staleEvidence: staleEvidence(candidates[0]!),
      detail:
        "Current main changed after the static exact-head plan was created; rebuild readiness before starting.",
    });
  }

  const active = candidates[firstUnmergedIndex]!;
  const stale = staleEvidence(active);
  if (plan.status === "awaiting_actions_capacity") {
    return result({
      status: "waiting_for_actions_capacity",
      nextStep: "wait_for_actions_capacity",
      activeOrder: active.order,
      activeBranch: active.branch,
      activeHeadSha: active.rebasedHeadSha,
      excludedPrecursorOrders,
      staleEvidence: stale,
      detail:
        "Actions capacity is not explicitly available; do not rebase, dispatch or merge.",
    });
  }

  if (
    active.rebasedHeadSha === null ||
    active.rebasedOntoMainSha !== input.currentMainSha
  ) {
    return result({
      status: "evidence_required",
      nextStep: "rebase_candidate",
      activeOrder: active.order,
      activeBranch: active.branch,
      activeHeadSha: active.rebasedHeadSha,
      excludedPrecursorOrders,
      staleEvidence: stale,
      detail:
        "Rebase the active candidate onto the current main head; all prior head-bound evidence becomes stale.",
    });
  }

  const headSha = active.rebasedHeadSha;
  const evidence = [
    active.hostedValidation,
    ...(active.migrationRequired ? [active.migrationValidation] : []),
    active.diffReview,
    active.reviewResolution,
    active.exactHeadCi,
  ];
  if (evidence.some((value) => isCurrentFailure(value, headSha))) {
    return result({
      status: "blocked",
      nextStep: "resolve_failed_evidence",
      activeOrder: active.order,
      activeBranch: active.branch,
      activeHeadSha: headSha,
      excludedPrecursorOrders,
      staleEvidence: stale,
      detail:
        "Current-head evidence failed. Stop the sequence and resolve it before continuing.",
    });
  }

  if (!isCurrentPass(active.hostedValidation, headSha)) {
    return result({
      status: "evidence_required",
      nextStep: "run_hosted_validation",
      activeOrder: active.order,
      activeBranch: active.branch,
      activeHeadSha: headSha,
      excludedPrecursorOrders,
      staleEvidence: stale,
      detail:
        "Run formatting, lint, strict types, all TS/TSX tests, build, audit and privacy scans on the rebased head.",
    });
  }
  if (
    active.migrationRequired &&
    !isCurrentPass(active.migrationValidation, headSha)
  ) {
    return result({
      status: "evidence_required",
      nextStep: "run_reversible_migration_validation",
      activeOrder: active.order,
      activeBranch: active.branch,
      activeHeadSha: headSha,
      excludedPrecursorOrders,
      staleEvidence: stale,
      detail:
        "Apply, smoke-test and reverse applicable PostgreSQL migrations on an approved non-Production target.",
    });
  }
  if (!isCurrentPass(active.diffReview, headSha)) {
    return result({
      status: "evidence_required",
      nextStep: "review_exact_diff",
      activeOrder: active.order,
      activeBranch: active.branch,
      activeHeadSha: headSha,
      excludedPrecursorOrders,
      staleEvidence: stale,
      detail:
        "Review the complete rebased diff, append-only decisions, privacy boundary and limitations.",
    });
  }
  if (!isCurrentPass(active.reviewResolution, headSha)) {
    return result({
      status: "evidence_required",
      nextStep: "resolve_review_threads",
      activeOrder: active.order,
      activeBranch: active.branch,
      activeHeadSha: headSha,
      excludedPrecursorOrders,
      staleEvidence: stale,
      detail:
        "Resolve every review thread and bind the result to the exact reviewed head.",
    });
  }
  if (!isCurrentPass(active.exactHeadCi, headSha)) {
    return result({
      status: "evidence_required",
      nextStep: "run_exact_head_ci",
      activeOrder: active.order,
      activeBranch: active.branch,
      activeHeadSha: headSha,
      excludedPrecursorOrders,
      staleEvidence: stale,
      detail:
        "Run mandatory GitHub Actions on the exact reviewed and validated head.",
    });
  }

  return result({
    status: "ready_for_focused_merge",
    nextStep: "await_focused_merge",
    activeOrder: active.order,
    activeBranch: active.branch,
    activeHeadSha: headSha,
    excludedPrecursorOrders,
    staleEvidence: stale,
    detail:
      "All current-head evidence passed. The plan records readiness but does not authorize or perform the merge.",
  });
}
