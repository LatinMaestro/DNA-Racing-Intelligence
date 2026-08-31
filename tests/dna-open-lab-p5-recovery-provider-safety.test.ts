import { describe, expect, it, vi } from "vitest";

import { createDnaOpenLabP5RecoveryProviderSafety } from "@/lib/dna-open-lab-p5-recovery-provider-safety";

const hash = (character: string) => character.repeat(64);

describe("DNA Open Lab P5 provider recovery safety composition", () => {
  it("combines Neon and R2 without weakening either boundary", async () => {
    const cleanup = vi.fn(async () => undefined);
    const safety = createDnaOpenLabP5RecoveryProviderSafety({
      inspectNeon: async () => ({
        ownerDataSha256: hash("1"),
        checkpointStateSha256: hash("2"),
        servingStateSha256: hash("3"),
        retainedEvidenceSha256: hash("4"),
        persistentOwnerDataRowCount: 7,
      }),
      inspectR2: async () => ({
        retainedEvidenceSha256: hash("5"),
        syntheticResidueObjectCount: 2,
      }),
      cleanupR2SyntheticCase: cleanup,
    });

    const snapshot = await safety.inspectProviderSafety();
    expect(snapshot).toMatchObject({
      ownerDataSha256: hash("1"),
      checkpointStateSha256: hash("2"),
      servingStateSha256: hash("3"),
      persistentOwnerDataRowCount: 7,
      syntheticResidueObjectCount: 2,
    });
    expect(snapshot.retainedEvidenceSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(snapshot.retainedEvidenceSha256).not.toBe(hash("4"));
    expect(snapshot.retainedEvidenceSha256).not.toBe(hash("5"));

    await safety.cleanupSyntheticCase();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("redacts provider errors and rejects malformed fingerprints", async () => {
    const safety = createDnaOpenLabP5RecoveryProviderSafety({
      inspectNeon: async () => {
        throw new Error("private database error");
      },
      inspectR2: async () => ({
        retainedEvidenceSha256: "bad",
        syntheticResidueObjectCount: 0,
      }),
      cleanupR2SyntheticCase: async () => undefined,
    });
    await expect(safety.inspectProviderSafety()).rejects.toThrow(
      "provider recovery safety failed",
    );
  });
});
