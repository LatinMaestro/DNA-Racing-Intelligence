import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createDnaOpenLabP5ComponentRecoveryCaseRunner } from "@/lib/dna-open-lab-p5-component-recovery-executor";
import { createDnaOpenLabP5DynamicPlanDriftScenario } from "@/lib/dna-open-lab-p5-dynamic-plan-drift-scenario";
import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "@/lib/dna-open-lab-p5-private-preview-recovery";

const sha = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function fixture(input: { cleanupLeavesResidue?: boolean } = {}) {
  let residue = 0;
  let inspections = 0;
  const inspectProviderSafety =
    async (): Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot> => {
      inspections += 1;
      if (inspections > 1 && input.cleanupLeavesResidue === true) residue = 1;
      return Object.freeze({
        ownerDataSha256: sha("owner"),
        checkpointStateSha256: sha("checkpoint"),
        servingStateSha256: sha("serving"),
        retainedEvidenceSha256: sha("retained"),
        persistentOwnerDataRowCount: 0,
        syntheticResidueObjectCount: residue,
      });
    };
  const cleanupSyntheticCase = vi.fn(async () => undefined);
  const scenario = createDnaOpenLabP5DynamicPlanDriftScenario({
    cycleId: "75000000-0000-4000-8000-000000000600",
    indexedAt: "2026-08-31T13:00:00.000Z",
    evaluatedAt: "2026-08-31T13:02:00.000Z",
    inspectProviderSafety,
    cleanupSyntheticCase,
  });
  return { cleanupSyntheticCase, scenario };
}

describe("DNA Open Lab P5 dynamic plan drift scenario", () => {
  it("invalidates every cached receipt and requires a full replacement cycle", async () => {
    const { cleanupSyntheticCase, scenario } = fixture();
    const evidence = await scenario();

    expect(evidence).toMatchObject({
      caseId: "dynamic_plan_drift",
      apiRequestCount: 0,
      syntheticProviderWriteCount: 0,
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      cachedReceiptReuseCount: 0,
      replacementCycleStarted: true,
      catchUpStarted: true,
      catchUpCompleted: true,
    });
    expect(evidence.checkpointPlanSha256).not.toBe(evidence.currentPlanSha256);
    expect(cleanupSyntheticCase).toHaveBeenCalledOnce();

    const runner = createDnaOpenLabP5ComponentRecoveryCaseRunner({
      scenarios: {
        dynamic_plan_drift: async () => evidence,
      } as never,
    });
    await expect(runner("dynamic_plan_drift")).resolves.toMatchObject({
      caseId: "dynamic_plan_drift",
      outcome: "passed",
      apiRequestCount: 0,
      syntheticProviderWriteCount: 0,
    });
  });

  it("fails closed if mandatory cleanup reports synthetic residue", async () => {
    const { scenario } = fixture({ cleanupLeavesResidue: true });
    await expect(scenario()).rejects.toThrow(
      "DNA Open Lab P5 dynamic-plan-drift scenario failed.",
    );
  });
});
