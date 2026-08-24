import { gunzipSync } from "node:zlib";

import type { DatasetEvidenceNdjsonRow } from "./dataset-evidence-ndjson-partition-writer";
import type { DatasetEvidenceObjectRegistration } from "./neon-dataset-evidence-object-repository";
import type {
  SealedRaceArchiveManifest,
  SealedRaceArchiveManifestRepository,
} from "./neon-sealed-race-archive-manifest-repository";
import type { PrivateDatasetEvidenceObjectReader } from "./private-dataset-evidence-object-reader";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DecodedSealedRaceArchivePartition = Readonly<{
  registration: DatasetEvidenceObjectRegistration;
  rows: readonly DatasetEvidenceNdjsonRow[];
  uncompressedByteSize: number;
}>;

export type SealedRaceArchiveReader = Readonly<{
  open: (input: {
    ownerId: string;
    datasetVersionId: string;
    maximumPartitions: number;
  }) => Promise<
    | Readonly<{ status: "missing" }>
    | Readonly<{
        status: "ready";
        manifest: SealedRaceArchiveManifest;
        partitions: AsyncIterable<DecodedSealedRaceArchivePartition>;
      }>
  >;
}>;

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(field + " must be a positive safe integer");
  }
  return value;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(field + " must be an object");
  }
  return value as Record<string, unknown>;
}

function naturalKey(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new Error("Archived Race evidence natural key is invalid.");
  }
  return value;
}

function decodeRow(line: string): DatasetEvidenceNdjsonRow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    throw new Error("Archived Race evidence contains invalid NDJSON.");
  }
  const row = record(parsed, "Archived Race evidence row");
  const keys = Object.keys(row).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "naturalKey" ||
    keys[1] !== "value" ||
    !("value" in row)
  ) {
    throw new Error("Archived Race evidence row envelope is invalid.");
  }
  return Object.freeze({
    naturalKey: naturalKey(row.naturalKey),
    value: row.value,
  });
}

function expectedNaturalKeyRange(
  rows: readonly DatasetEvidenceNdjsonRow[],
): Readonly<{ first: string | null; last: string | null }> {
  const keyed = rows.filter(
    (row): row is DatasetEvidenceNdjsonRow & { naturalKey: string } =>
      row.naturalKey !== null,
  );
  return {
    first: keyed[0]?.naturalKey ?? null,
    last: keyed.at(-1)?.naturalKey ?? null,
  };
}

function decodePartition(input: {
  registration: DatasetEvidenceObjectRegistration;
  body: Uint8Array;
  maximumUncompressedBytes: number;
  maximumRowsPerPartition: number;
}): DecodedSealedRaceArchivePartition {
  if (
    input.registration.sourceType !== "race_merge" ||
    (input.registration.objectKind !== "staged_rows" &&
      input.registration.objectKind !== "normalized_partition") ||
    input.registration.objectFormat !== "ndjson_gzip"
  ) {
    throw new Error(
      "Archived Race evidence format is not supported for rebuild.",
    );
  }
  if (input.registration.rowCount > input.maximumRowsPerPartition) {
    throw new Error(
      "Archived Race evidence row count exceeds the decode bound.",
    );
  }

  let uncompressed: Uint8Array;
  try {
    uncompressed = gunzipSync(input.body, {
      maxOutputLength: input.maximumUncompressedBytes,
    });
  } catch {
    throw new Error(
      "Archived Race evidence gzip payload is invalid or too large.",
    );
  }
  if (
    uncompressed.byteLength < 1 ||
    uncompressed.byteLength > input.maximumUncompressedBytes
  ) {
    throw new Error(
      "Archived Race evidence exceeds the uncompressed decode bound.",
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(uncompressed);
  } catch {
    throw new Error("Archived Race evidence is not valid UTF-8.");
  }
  if (!text.endsWith("\n")) {
    throw new Error("Archived Race evidence is not canonically terminated.");
  }
  const lines = text.slice(0, -1).split("\n");
  if (
    lines.length !== input.registration.rowCount ||
    lines.length > input.maximumRowsPerPartition ||
    lines.some((line) => line.length === 0)
  ) {
    throw new Error("Archived Race evidence row coverage is invalid.");
  }
  const rows = lines.map(decodeRow);
  const range = expectedNaturalKeyRange(rows);
  if (
    range.first !== input.registration.firstNaturalKey ||
    range.last !== input.registration.lastNaturalKey
  ) {
    throw new Error("Archived Race evidence natural-key coverage is invalid.");
  }

  return Object.freeze({
    registration: input.registration,
    rows: Object.freeze(rows),
    uncompressedByteSize: uncompressed.byteLength,
  });
}

export function createSealedRaceArchiveReader(input: {
  manifestRepository: SealedRaceArchiveManifestRepository;
  objectReader: PrivateDatasetEvidenceObjectReader;
  maximumUncompressedBytesPerPartition: number;
  maximumRowsPerPartition: number;
}): SealedRaceArchiveReader {
  const maximumUncompressedBytes = positiveSafeInteger(
    input.maximumUncompressedBytesPerPartition,
    "maximumUncompressedBytesPerPartition",
  );
  const maximumRowsPerPartition = positiveSafeInteger(
    input.maximumRowsPerPartition,
    "maximumRowsPerPartition",
  );

  return Object.freeze({
    async open(request) {
      const located = await input.manifestRepository.list(request);
      if (located.status === "missing") return located;
      const manifest = located.manifest;
      for (const registration of manifest.objects) {
        if (
          registration.objectFormat !== "ndjson_gzip" ||
          registration.rowCount > maximumRowsPerPartition
        ) {
          throw new Error(
            "Sealed Race archive contains a partition outside the rebuild bounds.",
          );
        }
      }

      const partitions = (async function* () {
        for (const registration of manifest.objects) {
          const verified = await input.objectReader.read(registration);
          if (verified.registration !== registration) {
            if (
              verified.registration.objectKey !== registration.objectKey ||
              verified.registration.checksumSha256 !==
                registration.checksumSha256 ||
              verified.registration.byteSize !== registration.byteSize ||
              verified.registration.rowCount !== registration.rowCount
            ) {
              throw new Error(
                "Verified Race archive object does not match its sealed manifest.",
              );
            }
          }
          yield decodePartition({
            registration,
            body: verified.body,
            maximumUncompressedBytes,
            maximumRowsPerPartition,
          });
        }
      })();

      return Object.freeze({
        status: "ready" as const,
        manifest,
        partitions,
      });
    },
  });
}
