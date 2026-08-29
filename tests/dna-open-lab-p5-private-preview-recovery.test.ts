import { describe, expect, it, vi } from "vitest";

import type {
  DnaOpenLabP5ComponentRecoveryEvidence,
  DnaOpenLabP5ComponentRecoveryScenarios,
} from "@/lib/dna-open-lab-p5-component-recovery-executor";
import {
  DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY,
  runGuardedDnaOpenLabP5PrivatePreviewRecoveryCase,
  type DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot,
} from "@/lib/dna-open-lab-p5-private-preview-recovery";

const codeHeadSha = "a".repeat(40);
const privateProviderError = "private-provider-error-do-not-emit";

function componentEvidence(): Extract<
  DnaOpenLabP5ComponentRecoveryEvidence,
  { caseId: "crash_after_evidence_write" }
> {
  return Object.freeze({
    caseId: "crash_after_evidence_write",
    apiRequestCount: 0,
    syntheticProviderWriteCount: 2,
    persistentOwnerDataWriteCount: 0,
    residueObjectCount: 0,
    rawPayloadIncluded: false,
    secretMaterialIncluded: false,
    lastGoodGenerationBefore: "last-good-generation",
    lastGoodGenerationAfter: "last-good-generation",
    expectedCheckpointSha256: "b".repeat(64),
    recoveredCheckpointSha256: "b".repeat(64),
    expectedEvidenceSha256: "c".repeat(64),
    readBackEvidenceSha256: "c".repeat(64),
    retryBoundaryAt: "2026-08-29T04:00:00.000Z",
    firstRetryAt: "2026-08-29T04:00:01.000Z",
    catchUpStarted: true,
    catchUpCompleted: true,
    summary: privateProviderError,
    firstReceiptSha256: "d".repeat(64),
    replayReceiptSha256: "d".repeat(64),
    checkpointRevisionBefore: 7,
    checkpointRevisionAfter: 8,
    objectCountBefore: 2,
    objectCountAfter: 2,
  });
}

function scenarios(
  input: {
    execute?: () => Promise<DnaOpenLabP5ComponentRecoveryEvidence>;
  } = {},
): DnaOpenLabP5ComponentRecoveryScenarios {
  const execute = input.execute ?? (async () => componentEvidence());
  return new Proxy({} as DnaOpenLabP5ComponentRecoveryScenarios, {
    get: () => execute,
  });
}

function snapshot(
  overrides: Partial<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot> = {},
): DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot {
  return Object.freeze({
    ownerDataSha256: "1".repeat(64),
    checkpointStateSha256: "2".repeat(64),
    servingStateSha256: "3".repeat(64),
    retainedEvidenceSha256: "4".repeat(64),
    persistentOwnerDataRowCount: 0,
    syntheticResidueObjectCount: 0,
    ...overrides,
  });
}

function fixture(
  input: {
    snapshots?: readonly DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot[];
    execute?: () => Promise<DnaOpenLabP5ComponentRecoveryEvidence>;
    cleanup?: () => Promise<void>;
  } = {},
) {
  const values = [...(input.snapshots ?? [snapshot(), snapshot()])];
  const order: string[] = [];
  const inspectProviderSafety = vi.fn(async () => {
    order.push("inspect");
    const value = values.shift();
    if (value === undefined) throw new Error("missing snapshot");
    return value;
  });
  const cleanupSyntheticCase = vi.fn(async () => {
    order.push("cleanup");
    await input.cleanup?.();
  });
  const emitEvidence = vi.fn(async (canonicalJson: string) => {
    order.push("emit");
    void canonicalJson;
  });
  return {
    order,
    inspectProviderSafety,
    cleanupSyntheticCase,
    emitEvidence,
    scenarios: scenarios(input.execute ? { execute: input.execute } : {}),
  };
}

describe("DNA Open Lab P5 guarded private Preview recovery", () => {
  it("emits only after cleanup and unchanged provider-state proof", async () => {
    const test = fixture();
    const result = await runGuardedDnaOpenLabP5PrivatePreviewRecoveryCase({
      authority: DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY,
      expectedCodeHeadSha: codeHeadSha,
      actualCodeHeadSha: codeHeadSha,
      executedAt: "2026-08-29T04:00:00.000Z",
      checkpoint: null,
      scenarios: test.scenarios,
      inspectProviderSafety: test.inspectProviderSafety,
      cleanupSyntheticCase: test.cleanupSyntheticCase,
      emitEvidence: test.emitEvidence,
    });

    expect(result.evidence).toMatchObject({
      completedCaseId: "crash_after_evidence_write",
      casePassed: true,
      connectedRecoveryEvidenceComplete: false,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
    });
    expect(test.order).toEqual(["inspect", "cleanup", "inspect", "emit"]);
    const emitted = test.emitEvidence.mock.calls[0]?.[0] ?? "";
    expect(emitted).not.toContain(privateProviderError);
    expect(JSON.parse(emitted)).toEqual(result.evidence);
  });

  it("runs cleanup after a scenario failure and emits nothing", async () => {
    const test = fixture({
      execute: async () => {
        throw new Error(privateProviderError);
      },
    });
    await expect(
      runGuardedDnaOpenLabP5PrivatePreviewRecoveryCase({
        authority: DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        actualCodeHeadSha: codeHeadSha,
        executedAt: "2026-08-29T04:00:00.000Z",
        checkpoint: null,
        scenarios: test.scenarios,
        inspectProviderSafety: test.inspectProviderSafety,
        cleanupSyntheticCase: test.cleanupSyntheticCase,
        emitEvidence: test.emitEvidence,
      }),
    ).rejects.toThrow("guarded private Preview recovery case failed");
    expect(test.cleanupSyntheticCase).toHaveBeenCalledOnce();
    expect(test.inspectProviderSafety).toHaveBeenCalledTimes(2);
    expect(test.emitEvidence).not.toHaveBeenCalled();
  });

  it("fails closed on provider drift, residue or cleanup failure", async () => {
    const fixtures = [
      fixture({
        snapshots: [snapshot(), snapshot({ ownerDataSha256: "5".repeat(64) })],
      }),
      fixture({
        snapshots: [snapshot(), snapshot({ syntheticResidueObjectCount: 1 })],
      }),
      fixture({
        cleanup: async () => {
          throw new Error(privateProviderError);
        },
      }),
    ];
    for (const test of fixtures) {
      await expect(
        runGuardedDnaOpenLabP5PrivatePreviewRecoveryCase({
          authority: DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY,
          expectedCodeHeadSha: codeHeadSha,
          actualCodeHeadSha: codeHeadSha,
          executedAt: "2026-08-29T04:00:00.000Z",
          checkpoint: null,
          scenarios: test.scenarios,
          inspectProviderSafety: test.inspectProviderSafety,
          cleanupSyntheticCase: test.cleanupSyntheticCase,
          emitEvidence: test.emitEvidence,
        }),
      ).rejects.toThrow("guarded private Preview recovery case failed");
      expect(test.emitEvidence).not.toHaveBeenCalled();
    }
  });

  it("rejects existing residue and exact-head drift before a scenario runs", async () => {
    const residue = fixture({
      snapshots: [snapshot({ syntheticResidueObjectCount: 1 })],
    });
    await expect(
      runGuardedDnaOpenLabP5PrivatePreviewRecoveryCase({
        authority: DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        actualCodeHeadSha: codeHeadSha,
        executedAt: "2026-08-29T04:00:00.000Z",
        checkpoint: null,
        scenarios: residue.scenarios,
        inspectProviderSafety: residue.inspectProviderSafety,
        cleanupSyntheticCase: residue.cleanupSyntheticCase,
        emitEvidence: residue.emitEvidence,
      }),
    ).rejects.toThrow("guarded private Preview recovery case failed");
    expect(residue.cleanupSyntheticCase).not.toHaveBeenCalled();

    const drift = fixture();
    await expect(
      runGuardedDnaOpenLabP5PrivatePreviewRecoveryCase({
        authority: DNA_OPEN_LAB_P5_PRIVATE_PREVIEW_RECOVERY_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        actualCodeHeadSha: "f".repeat(40),
        executedAt: "2026-08-29T04:00:00.000Z",
        checkpoint: null,
        scenarios: drift.scenarios,
        inspectProviderSafety: drift.inspectProviderSafety,
        cleanupSyntheticCase: drift.cleanupSyntheticCase,
        emitEvidence: drift.emitEvidence,
      }),
    ).rejects.toThrow("guarded private Preview recovery case failed");
    expect(drift.inspectProviderSafety).not.toHaveBeenCalled();
    expect(drift.cleanupSyntheticCase).not.toHaveBeenCalled();
  });
});
