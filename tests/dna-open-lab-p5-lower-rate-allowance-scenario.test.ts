import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createDnaOpenLabP5ComponentRecoveryCaseRunner } from "@/lib/dna-open-lab-p5-component-recovery-executor";
import { createDnaOpenLabP5LowerRateAllowanceScenario } from "@/lib/dna-open-lab-p5-lower-rate-allowance-scenario";
import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "@/lib/dna-open-lab-p5-private-preview-recovery";
import type { DnaOpenLabR2CurrentStateEvidenceStoragePort } from "@/lib/dna-open-lab-r2-current-state-evidence";

type StoredObject = Readonly<{
  body: Uint8Array;
  contentType: string;
  checksumSha256: string;
  metadata: Readonly<Record<string, string>>;
}>;

class MemoryRecoveryR2 implements DnaOpenLabR2CurrentStateEvidenceStoragePort {
  readonly objects = new Map<string, StoredObject>();
  putCount = 0;

  async readBucketPrivacy() {
    return Object.freeze({
      publicAccessDisabled: true,
      r2DevDisabled: true,
      customDomainCount: 0,
    });
  }

  async putObjectIfAbsent(input: {
    bucketName: string;
    key: string;
    body: AsyncIterable<Uint8Array>;
    contentType: string;
    byteLength: number;
    checksumSha256: string;
    metadata: Readonly<Record<string, string>>;
  }) {
    this.putCount += 1;
    if (this.objects.has(input.key)) {
      return Object.freeze({ status: "existing" as const });
    }
    const body = new Uint8Array(input.byteLength);
    let offset = 0;
    for await (const chunk of input.body) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.objects.set(
      input.key,
      Object.freeze({
        body,
        contentType: input.contentType,
        checksumSha256: input.checksumSha256,
        metadata: input.metadata,
      }),
    );
    return Object.freeze({ status: "created" as const });
  }

  async headObject(input: { bucketName: string; key: string }) {
    const stored = this.objects.get(input.key);
    return stored === undefined
      ? Object.freeze({ status: "missing" as const })
      : Object.freeze({
          status: "ready" as const,
          contentType: stored.contentType,
          byteLength: stored.body.byteLength,
          checksumSha256: stored.checksumSha256,
          metadata: stored.metadata,
        });
  }

  async getObject(input: { bucketName: string; key: string }) {
    const stored = this.objects.get(input.key);
    return stored === undefined
      ? Object.freeze({ status: "missing" as const })
      : Object.freeze({
          status: "ready" as const,
          body: (async function* () {
            yield stored.body;
          })(),
        });
  }
}

const sha = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function fixture(input: { cleanupLeavesResidue?: boolean } = {}) {
  const storage = new MemoryRecoveryR2();
  const inspectProviderSafety =
    async (): Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot> =>
      Object.freeze({
        ownerDataSha256: sha("owner"),
        checkpointStateSha256: sha("checkpoint"),
        servingStateSha256: sha("serving"),
        retainedEvidenceSha256: sha("retained"),
        persistentOwnerDataRowCount: 0,
        syntheticResidueObjectCount: [...storage.objects.keys()].filter((key) =>
          key.includes("/p5-recovery/"),
        ).length,
      });
  const cleanupSyntheticCase = async () => {
    if (input.cleanupLeavesResidue === true) return;
    for (const key of storage.objects.keys()) {
      if (key.includes("/p5-recovery/")) storage.objects.delete(key);
    }
  };
  const scenario = createDnaOpenLabP5LowerRateAllowanceScenario({
    ownerId: "owner-vault@example.test",
    bucketName: "dna-racing-import-preview",
    cycleId: "75000000-0000-4000-8000-000000000393",
    observedAt: "2026-08-31T07:30:00.000Z",
    observedAllowance: 12,
    storage,
    inspectProviderSafety,
    cleanupSyntheticCase,
  });
  return { storage, scenario };
}

describe("DNA Open Lab P5 lower-rate-allowance provider scenario", () => {
  it("reduces both gates and waits before exceeding the observed allowance", async () => {
    const { scenario, storage } = fixture();
    const evidence = await scenario();

    expect(evidence).toMatchObject({
      caseId: "lower_rate_allowance",
      apiRequestCount: 0,
      syntheticProviderWriteCount: 1,
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      configuredAggregateCeiling: 30,
      observedAllowance: 12,
      appliedAllowance: 12,
      catchUpStarted: true,
      catchUpCompleted: true,
    });
    expect(evidence.expectedCheckpointSha256).toBe(
      evidence.recoveredCheckpointSha256,
    );
    expect(evidence.expectedEvidenceSha256).toBe(
      evidence.readBackEvidenceSha256,
    );
    expect(evidence.firstRetryAt).toBe("2026-08-31T07:31:00.000Z");
    expect(storage.putCount).toBe(1);
    expect(storage.objects.size).toBe(0);

    const runner = createDnaOpenLabP5ComponentRecoveryCaseRunner({
      scenarios: { lower_rate_allowance: async () => evidence } as never,
    });
    await expect(runner("lower_rate_allowance")).resolves.toMatchObject({
      caseId: "lower_rate_allowance",
      outcome: "passed",
      apiRequestCount: 0,
      syntheticProviderWriteCount: 1,
    });
  });

  it("rejects a non-lower allowance before touching provider evidence", async () => {
    const { storage } = fixture();
    const scenario = createDnaOpenLabP5LowerRateAllowanceScenario({
      ownerId: "owner-vault@example.test",
      bucketName: "dna-racing-import-preview",
      cycleId: "75000000-0000-4000-8000-000000000394",
      observedAt: "2026-08-31T07:30:00.000Z",
      observedAllowance: 30,
      storage,
      inspectProviderSafety: async () =>
        Object.freeze({
          ownerDataSha256: sha("owner"),
          checkpointStateSha256: sha("checkpoint"),
          servingStateSha256: sha("serving"),
          retainedEvidenceSha256: sha("retained"),
          persistentOwnerDataRowCount: 0,
          syntheticResidueObjectCount: 0,
        }),
      cleanupSyntheticCase: async () => undefined,
    });
    await expect(scenario()).rejects.toThrow(
      "DNA Open Lab P5 lower-rate-allowance scenario failed.",
    );
    expect(storage.putCount).toBe(0);
  });

  it("fails closed when temporary evidence cleanup leaves residue", async () => {
    const { scenario, storage } = fixture({ cleanupLeavesResidue: true });
    await expect(scenario()).rejects.toThrow(
      "DNA Open Lab P5 lower-rate-allowance scenario failed.",
    );
    expect(storage.objects.size).toBe(1);
  });
});
