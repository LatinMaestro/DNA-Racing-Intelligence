import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createDnaOpenLabP5ComponentRecoveryCaseRunner } from "@/lib/dna-open-lab-p5-component-recovery-executor";
import {
  createDnaOpenLabP5EligibilityReinstatementScenario,
  DNA_OPEN_LAB_P5_ELIGIBILITY_REINSTATEMENT_STAGES,
  type DnaOpenLabP5EligibilityReinstatementStage,
} from "@/lib/dna-open-lab-p5-eligibility-reinstatement-scenario";
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

function fixture(
  input: { cleanupLeavesResidue?: boolean; mutateServingAfter?: boolean } = {},
) {
  const storage = new MemoryRecoveryR2();
  const stages: DnaOpenLabP5EligibilityReinstatementStage[] = [];
  let inspectionCount = 0;
  const inspectProviderSafety =
    async (): Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot> => {
      inspectionCount += 1;
      return Object.freeze({
        ownerDataSha256: sha("owner"),
        checkpointStateSha256: sha("checkpoint"),
        servingStateSha256:
          input.mutateServingAfter === true && inspectionCount >= 3
            ? sha("changed-serving")
            : sha("serving"),
        retainedEvidenceSha256: sha("retained"),
        persistentOwnerDataRowCount: 0,
        syntheticResidueObjectCount: [...storage.objects.keys()].filter((key) =>
          key.includes("/p5-recovery/"),
        ).length,
      });
    };
  const cleanupSyntheticCase = async () => {
    if (input.cleanupLeavesResidue === true) return;
    for (const key of storage.objects.keys()) {
      if (key.includes("/p5-recovery/")) storage.objects.delete(key);
    }
  };
  const scenario = createDnaOpenLabP5EligibilityReinstatementScenario({
    ownerId: "owner-vault@example.test",
    bucketName: "dna-racing-import-preview",
    cycleId: "75000000-0000-4000-8000-000000000396",
    eligibilityReinstatedAt: "2026-08-31T09:00:00.000Z",
    storage,
    inspectProviderSafety,
    cleanupSyntheticCase,
    reportStage: (stage) => stages.push(stage),
  });
  return { storage, scenario, stages };
}

describe("DNA Open Lab P5 eligibility-reinstatement provider scenario", () => {
  it("resumes the exact checkpoint and clears the pause after one indexed publication", async () => {
    const { scenario, storage, stages } = fixture();
    const evidence = await scenario();

    expect(evidence).toMatchObject({
      caseId: "eligibility_reinstatement",
      apiRequestCount: 0,
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      catchUpStarted: true,
      catchUpCompleted: true,
      indexedPublicationCount: 1,
      syncStateAfter: "current",
    });
    expect(evidence.syntheticProviderWriteCount).toBeGreaterThan(1);
    expect(evidence.checkpointSha256BeforeResume).toBe(
      evidence.checkpointSha256UsedForResume,
    );
    expect(evidence.expectedCheckpointSha256).toBe(
      evidence.recoveredCheckpointSha256,
    );
    expect(evidence.expectedEvidenceSha256).toBe(
      evidence.readBackEvidenceSha256,
    );
    expect(storage.putCount).toBe(evidence.syntheticProviderWriteCount);
    expect(storage.objects.size).toBe(0);
    expect(stages).toEqual(DNA_OPEN_LAB_P5_ELIGIBILITY_REINSTATEMENT_STAGES);

    const runner = createDnaOpenLabP5ComponentRecoveryCaseRunner({
      scenarios: { eligibility_reinstatement: async () => evidence } as never,
    });
    await expect(runner("eligibility_reinstatement")).resolves.toMatchObject({
      caseId: "eligibility_reinstatement",
      outcome: "passed",
      lastGoodPreserved: true,
      catchUpCompleted: true,
    });
  });

  it("fails closed when temporary evidence cleanup leaves residue", async () => {
    const { scenario, storage } = fixture({ cleanupLeavesResidue: true });
    await expect(scenario()).rejects.toThrow(
      "DNA Open Lab P5 eligibility-reinstatement scenario failed.",
    );
    expect(storage.objects.size).toBeGreaterThan(0);
  });

  it("fails closed when the cached serving provider fingerprint changes", async () => {
    const { scenario, storage } = fixture({ mutateServingAfter: true });
    await expect(scenario()).rejects.toThrow(
      "DNA Open Lab P5 eligibility-reinstatement scenario failed.",
    );
    expect(storage.objects.size).toBe(0);
  });
});
