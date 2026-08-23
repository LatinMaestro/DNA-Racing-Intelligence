import { describe, expect, it, vi } from "vitest";

import { createDatasetEvidenceManifestRegistrationService } from "@/lib/dataset-evidence-manifest-registration-service";
import type { DatasetEvidenceObjectRepository } from "@/lib/neon-dataset-evidence-object-repository";
import type { StoredPrivateDatasetEvidenceObject } from "@/lib/private-dataset-evidence-object-writer";

const ownerId = "user_owner";
const evidenceObjectId = "22222222-2222-4222-8222-222222222222";

function stored(
  partitionNumber: number,
  overrides: Partial<StoredPrivateDatasetEvidenceObject["registration"]> = {},
): StoredPrivateDatasetEvidenceObject {
  return {
    registration: {
      ownerId,
      importBatchId: "11111111-1111-4111-8111-111111111111",
      sourceType: "race_merge",
      objectKind: "staged_rows",
      partitionNumber,
      objectFormat: "ndjson_gzip",
      objectKey: `evidence/part-${partitionNumber}.ndjson.gz`,
      checksumSha256: String(partitionNumber).padStart(64, "a"),
      byteSize: 100,
      rowCount: 10,
      firstNaturalKey: `key-${partitionNumber}-first`,
      lastNaturalKey: `key-${partitionNumber}-last`,
      createdAt: "2026-08-23T09:00:00.000Z",
      ...overrides,
    },
    storageStatus: "created",
  };
}

function harness(maximumObjects?: number) {
  const register =
    vi.fn<
      Extract<
        DatasetEvidenceObjectRepository,
        Readonly<{ status: "ready" }>
      >["register"]
    >();
  register.mockImplementation(async (registration) => ({
    status: registration.partitionNumber === 0 ? "created" : "existing",
    evidenceObjectId,
  }));
  const repository = {
    status: "ready" as const,
    register,
  } satisfies DatasetEvidenceObjectRepository;
  const service = createDatasetEvidenceManifestRegistrationService({
    ownerId,
    repository,
    ...(maximumObjects === undefined ? {} : { maximumObjects }),
  });
  return { service, register };
}

describe("dataset evidence manifest registration service", () => {
  it("registers a prevalidated bounded set sequentially", async () => {
    const test = harness();

    await expect(test.service.register([stored(0), stored(1)])).resolves.toEqual([
      {
        status: "created",
        evidenceObjectId,
        objectKey: "evidence/part-0.ndjson.gz",
        storageStatus: "created",
      },
      {
        status: "existing",
        evidenceObjectId,
        objectKey: "evidence/part-1.ndjson.gz",
        storageStatus: "created",
      },
    ]);
    expect(test.register.mock.calls.map(([value]) => value.partitionNumber)).toEqual([
      0, 1,
    ]);
  });

  it("rejects another owner before registering any manifest", async () => {
    const test = harness();

    await expect(
      test.service.register([stored(0), stored(1, { ownerId: "other_owner" })]),
    ).rejects.toThrow("access denied");
    expect(test.register).not.toHaveBeenCalled();
  });

  it("rejects duplicate partitions before registering any manifest", async () => {
    const test = harness();

    await expect(test.service.register([stored(0), stored(0)])).rejects.toThrow(
      "duplicate partition",
    );
    expect(test.register).not.toHaveBeenCalled();
  });

  it("enforces the configured object bound and accepts an empty set", async () => {
    const test = harness(1);

    await expect(test.service.register([stored(0), stored(1)])).rejects.toThrow(
      "exceeds configured capacity",
    );
    await expect(test.service.register([])).resolves.toEqual([]);
    expect(test.register).not.toHaveBeenCalled();
  });

  it("stops at the first registration failure for replay-safe recovery", async () => {
    const test = harness();
    test.register
      .mockResolvedValueOnce({ status: "created", evidenceObjectId })
      .mockRejectedValueOnce(new Error("manifest conflict"));

    await expect(
      test.service.register([stored(0), stored(1), stored(2)]),
    ).rejects.toThrow("manifest conflict");
    expect(test.register).toHaveBeenCalledTimes(2);
  });
});
