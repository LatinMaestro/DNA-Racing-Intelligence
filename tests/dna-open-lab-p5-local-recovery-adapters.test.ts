import { describe, expect, it, vi } from "vitest";

import {
  adaptDnaOpenLabP5LocalRecoveryTrace,
  createDnaOpenLabP5LocalRecoveryCaseRunner,
  type DnaOpenLabP5LocalRecoveryTrace,
} from "@/lib/dna-open-lab-p5-local-recovery-adapters";
import { DNA_OPEN_LAB_P5_RECOVERY_CASES } from "@/lib/dna-open-lab-p5-recovery-harness";

const common = Object.freeze({
  apiRequestCount: 1,
  syntheticProviderWriteCount: 0,
  persistentOwnerDataWriteCount: 0 as const,
  residueObjectCount: 0 as const,
  rawPayloadIncluded: false as const,
  secretMaterialIncluded: false as const,
  lastGoodPreserved: true,
  checkpointRecovered: true,
  immutableEvidenceVerified: true,
  retryBoundaryObserved: true,
  catchUpCompleted: true,
  summary: "Synthetic case-specific recovery evidence.",
});

const passingTraces = [
  {
    ...common,
    caseId: "crash_after_evidence_write",
    replayReturnedOriginalReceipt: true,
    checkpointAdvanceCount: 1,
    duplicateObjectCount: 0,
  },
  {
    ...common,
    caseId: "concurrent_checkpoint_advancement",
    losingWriterRejected: true,
    servingGenerationChanged: false,
  },
  {
    ...common,
    caseId: "rate_limited_retry_after",
    retryAfterSeconds: 17,
    immediateRetryCount: 0,
  },
  {
    ...common,
    caseId: "lower_rate_allowance",
    configuredAggregateCeiling: 30,
    observedAllowance: 12,
    effectiveAllowance: 12,
  },
  {
    ...common,
    caseId: "eligibility_loss",
    syncPaused: true,
    destructiveResetPerformed: false,
    cachedSiteAvailable: true,
  },
  {
    ...common,
    caseId: "eligibility_reinstatement",
    resumedFromDurableAuthority: true,
    indexedPublicationCompleted: true,
    pauseClearedAfterPublication: true,
  },
  {
    ...common,
    caseId: "api_outage_or_invalid_body",
    responseBodyAuthorityPreserved: true,
    partialCandidatePublished: false,
  },
  {
    ...common,
    caseId: "missing_or_conflicting_evidence",
    conflictingEvidenceRejected: true,
    neonStagingAttemptCount: 0,
  },
  {
    ...common,
    caseId: "atomic_publication_failure",
    servingPointerChanged: false,
    receiptIndexSplit: false,
    retryIdempotent: true,
  },
  {
    ...common,
    caseId: "dynamic_plan_drift",
    cachedReceiptReuseCount: 0,
    fullCycleRequired: true,
  },
] as const satisfies readonly DnaOpenLabP5LocalRecoveryTrace[];

describe("DNA Open Lab P5 local recovery adapters", () => {
  it("requires the exact outcome for every accepted recovery case", () => {
    expect(passingTraces.map((trace) => trace.caseId)).toEqual(
      DNA_OPEN_LAB_P5_RECOVERY_CASES,
    );
    expect(
      passingTraces.map((trace) => adaptDnaOpenLabP5LocalRecoveryTrace(trace)),
    ).toEqual(
      passingTraces.map((trace) =>
        expect.objectContaining({ caseId: trace.caseId, outcome: "passed" }),
      ),
    );
  });

  it("fails each case when its decisive assertion is absent", () => {
    const failures: readonly DnaOpenLabP5LocalRecoveryTrace[] = [
      { ...passingTraces[0]!, duplicateObjectCount: 1 },
      { ...passingTraces[1]!, losingWriterRejected: false },
      { ...passingTraces[2]!, immediateRetryCount: 1 },
      { ...passingTraces[3]!, effectiveAllowance: 30 },
      { ...passingTraces[4]!, destructiveResetPerformed: true },
      { ...passingTraces[5]!, pauseClearedAfterPublication: false },
      { ...passingTraces[6]!, partialCandidatePublished: true },
      { ...passingTraces[7]!, neonStagingAttemptCount: 1 },
      { ...passingTraces[8]!, receiptIndexSplit: true },
      { ...passingTraces[9]!, cachedReceiptReuseCount: 1 },
    ];
    expect(
      failures.map(
        (trace) => adaptDnaOpenLabP5LocalRecoveryTrace(trace).outcome,
      ),
    ).toEqual(Array.from({ length: 10 }, () => "failed"));
  });

  it("does not let case-specific success override a common recovery failure", () => {
    const trace = {
      ...passingTraces[0]!,
      lastGoodPreserved: false,
    };
    expect(adaptDnaOpenLabP5LocalRecoveryTrace(trace)).toMatchObject({
      outcome: "failed",
      lastGoodPreserved: false,
    });
  });

  it("binds an executor result to the requested case", async () => {
    const executeCase = vi.fn(async () => passingTraces[0]!);
    const runner = createDnaOpenLabP5LocalRecoveryCaseRunner({ executeCase });
    await expect(runner("crash_after_evidence_write")).resolves.toMatchObject({
      caseId: "crash_after_evidence_write",
      outcome: "passed",
    });
    await expect(runner("rate_limited_retry_after")).rejects.toThrow(
      "expected rate_limited_retry_after, received crash_after_evidence_write",
    );
    expect(executeCase).toHaveBeenCalledTimes(2);
  });
});
