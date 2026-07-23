export type RecoveryBatchEvidence = {
  batchId: string;
  ownerScope: string;
  sourceType: "race_merge" | "core_details" | "current_vault" | "current_arena";
  checksum: string;
  version: number;
  status: "accepted" | "quarantined" | "rolled_back";
  dataCurrentThrough: string | null;
  acceptedContributionCount: number;
  active: boolean;
};

export type ImportRecoveryAuditInput = {
  activeBatchId: string;
  latestAttemptBatchId: string;
  requestedRollbackBatchId: string | null;
  replayBatchId: string | null;
  batches: readonly RecoveryBatchEvidence[];
  provenanceRetained: boolean;
  rollbackReasonRecorded: boolean;
  replayResolvedExistingVersion: boolean;
  replayCreatedContributionCount: number;
  aggregateRefreshState:
    | "not_required"
    | "pending"
    | "completed_after_recovery"
    | "incorrectly_carried_forward";
  sourceDeletionRequested: boolean;
  productionMutationRequested: boolean;
};

export type ImportRecoveryCheck = {
  code:
    | "ACTIVE_ACCEPTED_BATCH"
    | "LATEST_ATTEMPT_ISOLATED"
    | "ROLLBACK_TARGET_SAFE"
    | "PROVENANCE_RETAINED"
    | "REPLAY_IDEMPOTENT"
    | "AGGREGATE_REFRESH_SAFE"
    | "NON_DESTRUCTIVE_SCOPE";
  status: "pass" | "review" | "block";
  detail: string;
};

export type ImportRecoveryAudit = {
  status: "verified_contract" | "review_required" | "blocked";
  checks: readonly ImportRecoveryCheck[];
  rollbackExecutable: false;
  sourceDeletionAllowed: false;
  productionMutationAllowed: false;
  gateBStatus: "not_assessed";
};

function timestamp(value: string | null, label: string): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return parsed;
}

function assertBatch(batch: RecoveryBatchEvidence): void {
  if (
    batch.batchId.trim() === "" ||
    batch.ownerScope.trim() === "" ||
    batch.checksum.trim() === "" ||
    !["race_merge", "core_details", "current_vault", "current_arena"].includes(
      batch.sourceType,
    ) ||
    !["accepted", "quarantined", "rolled_back"].includes(batch.status) ||
    !Number.isSafeInteger(batch.version) ||
    batch.version <= 0 ||
    !Number.isSafeInteger(batch.acceptedContributionCount) ||
    batch.acceptedContributionCount < 0
  ) {
    throw new Error("Recovery batch evidence is invalid.");
  }
  timestamp(batch.dataCurrentThrough, "Data current through");
  if (batch.status !== "accepted" && batch.active) {
    throw new Error("Only an accepted recovery batch may be active.");
  }
  if (batch.status === "quarantined" && batch.acceptedContributionCount !== 0) {
    throw new Error("A quarantined batch cannot have accepted contributions.");
  }
}

function check(
  code: ImportRecoveryCheck["code"],
  status: ImportRecoveryCheck["status"],
  detail: string,
): ImportRecoveryCheck {
  return { code, status, detail };
}

export function auditImportRecovery(
  input: ImportRecoveryAuditInput,
): ImportRecoveryAudit {
  if (
    input.activeBatchId.trim() === "" ||
    input.latestAttemptBatchId.trim() === "" ||
    !Number.isSafeInteger(input.replayCreatedContributionCount) ||
    input.replayCreatedContributionCount < 0
  ) {
    throw new Error("Import recovery audit input is invalid.");
  }
  for (const batch of input.batches) assertBatch(batch);
  const batchIds = input.batches.map((batch) => batch.batchId);
  if (new Set(batchIds).size !== batchIds.length) {
    throw new Error("Recovery batch IDs must be unique.");
  }
  const byId = new Map(input.batches.map((batch) => [batch.batchId, batch]));
  const active = byId.get(input.activeBatchId);
  const latest = byId.get(input.latestAttemptBatchId);
  if (!active || !latest) {
    throw new Error("Active and latest recovery batches must exist.");
  }
  const activeCount = input.batches.filter((batch) => batch.active).length;
  const checks: ImportRecoveryCheck[] = [];

  checks.push(
    check(
      "ACTIVE_ACCEPTED_BATCH",
      active.status === "accepted" && active.active && activeCount === 1
        ? "pass"
        : "block",
      "Exactly one accepted batch must remain active.",
    ),
  );

  const latestIsolationSafe =
    latest.status !== "quarantined" ||
    (!latest.active &&
      latest.acceptedContributionCount === 0 &&
      active.batchId !== latest.batchId);
  checks.push(
    check(
      "LATEST_ATTEMPT_ISOLATED",
      latestIsolationSafe ? "pass" : "block",
      "A quarantined latest attempt cannot replace or contribute to the active dataset.",
    ),
  );

  if (input.requestedRollbackBatchId === null) {
    checks.push(
      check(
        "ROLLBACK_TARGET_SAFE",
        "review",
        "No reasoned rollback target was supplied.",
      ),
    );
  } else {
    const target = byId.get(input.requestedRollbackBatchId);
    const targetTime = target
      ? timestamp(target.dataCurrentThrough, "Rollback target cutoff")
      : null;
    const activeTime = timestamp(
      active.dataCurrentThrough,
      "Active data cutoff",
    );
    const identityAndVersionSafe =
      target !== undefined &&
      target.status === "accepted" &&
      !target.active &&
      target.ownerScope === active.ownerScope &&
      target.sourceType === active.sourceType &&
      target.version < active.version &&
      input.rollbackReasonRecorded;
    const cutoffKnown = targetTime !== null && activeTime !== null;
    const safe =
      identityAndVersionSafe && cutoffKnown && targetTime <= activeTime;
    checks.push(
      check(
        "ROLLBACK_TARGET_SAFE",
        safe
          ? "pass"
          : identityAndVersionSafe && !cutoffKnown
            ? "review"
            : "block",
        "Rollback requires a prior accepted same-owner/source version and a recorded reason.",
      ),
    );
  }

  checks.push(
    check(
      "PROVENANCE_RETAINED",
      input.provenanceRetained ? "pass" : "block",
      "Recovery must retain batch and contribution provenance.",
    ),
  );

  if (input.replayBatchId === null) {
    checks.push(
      check("REPLAY_IDEMPOTENT", "review", "No replay evidence was supplied."),
    );
  } else {
    const replay = byId.get(input.replayBatchId);
    const exactReplay =
      replay !== undefined &&
      replay.status === "accepted" &&
      input.replayResolvedExistingVersion &&
      input.replayCreatedContributionCount === 0;
    checks.push(
      check(
        "REPLAY_IDEMPOTENT",
        exactReplay ? "pass" : "block",
        "An exact replay must resolve the existing version and create no contributions.",
      ),
    );
  }

  checks.push(
    check(
      "AGGREGATE_REFRESH_SAFE",
      input.aggregateRefreshState === "incorrectly_carried_forward"
        ? "block"
        : input.aggregateRefreshState === "pending"
          ? "review"
          : "pass",
      "Recovered facts require a new aggregate refresh or explicit proof that none is required.",
    ),
  );

  checks.push(
    check(
      "NON_DESTRUCTIVE_SCOPE",
      input.sourceDeletionRequested || input.productionMutationRequested
        ? "block"
        : "pass",
      "This validation cannot delete source evidence or mutate Production.",
    ),
  );

  return {
    status: checks.some((item) => item.status === "block")
      ? "blocked"
      : checks.some((item) => item.status === "review")
        ? "review_required"
        : "verified_contract",
    checks,
    rollbackExecutable: false,
    sourceDeletionAllowed: false,
    productionMutationAllowed: false,
    gateBStatus: "not_assessed",
  };
}
