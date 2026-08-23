import { describe, expect, it, vi } from "vitest";

import {
  createDatasetEvidenceCommitCoordinator,
  type DatasetEvidenceCommitCoordinator,
} from "@/lib/dataset-evidence-commit-coordinator";
import type { DatasetEvidenceManifestRegistrationService } from "@/lib/dataset-evidence-manifest-registration-service";
import type {
  PrivateDatasetEvidenceObjectRecoveryReceipt,
  StoredPrivateDatasetEvidenceObject,
} from "@/lib/private-dataset-evidence-object-writer";

const ownerId = "user_owner";
const importBatchId = "11111111-1111-4111-8111-111111111111";
const evidenceObjectId = "22222222-2222-4222-8222-222222222222";

function stored(
  partitionNumber: number,
  storageStatus: "created" | "existing" = "created",
): StoredPrivateDatasetEvidenceObject {
  return {
    registration: {
      ownerId,
      importBatchId,
      sourceType: "race_merge",
      objectKind: "staged_rows",
      partitionNumber,
      objectFormat: "ndjson_gzip",
      objectKey: `evidence/part-${partitionNumber}.ndjson.gz`,
      checksumSha256: "a".repeat(64),
      byteSize: 100,
      rowCount: 10,
      firstNaturalKey: `key-${partitionNumber}-first`,
      lastNaturalKey: `key-${partitionNumber}-last`,
      createdAt: "2026-08-23T10:00:00.000Z",
    },
    storageStatus,
  };
}

function harness(): {
  coordinator: DatasetEvidenceCommitCoordinator;
  validate: ReturnType<typeof vi.fn<DatasetEvidenceManifestRegistrationService["validate"]>>;
  register: ReturnType<typeof vi.fn<DatasetEvidenceManifestRegistrationService["register"]>>;
  cleanup: ReturnType<
    typeof vi.fn<
      (
        stored: readonly StoredPrivateDatasetEvidenceObject[],
      ) => Promise<readonly PrivateDatasetEvidenceObjectRecoveryReceipt[]>
    >
  >;
} {
  const validate =
    vi.fn<DatasetEvidenceManifestRegistrationService["validate"]>();
  const register =
    vi.fn<DatasetEvidenceManifestRegistrationService["register"]>();
  register.mockResolvedValue([
    {
      evidenceObjectId,
      objectKey: "evidence/part-0.ndjson.gz",
      status: "created",
      storageStatus: "created",
    },
  ]);
  const cleanup =
    vi.fn<
      (
        stored: readonly StoredPrivateDatasetEvidenceObject[],
      ) => Promise<readonly PrivateDatasetEvidenceObjectRecoveryReceipt[]>
    >();
  cleanup.mockResolvedValue([
    {
      objectKey: "evidence/part-0.ndjson.gz",
      status: "deleted",
    },
  ]);
  const coordinator = createDatasetEvidenceCommitCoordinator({
    registrationService: { validate, register },
    recovery: { cleanup },
  });
  return { coordinator, validate, register, cleanup };
}

describe("dataset evidence commit coordinator", () => {
  it("validates before commit and registers only after commit succeeds", async () => {
    const test = harness();
    const order: string[] = [];
    test.validate.mockImplementation(() => {
      order.push("validate");
    });
    const commit = vi.fn(async () => {
      order.push("commit");
      return { importBatchId };
    });
    test.register.mockImplementation(async () => {
      order.push("register");
      return [
        {
          evidenceObjectId,
          objectKey: "evidence/part-0.ndjson.gz",
          status: "created",
          storageStatus: "created",
        },
      ];
    });

    await expect(
      test.coordinator.commitAndRegister({
        stored: [stored(0)],
        commit,
      }),
    ).resolves.toEqual({
      committed: { importBatchId },
      manifests: [
        {
          evidenceObjectId,
          objectKey: "evidence/part-0.ndjson.gz",
          status: "created",
          storageStatus: "created",
        },
      ],
    });
    expect(order).toEqual(["validate", "commit", "register"]);
    expect(test.cleanup).not.toHaveBeenCalled();
  });

  it("recovers newly created objects when pre-commit validation fails", async () => {
    const test = harness();
    const validationError = new Error("invalid evidence set");
    test.validate.mockImplementation(() => {
      throw validationError;
    });
    const commit = vi.fn();

    await expect(
      test.coordinator.commitAndRegister({
        stored: [stored(0), stored(1, "existing")],
        commit,
      }),
    ).rejects.toBe(validationError);
    expect(commit).not.toHaveBeenCalled();
    expect(test.register).not.toHaveBeenCalled();
    expect(test.cleanup).toHaveBeenCalledWith([stored(0)]);
  });

  it("recovers only newly created objects when the database commit fails", async () => {
    const test = harness();
    const commitError = new Error("database commit failed");

    await expect(
      test.coordinator.commitAndRegister({
        stored: [stored(0), stored(1, "existing"), stored(2)],
        commit: async () => {
          throw commitError;
        },
      }),
    ).rejects.toBe(commitError);
    expect(test.cleanup).toHaveBeenCalledWith([stored(0), stored(2)]);
    expect(test.register).not.toHaveBeenCalled();
  });

  it("reports both the commit and recovery failures without hiding residue", async () => {
    const test = harness();
    const commitError = new Error("database commit failed");
    const recoveryError = new Error("provider deletion failed");
    test.cleanup.mockRejectedValueOnce(recoveryError);

    const result = test.coordinator.commitAndRegister({
      stored: [stored(0)],
      commit: async () => {
        throw commitError;
      },
    });

    await expect(result).rejects.toMatchObject({
      message:
        "Dataset evidence commit failed and pre-commit recovery was incomplete.",
      errors: [commitError, recoveryError],
    });
    expect(test.register).not.toHaveBeenCalled();
  });

  it("never deletes evidence after commit when manifest registration fails", async () => {
    const test = harness();
    const registrationError = new Error("manifest registration interrupted");
    const commit = vi.fn(async () => ({ importBatchId }));
    test.register.mockRejectedValueOnce(registrationError);

    await expect(
      test.coordinator.commitAndRegister({
        stored: [stored(0)],
        commit,
      }),
    ).rejects.toBe(registrationError);
    expect(commit).toHaveBeenCalledOnce();
    expect(test.cleanup).not.toHaveBeenCalled();
  });

  it("does not invoke recovery for replayed objects that were not created", async () => {
    const test = harness();
    const commitError = new Error("database commit failed");

    await expect(
      test.coordinator.commitAndRegister({
        stored: [stored(0, "existing")],
        commit: async () => {
          throw commitError;
        },
      }),
    ).rejects.toBe(commitError);
    expect(test.cleanup).not.toHaveBeenCalled();
    expect(test.register).not.toHaveBeenCalled();
  });
});
