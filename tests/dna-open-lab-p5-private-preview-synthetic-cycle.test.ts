import { describe, expect, it, vi } from "vitest";

import { createDnaOpenLabP5PrivatePreviewSyntheticCycle } from "@/lib/dna-open-lab-p5-private-preview-synthetic-cycle";
import { createP5SyntheticCycleFixture } from "./helpers/dna-open-lab-p5-synthetic-cycle-fixture";

const input = {
  codeHeadSha: "a".repeat(40),
  measuredAt: "2026-08-28T20:00:00.000Z",
  ownerId: "private-owner",
  databaseOwnerId: "11111111-1111-4111-8111-111111111111",
  databaseUrl: "postgresql://runtime:secret@preview.invalid/dna",
  runtimeRole: "dna_app_runtime",
  bucketName: "dna-private-preview",
} as const;

describe("DNA Open Lab P5 private Preview synthetic cycle", () => {
  it("runs the complete publication path, samples before rollback and removes R2 residue", async () => {
    const test = createP5SyntheticCycleFixture(input);
    const cycle = createDnaOpenLabP5PrivatePreviewSyntheticCycle(
      test.configuration,
    );
    const captureTransientSample = vi.fn(async () => 123_456);

    await cycle.runSyntheticCycle({ captureTransientSample });
    await expect(cycle.cleanupSyntheticEvidence()).resolves.toEqual({
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      rawPayloadIncluded: false,
      secretMaterialIncluded: false,
    });

    expect(captureTransientSample).toHaveBeenCalledOnce();
    expect(test.query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(
      true,
    );
    expect(
      test.query.mock.calls.filter(([sql]) => sql === "COMMIT"),
    ).toHaveLength(1);
    expect(
      test.query.mock.calls.some(([sql]) =>
        sql.includes("stage_dna_open_lab_token_splice_candidate"),
      ),
    ).toBe(true);
    expect(
      test.query.mock.calls.some(([sql]) =>
        sql.includes("save_dna_open_lab_current_state_evidence_index"),
      ),
    ).toBe(true);
    expect(
      test.query.mock.calls.some(([sql]) =>
        sql.includes("publish_dna_open_lab_indexed_sync_candidate"),
      ),
    ).toBe(true);
    expect(test.putObjectIfAbsent).toHaveBeenCalledOnce();
    expect(test.deleteObject).toHaveBeenCalledOnce();
    expect(test.sessionFactory).toHaveBeenCalledTimes(2);
  });

  it("rolls back on sample failure and cleanup remains safe", async () => {
    const test = createP5SyntheticCycleFixture(input);
    const cycle = createDnaOpenLabP5PrivatePreviewSyntheticCycle(
      test.configuration,
    );

    await expect(
      cycle.runSyntheticCycle({
        captureTransientSample: async () => {
          throw new Error("private provider detail");
        },
      }),
    ).rejects.toThrow("private provider detail");
    await expect(cycle.cleanupSyntheticEvidence()).resolves.toMatchObject({
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
    });
    expect(test.query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(
      true,
    );
    expect(test.deleteObject).toHaveBeenCalledOnce();
  });

  it("rejects reuse before making a second provider write", async () => {
    const test = createP5SyntheticCycleFixture(input);
    const cycle = createDnaOpenLabP5PrivatePreviewSyntheticCycle(
      test.configuration,
    );
    await cycle.runSyntheticCycle({
      captureTransientSample: async () => 1,
    });
    await expect(
      cycle.runSyntheticCycle({ captureTransientSample: async () => 2 }),
    ).rejects.toThrow("cycle may only run once");
    expect(test.putObjectIfAbsent).toHaveBeenCalledOnce();
    await cycle.cleanupSyntheticEvidence();
  });

  it("fails closed when the evidence bucket is not private", async () => {
    const test = createP5SyntheticCycleFixture(input);
    test.readBucketPrivacy.mockResolvedValueOnce({
      publicAccessDisabled: false,
      r2DevDisabled: true,
      customDomainCount: 0,
    });
    const cycle = createDnaOpenLabP5PrivatePreviewSyntheticCycle(
      test.configuration,
    );

    await expect(
      cycle.runSyntheticCycle({ captureTransientSample: async () => 1 }),
    ).rejects.toThrow("R2 bucket is not private");
    expect(test.putObjectIfAbsent).not.toHaveBeenCalled();
    await expect(cycle.cleanupSyntheticEvidence()).resolves.toMatchObject({
      residueObjectCount: 0,
    });
  });
});
