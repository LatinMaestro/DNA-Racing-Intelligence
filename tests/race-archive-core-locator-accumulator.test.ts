import { describe, expect, it } from "vitest";

import type { DurablePreviewStagedRow } from "@/lib/durable-import-preview-staging-sink";
import { createRaceArchiveCoreLocatorAccumulator } from "@/lib/race-archive-core-locator-accumulator";
import type { RehydratedRaceStagedRow } from "@/lib/race-staged-row-rehydrator";

const datasetVersionId = "11111111-1111-4111-8111-111111111111";
const importBatchId = "22222222-2222-4222-8222-222222222222";

function rehydrated(input: {
  sourceRowNumber: number;
  sourceCoreId?: string;
  partitionNumber: number;
  quarantined?: boolean;
  datasetVersionIdOverride?: string;
}): RehydratedRaceStagedRow {
  const quarantined = input.quarantined ?? false;
  const stagedRow: DurablePreviewStagedRow = {
    sourceRowNumber: input.sourceRowNumber,
    naturalKey: quarantined
      ? null
      : `event-${input.sourceRowNumber}:${input.sourceCoreId ?? "core-1"}`,
    fingerprintSha256: quarantined ? null : "a".repeat(64),
    row: quarantined
      ? ({
          status: "quarantined",
          sourceType: "race_merge",
          record: null,
          provenance: [],
          issues: [],
        } as unknown as DurablePreviewStagedRow["row"])
      : ({
          status: "ready",
          sourceType: "race_merge",
          record: {
            sourceType: "race_merge",
            sourceEventId: `event-${input.sourceRowNumber}`,
            sourceCoreId: input.sourceCoreId ?? "core-1",
          },
          provenance: [],
          issues: [],
        } as unknown as DurablePreviewStagedRow["row"]),
  };
  return {
    datasetVersionId: input.datasetVersionIdOverride ?? datasetVersionId,
    importBatchId,
    partitionNumber: input.partitionNumber,
    stagedRow,
  };
}

function accumulator(
  overrides: Partial<{
    maximumCoreLocators: number;
    maximumPartitionsPerCore: number;
  }> = {},
) {
  return createRaceArchiveCoreLocatorAccumulator({
    datasetVersionId,
    importBatchId,
    maximumCoreLocators: overrides.maximumCoreLocators ?? 10,
    maximumPartitionsPerCore: overrides.maximumPartitionsPerCore ?? 10,
  });
}

describe("Race archive Core locator accumulator", () => {
  it("groups ready rows by Core and preserves distinct sorted partition locators", () => {
    const service = accumulator();
    service.append([
      rehydrated({
        sourceRowNumber: 1,
        sourceCoreId: "core-b",
        partitionNumber: 4,
      }),
      rehydrated({
        sourceRowNumber: 2,
        sourceCoreId: "core-a",
        partitionNumber: 3,
      }),
      rehydrated({
        sourceRowNumber: 3,
        sourceCoreId: "core-a",
        partitionNumber: 3,
      }),
      rehydrated({
        sourceRowNumber: 4,
        sourceCoreId: "core-a",
        partitionNumber: 1,
      }),
      rehydrated({
        sourceRowNumber: 5,
        partitionNumber: 4,
        quarantined: true,
      }),
    ]);

    expect(service.finish()).toEqual([
      {
        datasetVersionId,
        importBatchId,
        sourceCoreId: "core-a",
        partitionNumbers: [1, 3],
        readyRowCount: 3,
        firstSourceRowNumber: 2,
        lastSourceRowNumber: 4,
      },
      {
        datasetVersionId,
        importBatchId,
        sourceCoreId: "core-b",
        partitionNumbers: [4],
        readyRowCount: 1,
        firstSourceRowNumber: 1,
        lastSourceRowNumber: 1,
      },
    ]);
  });

  it("fails closed when Core or per-Core partition bounds are exceeded", () => {
    const coreBound = accumulator({ maximumCoreLocators: 1 });
    coreBound.append([
      rehydrated({
        sourceRowNumber: 1,
        sourceCoreId: "core-a",
        partitionNumber: 0,
      }),
    ]);
    expect(() =>
      coreBound.append([
        rehydrated({
          sourceRowNumber: 2,
          sourceCoreId: "core-b",
          partitionNumber: 0,
        }),
      ]),
    ).toThrow("Core locator count exceeds its bound");

    const partitionBound = accumulator({ maximumPartitionsPerCore: 1 });
    partitionBound.append([
      rehydrated({
        sourceRowNumber: 1,
        sourceCoreId: "core-a",
        partitionNumber: 0,
      }),
    ]);
    expect(() =>
      partitionBound.append([
        rehydrated({
          sourceRowNumber: 2,
          sourceCoreId: "core-a",
          partitionNumber: 1,
        }),
      ]),
    ).toThrow("Core partition count exceeds its bound");
  });

  it("rejects rows from another rebuild identity and cannot be reused after finish", () => {
    const service = accumulator();
    expect(() =>
      service.append([
        rehydrated({
          sourceRowNumber: 1,
          partitionNumber: 0,
          datasetVersionIdOverride: "33333333-3333-4333-8333-333333333333",
        }),
      ]),
    ).toThrow("identity conflicts with the rebuild session");

    service.append([
      rehydrated({
        sourceRowNumber: 2,
        partitionNumber: 0,
        quarantined: true,
      }),
    ]);
    expect(service.finish()).toEqual([]);
    expect(() => service.append([])).toThrow("accumulator is finished");
    expect(() => service.finish()).toThrow("accumulator is finished");
  });
});
