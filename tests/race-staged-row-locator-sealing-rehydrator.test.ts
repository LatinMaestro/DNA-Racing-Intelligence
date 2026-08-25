import { describe, expect, it, vi } from "vitest";

import type { DurablePreviewStagedRow } from "../lib/durable-import-preview-staging-sink";
import type { NeonRaceArchiveCoreLocatorRepository } from "../lib/neon-race-archive-core-locator-repository";
import type { SealedRaceArchiveManifest } from "../lib/neon-sealed-race-archive-manifest-repository";
import type {
  RaceStagedRowRehydrator,
  RehydratedRaceStagedRow,
} from "../lib/race-staged-row-rehydrator";
import { createRaceStagedRowLocatorSealingRehydrator } from "../lib/race-staged-row-locator-sealing-rehydrator";

const OWNER = "owner-1";
const VERSION = "11111111-1111-4111-8111-111111111111";
const BATCH = "22222222-2222-4222-8222-222222222222";

function manifest(): SealedRaceArchiveManifest {
  return {
    datasetVersionId: VERSION,
    importBatchId: BATCH,
    sourceType: "race_merge",
    evidenceKind: "staged_rows",
    partitionCount: 2,
    rowCount: 3,
    byteSize: 300,
    objects: [],
  };
}

function readyRow(input: {
  sourceRowNumber: number;
  partitionNumber: number;
  coreId: string;
}): RehydratedRaceStagedRow {
  return {
    datasetVersionId: VERSION,
    importBatchId: BATCH,
    partitionNumber: input.partitionNumber,
    stagedRow: {
      sourceRowNumber: input.sourceRowNumber,
      naturalKey: `event-${input.sourceRowNumber}:${input.coreId}`,
      fingerprintSha256: "a".repeat(64),
      row: {
        status: "ready",
        sourceType: "race_merge",
        record: {
          sourceType: "race_merge",
          sourceEventId: `event-${input.sourceRowNumber}`,
          sourceCoreId: input.coreId,
        },
        provenance: [],
        issues: [],
      } as unknown as DurablePreviewStagedRow["row"],
    },
  };
}

function quarantinedRow(): RehydratedRaceStagedRow {
  return {
    datasetVersionId: VERSION,
    importBatchId: BATCH,
    partitionNumber: 1,
    stagedRow: {
      sourceRowNumber: 3,
      naturalKey: null,
      fingerprintSha256: null,
      row: {
        status: "quarantined",
        sourceType: "race_merge",
        record: null,
        provenance: [],
        issues: [],
      } as unknown as DurablePreviewStagedRow["row"],
    },
  };
}

function source(): RaceStagedRowRehydrator {
  return {
    async open() {
      return {
        status: "ready" as const,
        manifest: manifest(),
        rows: (async function* () {
          yield readyRow({
            sourceRowNumber: 1,
            partitionNumber: 0,
            coreId: "core-1",
          });
          yield readyRow({
            sourceRowNumber: 2,
            partitionNumber: 1,
            coreId: "core-1",
          });
          yield quarantinedRow();
        })(),
      };
    },
  };
}

function repository(input?: { wrongCount?: boolean }) {
  const replace = vi.fn(
    async (
      request: Parameters<NeonRaceArchiveCoreLocatorRepository["replace"]>[0],
    ) => ({
      status: "sealed" as const,
      datasetVersionId: request.datasetVersionId,
      importBatchId: request.importBatchId,
      locatorSetSha256: "b".repeat(64),
      coreLocatorCount: input?.wrongCount
        ? request.locators.length + 1
        : request.locators.length,
      readyRowCount: 2,
      partitionReferenceCount: 2,
      builtAt: request.builtAt,
    }),
  );
  return {
    replace,
    repository: {
      replace,
      listForCore: vi.fn(async () => []),
    } as NeonRaceArchiveCoreLocatorRepository,
  };
}

async function collect(rehydrator: RaceStagedRowRehydrator) {
  const opened = await rehydrator.open({
    ownerId: OWNER,
    datasetVersionId: VERSION,
    maximumPartitions: 10,
  });
  if (opened.status !== "ready") throw new Error("expected ready archive");
  const rows: RehydratedRaceStagedRow[] = [];
  for await (const row of opened.rows) rows.push(row);
  return rows;
}

describe("Race staged-row locator-sealing rehydrator", () => {
  it("seals canonical Core-to-partition locators after complete archive consumption", async () => {
    const test = repository();
    const rehydrator = createRaceStagedRowLocatorSealingRehydrator({
      rehydrator: source(),
      coreLocatorRepository: test.repository,
      now: () => new Date("2026-08-25T09:30:00.000Z"),
    });

    await expect(collect(rehydrator)).resolves.toHaveLength(3);
    expect(test.replace).toHaveBeenCalledOnce();
    expect(test.replace).toHaveBeenCalledWith({
      ownerId: OWNER,
      datasetVersionId: VERSION,
      importBatchId: BATCH,
      locators: [
        {
          datasetVersionId: VERSION,
          importBatchId: BATCH,
          sourceCoreId: "core-1",
          partitionNumbers: [0, 1],
          readyRowCount: 2,
          firstSourceRowNumber: 1,
          lastSourceRowNumber: 2,
        },
      ],
      builtAt: "2026-08-25T09:30:00.000Z",
    });
  });

  it("does not publish a locator receipt when the archive stream is not exhausted", async () => {
    const test = repository();
    const rehydrator = createRaceStagedRowLocatorSealingRehydrator({
      rehydrator: source(),
      coreLocatorRepository: test.repository,
    });
    const opened = await rehydrator.open({
      ownerId: OWNER,
      datasetVersionId: VERSION,
      maximumPartitions: 10,
    });
    if (opened.status !== "ready") throw new Error("expected ready archive");
    for await (const _row of opened.rows) break;
    expect(test.replace).not.toHaveBeenCalled();
  });

  it("fails closed when the durable locator receipt changes verified coverage", async () => {
    const test = repository({ wrongCount: true });
    const rehydrator = createRaceStagedRowLocatorSealingRehydrator({
      rehydrator: source(),
      coreLocatorRepository: test.repository,
    });
    await expect(collect(rehydrator)).rejects.toThrow(
      "Race archive Core locator receipt conflicts with rehydrated evidence",
    );
  });
});
