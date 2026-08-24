import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { DatasetEvidenceObjectRegistration } from "@/lib/neon-dataset-evidence-object-repository";
import type {
  NeonRaceArchiveCoreLocatorRepository,
  PersistedRaceArchiveCoreLocator,
} from "@/lib/neon-race-archive-core-locator-repository";
import { createRaceArchiveCoreHistoryService } from "@/lib/race-archive-core-history-service";
import type {
  DecodedSealedRaceArchivePartition,
  SealedRaceArchiveReader,
} from "@/lib/sealed-race-archive-reader";

const ownerId = "user_owner";
const coreId = "core-1";
const firstDatasetVersionId = "11111111-1111-4111-8111-111111111111";
const firstImportBatchId = "22222222-2222-4222-8222-222222222222";
const secondDatasetVersionId = "33333333-3333-4333-8333-333333333333";
const secondImportBatchId = "44444444-4444-4444-8444-444444444444";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function readyEvidence(input: {
  sourceRowNumber: number;
  sourceEventId: string;
  sourceCoreId?: string;
  extra?: Readonly<Record<string, unknown>>;
}) {
  const sourceCoreId = input.sourceCoreId ?? coreId;
  const raceRecord = {
    sourceType: "race_merge",
    sourceEventId: input.sourceEventId,
    sourceCoreId,
    ...input.extra,
  };
  const naturalKey = `${input.sourceEventId}:${sourceCoreId}`;
  return Object.freeze({
    naturalKey,
    value: {
      sourceRowNumber: input.sourceRowNumber,
      naturalKey,
      fingerprintSha256: fingerprint(raceRecord),
      row: {
        sourceType: "race_merge",
        status: "ready",
        record: raceRecord,
        provenance: [],
        issues: [],
      },
    },
  });
}

function quarantinedEvidence(sourceRowNumber: number) {
  return Object.freeze({
    naturalKey: null,
    value: {
      sourceRowNumber,
      naturalKey: null,
      fingerprintSha256: null,
      row: {
        sourceType: "race_merge",
        status: "quarantined",
        record: null,
        provenance: [],
        issues: [],
      },
    },
  });
}

function registration(input: {
  importBatchId: string;
  partitionNumber: number;
  rowCount: number;
}): DatasetEvidenceObjectRegistration {
  return {
    ownerId,
    importBatchId: input.importBatchId,
    sourceType: "race_merge",
    objectKind: "staged_rows",
    partitionNumber: input.partitionNumber,
    objectFormat: "ndjson_gzip",
    objectKey: `private/${input.importBatchId}/part-${input.partitionNumber}.ndjson.gz`,
    checksumSha256: "a".repeat(64),
    byteSize: 100,
    rowCount: input.rowCount,
    firstNaturalKey: null,
    lastNaturalKey: null,
    createdAt: "2026-08-25T00:00:00.000Z",
  };
}

function locator(
  input: {
    datasetVersionId?: string;
    importBatchId?: string;
    versionNumber?: number;
    partitionNumbers?: readonly number[];
    readyRowCount?: number;
    firstSourceRowNumber?: number;
    lastSourceRowNumber?: number;
  } = {},
): PersistedRaceArchiveCoreLocator {
  return Object.freeze({
    datasetVersionId: input.datasetVersionId ?? firstDatasetVersionId,
    importBatchId: input.importBatchId ?? firstImportBatchId,
    sourceCoreId: coreId,
    versionNumber: input.versionNumber ?? 1,
    partitionNumbers: input.partitionNumbers ?? [2],
    readyRowCount: input.readyRowCount ?? 2,
    firstSourceRowNumber: input.firstSourceRowNumber ?? 4,
    lastSourceRowNumber: input.lastSourceRowNumber ?? 8,
    builtAt: "2026-08-25T00:00:00.000Z",
  });
}

function partition(input: {
  importBatchId?: string;
  partitionNumber?: number;
  rows: readonly Readonly<{ naturalKey: string | null; value: unknown }>[];
}): DecodedSealedRaceArchivePartition {
  return Object.freeze({
    registration: registration({
      importBatchId: input.importBatchId ?? firstImportBatchId,
      partitionNumber: input.partitionNumber ?? 2,
      rowCount: input.rows.length,
    }),
    rows: input.rows,
    uncompressedByteSize: 1000,
  });
}

function harness(input: {
  locators?: readonly PersistedRaceArchiveCoreLocator[];
  archives?: ReadonlyMap<
    string,
    Readonly<{
      importBatchId: string;
      partitions: readonly DecodedSealedRaceArchivePartition[];
    }>
  >;
  maximumHistoryRows?: number;
}) {
  const listForCore = vi.fn(async () => input.locators ?? []);
  const replace = vi.fn(async () => {
    throw new Error("replace should not be called by history reads");
  });
  const open = vi.fn(async () => ({ status: "missing" as const }));
  const openSelected = vi.fn(
    async (request: {
      ownerId: string;
      datasetVersionId: string;
      maximumPartitions: number;
      partitionNumbers: readonly number[];
    }) => {
      const archive = input.archives?.get(request.datasetVersionId);
      if (archive === undefined) return { status: "missing" as const };
      const rows = archive.partitions.reduce(
        (total, item) => total + item.rows.length,
        0,
      );
      return {
        status: "ready" as const,
        manifest: {
          datasetVersionId: request.datasetVersionId,
          importBatchId: archive.importBatchId,
          sourceType: "race_merge" as const,
          evidenceKind: "staged_rows" as const,
          partitionCount: archive.partitions.length,
          rowCount: rows,
          byteSize: archive.partitions.length * 100,
          objects: archive.partitions.map((item) => item.registration),
        },
        partitions: (async function* () {
          for (const item of archive.partitions) yield item;
        })(),
      };
    },
  );
  const locatorRepository: NeonRaceArchiveCoreLocatorRepository = {
    replace,
    listForCore,
  };
  const archiveReader: SealedRaceArchiveReader = { open, openSelected };
  const service = createRaceArchiveCoreHistoryService({
    locatorRepository,
    archiveReader,
    maximumVersions: 5,
    maximumArchivePartitions: 100,
    maximumHistoryRows: input.maximumHistoryRows ?? 100,
  });
  return { service, listForCore, replace, open, openSelected };
}

describe("Race archive Core history service", () => {
  it("returns empty bounded history without scanning the archive when no locator exists", async () => {
    const test = harness({});

    await expect(
      test.service.load({ ownerId, sourceCoreId: coreId }),
    ).resolves.toEqual({
      sourceCoreId: coreId,
      locatorVersionCount: 0,
      selectedPartitionCount: 0,
      rows: [],
    });
    expect(test.listForCore).toHaveBeenCalledWith({
      ownerId,
      sourceCoreId: coreId,
      maximumVersions: 5,
    });
    expect(test.open).not.toHaveBeenCalled();
    expect(test.openSelected).not.toHaveBeenCalled();
    expect(test.replace).not.toHaveBeenCalled();
  });

  it("reads only locator-selected partitions and returns exact Core rows", async () => {
    const selected = partition({
      rows: [
        readyEvidence({ sourceRowNumber: 4, sourceEventId: "event-1" }),
        readyEvidence({
          sourceRowNumber: 5,
          sourceEventId: "event-2",
          sourceCoreId: "core-foreign",
        }),
        quarantinedEvidence(6),
        readyEvidence({ sourceRowNumber: 8, sourceEventId: "event-3" }),
      ],
    });
    const test = harness({
      locators: [locator()],
      archives: new Map([
        [
          firstDatasetVersionId,
          { importBatchId: firstImportBatchId, partitions: [selected] },
        ],
      ]),
    });

    const history = await test.service.load({ ownerId, sourceCoreId: coreId });

    expect(history).toMatchObject({
      sourceCoreId: coreId,
      locatorVersionCount: 1,
      selectedPartitionCount: 1,
    });
    expect(history.rows.map((row) => row.naturalKey)).toEqual([
      "event-1:core-1",
      "event-3:core-1",
    ]);
    expect(history.rows.map((row) => row.sourceRowNumber)).toEqual([4, 8]);
    expect(test.openSelected).toHaveBeenCalledWith({
      ownerId,
      datasetVersionId: firstDatasetVersionId,
      maximumPartitions: 100,
      partitionNumbers: [2],
    });
    expect(test.open).not.toHaveBeenCalled();
  });

  it("deduplicates exact cross-version replay and fails closed on conflicting replay", async () => {
    const firstRow = readyEvidence({
      sourceRowNumber: 4,
      sourceEventId: "event-1",
    });
    const secondReplay = readyEvidence({
      sourceRowNumber: 9,
      sourceEventId: "event-1",
    });
    const firstLocator = locator({ readyRowCount: 1, lastSourceRowNumber: 4 });
    const secondLocator = locator({
      datasetVersionId: secondDatasetVersionId,
      importBatchId: secondImportBatchId,
      versionNumber: 2,
      partitionNumbers: [7],
      readyRowCount: 1,
      firstSourceRowNumber: 9,
      lastSourceRowNumber: 9,
    });
    const replay = harness({
      locators: [firstLocator, secondLocator],
      archives: new Map([
        [
          firstDatasetVersionId,
          {
            importBatchId: firstImportBatchId,
            partitions: [partition({ rows: [firstRow] })],
          },
        ],
        [
          secondDatasetVersionId,
          {
            importBatchId: secondImportBatchId,
            partitions: [
              partition({
                importBatchId: secondImportBatchId,
                partitionNumber: 7,
                rows: [secondReplay],
              }),
            ],
          },
        ],
      ]),
    });

    const replayed = await replay.service.load({
      ownerId,
      sourceCoreId: coreId,
    });
    expect(replayed.rows).toHaveLength(1);
    expect(replayed.selectedPartitionCount).toBe(2);

    const conflictRow = readyEvidence({
      sourceRowNumber: 9,
      sourceEventId: "event-1",
      extra: { elapsedTime: 9.99 },
    });
    const conflict = harness({
      locators: [firstLocator, secondLocator],
      archives: new Map([
        [
          firstDatasetVersionId,
          {
            importBatchId: firstImportBatchId,
            partitions: [partition({ rows: [firstRow] })],
          },
        ],
        [
          secondDatasetVersionId,
          {
            importBatchId: secondImportBatchId,
            partitions: [
              partition({
                importBatchId: secondImportBatchId,
                partitionNumber: 7,
                rows: [conflictRow],
              }),
            ],
          },
        ],
      ]),
    });

    await expect(
      conflict.service.load({ ownerId, sourceCoreId: coreId }),
    ).rejects.toThrow("conflicting replay evidence");
  });

  it("fails closed when locator identity or coverage disagrees with sealed evidence", async () => {
    const onlyRow = readyEvidence({
      sourceRowNumber: 4,
      sourceEventId: "event-1",
    });
    const wrongImport = harness({
      locators: [locator({ readyRowCount: 1, lastSourceRowNumber: 4 })],
      archives: new Map([
        [
          firstDatasetVersionId,
          {
            importBatchId: secondImportBatchId,
            partitions: [partition({ rows: [onlyRow] })],
          },
        ],
      ]),
    });
    await expect(
      wrongImport.service.load({ ownerId, sourceCoreId: coreId }),
    ).rejects.toThrow("conflicts with sealed evidence identity");

    const wrongCoverage = harness({
      locators: [locator()],
      archives: new Map([
        [
          firstDatasetVersionId,
          {
            importBatchId: firstImportBatchId,
            partitions: [partition({ rows: [onlyRow] })],
          },
        ],
      ]),
    });
    await expect(
      wrongCoverage.service.load({ ownerId, sourceCoreId: coreId }),
    ).rejects.toThrow("coverage conflicts with its locator");
  });

  it("rejects duplicate partition delivery and malformed quarantined evidence", async () => {
    const row = readyEvidence({ sourceRowNumber: 4, sourceEventId: "event-1" });
    const duplicate = partition({ rows: [row] });
    const duplicatePartition = harness({
      locators: [locator({ readyRowCount: 1, lastSourceRowNumber: 4 })],
      archives: new Map([
        [
          firstDatasetVersionId,
          {
            importBatchId: firstImportBatchId,
            partitions: [duplicate, duplicate],
          },
        ],
      ]),
    });
    await expect(
      duplicatePartition.service.load({ ownerId, sourceCoreId: coreId }),
    ).rejects.toThrow("duplicate partition");

    const malformedQuarantine = Object.freeze({
      naturalKey: null,
      value: {
        sourceRowNumber: 6,
        naturalKey: null,
        fingerprintSha256: null,
        row: {
          sourceType: "race_merge",
          status: "quarantined",
          record: { sourceType: "race_merge" },
          provenance: [],
          issues: [],
        },
      },
    });
    const quarantined = harness({
      locators: [locator({ readyRowCount: 1, lastSourceRowNumber: 4 })],
      archives: new Map([
        [
          firstDatasetVersionId,
          {
            importBatchId: firstImportBatchId,
            partitions: [partition({ rows: [malformedQuarantine] })],
          },
        ],
      ]),
    });
    await expect(
      quarantined.service.load({ ownerId, sourceCoreId: coreId }),
    ).rejects.toThrow(
      "Quarantined Race staged-row unexpectedly contains identity evidence",
    );
  });

  it("fails closed when bounded unique Core history would exceed its configured row limit", async () => {
    const selected = partition({
      rows: [
        readyEvidence({ sourceRowNumber: 4, sourceEventId: "event-1" }),
        readyEvidence({ sourceRowNumber: 8, sourceEventId: "event-2" }),
      ],
    });
    const test = harness({
      locators: [locator()],
      archives: new Map([
        [
          firstDatasetVersionId,
          { importBatchId: firstImportBatchId, partitions: [selected] },
        ],
      ]),
      maximumHistoryRows: 1,
    });

    await expect(
      test.service.load({ ownerId, sourceCoreId: coreId }),
    ).rejects.toThrow("exceeds the configured row bound");
  });
});
