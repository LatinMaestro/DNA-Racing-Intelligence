import type { DatasetEvidenceObjectRepository } from "./neon-dataset-evidence-object-repository";
import type { StoredPrivateDatasetEvidenceObject } from "./private-dataset-evidence-object-writer";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const DEFAULT_MAXIMUM_OBJECTS = 10_000;

export type DatasetEvidenceManifestRegistrationReceipt = Readonly<{
  evidenceObjectId: string;
  objectKey: string;
  status: "created" | "existing";
  storageStatus: "created" | "existing";
}>;

function owner(value: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error("ownerId is invalid");
  }
  return normalized;
}

function maximumObjects(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 10_000) {
    throw new Error("maximumObjects is invalid");
  }
  return value;
}

export function createDatasetEvidenceManifestRegistrationService(input: {
  ownerId: string;
  repository: Extract<
    DatasetEvidenceObjectRepository,
    Readonly<{ status: "ready" }>
  >;
  maximumObjects?: number;
}): Readonly<{
  register: (
    stored: readonly StoredPrivateDatasetEvidenceObject[],
  ) => Promise<readonly DatasetEvidenceManifestRegistrationReceipt[]>;
}> {
  const ownerId = owner(input.ownerId);
  const limit = maximumObjects(input.maximumObjects ?? DEFAULT_MAXIMUM_OBJECTS);

  return Object.freeze({
    async register(stored) {
      if (stored.length > limit) {
        throw new Error("evidence manifest set exceeds configured capacity");
      }

      const seen = new Set<string>();
      for (const object of stored) {
        const registration = object.registration;
        if (owner(registration.ownerId) !== ownerId) {
          throw new Error("Evidence manifest registration access denied.");
        }
        const identity = [
          registration.importBatchId,
          registration.objectKind,
          registration.partitionNumber,
        ].join("\u0000");
        if (seen.has(identity)) {
          throw new Error(
            "evidence manifest set contains a duplicate partition",
          );
        }
        seen.add(identity);
      }

      const receipts: DatasetEvidenceManifestRegistrationReceipt[] = [];
      for (const object of stored) {
        const receipt = await input.repository.register(object.registration);
        receipts.push({
          ...receipt,
          objectKey: object.registration.objectKey,
          storageStatus: object.storageStatus,
        });
      }
      return receipts;
    },
  });
}
