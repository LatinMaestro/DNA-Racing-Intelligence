import { describe, expect, it, vi } from "vitest";

import {
  createDnaOpenLabP5ComponentRecoveryCaseRunner,
  type DnaOpenLabP5ComponentRecoveryEvidence,
  type DnaOpenLabP5ComponentRecoveryScenarios,
} from "@/lib/dna-open-lab-p5-component-recovery-executor";
import { DNA_OPEN_LAB_P5_RECOVERY_CASES } from "@/lib/dna-open-lab-p5-recovery-harness";

const checkpointSha = "1".repeat(64);
const evidenceSha = "2".repeat(64);
const receiptSha = "3".repeat(64);
const retrySha = "4".repeat(64);
const oldPlanSha = "5".repeat(64);
const newPlanSha = "6".repeat(64);

const common = Object.freeze({
  apiRequestCount: 1,
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
  retryBoundaryAt: "2026-08-28T19:00:17.000Z",
  firstRetryAt: "2026-08-28T19:00:17.000Z",
  catchUpStarted: true,
  catchUpCompleted: true,
  summary: "Component-derived synthetic recovery evidence.",
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
    rateLimitedAt: "2026-08-28T19:00:00.000Z",
    retryAfterSeconds: 17,
    attemptedRetryAt: ["2026-08-28T19:00:17.000Z"],
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

function scenarios(
  evidence: readonly DnaOpenLabP5ComponentRecoveryEvidence[] = passingEvidence,
): DnaOpenLabP5ComponentRecoveryScenarios {
  const byCase = new Map(evidence.map((item) => [item.caseId, item]));
  return Object.fromEntries(
    DNA_OPEN_LAB_P5_RECOVERY_CASES.map((caseId) => [
      caseId,
      vi.fn(async () => {
        const result = byCase.get(caseId);
        if (result === undefined) throw new Error(`Missing ${caseId}`);
        return result;
      }),
    ]),
  ) as unknown as DnaOpenLabP5ComponentRecoveryScenarios;
}

describe("DNA Open Lab P5 component recovery executor", () => {
  it("derives a passing trace for all ten raw component scenarios", async () => {
    const scenarioSet = scenarios();
    const runner = createDnaOpenLabP5ComponentRecoveryCaseRunner({
      scenarios: scenarioSet,
    });

    const observations = [];
    for (const caseId of DNA_OPEN_LAB_P5_RECOVERY_CASES) {
      observations.push(await runner(caseId));
    }

    expect(observations).toEqual(
      DNA_OPEN_LAB_P5_RECOVERY_CASES.map((caseId) =>
        expect.objectContaining({ caseId, outcome: "passed" }),
      ),
    );
    for (const caseId of DNA_OPEN_LAB_P5_RECOVERY_CASES) {
      expect(scenarioSet[caseId]).toHaveBeenCalledTimes(1);
    }
  });

  it("fails when raw component outcomes do not prove each decisive case", async () => {
    const failures: readonly DnaOpenLabP5ComponentRecoveryEvidence[] = [
      { ...passingEvidence[0]!, objectCountAfter: 2 },
      { ...passingEvidence[1]!, losingWriterAccepted: true },
      {
        ...passingEvidence[2]!,
        attemptedRetryAt: ["2026-08-28T19:00:16.999Z"],
      },
      { ...passingEvidence[3]!, appliedAllowance: 30 },
      {
        ...passingEvidence[4]!,
        catchUpStarted: true,
        catchUpCompleted: true,
      },
      { ...passingEvidence[5]!, indexedPublicationCount: 0 },
      { ...passingEvidence[6]!, acceptedCandidateCount: 1 },
      { ...passingEvidence[7]!, neonStagingAttemptCount: 1 },
      {
        ...passingEvidence[8]!,
        canonicalCommitCount: 1,
        receiptIndexCommitCount: 1,
      },
      { ...passingEvidence[9]!, cachedReceiptReuseCount: 1 },
    ];
    const runner = createDnaOpenLabP5ComponentRecoveryCaseRunner({
      scenarios: scenarios(failures),
    });

    const outcomes = [];
    for (const caseId of DNA_OPEN_LAB_P5_RECOVERY_CASES) {
      outcomes.push((await runner(caseId)).outcome);
    }
    expect(outcomes).toEqual(Array.from({ length: 10 }, () => "failed"));
  });

  it("derives common assertions from identities, pointers and timestamps", async () => {
    const runner = createDnaOpenLabP5ComponentRecoveryCaseRunner({
      scenarios: scenarios([
        {
          ...passingEvidence[0]!,
          lastGoodGenerationAfter: "generation-partial",
          recoveredCheckpointSha256: "7".repeat(64),
          readBackEvidenceSha256: "8".repeat(64),
          firstRetryAt: "2026-08-28T19:00:16.999Z",
          catchUpCompleted: false,
        },
        ...passingEvidence.slice(1),
      ]),
    });

    await expect(runner("crash_after_evidence_write")).resolves.toMatchObject({
      outcome: "failed",
      lastGoodPreserved: false,
      checkpointRecovered: false,
      immutableEvidenceVerified: false,
      retryBoundaryObserved: false,
      catchUpCompleted: false,
    });
  });

  it("treats a provider outage as authoritative without requiring unusual HTTP 200", async () => {
    const runner = createDnaOpenLabP5ComponentRecoveryCaseRunner({
      scenarios: scenarios([
        ...passingEvidence.slice(0, 6),
        {
          ...passingEvidence[6]!,
          httpStatus: 503,
          responseBodyStatus: "unavailable",
        },
        ...passingEvidence.slice(7),
      ]),
    });
    await expect(runner("api_outage_or_invalid_body")).resolves.toMatchObject({
      outcome: "passed",
    });

    const successBodyRunner = createDnaOpenLabP5ComponentRecoveryCaseRunner({
      scenarios: scenarios([
        ...passingEvidence.slice(0, 6),
        {
          ...passingEvidence[6]!,
          httpStatus: 503,
          responseBodyStatus: "success",
        },
        ...passingEvidence.slice(7),
      ]),
    });
    await expect(
      successBodyRunner("api_outage_or_invalid_body"),
    ).resolves.toMatchObject({ outcome: "failed" });
  });

  it("binds the requested case and rejects malformed component evidence", async () => {
    const mismatched = scenarios();
    Object.defineProperty(mismatched, "rate_limited_retry_after", {
      value: vi.fn(async () => passingEvidence[0]!),
    });
    const mismatchRunner = createDnaOpenLabP5ComponentRecoveryCaseRunner({
      scenarios: mismatched,
    });
    await expect(mismatchRunner("rate_limited_retry_after")).rejects.toThrow(
      "expected rate_limited_retry_after, received crash_after_evidence_write",
    );

    const malformed = scenarios([
      { ...passingEvidence[0]!, firstReceiptSha256: "not-a-sha" },
      ...passingEvidence.slice(1),
    ]);
    const malformedRunner = createDnaOpenLabP5ComponentRecoveryCaseRunner({
      scenarios: malformed,
    });
    await expect(malformedRunner("crash_after_evidence_write")).rejects.toThrow(
      "firstReceiptSha256 must be an exact SHA-256 value",
    );

    const missingMalformed = scenarios([
      ...passingEvidence.slice(0, 7),
      {
        ...passingEvidence[7]!,
        expectedReceiptSha256: "not-a-sha",
        presentedReceiptSha256: null,
      },
      ...passingEvidence.slice(8),
    ]);
    const missingMalformedRunner =
      createDnaOpenLabP5ComponentRecoveryCaseRunner({
        scenarios: missingMalformed,
      });
    await expect(
      missingMalformedRunner("missing_or_conflicting_evidence"),
    ).rejects.toThrow("expectedReceiptSha256 must be an exact SHA-256 value");
  });
});
