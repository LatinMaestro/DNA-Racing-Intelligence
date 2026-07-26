const DISPOSITIONS = ["merge_candidate", "non_merge_precursor"] as const;
const EVIDENCE_STATES = ["passed", "not_run", "failed"] as const;

export type OfflineMergeDisposition = (typeof DISPOSITIONS)[number];
export type OfflineMergeEvidenceState = (typeof EVIDENCE_STATES)[number];

export type OfflineMergeQueueEntry = Readonly<{
  order: number;
  title: string;
  branch: string;
  expectedHeadSha: string;
  observedHeadSha: string | null;
  disposition: OfflineMergeDisposition;
  dependsOnOrder: number | null;
  hostedValidation: OfflineMergeEvidenceState;
  workflowRunCount: number;
  statusContextCount: number;
  pullRequestCount: number;
}>;

export type OfflineMergeReadinessInput = Readonly<{
  assessmentId: string;
  entries: readonly OfflineMergeQueueEntry[];
  controls: Readonly<{
    productionDisabled: boolean;
    providersUnchanged: boolean;
    privateDataInGit: boolean;
    publicRoutesExposed: boolean;
    recurringPaidInfrastructureEnabled: boolean;
  }>;
}>;

export type OfflineMergeReadinessIssue = Readonly<{
  code:
    | "DEPENDENCY_ORDER"
    | "REMOTE_HEAD"
    | "HOSTED_VALIDATION"
    | "NO_ACTIONS_STAGING"
    | "PRODUCTION_FAIL_CLOSED";
  order: number | null;
  status: "review" | "block";
  detail: string;
}>;

export type OfflineMergeCandidate = Readonly<{
  order: number;
  title: string;
  branch: string;
  exactHeadSha: string;
  dependsOnOrder: number | null;
}>;

export type OfflineMergeReadiness = Readonly<{
  status: "blocked" | "review_required" | "ready_for_exact_head_ci";
  mergeCandidates: readonly OfflineMergeCandidate[];
  excludedPrecursorOrders: readonly number[];
  issues: readonly OfflineMergeReadinessIssue[];
  nextRequiredAction:
    "resolve_blockers" | "complete_missing_evidence" | "await_actions_capacity";
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

function nonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
}

function issue(
  code: OfflineMergeReadinessIssue["code"],
  order: number | null,
  status: OfflineMergeReadinessIssue["status"],
  detail: string,
): OfflineMergeReadinessIssue {
  return { code, order, status, detail };
}

function assertRuntimeShape(input: OfflineMergeReadinessInput): void {
  requiredText(input.assessmentId, "Assessment ID");
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new Error("At least one offline merge queue entry is required.");
  }
  if (
    typeof input.controls !== "object" ||
    input.controls === null ||
    Object.values(input.controls).some((value) => typeof value !== "boolean")
  ) {
    throw new Error("Offline merge controls must be explicit booleans.");
  }

  const orders = new Set<number>();
  for (const entry of input.entries) {
    if (!Number.isSafeInteger(entry.order) || entry.order <= 0) {
      throw new Error("Queue order must be a positive safe integer.");
    }
    if (orders.has(entry.order)) {
      throw new Error(`Queue order ${entry.order} must be unique.`);
    }
    orders.add(entry.order);
    requiredText(entry.title, `Queue ${entry.order} title`);
    if (
      typeof entry.branch !== "string" ||
      !/^agent\/[a-z0-9][a-z0-9._/-]*$/.test(entry.branch)
    ) {
      throw new Error(`Queue ${entry.order} branch is invalid.`);
    }
    exactSha(entry.expectedHeadSha, `Queue ${entry.order} expected head`);
    if (entry.observedHeadSha !== null) {
      exactSha(entry.observedHeadSha, `Queue ${entry.order} observed head`);
    }
    if (!DISPOSITIONS.includes(entry.disposition)) {
      throw new Error(`Queue ${entry.order} disposition is invalid.`);
    }
    if (
      entry.dependsOnOrder !== null &&
      (!Number.isSafeInteger(entry.dependsOnOrder) || entry.dependsOnOrder <= 0)
    ) {
      throw new Error(`Queue ${entry.order} dependency is invalid.`);
    }
    if (!EVIDENCE_STATES.includes(entry.hostedValidation)) {
      throw new Error(`Queue ${entry.order} validation state is invalid.`);
    }
    nonNegativeInteger(
      entry.workflowRunCount,
      `Queue ${entry.order} workflow count`,
    );
    nonNegativeInteger(
      entry.statusContextCount,
      `Queue ${entry.order} status count`,
    );
    nonNegativeInteger(
      entry.pullRequestCount,
      `Queue ${entry.order} pull-request count`,
    );
  }
}

export function assessOfflineMergeReadiness(
  input: OfflineMergeReadinessInput,
): OfflineMergeReadiness {
  assertRuntimeShape(input);
  const sorted = [...input.entries].sort(
    (left, right) => left.order - right.order,
  );
  const candidates = sorted.filter(
    ({ disposition }) => disposition === "merge_candidate",
  );
  const issues: OfflineMergeReadinessIssue[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const entry = candidates[index]!;
    const previous = candidates[index - 1];
    const expectedDependency = previous?.order ?? null;
    if (entry.dependsOnOrder !== expectedDependency) {
      issues.push(
        issue(
          "DEPENDENCY_ORDER",
          entry.order,
          "block",
          expectedDependency === null
            ? "The first merge candidate must not declare a dependency."
            : `The merge candidate must depend on prior merge candidate ${expectedDependency}.`,
        ),
      );
    }
  }

  for (const entry of sorted) {
    if (entry.observedHeadSha === null) {
      issues.push(
        issue(
          "REMOTE_HEAD",
          entry.order,
          "review",
          "The remote branch head has not been verified.",
        ),
      );
    } else if (entry.observedHeadSha !== entry.expectedHeadSha) {
      issues.push(
        issue(
          "REMOTE_HEAD",
          entry.order,
          "block",
          "The observed remote head does not match the queued exact head.",
        ),
      );
    }

    if (entry.hostedValidation !== "passed") {
      issues.push(
        issue(
          "HOSTED_VALIDATION",
          entry.order,
          entry.hostedValidation === "failed" ? "block" : "review",
          entry.hostedValidation === "failed"
            ? "Hosted validation failed for the queued exact head."
            : "Hosted validation has not run for the queued exact head.",
        ),
      );
    }

    if (
      entry.workflowRunCount > 0 ||
      entry.statusContextCount > 0 ||
      entry.pullRequestCount > 0
    ) {
      issues.push(
        issue(
          "NO_ACTIONS_STAGING",
          entry.order,
          "block",
          "The staging branch has a workflow run, status context or pull request.",
        ),
      );
    }
  }

  if (
    !input.controls.productionDisabled ||
    !input.controls.providersUnchanged ||
    input.controls.privateDataInGit ||
    input.controls.publicRoutesExposed ||
    input.controls.recurringPaidInfrastructureEnabled
  ) {
    issues.push(
      issue(
        "PRODUCTION_FAIL_CLOSED",
        null,
        "block",
        "Production, providers, privacy and paid-infrastructure controls must remain fail-closed.",
      ),
    );
  }

  const status = issues.some(({ status: value }) => value === "block")
    ? "blocked"
    : issues.some(({ status: value }) => value === "review")
      ? "review_required"
      : "ready_for_exact_head_ci";

  return {
    status,
    mergeCandidates: candidates.map((entry) => ({
      order: entry.order,
      title: entry.title,
      branch: entry.branch,
      exactHeadSha: entry.expectedHeadSha,
      dependsOnOrder: entry.dependsOnOrder,
    })),
    excludedPrecursorOrders: sorted
      .filter(({ disposition }) => disposition === "non_merge_precursor")
      .map(({ order }) => order),
    issues,
    nextRequiredAction:
      status === "blocked"
        ? "resolve_blockers"
        : status === "review_required"
          ? "complete_missing_evidence"
          : "await_actions_capacity",
    mergeAllowed: false,
    workflowDispatchAllowed: false,
    productionMutationAllowed: false,
  };
}
