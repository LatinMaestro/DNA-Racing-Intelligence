import { describe, expect, it, vi } from "vitest";

import {
  DNA_OPEN_LAB_P5_RECOVERY_CASES,
  runDnaOpenLabP5RecoveryHarnessStep,
  type DnaOpenLabP5RecoveryCheckpoint,
  type DnaOpenLabP5RecoveryObservation,
} from "@/lib/dna-open-lab-p5-recovery-harness";

const codeHeadSha = "a".repeat(40);
const executedAt = "2026-08-28T17:00:00.000Z";

function observation(
  caseId: (typeof DNA_OPEN_LAB_P5_RECOVERY_CASES)[number],
  overrides: Readonly<
    Partial<Record<keyof DnaOpenLabP5RecoveryObservation, unknown>>
  > = {},
): DnaOpenLabP5RecoveryObservation {
  return Object.freeze({
    caseId,
    outcome: "passed",
    apiRequestCount: 1,
    syntheticProviderWriteCount: 0,
    persistentOwnerDataWriteCount: 0,
    residueObjectCount: 0,
    rawPayloadIncluded: false,
    secretMaterialIncluded: false,
    lastGoodPreserved: true,
    checkpointRecovered: true,
    immutableEvidenceVerified: true,
    retryBoundaryObserved: true,
    catchUpCompleted: true,
    summary: `Synthetic ${caseId} recovery passed without owner data.`,
    ...overrides,
  }) as DnaOpenLabP5RecoveryObservation;
}

describe("DNA Open Lab P5 recovery harness", () => {
  it("runs only the next ordered case per invocation", async () => {
    const runCase = vi.fn(async (caseId) => observation(caseId));

    const result = await runDnaOpenLabP5RecoveryHarnessStep({
      codeHeadSha,
      providerScope: "synthetic_local",
      executedAt,
      checkpoint: null,
      runCase,
    });

    expect(result).toMatchObject({
      kind: "case_completed",
      completedCaseId: "crash_after_evidence_write",
      nextCaseId: "concurrent_checkpoint_advancement",
      checkpoint: {
        results: [{ codeHeadSha, providerScope: "synthetic_local" }],
      },
    });
    expect(runCase).toHaveBeenCalledTimes(1);
  });

  it("creates a complete immutable report after all ten cases", async () => {
    let checkpoint: DnaOpenLabP5RecoveryCheckpoint | null = null;
    let final:
      | Awaited<ReturnType<typeof runDnaOpenLabP5RecoveryHarnessStep>>
      | undefined;

    for (const expectedCase of DNA_OPEN_LAB_P5_RECOVERY_CASES) {
      final = await runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha,
        providerScope: "synthetic_local",
        executedAt,
        checkpoint,
        runCase: async (caseId) => {
          expect(caseId).toBe(expectedCase);
          return observation(caseId);
        },
      });
      checkpoint = final.checkpoint;
    }

    expect(final).toMatchObject({
      kind: "complete",
      report: {
        passed: true,
        codeHeadSha,
        providerScope: "synthetic_local",
        results: DNA_OPEN_LAB_P5_RECOVERY_CASES.map((caseId) => ({ caseId })),
      },
    });
    expect(Object.isFrozen(final?.checkpoint.results)).toBe(true);
  });

  it("retains a failed case without promoting the report", async () => {
    let checkpoint: DnaOpenLabP5RecoveryCheckpoint | null = null;
    let final:
      | Awaited<ReturnType<typeof runDnaOpenLabP5RecoveryHarnessStep>>
      | undefined;
    for (const expectedCase of DNA_OPEN_LAB_P5_RECOVERY_CASES) {
      final = await runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha,
        providerScope: "synthetic_local",
        executedAt,
        checkpoint,
        runCase: async (caseId) =>
          observation(caseId, {
            outcome:
              caseId === "atomic_publication_failure" ? "failed" : "passed",
          }),
      });
      expect(final.checkpoint.results.at(-1)?.caseId).toBe(expectedCase);
      checkpoint = final.checkpoint;
    }
    expect(final).toMatchObject({
      kind: "complete",
      report: { passed: false },
    });
  });

  it("rejects checkpoint head, scope and order drift", async () => {
    const first = await runDnaOpenLabP5RecoveryHarnessStep({
      codeHeadSha,
      providerScope: "synthetic_local",
      executedAt,
      checkpoint: null,
      runCase: async (caseId) => observation(caseId),
    });

    await expect(
      runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha: "b".repeat(40),
        providerScope: "synthetic_local",
        executedAt,
        checkpoint: first.checkpoint,
        runCase: async (caseId) => observation(caseId),
      }),
    ).rejects.toThrow("checkpoint code head changed");
    await expect(
      runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha,
        providerScope: "private_preview",
        executedAt,
        checkpoint: first.checkpoint,
        runCase: async (caseId) => observation(caseId),
      }),
    ).rejects.toThrow("checkpoint provider scope changed");

    const drifted = Object.freeze({
      ...first.checkpoint,
      results: Object.freeze([
        Object.freeze({
          ...first.checkpoint.results[0]!,
          caseId: "rate_limited_retry_after" as const,
        }),
      ]),
    });
    await expect(
      runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha,
        providerScope: "synthetic_local",
        executedAt,
        checkpoint: drifted,
        runCase: async (caseId) => observation(caseId),
      }),
    ).rejects.toThrow("incomplete or out of order");
  });

  it("enforces one API request and bounded synthetic provider writes", async () => {
    await expect(
      runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha,
        providerScope: "synthetic_local",
        executedAt,
        checkpoint: null,
        runCase: async (caseId) => observation(caseId, { apiRequestCount: 2 }),
      }),
    ).rejects.toThrow("apiRequestCount must be an integer between 0 and 1");
    await expect(
      runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha,
        providerScope: "synthetic_local",
        executedAt,
        checkpoint: null,
        runCase: async (caseId) =>
          observation(caseId, { syntheticProviderWriteCount: 1 }),
      }),
    ).rejects.toThrow(
      "syntheticProviderWriteCount must be an integer between 0 and 0",
    );
    await expect(
      runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha,
        providerScope: "private_preview",
        executedAt,
        checkpoint: null,
        runCase: async (caseId) =>
          observation(caseId, { syntheticProviderWriteCount: 5 }),
      }),
    ).rejects.toThrow(
      "syntheticProviderWriteCount must be an integer between 0 and 4",
    );
  });

  it("rejects raw payload, secret and residue evidence", async () => {
    for (const overrides of [
      { rawPayloadIncluded: true },
      { secretMaterialIncluded: true },
      { residueObjectCount: 1 },
    ] as const) {
      await expect(
        runDnaOpenLabP5RecoveryHarnessStep({
          codeHeadSha,
          providerScope: "synthetic_local",
          executedAt,
          checkpoint: null,
          runCase: async (caseId) => observation(caseId, overrides),
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects a passed outcome with an unproven recovery assertion", async () => {
    await expect(
      runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha,
        providerScope: "synthetic_local",
        executedAt,
        checkpoint: null,
        runCase: async (caseId) =>
          observation(caseId, { immutableEvidenceVerified: false }),
      }),
    ).rejects.toThrow("passed outcome requires every recovery assertion");
  });

  it("rejects invalid exact-head and timestamp authority", async () => {
    await expect(
      runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha: "main",
        providerScope: "synthetic_local",
        executedAt,
        checkpoint: null,
        runCase: async (caseId) => observation(caseId),
      }),
    ).rejects.toThrow("exact lowercase 40-character SHA");
    await expect(
      runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha,
        providerScope: "synthetic_local",
        executedAt: "not-a-time",
        checkpoint: null,
        runCase: async (caseId) => observation(caseId),
      }),
    ).rejects.toThrow("timezone-qualified ISO timestamp");
  });

  it("revalidates resumed observations and runtime scope values", async () => {
    const first = await runDnaOpenLabP5RecoveryHarnessStep({
      codeHeadSha,
      providerScope: "synthetic_local",
      executedAt,
      checkpoint: null,
      runCase: async (caseId) => observation(caseId),
    });
    const unsafeCheckpoint = Object.freeze({
      ...first.checkpoint,
      results: Object.freeze([
        Object.freeze({
          ...first.checkpoint.results[0]!,
          lastGoodPreserved: "yes",
        }),
      ]),
    }) as unknown as DnaOpenLabP5RecoveryCheckpoint;

    await expect(
      runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha,
        providerScope: "synthetic_local",
        executedAt,
        checkpoint: unsafeCheckpoint,
        runCase: async (caseId) => observation(caseId),
      }),
    ).rejects.toThrow("lastGoodPreserved must be boolean");
    await expect(
      runDnaOpenLabP5RecoveryHarnessStep({
        codeHeadSha,
        providerScope: "connected_production" as "synthetic_local",
        executedAt,
        checkpoint: null,
        runCase: async (caseId) => observation(caseId),
      }),
    ).rejects.toThrow("providerScope is unsupported");
  });
});
