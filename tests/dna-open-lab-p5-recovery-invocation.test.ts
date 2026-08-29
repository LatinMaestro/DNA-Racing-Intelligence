import { describe, expect, it, vi } from "vitest";

import {
  DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY,
  invokeDnaOpenLabP5PrivatePreviewRecoveryCase,
} from "@/lib/dna-open-lab-p5-recovery-invocation";
import {
  DNA_OPEN_LAB_P5_RECOVERY_CASES,
  type DnaOpenLabP5RecoveryCheckpoint,
  type DnaOpenLabP5RecoveryObservation,
} from "@/lib/dna-open-lab-p5-recovery-harness";

const codeHeadSha = "a".repeat(40);
const providerSecret = "private-provider-secret-do-not-emit";
const ownerIdentity = "private-owner-identity-do-not-emit";

function observation(
  caseId: (typeof DNA_OPEN_LAB_P5_RECOVERY_CASES)[number],
  overrides: Partial<DnaOpenLabP5RecoveryObservation> = {},
): DnaOpenLabP5RecoveryObservation {
  return Object.freeze({
    caseId,
    outcome: "passed",
    apiRequestCount: 0,
    syntheticProviderWriteCount: 2,
    persistentOwnerDataWriteCount: 0,
    residueObjectCount: 0,
    rawPayloadIncluded: false,
    secretMaterialIncluded: false,
    lastGoodPreserved: true,
    checkpointRecovered: true,
    immutableEvidenceVerified: true,
    retryBoundaryObserved: true,
    catchUpCompleted: true,
    summary: `${providerSecret} ${ownerIdentity}`,
    ...overrides,
  });
}

describe("DNA Open Lab P5 connected recovery invocation", () => {
  it("emits one bounded hash-addressed whitelist record per case", async () => {
    const runCase = vi.fn(async (caseId) => observation(caseId));
    const emitEvidence = vi.fn(async (canonicalJson: string) => {
      void canonicalJson;
    });

    const result = await invokeDnaOpenLabP5PrivatePreviewRecoveryCase({
      authority: DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY,
      expectedCodeHeadSha: codeHeadSha,
      actualCodeHeadSha: codeHeadSha,
      executedAt: "2026-08-29T03:00:00.000Z",
      checkpoint: null,
      runCase,
      emitEvidence,
    });

    expect(result.evidence).toMatchObject({
      evidenceKind: "dna_open_lab_p5_private_preview_recovery_case",
      codeHeadSha,
      providerScope: "private_preview",
      completedCaseId: "crash_after_evidence_write",
      nextCaseId: "concurrent_checkpoint_advancement",
      completedCaseCount: 1,
      totalCaseCount: 10,
      casePassed: true,
      recoveryComplete: false,
      reportPassed: null,
      connectedRecoveryEvidenceComplete: false,
      readyToUpdateP5RecoveryRows: false,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
    });
    expect(result.evidence.evidenceSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.evidence.checkpointSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.evidence.reportSha256).toBeNull();
    expect(runCase).toHaveBeenCalledOnce();
    expect(emitEvidence).toHaveBeenCalledOnce();
    const emitted = emitEvidence.mock.calls[0]?.[0] ?? "";
    expect(Buffer.byteLength(emitted, "utf8")).toBeLessThanOrEqual(16_384);
    expect(JSON.parse(emitted)).toEqual(result.evidence);
    expect(emitted).not.toContain(providerSecret);
    expect(emitted).not.toContain(ownerIdentity);
    expect(emitted).not.toContain("summary");
  });

  it("completes the fixed sequence without promoting a failed report", async () => {
    let checkpoint: DnaOpenLabP5RecoveryCheckpoint | null = null;
    const emitted: string[] = [];
    let final: Awaited<
      ReturnType<typeof invokeDnaOpenLabP5PrivatePreviewRecoveryCase>
    > | null = null;

    for (const expectedCaseId of DNA_OPEN_LAB_P5_RECOVERY_CASES) {
      final = await invokeDnaOpenLabP5PrivatePreviewRecoveryCase({
        authority: DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        actualCodeHeadSha: codeHeadSha,
        executedAt: "2026-08-29T03:00:00.000Z",
        checkpoint,
        runCase: async (caseId) => {
          expect(caseId).toBe(expectedCaseId);
          return observation(caseId, {
            outcome:
              caseId === "atomic_publication_failure" ? "failed" : "passed",
          });
        },
        emitEvidence: async (canonicalJson) => {
          emitted.push(canonicalJson);
        },
      });
      checkpoint = final.checkpoint;
    }

    expect(emitted).toHaveLength(10);
    expect(final?.evidence).toMatchObject({
      completedCaseId: "dynamic_plan_drift",
      nextCaseId: null,
      completedCaseCount: 10,
      recoveryComplete: true,
      reportPassed: false,
      connectedRecoveryEvidenceComplete: false,
      readyToUpdateP5RecoveryRows: false,
    });
    expect(final?.evidence.reportSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("marks only a complete passing private-Preview report ready", async () => {
    let checkpoint: DnaOpenLabP5RecoveryCheckpoint | null = null;
    let final: Awaited<
      ReturnType<typeof invokeDnaOpenLabP5PrivatePreviewRecoveryCase>
    > | null = null;
    for (const expectedCaseId of DNA_OPEN_LAB_P5_RECOVERY_CASES) {
      final = await invokeDnaOpenLabP5PrivatePreviewRecoveryCase({
        authority: DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        actualCodeHeadSha: codeHeadSha,
        executedAt: "2026-08-29T03:00:00.000Z",
        checkpoint,
        runCase: async (caseId) => {
          expect(caseId).toBe(expectedCaseId);
          return observation(caseId);
        },
        emitEvidence: async () => undefined,
      });
      checkpoint = final.checkpoint;
    }
    expect(final?.evidence).toMatchObject({
      recoveryComplete: true,
      reportPassed: true,
      connectedRecoveryEvidenceComplete: true,
      readyToUpdateP5RecoveryRows: true,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
    });
  });

  it("fails before scenario access on authority or exact-head drift", async () => {
    const runCase = vi.fn(async (caseId) => observation(caseId));
    const emitEvidence = vi.fn(async (canonicalJson: string) => {
      void canonicalJson;
    });
    for (const input of [
      {
        authority:
          "wrong" as typeof DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY,
        actualCodeHeadSha: codeHeadSha,
      },
      {
        authority: DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY,
        actualCodeHeadSha: "b".repeat(40),
      },
    ]) {
      await expect(
        invokeDnaOpenLabP5PrivatePreviewRecoveryCase({
          authority: input.authority,
          expectedCodeHeadSha: codeHeadSha,
          actualCodeHeadSha: input.actualCodeHeadSha,
          executedAt: "2026-08-29T03:00:00.000Z",
          checkpoint: null,
          runCase,
          emitEvidence,
        }),
      ).rejects.toThrow("private Preview recovery invocation failed");
    }
    expect(runCase).not.toHaveBeenCalled();
    expect(emitEvidence).not.toHaveBeenCalled();
  });

  it("sanitizes scenario and emitter failures", async () => {
    await expect(
      invokeDnaOpenLabP5PrivatePreviewRecoveryCase({
        authority: DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        actualCodeHeadSha: codeHeadSha,
        executedAt: "2026-08-29T03:00:00.000Z",
        checkpoint: null,
        runCase: async () => {
          throw new Error(providerSecret);
        },
        emitEvidence: async () => undefined,
      }),
    ).rejects.toThrow(
      "DNA Open Lab P5 private Preview recovery invocation failed.",
    );

    await expect(
      invokeDnaOpenLabP5PrivatePreviewRecoveryCase({
        authority: DNA_OPEN_LAB_P5_RECOVERY_INVOCATION_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        actualCodeHeadSha: codeHeadSha,
        executedAt: "2026-08-29T03:00:00.000Z",
        checkpoint: null,
        runCase: async (caseId) => observation(caseId),
        emitEvidence: async () => {
          throw new Error(ownerIdentity);
        },
      }),
    ).rejects.toThrow(
      "DNA Open Lab P5 private Preview recovery invocation failed.",
    );
  });
});
