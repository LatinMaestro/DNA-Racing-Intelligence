import { describe, expect, it, vi } from "vitest";

import type { DatasetEvidenceObjectRegistration } from "@/lib/neon-dataset-evidence-object-repository";
import type {
  RacePreactivationEvidenceManifest,
  RacePreactivationEvidenceManifestRepository,
} from "@/lib/neon-race-preactivation-evidence-manifest";
import { createRacePreactivationSealedManifestRepository } from "@/lib/race-preactivation-sealed-manifest-adapter";

const ownerId = "user_owner";
const importBatchId = "11111111-1111-1111-1111-111111111111";
const datasetVersionId = "22222222-2222-2222-2222-222222222222";

function registration(
  partitionNumber: number,
  rowCount: number,
): DatasetEvidenceObjectRegistration {
  return Object.freeze({
    ownerId,
    importBatchId,
    sourceType: "race_merge" as const,
    objectKind: "staged_rows" as const,
    partitionNumber,
    objectFormat: "ndjson_gzip" as const,
    objectKey: `private/${importBatchId}/staged/${partitionNumber}.ndjson.gz`,
    checksumSha256: String(partitionNumber + 1).repeat(64),
    byteSize: 100 + partitionNumber,
    rowCount,
    firstNaturalKey: `event-${partitionNumber}:core-1`,
    lastNaturalKey: `event-${partitionNumber}:core-${rowCount}`,
    createdAt: "2026-08-26T00:00:00.000Z",
  });
}

function manifest(
  overrides: Partial<RacePreactivationEvidenceManifest> = {},
): RacePreactivationEvidenceManifest {
  const objects = Object.freeze([registration(0, 2), registration(1, 1)]);
  return Object.freeze({
    importBatchId,
    sourceRowCount: 3,
    acceptedRowCount: 2,
    rejectedRowCount: 1,
    warningRowCount: 0,
    partitionCount: 2,
    byteSize: objects.reduce((total, object) => total + object.byteSize, 0),
    objects,
    ...overrides,
  });
}

function repository(
  result:
    | Readonly<{ status: "missing" }>
    | Readonly<{
        status: "ready";
        manifest: RacePreactivationEvidenceManifest;
      }>,
) {
  const list = vi.fn(async () => result);
  return {
    repository: { list } as RacePreactivationEvidenceManifestRepository,
    list,
  };
}

describe("Race preactivation sealed-manifest adapter", () => {
  it("maps a ready import-batch manifest onto the future dataset-version identity", async () => {
    const source = repository({ status: "ready", manifest: manifest() });
    const adapter = createRacePreactivationSealedManifestRepository({
      repository: source.repository,
      importBatchId,
      datasetVersionId,
    });

    await expect(
      adapter.list({ ownerId, datasetVersionId, maximumPartitions: 10 }),
    ).resolves.toEqual({
      status: "ready",
      manifest: {
        datasetVersionId,
        importBatchId,
        sourceType: "race_merge",
        evidenceKind: "staged_rows",
        partitionCount: 2,
        rowCount: 3,
        byteSize: 201,
        objects: manifest().objects,
      },
    });
    expect(source.list).toHaveBeenCalledWith({
      ownerId,
      importBatchId,
      maximumPartitions: 10,
    });
  });

  it("preserves a missing preactivation manifest", async () => {
    const source = repository({ status: "missing" });
    const adapter = createRacePreactivationSealedManifestRepository({
      repository: source.repository,
      importBatchId,
      datasetVersionId,
    });

    await expect(
      adapter.list({ ownerId, datasetVersionId, maximumPartitions: 10 }),
    ).resolves.toEqual({ status: "missing" });
  });

  it("rejects an unexpected dataset-version identity before reading evidence", async () => {
    const source = repository({ status: "ready", manifest: manifest() });
    const adapter = createRacePreactivationSealedManifestRepository({
      repository: source.repository,
      importBatchId,
      datasetVersionId,
    });

    await expect(
      adapter.list({
        ownerId,
        datasetVersionId: "33333333-3333-3333-3333-333333333333",
        maximumPartitions: 10,
      }),
    ).rejects.toThrow("does not match its bound import batch");
    expect(source.list).not.toHaveBeenCalled();
  });

  it("fails closed if the preactivation manifest changes import-batch identity", async () => {
    const source = repository({
      status: "ready",
      manifest: manifest({
        importBatchId: "44444444-4444-4444-4444-444444444444",
      }),
    });
    const adapter = createRacePreactivationSealedManifestRepository({
      repository: source.repository,
      importBatchId,
      datasetVersionId,
    });

    await expect(
      adapter.list({ ownerId, datasetVersionId, maximumPartitions: 10 }),
    ).rejects.toThrow("import-batch identity changed");
  });

  it("rejects inconsistent preactivation coverage", async () => {
    const source = repository({
      status: "ready",
      manifest: manifest({ sourceRowCount: 4 }),
    });
    const adapter = createRacePreactivationSealedManifestRepository({
      repository: source.repository,
      importBatchId,
      datasetVersionId,
    });

    await expect(
      adapter.list({ ownerId, datasetVersionId, maximumPartitions: 10 }),
    ).rejects.toThrow("manifest coverage is invalid");
  });
});
