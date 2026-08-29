import { describe, expect, it, vi } from "vitest";

import {
  collectDnaOpenLabP5R2Footprint,
  runDnaOpenLabP5CapacityMeasurement,
  type DnaOpenLabP5PostgresCapacityPort,
  type DnaOpenLabP5R2FootprintPort,
} from "@/lib/dna-open-lab-p5-capacity-measurement-runner";

const objectOne = Object.freeze({
  objectIdentitySha256: "1".repeat(64),
  payloadBytes: 600_000_000,
  metadataBytes: 60_000_000,
});
const objectTwo = Object.freeze({
  objectIdentitySha256: "2".repeat(64),
  payloadBytes: 300_000_000,
  metadataBytes: 40_000_000,
});

function postgres(
  sizes = [20_000_000, 120_000_000, 80_000_000],
): DnaOpenLabP5PostgresCapacityPort {
  let index = 0;
  return {
    readMajorVersion: vi.fn(async () => 18),
    readDatabaseBytes: vi.fn(async () => {
      const value = sizes[index];
      if (value === undefined) throw new Error("No synthetic size remains");
      index += 1;
      return value;
    }),
    readOwnerRelationBytes: vi.fn(async () => ({
      heapBytes: 45_000_000,
      indexBytes: 20_000_000,
      toastBytes: 5_000_000,
    })),
  };
}

function r2(): DnaOpenLabP5R2FootprintPort {
  return {
    readBucketPrivacy: vi.fn(async () => ({
      publicAccessDisabled: true,
      r2DevDisabled: true,
      customDomainCount: 0,
    })),
    listRetainedObjects: vi.fn(async ({ cursor }) =>
      cursor === null
        ? { objects: [objectOne], nextCursor: "page-2" }
        : { objects: [objectTwo], nextCursor: null },
    ),
  };
}

function runnerInput(overrides: Record<string, unknown> = {}) {
  return {
    codeHeadSha: "a".repeat(40),
    planChecksum: "b".repeat(64),
    providerScope: "synthetic_local" as const,
    measurementAuthorityRef: "local:synthetic-capacity-run/2",
    measuredAt: "2026-08-28T19:00:00.000Z",
    postgres: postgres(),
    r2: r2(),
    runSyntheticCycle: async ({
      captureTransientSample,
    }: {
      captureTransientSample: () => Promise<number>;
    }) => {
      await captureTransientSample();
    },
    cleanupSyntheticEvidence: vi.fn(async () => ({
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      rawPayloadIncluded: false,
      secretMaterialIncluded: false,
    })),
    projectedMonthlyClassAOperations: 2_000_000,
    projectedMonthlyClassBOperations: 3_000_000,
    priceAuthorityRef: "provider-price-snapshot-2026-08-28",
    priceEffectiveAt: "2026-08-28T00:00:00.000Z",
    bytesPerBillableGb: 1_000_000_000,
    storageMicroUsdPerGbMonth: 15_000,
    classAMicroUsdPerMillion: 4_500_000,
    classBMicroUsdPerMillion: 360_000,
    ...overrides,
  };
}

describe("DNA Open Lab P5 capacity measurement runner", () => {
  it("measures bounded Postgres peak and complete private R2 footprint", async () => {
    const progress: string[] = [];
    const input = runnerInput({
      recordProgress: (stage: string) => progress.push(stage),
    });
    const report = await runDnaOpenLabP5CapacityMeasurement(input);

    expect(report).toMatchObject({
      providerScope: "synthetic_local",
      postgresMajorVersion: 18,
      postgres: {
        baselineDatabaseBytes: 20_000_000,
        settledDatabaseBytes: 80_000_000,
        peakDatabaseBytes: 120_000_000,
        measurementSamples: 3,
        ownerPhysicalBytes: 70_000_000,
        positivePeakHeadroom: true,
      },
      r2: {
        retainedObjectCount: 2,
        retainedPayloadBytes: 900_000_000,
        retainedMetadataBytes: 100_000_000,
        projectedMonthlyCostMicroUsd: 10_095_000,
      },
      connectedCapacityEvidenceComplete: false,
      readyToUpdateP5CapacityRows: false,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
    });
    expect(input.cleanupSyntheticEvidence).toHaveBeenCalledOnce();
    expect(progress).toEqual([
      "postgres_major_version_read",
      "postgres_baseline_read",
      "synthetic_cycle_completed",
      "postgres_settled_read",
      "postgres_owner_relations_read",
      "r2_footprint_collected",
      "cleanup_completed",
      "report_built",
    ]);
  });

  it("always cleans synthetic evidence when cycle execution fails", async () => {
    const cleanupSyntheticEvidence = vi.fn(async () => ({
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      rawPayloadIncluded: false,
      secretMaterialIncluded: false,
    }));
    await expect(
      runDnaOpenLabP5CapacityMeasurement(
        runnerInput({
          cleanupSyntheticEvidence,
          runSyntheticCycle: async () => {
            throw new Error("synthetic cycle failed");
          },
        }),
      ),
    ).rejects.toThrow("synthetic cycle failed");
    expect(cleanupSyntheticEvidence).toHaveBeenCalledOnce();
  });

  it("requires a component-triggered transient sample", async () => {
    const cleanupSyntheticEvidence = vi.fn(async () => ({
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      rawPayloadIncluded: false,
      secretMaterialIncluded: false,
    }));
    await expect(
      runDnaOpenLabP5CapacityMeasurement(
        runnerInput({
          cleanupSyntheticEvidence,
          runSyntheticCycle: async () => undefined,
        }),
      ),
    ).rejects.toThrow("did not capture a transient sample");
    expect(cleanupSyntheticEvidence).toHaveBeenCalledOnce();
  });

  it("fails closed when cleanup leaves residue", async () => {
    await expect(
      runDnaOpenLabP5CapacityMeasurement(
        runnerInput({
          cleanupSyntheticEvidence: async () => ({
            persistentOwnerDataWriteCount: 0,
            residueObjectCount: 1,
            rawPayloadIncluded: false,
            secretMaterialIncluded: false,
          }),
        }),
      ),
    ).rejects.toThrow("synthetic cleanup or evidence safety failed");
  });
});

describe("DNA Open Lab P5 private R2 footprint collector", () => {
  it("rejects an exposed bucket before listing objects", async () => {
    const listRetainedObjects = vi.fn();
    await expect(
      collectDnaOpenLabP5R2Footprint({
        port: {
          readBucketPrivacy: async () => ({
            publicAccessDisabled: false,
            r2DevDisabled: true,
            customDomainCount: 0,
          }),
          listRetainedObjects,
        },
      }),
    ).rejects.toThrow("bucket is not private");
    expect(listRetainedObjects).not.toHaveBeenCalled();
  });

  it("rejects duplicate object identities and cursor loops", async () => {
    await expect(
      collectDnaOpenLabP5R2Footprint({
        port: {
          readBucketPrivacy: r2().readBucketPrivacy,
          listRetainedObjects: async ({ cursor }) =>
            cursor === null
              ? { objects: [objectOne], nextCursor: "page-2" }
              : { objects: [objectOne], nextCursor: null },
        },
      }),
    ).rejects.toThrow("repeats an object identity");

    await expect(
      collectDnaOpenLabP5R2Footprint({
        port: {
          readBucketPrivacy: r2().readBucketPrivacy,
          listRetainedObjects: async () => ({
            objects: [],
            nextCursor: "same-page",
          }),
        },
      }),
    ).rejects.toThrow("repeats a cursor");
  });
});
