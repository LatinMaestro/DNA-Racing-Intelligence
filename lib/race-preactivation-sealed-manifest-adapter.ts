import type {
  RacePreactivationEvidenceManifestRepository,
} from "./neon-race-preactivation-evidence-manifest";
import type {
  SealedRaceArchiveManifest,
  SealedRaceArchiveManifestRepository,
} from "./neon-sealed-race-archive-manifest-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`${field} must be a UUID`);
  }
  return normalized;
}

function owner(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error("ownerId is invalid");
  }
  return normalized;
}

function maximumPartitions(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error("maximumPartitions is invalid");
  }
  return value;
}

export function createRacePreactivationSealedManifestRepository(input: {
  repository: RacePreactivationEvidenceManifestRepository;
  importBatchId: string;
  datasetVersionId: string;
}): SealedRaceArchiveManifestRepository {
  const importBatchId = uuid(input.importBatchId, "importBatchId");
  const datasetVersionId = uuid(input.datasetVersionId, "datasetVersionId");

  return Object.freeze({
    async list(request) {
      const ownerId = owner(request.ownerId);
      const requestedDatasetVersionId = uuid(
        request.datasetVersionId,
        "datasetVersionId",
      );
      if (requestedDatasetVersionId !== datasetVersionId) {
        throw new Error(
          "Race preactivation dataset-version identity does not match its bound import batch.",
        );
      }
      const located = await input.repository.list({
        ownerId,
        importBatchId,
        maximumPartitions: maximumPartitions(request.maximumPartitions),
      });
      if (located.status === "missing") return located;

      const source = located.manifest;
      if (source.importBatchId !== importBatchId) {
        throw new Error("Race preactivation import-batch identity changed.");
      }
      if (
        source.sourceRowCount < 1 ||
        source.acceptedRowCount < 1 ||
        source.acceptedRowCount + source.rejectedRowCount !==
          source.sourceRowCount ||
        source.partitionCount !== source.objects.length ||
        source.partitionCount < 1 ||
        source.byteSize < 1
      ) {
        throw new Error("Race preactivation manifest coverage is invalid.");
      }
      if (
        source.objects.some(
          (object) =>
            object.importBatchId !== importBatchId ||
            object.sourceType !== "race_merge" ||
            object.objectKind !== "staged_rows" ||
            object.objectFormat !== "ndjson_gzip",
        )
      ) {
        throw new Error("Race preactivation evidence object identity changed.");
      }

      const manifest: SealedRaceArchiveManifest = Object.freeze({
        datasetVersionId,
        importBatchId,
        sourceType: "race_merge",
        evidenceKind: "staged_rows",
        partitionCount: source.partitionCount,
        rowCount: source.sourceRowCount,
        byteSize: source.byteSize,
        objects: source.objects,
      });
      return Object.freeze({ status: "ready" as const, manifest });
    },
  });
}
