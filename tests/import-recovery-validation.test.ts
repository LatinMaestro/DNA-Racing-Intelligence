import { describe, expect, it } from "vitest";
import {
  auditImportRecovery,
  type ImportRecoveryAuditInput,
  type RecoveryBatchEvidence,
} from "@/domain/import-recovery-validation";

function batch(
  overrides: Partial<RecoveryBatchEvidence> = {},
): RecoveryBatchEvidence {
  return {
    batchId: "active",
    ownerScope: "owner-1",
    sourceType: "race_merge",
    checksum: "sha256-active",
    version: 2,
    status: "accepted",
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    acceptedContributionCount: 100,
    active: true,
    ...overrides,
  };
}

function input(
  overrides: Partial<ImportRecoveryAuditInput> = {},
): ImportRecoveryAuditInput {
  return {
    activeBatchId: "active",
    latestAttemptBatchId: "quarantined",
    requestedRollbackBatchId: "prior",
    replayBatchId: "active",
    batches: [
      batch(),
      batch({
        batchId: "prior",
        checksum: "sha256-prior",
        version: 1,
        dataCurrentThrough: "2026-07-10T00:00:00Z",
        acceptedContributionCount: 80,
        active: false,
      }),
      batch({
        batchId: "quarantined",
        checksum: "sha256-quarantine",
        version: 3,
        status: "quarantined",
        dataCurrentThrough: "2026-07-23T00:00:00Z",
        acceptedContributionCount: 0,
        active: false,
      }),
    ],
    provenanceRetained: true,
    rollbackReasonRecorded: true,
    replayResolvedExistingVersion: true,
    replayCreatedContributionCount: 0,
    aggregateRefreshState: "completed_after_recovery",
    sourceDeletionRequested: false,
    productionMutationRequested: false,
    ...overrides,
  };
}

describe("Phase 9 import recovery validation", () => {
  it("verifies a non-destructive recovery contract", () => {
    const audit = auditImportRecovery(input());

    expect(audit.status).toBe("verified_contract");
    expect(audit.checks.every((item) => item.status === "pass")).toBe(true);
    expect(audit).toMatchObject({
      rollbackExecutable: false,
      sourceDeletionAllowed: false,
      productionMutationAllowed: false,
      gateBStatus: "not_assessed",
    });
  });

  it("keeps a quarantined latest attempt isolated from accepted data", () => {
    const audit = auditImportRecovery(input());
    expect(
      audit.checks.find((item) => item.code === "LATEST_ATTEMPT_ISOLATED"),
    ).toMatchObject({ status: "pass" });

    expect(() =>
      auditImportRecovery(
        input({
          activeBatchId: "quarantined",
          batches: input().batches.map((item) =>
            item.batchId === "quarantined" ? { ...item, active: true } : item,
          ),
        }),
      ),
    ).toThrow(/Only an accepted/);
  });

  it("blocks rollback to another owner or source", () => {
    const audit = auditImportRecovery(
      input({
        batches: input().batches.map((item) =>
          item.batchId === "prior" ? { ...item, ownerScope: "owner-2" } : item,
        ),
      }),
    );

    expect(audit.status).toBe("blocked");
    expect(
      audit.checks.find((item) => item.code === "ROLLBACK_TARGET_SAFE"),
    ).toMatchObject({ status: "block" });
  });

  it("requires a recorded rollback reason and a prior version", () => {
    const noReason = auditImportRecovery(
      input({ rollbackReasonRecorded: false }),
    );
    expect(
      noReason.checks.find((item) => item.code === "ROLLBACK_TARGET_SAFE"),
    ).toMatchObject({ status: "block" });

    const futureTarget = auditImportRecovery(
      input({
        batches: input().batches.map((item) =>
          item.batchId === "prior" ? { ...item, version: 4 } : item,
        ),
      }),
    );
    expect(futureTarget.status).toBe("blocked");
  });

  it("keeps rollback review-required when cutoff evidence is unknown", () => {
    const audit = auditImportRecovery(
      input({
        batches: input().batches.map((item) =>
          item.batchId === "prior"
            ? { ...item, dataCurrentThrough: null }
            : item,
        ),
      }),
    );

    expect(audit.status).toBe("review_required");
    expect(
      audit.checks.find((item) => item.code === "ROLLBACK_TARGET_SAFE"),
    ).toMatchObject({ status: "review" });
  });

  it("blocks replay that creates new contributions", () => {
    const audit = auditImportRecovery(
      input({
        replayResolvedExistingVersion: false,
        replayCreatedContributionCount: 1,
      }),
    );

    expect(
      audit.checks.find((item) => item.code === "REPLAY_IDEMPOTENT"),
    ).toMatchObject({ status: "block" });
  });

  it("requires recovery aggregates to be refreshed rather than carried forward", () => {
    const pending = auditImportRecovery(
      input({ aggregateRefreshState: "pending" }),
    );
    expect(pending.status).toBe("review_required");

    const unsafe = auditImportRecovery(
      input({ aggregateRefreshState: "incorrectly_carried_forward" }),
    );
    expect(unsafe.status).toBe("blocked");
  });

  it("blocks source deletion and Production mutation requests", () => {
    const audit = auditImportRecovery(
      input({
        sourceDeletionRequested: true,
        productionMutationRequested: true,
      }),
    );

    expect(
      audit.checks.find((item) => item.code === "NON_DESTRUCTIVE_SCOPE"),
    ).toMatchObject({ status: "block" });
    expect(audit.sourceDeletionAllowed).toBe(false);
    expect(audit.productionMutationAllowed).toBe(false);
  });

  it("rejects duplicate IDs and quarantined contributions", () => {
    expect(() =>
      auditImportRecovery(
        input({
          batches: [batch(), batch()],
        }),
      ),
    ).toThrow(/unique/);

    expect(() =>
      auditImportRecovery(
        input({
          batches: input().batches.map((item) =>
            item.batchId === "quarantined"
              ? { ...item, acceptedContributionCount: 1 }
              : item,
          ),
        }),
      ),
    ).toThrow(/quarantined batch/);
  });
});
