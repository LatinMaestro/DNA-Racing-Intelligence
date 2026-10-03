import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { CloudflareR2ImportObjectStoragePort } from "@/lib/cloudflare-r2-import-object-storage";
import type {
  DnaOpenLabProviderCapacityMeasurement,
  DnaOpenLabProviderCapacityMeasurementSource,
} from "@/lib/dna-open-lab-provider-capacity-preflight";
import {
  ingestRaceMergeOutcomeEvidence,
  type RaceMergeOutcomeIngestionRepository,
} from "@/lib/race-merge-outcome-ingestion-service";
import { raceMergeOutcomeConnectedRuntimeFromEnvironment } from "@/lib/race-merge-outcome-connected-runtime";

const ownerId = "private-owner";
const now = new Date("2026-10-03T10:00:00.000Z");
const bytes = new TextEncoder().encode(
  "event_id,token_id,pos,time\nrace-1,101,2,12.345\n",
);
const sourceSha256 = createHash("sha256").update(bytes).digest("hex");

const measurement: DnaOpenLabProviderCapacityMeasurement = Object.freeze({
  evidenceSource: "provider_api",
  r2StorageClass: "Standard",
  measuredAt: "2026-10-03T09:59:00.000Z",
  billingWindowStartAt: "2026-10-01T00:00:00.000Z",
  billingWindowEndAt: "2026-11-01T00:00:00.000Z",
  currentR2Usage: {
    storageBytes: 1_000_000_000,
    classAOperations: 1_000,
    classBOperations: 2_000,
  },
  neonMeasuredAt: "2026-10-03T09:59:00.000Z",
  neonBillingWindowStartAt: "2026-10-01T00:00:00.000Z",
  neonBillingWindowEndAt: "2026-11-01T00:00:00.000Z",
  currentNeonUsage: {
    storageBytes: 10_000_000,
    computeMilliCuHours: 1_000,
  },
});

const bounds = Object.freeze({
  maximumFiles: 8,
  maximumTotalBytes: 600_000_000,
  maximumObjectBytes: 300_000_000,
  maximumChunkBytes: 64 * 1024 * 1024,
  maximumRowsPerObject: 4_000_000,
  maximumRowsPerGeneration: 4_000_000,
  maximumHeaderColumns: 100,
  maximumFieldCharacters: 1_000,
  maximumRowCharacters: 10_000,
  rowsPerWrite: 10_000,
});

function environment(exactCodeHeadSha = "a".repeat(40)) {
  return {
    authorizedOwnerId: ownerId,
    exactCodeHeadSha,
    cloudflareAccountId: "b".repeat(32),
    r2BucketName: "private-race-archive",
    cloudflareApiToken: "cloudflare-token",
    r2AccessKeyId: "r2-access-key",
    r2SecretAccessKey: "r2-secret-key",
  };
}

function measurementSource() {
  const measure = vi.fn().mockResolvedValue(measurement);
  return {
    measure,
    source: {
      status: "ready" as const,
      measure,
    } satisfies DnaOpenLabProviderCapacityMeasurementSource,
  };
}

function r2Port(status: "ready" | "missing" = "ready") {
  const getObject = vi.fn(async () =>
    status === "missing"
      ? ({ status: "missing" } as const)
      : ({
          status: "ready" as const,
          advertisedByteLength: bytes.byteLength,
          body: (async function* () {
            yield bytes;
          })(),
        } as const),
  );
  const port: CloudflareR2ImportObjectStoragePort = {
    async readBucketPrivacy() {
      return {
        publicAccessDisabled: true,
        r2DevDisabled: true,
        customDomainCount: 0,
      };
    },
    async createPresignedPut() {
      throw new Error("not used");
    },
    async headObject() {
      return { status: "missing" };
    },
    getObject,
  };
  return { getObject, port };
}

describe("Race Merge outcome connected runtime", () => {
  it("connects exact-main capacity, private R2 reads and guarded ingestion", async () => {
    const measured = measurementSource();
    const r2 = r2Port();
    const repository = {} as RaceMergeOutcomeIngestionRepository;
    const runIngestion = vi.fn(
      async (input: Parameters<typeof ingestRaceMergeOutcomeEvidence>[0]) => {
        const authority = await input.zeroCostCapacityGate.authorize({
          ownerId: input.ownerId,
          generationId: input.generationId,
          manifestDigestSha256: "c".repeat(64),
          sourceObjectCount: input.references.length,
          sourceByteLength: input.references.reduce(
            (total, item) => total + item.expectedByteLength,
            0,
          ),
          maximumRowsPerGeneration: input.bounds.maximumRowsPerGeneration,
        });
        const opened = await input.objectStore.openObject({
          ownerId: input.ownerId,
          objectId: input.references[0]!.objectId,
        });
        expect(authority).toMatchObject({
          projectedPaidCostAud: 0,
          projectedR2RetainedBytes: 1_000_000_000,
        });
        expect(opened.advertisedByteLength).toBe(bytes.byteLength);
        return {
          status: "complete" as const,
          generationId: input.generationId,
          objectCount: 1,
          sourceRowCount: 1,
          uniqueOutcomeCount: 1,
          exactReplayCount: 0,
          manifestDigestSha256: "c".repeat(64),
          outcomeSetDigestSha256: "d".repeat(64),
          dnaProviderRequestCount: 0 as const,
        };
      },
    );
    const runtime = raceMergeOutcomeConnectedRuntimeFromEnvironment(
      environment(),
      {
        measurementSource: measured.source,
        repository,
        createR2Port: () => r2.port,
        runIngestion,
        now: () => now,
      },
    );
    expect(runtime.status).toBe("ready");
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    const result = await runtime.execute({
      generationId: "race-merge-owner-export-v1",
      references: [
        {
          objectId: "source-1",
          sourceFamily: "race_merge",
          expectedByteLength: bytes.byteLength,
          expectedSha256: sourceSha256,
        },
      ],
      bounds,
    });

    expect(result).toMatchObject({
      status: "complete",
      uniqueOutcomeCount: 1,
      dnaProviderRequestCount: 0,
    });
    expect(measured.measure).toHaveBeenCalledWith({ ownerId });
    expect(runIngestion).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId, repository, now }),
    );
    expect(r2.getObject).toHaveBeenCalledWith({
      bucketName: "private-race-archive",
      key: expect.stringMatching(/^quarantine\/[a-f0-9]{64}\/source-1\.csv$/u),
    });
  });

  it("fails closed before provider work when required configuration is absent", () => {
    const runtime = raceMergeOutcomeConnectedRuntimeFromEnvironment({
      authorizedOwnerId: ownerId,
      exactCodeHeadSha: "a".repeat(40),
    });
    expect(runtime).toEqual({ status: "not_configured" });
  });

  it("returns a sanitized missing-object failure without widening access", async () => {
    const measured = measurementSource();
    const r2 = r2Port("missing");
    const runtime = raceMergeOutcomeConnectedRuntimeFromEnvironment(
      environment(),
      {
        measurementSource: measured.source,
        repository: {} as RaceMergeOutcomeIngestionRepository,
        createR2Port: () => r2.port,
        runIngestion: async (input) => {
          await input.objectStore.openObject({
            ownerId: input.ownerId,
            objectId: "source-1",
          });
          throw new Error("unreachable");
        },
        now: () => now,
      },
    );
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    await expect(
      runtime.execute({
        generationId: "race-merge-owner-export-v1",
        references: [
          {
            objectId: "source-1",
            sourceFamily: "race_merge",
            expectedByteLength: bytes.byteLength,
            expectedSha256: sourceSha256,
          },
        ],
        bounds,
      }),
    ).rejects.toThrow("private source object is missing");
  });
});
