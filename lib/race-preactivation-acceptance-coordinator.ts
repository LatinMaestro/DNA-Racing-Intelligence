import type { RacePreactivationEvidenceManifestRepository } from "./neon-race-preactivation-evidence-manifest";
import type { PrivateDatasetEvidenceObjectReader } from "./private-dataset-evidence-object-reader";
import {
  prepareSpillableRaceArchiveAcceptanceStream,
  type RaceArchiveAcceptanceCandidate,
  type SpillableRaceArchiveAcceptanceStream,
} from "./race-archive-acceptance-stream";
import type { RaceArchiveExternalSortedRunStore } from "./race-archive-external-sort";
import { createRacePreactivationSealedManifestRepository } from "./race-preactivation-sealed-manifest-adapter";
import { createRaceStagedRowRehydrator } from "./race-staged-row-rehydrator";
import { createSealedRaceArchiveReader } from "./sealed-race-archive-reader";

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

function safeText(value: string, field: string, maximumLength = 512): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

export async function prepareRacePreactivationArchiveAcceptance(input: {
  ownerId: string;
  importBatchId: string;
  datasetVersionId: string;
  manifestRepository: RacePreactivationEvidenceManifestRepository;
  objectReader: PrivateDatasetEvidenceObjectReader;
  store: RaceArchiveExternalSortedRunStore<RaceArchiveAcceptanceCandidate>;
  runPrefix: string;
  maximumArchivePartitions: number;
  maximumUncompressedBytesPerPartition: number;
  maximumRowsPerPartition: number;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumSourceRows: number;
  maximumRunObjects: number;
}): Promise<SpillableRaceArchiveAcceptanceStream> {
  const ownerId = safeText(input.ownerId, "ownerId", 128);
  const importBatchId = uuid(input.importBatchId, "importBatchId");
  const datasetVersionId = uuid(input.datasetVersionId, "datasetVersionId");
  const maximumArchivePartitions = positiveBound(
    input.maximumArchivePartitions,
    "maximumArchivePartitions",
    10_000,
  );

  const located = await input.manifestRepository.list({
    ownerId,
    importBatchId,
    maximumPartitions: maximumArchivePartitions,
  });
  if (located.status === "missing") {
    throw new Error("Race preactivation evidence is unavailable.");
  }
  const sourceManifest = located.manifest;

  const snapshotRepository: RacePreactivationEvidenceManifestRepository =
    Object.freeze({
      async list(request) {
        if (
          request.ownerId !== ownerId ||
          request.importBatchId !== importBatchId ||
          request.maximumPartitions !== maximumArchivePartitions
        ) {
          throw new Error("Race preactivation evidence snapshot scope changed.");
        }
        return located;
      },
    });

  const manifestRepository = createRacePreactivationSealedManifestRepository({
    repository: snapshotRepository,
    importBatchId,
    datasetVersionId,
  });
  const archiveReader = createSealedRaceArchiveReader({
    manifestRepository,
    objectReader: input.objectReader,
    maximumUncompressedBytesPerPartition: positiveBound(
      input.maximumUncompressedBytesPerPartition,
      "maximumUncompressedBytesPerPartition",
      1_000_000_000,
    ),
    maximumRowsPerPartition: positiveBound(
      input.maximumRowsPerPartition,
      "maximumRowsPerPartition",
      10_000_000,
    ),
  });
  const rehydrator = createRaceStagedRowRehydrator({ archiveReader });
  const stream = await prepareSpillableRaceArchiveAcceptanceStream({
    ownerId,
    datasetVersionId,
    rehydrator,
    store: input.store,
    runPrefix: safeText(input.runPrefix, "runPrefix", 256),
    maximumArchivePartitions,
    maximumRecordsInMemory: input.maximumRecordsInMemory,
    mergeFanIn: input.mergeFanIn,
    maximumSourceRows: input.maximumSourceRows,
    maximumRunObjects: input.maximumRunObjects,
  });

  if (
    stream.sourceRowCount !== sourceManifest.sourceRowCount ||
    stream.readyRowCount !== sourceManifest.acceptedRowCount ||
    stream.quarantinedRowCount !== sourceManifest.rejectedRowCount
  ) {
    await stream.cleanup();
    throw new Error(
      "Race preactivation archived row status conflicts with its finalized Preview receipt.",
    );
  }

  return stream;
}
