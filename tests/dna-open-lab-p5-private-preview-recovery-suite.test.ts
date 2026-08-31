import { describe, expect, it, vi } from "vitest";

import type {
  DnaOpenLabP5ComponentRecoveryEvidence,
  DnaOpenLabP5ComponentRecoveryScenarios,
} from "@/lib/dna-open-lab-p5-component-recovery-executor";
import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "@/lib/dna-open-lab-p5-private-preview-recovery";
import {
  DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_SUITE_AUTHORITY,
  runGuardedDnaOpenLabP5PrivatePreviewRecoverySuite,
} from "@/lib/dna-open-lab-p5-private-preview-recovery-suite";
import { DNA_OPEN_LAB_P5_RECOVERY_CASES } from "@/lib/dna-open-lab-p5-recovery-harness";

const codeHeadSha = "a".repeat(40);
const checkpointSha = "1".repeat(64);
const evidenceSha = "2".repeat(64);
const receiptSha = "3".repeat(64);
const retrySha = "4".repeat(64);
const oldPlanSha = "5".repeat(64);
const newPlanSha = "6".repeat(64);

const common = Object.freeze({
  apiRequestCount: 0,
  syntheticProviderWriteCount: 0,
  persistentOwnerDataWriteCount: 0 as const,
  residueObjectCount: 0 as const,
  rawPayloadIncluded: false as const,
  secretMaterialIncluded: false as const,
  lastGoodGenerationBefore: "generation-last-good",
  lastGoodGenerationAfter: "generation-last-good",
  expectedCheckpointSha256: checkpointSha,
  recoveredCheckpointSha256: checkpointSha,
  expectedEvidenceSha256: evidenceSha,
  readBackEvidenceSha256: evidenceSha,
  retryBoundaryAt: "2026-08-31T14:00:00.000Z",
  firstRetryAt: "2026-08-31T14:00:01.000Z",
  catchUpStarted: true,
  catchUpCompleted: true,
  summary: "Bounded ordered-suite recovery evidence.",
});

const passingEvidence = [
  {
    ...common,
    caseId: "crash_after_evidence_write",
    firstReceiptSha256: receiptSha,
    replayReceiptSha256: receiptSha,
    checkpointRevisionBefore: 7,
    checkpointRevisionAfter: 8,
    objectCountBefore: 1,
    objectCountAfter: 1,
  },
  {
    ...common,
    caseId: "concurrent_checkpoint_advancement",
    winningWriterAccepted: true,
    losingWriterAccepted: false,
    servingGenerationBefore: "generation-last-good",
    servingGenerationAfter: "generation-last-good",
  },
  {
    ...common,
    caseId: "rate_limited_retry_after",
    rateLimitedAt: "2026-08-31T14:00:00.000Z",
    retryAfterSeconds: 1,
    attemptedRetryAt: ["2026-08-31T14:00:01.000Z"],
  },
  {
    ...common,
    caseId: "lower_rate_allowance",
    configuredAggregateCeiling: 30,
    observedAllowance: 12,
    appliedAllowance: 12,
  },
  {
    ...common,
    caseId: "eligibility_loss",
    catchUpStarted: false,
    catchUpCompleted: false,
    syncStateAfter: "paused",
    destructiveResetCount: 0,
    cachedServingGeneration: "generation-last-good",
  },
  {
    ...common,
    caseId: "eligibility_reinstatement",
    checkpointSha256BeforeResume: checkpointSha,
    checkpointSha256UsedForResume: checkpointSha,
    indexedPublicationCount: 1,
    syncStateAfter: "current",
  },
  {
    ...common,
    caseId: "api_outage_or_invalid_body",
    httpStatus: 200,
    responseBodyStatus: "error",
    acceptedCandidateCount: 0,
  },
  {
    ...common,
    caseId: "missing_or_conflicting_evidence",
    expectedReceiptSha256: receiptSha,
    presentedReceiptSha256: retrySha,
    neonStagingAttemptCount: 0,
  },
  {
    ...common,
    caseId: "atomic_publication_failure",
    servingGenerationBefore: "generation-last-good",
    servingGenerationAfterFailure: "generation-last-good",
    canonicalCommitCount: 0,
    receiptIndexCommitCount: 0,
    firstAttemptSha256: retrySha,
    retryAttemptSha256: retrySha,
  },
  {
    ...common,
    caseId: "dynamic_plan_drift",
    checkpointPlanSha256: oldPlanSha,
    currentPlanSha256: newPlanSha,
    cachedReceiptReuseCount: 0,
    replacementCycleStarted: true,
  },
] as const satisfies readonly DnaOpenLabP5ComponentRecoveryEvidence[];

function scenarios(input: { failCase?: string } = {}) {
  const byCase = new Map(passingEvidence.map((item) => [item.caseId, item]));
  const calls: string[] = [];
  const values = Object.fromEntries(
    DNA_OPEN_LAB_P5_RECOVERY_CASES.map((caseId) => [
      caseId,
      vi.fn(async () => {
        calls.push(caseId);
        if (input.failCase === caseId)
          throw new Error("private scenario failure");
        const evidence = byCase.get(caseId);
        if (evidence === undefined) throw new Error("missing evidence");
        return evidence;
      }),
    ]),
  ) as unknown as DnaOpenLabP5ComponentRecoveryScenarios;
  return { calls, values };
}

function snapshot(): DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot {
  return Object.freeze({
    ownerDataSha256: "7".repeat(64),
    checkpointStateSha256: "8".repeat(64),
    servingStateSha256: "9".repeat(64),
    retainedEvidenceSha256: "a".repeat(64),
    persistentOwnerDataRowCount: 0,
    syntheticResidueObjectCount: 0,
  });
}

function fixture(input: { failCase?: string } = {}) {
  const scenarioSet = scenarios(input);
  const inspectProviderSafety = vi.fn(async () => snapshot());
  const cleanupSyntheticCase = vi.fn(async () => undefined);
  const emitted: string[] = [];
  const emitEvidence = vi.fn(async (value: string) => {
    emitted.push(value);
  });
  const executedAt = vi.fn(
    (caseId: (typeof DNA_OPEN_LAB_P5_RECOVERY_CASES)[number]) => {
      const offset = DNA_OPEN_LAB_P5_RECOVERY_CASES.indexOf(caseId);
      return new Date(Date.UTC(2026, 7, 31, 14, 0, offset)).toISOString();
    },
  );
  return {
    ...scenarioSet,
    inspectProviderSafety,
    cleanupSyntheticCase,
    emitted,
    emitEvidence,
    executedAt,
  };
}

describe("DNA Open Lab P5 guarded private Preview recovery suite", () => {
  it("runs all ten cases in order with a separate cleanup guard", async () => {
    const test = fixture();
    const result = await runGuardedDnaOpenLabP5PrivatePreviewRecoverySuite({
      authority: DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_SUITE_AUTHORITY,
      expectedCodeHeadSha: codeHeadSha,
      actualCodeHeadSha: codeHeadSha,
      checkpoint: null,
      executedAt: test.executedAt,
      scenarios: test.values,
      inspectProviderSafety: test.inspectProviderSafety,
      cleanupSyntheticCase: test.cleanupSyntheticCase,
      emitEvidence: test.emitEvidence,
    });

    expect(test.calls).toEqual(DNA_OPEN_LAB_P5_RECOVERY_CASES);
    expect(test.inspectProviderSafety).toHaveBeenCalledTimes(20);
    expect(test.cleanupSyntheticCase).toHaveBeenCalledTimes(10);
    expect(test.emitEvidence).toHaveBeenCalledTimes(10);
    expect(result.evidence).toHaveLength(10);
    expect(result.checkpoint.results).toHaveLength(10);
    expect(result.final.evidence).toMatchObject({
      completedCaseId: "dynamic_plan_drift",
      completedCaseCount: 10,
      recoveryComplete: true,
      reportPassed: true,
      connectedRecoveryEvidenceComplete: true,
      readyToUpdateP5RecoveryRows: true,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
    });
    expect(
      test.emitted.map((value) => JSON.parse(value).completedCaseId),
    ).toEqual(DNA_OPEN_LAB_P5_RECOVERY_CASES);
  });

  it("resumes from the exact ordered checkpoint without replaying passed cases", async () => {
    const initial = fixture();
    const complete = await runGuardedDnaOpenLabP5PrivatePreviewRecoverySuite({
      authority: DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_SUITE_AUTHORITY,
      expectedCodeHeadSha: codeHeadSha,
      actualCodeHeadSha: codeHeadSha,
      checkpoint: null,
      executedAt: initial.executedAt,
      scenarios: initial.values,
      inspectProviderSafety: initial.inspectProviderSafety,
      cleanupSyntheticCase: initial.cleanupSyntheticCase,
      emitEvidence: initial.emitEvidence,
    });
    const checkpoint = Object.freeze({
      ...complete.checkpoint,
      results: Object.freeze(complete.checkpoint.results.slice(0, 4)),
    });
    const resumed = fixture();
    const result = await runGuardedDnaOpenLabP5PrivatePreviewRecoverySuite({
      authority: DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_SUITE_AUTHORITY,
      expectedCodeHeadSha: codeHeadSha,
      actualCodeHeadSha: codeHeadSha,
      checkpoint,
      executedAt: resumed.executedAt,
      scenarios: resumed.values,
      inspectProviderSafety: resumed.inspectProviderSafety,
      cleanupSyntheticCase: resumed.cleanupSyntheticCase,
      emitEvidence: resumed.emitEvidence,
    });

    expect(resumed.calls).toEqual(DNA_OPEN_LAB_P5_RECOVERY_CASES.slice(4));
    expect(resumed.cleanupSyntheticCase).toHaveBeenCalledTimes(6);
    expect(result.evidence).toHaveLength(6);
    expect(result.checkpoint.results).toHaveLength(10);
  });

  it("stops before later cases and emits nothing for the failing case", async () => {
    const test = fixture({ failCase: "lower_rate_allowance" });
    await expect(
      runGuardedDnaOpenLabP5PrivatePreviewRecoverySuite({
        authority: DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_SUITE_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        actualCodeHeadSha: codeHeadSha,
        checkpoint: null,
        executedAt: test.executedAt,
        scenarios: test.values,
        inspectProviderSafety: test.inspectProviderSafety,
        cleanupSyntheticCase: test.cleanupSyntheticCase,
        emitEvidence: test.emitEvidence,
      }),
    ).rejects.toThrow("guarded private Preview recovery case failed");

    expect(test.calls).toEqual(DNA_OPEN_LAB_P5_RECOVERY_CASES.slice(0, 4));
    expect(test.cleanupSyntheticCase).toHaveBeenCalledTimes(4);
    expect(test.emitEvidence).toHaveBeenCalledTimes(3);
  });
});
