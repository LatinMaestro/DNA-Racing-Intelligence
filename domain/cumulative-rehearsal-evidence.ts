const CHECK_NAMES = [
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
  "private_real_file_import_assurance",
  "synthetic_import_replay_rollback_reconciliation",
] as const;

const CHECK_STATES = ["not_run", "passed", "failed"] as const;
const MIGRATION_STATES = [
  "unavailable",
  "not_run",
  "passed",
  "failed",
] as const;

export type CumulativeRehearsalCheckName = (typeof CHECK_NAMES)[number];
export type CumulativeRehearsalCheckState = (typeof CHECK_STATES)[number];
export type CumulativeMigrationState = (typeof MIGRATION_STATES)[number];

export type CumulativeRehearsalCheck = Readonly<{
  name: CumulativeRehearsalCheckName;
  state: CumulativeRehearsalCheckState;
  headSha: string | null;
}>;

export type CumulativeRehearsalEvidenceInput = Readonly<{
  rehearsalId: string;
  composedHeadSha: string;
  latestCandidateHeadSha: string;
  checks: readonly CumulativeRehearsalCheck[];
  migration: Readonly<{
    state: CumulativeMigrationState;
    headSha: string | null;
    nonProductionTarget: boolean;
    applyPassed: boolean;
    smokePassed: boolean;
    reversePassed: boolean;
    removalPassed: boolean;
  }>;
  controls: Readonly<{
    productionDisabled: boolean;
    providersUnchanged: boolean;
    privateDataInGit: boolean;
    publicRoutesExposed: boolean;
    actionsDispatched: boolean;
  }>;
}>;

export type CumulativeRehearsalIssue = Readonly<{
  code:
    | "COMPOSITION_HEAD"
    | "CHECK_MISSING"
    | "CHECK_NOT_RUN"
    | "CHECK_FAILED"
    | "CHECK_STALE"
    | "MIGRATION_NOT_RUN"
    | "MIGRATION_FAILED"
    | "MIGRATION_STALE"
    | "MIGRATION_INCOMPLETE"
    | "CONTROL_DRIFT";
  check: CumulativeRehearsalCheckName | "migration" | null;
  severity: "review" | "block";
  detail: string;
}>;

export type CumulativeRehearsalEvidence = Readonly<{
  status: "blocked" | "review_required" | "rehearsed_with_limitations";
  passedChecks: readonly CumulativeRehearsalCheckName[];
  pendingChecks: readonly CumulativeRehearsalCheckName[];
  issues: readonly CumulativeRehearsalIssue[];
  migrationEvidenceComplete: boolean;
  exactHeadActionsStillRequired: true;
  connectedProviderEvidenceStillRequired: true;
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

function issue(
  code: CumulativeRehearsalIssue["code"],
  check: CumulativeRehearsalIssue["check"],
  severity: CumulativeRehearsalIssue["severity"],
  detail: string,
): CumulativeRehearsalIssue {
  return { code, check, severity, detail };
}

function assertRuntimeShape(input: CumulativeRehearsalEvidenceInput): void {
  requiredText(input.rehearsalId, "Rehearsal ID");
  exactSha(input.composedHeadSha, "Composed head");
  exactSha(input.latestCandidateHeadSha, "Latest candidate head");

  if (!Array.isArray(input.checks)) {
    throw new Error("Rehearsal checks must be an array.");
  }

  const seen = new Set<CumulativeRehearsalCheckName>();
  for (const check of input.checks) {
    if (!CHECK_NAMES.includes(check.name)) {
      throw new Error("Rehearsal check name is invalid.");
    }
    if (seen.has(check.name)) {
      throw new Error(`Rehearsal check ${check.name} must be unique.`);
    }
    seen.add(check.name);
    if (!CHECK_STATES.includes(check.state)) {
      throw new Error(`Rehearsal check ${check.name} state is invalid.`);
    }
    optionalSha(check.headSha, `Rehearsal check ${check.name} head`);
    if ((check.state === "not_run") !== (check.headSha === null)) {
      throw new Error(
        `Rehearsal check ${check.name} must bind only completed evidence to a head.`,
      );
    }
  }

  if (
    typeof input.migration !== "object" ||
    input.migration === null ||
    !MIGRATION_STATES.includes(input.migration.state)
  ) {
    throw new Error("Migration evidence state is invalid.");
  }
  optionalSha(input.migration.headSha, "Migration evidence head");
  if (
    (input.migration.state === "unavailable" ||
      input.migration.state === "not_run") !==
    (input.migration.headSha === null)
  ) {
    throw new Error(
      "Migration evidence must bind only completed evidence to a head.",
    );
  }
  if (
    [
      input.migration.nonProductionTarget,
      input.migration.applyPassed,
      input.migration.smokePassed,
      input.migration.reversePassed,
      input.migration.removalPassed,
    ].some((value) => typeof value !== "boolean")
  ) {
    throw new Error("Migration controls must be explicit booleans.");
  }

  if (
    typeof input.controls !== "object" ||
    input.controls === null ||
    Object.values(input.controls).some((value) => typeof value !== "boolean")
  ) {
    throw new Error("Rehearsal controls must be explicit booleans.");
  }
}

export function assessCumulativeRehearsalEvidence(
  input: CumulativeRehearsalEvidenceInput,
): CumulativeRehearsalEvidence {
  assertRuntimeShape(input);
  const issues: CumulativeRehearsalIssue[] = [];
  const checks = new Map(input.checks.map((check) => [check.name, check]));

  if (input.composedHeadSha !== input.latestCandidateHeadSha) {
    issues.push(
      issue(
        "COMPOSITION_HEAD",
        null,
        "block",
        "The cumulative composition must use the latest merge-candidate head.",
      ),
    );
  }

  for (const name of CHECK_NAMES) {
    const check = checks.get(name);
    if (check === undefined) {
      issues.push(
        issue(
          "CHECK_MISSING",
          name,
          "review",
          "Required cumulative rehearsal evidence is missing.",
        ),
      );
    } else if (check.state === "not_run") {
      issues.push(
        issue(
          "CHECK_NOT_RUN",
          name,
          "review",
          "Required cumulative rehearsal evidence has not run.",
        ),
      );
    } else if (check.headSha !== input.composedHeadSha) {
      issues.push(
        issue(
          "CHECK_STALE",
          name,
          "block",
          "Cumulative rehearsal evidence belongs to another head.",
        ),
      );
    } else if (check.state === "failed") {
      issues.push(
        issue(
          "CHECK_FAILED",
          name,
          "block",
          "Required cumulative rehearsal evidence failed.",
        ),
      );
    }
  }

  const migrationChecks = [
    input.migration.nonProductionTarget,
    input.migration.applyPassed,
    input.migration.smokePassed,
    input.migration.reversePassed,
    input.migration.removalPassed,
  ];
  const migrationEvidenceComplete =
    input.migration.state === "passed" &&
    input.migration.headSha === input.composedHeadSha &&
    migrationChecks.every(Boolean);

  if (
    input.migration.state === "unavailable" ||
    input.migration.state === "not_run"
  ) {
    issues.push(
      issue(
        "MIGRATION_NOT_RUN",
        "migration",
        "review",
        "Reversible PostgreSQL migration evidence remains unavailable.",
      ),
    );
  } else if (input.migration.headSha !== input.composedHeadSha) {
    issues.push(
      issue(
        "MIGRATION_STALE",
        "migration",
        "block",
        "Migration evidence belongs to another head.",
      ),
    );
  } else if (input.migration.state === "failed") {
    issues.push(
      issue(
        "MIGRATION_FAILED",
        "migration",
        "block",
        "Reversible PostgreSQL migration evidence failed.",
      ),
    );
  } else if (!migrationChecks.every(Boolean)) {
    issues.push(
      issue(
        "MIGRATION_INCOMPLETE",
        "migration",
        "block",
        "Migration evidence must cover a non-Production apply, smoke, reverse and removal sequence.",
      ),
    );
  }

  if (
    !input.controls.productionDisabled ||
    !input.controls.providersUnchanged ||
    input.controls.privateDataInGit ||
    input.controls.publicRoutesExposed ||
    input.controls.actionsDispatched
  ) {
    issues.push(
      issue(
        "CONTROL_DRIFT",
        null,
        "block",
        "No-Actions, provider, privacy and Production controls must remain fail-closed.",
      ),
    );
  }

  const passedChecks = CHECK_NAMES.filter((name) => {
    const check = checks.get(name);
    return check?.state === "passed" && check.headSha === input.composedHeadSha;
  });
  const pendingChecks = CHECK_NAMES.filter(
    (name) => !passedChecks.includes(name),
  );

  const status = issues.some(({ severity }) => severity === "block")
    ? "blocked"
    : issues.length > 0
      ? "review_required"
      : "rehearsed_with_limitations";

  return {
    status,
    passedChecks,
    pendingChecks,
    issues,
    migrationEvidenceComplete,
    exactHeadActionsStillRequired: true,
    connectedProviderEvidenceStillRequired: true,
    mergeAllowed: false,
    workflowDispatchAllowed: false,
    productionMutationAllowed: false,
  };
}
