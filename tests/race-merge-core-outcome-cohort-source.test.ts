import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  materializeRaceMergeCoreOutcomeSourceCohort,
  type RaceMergeCoreOutcomeCohortSourceBounds,
} from "@/lib/race-merge-core-outcome-cohort-source";
import type { PrivateRawImportObjectStore } from "@/lib/private-raw-import-object-stream";
import type { RaceMergeOutcomeImportReference } from "@/lib/race-merge-outcome-ingestion-service";

const encoder = new TextEncoder();
const bounds: RaceMergeCoreOutcomeCohortSourceBounds = Object.freeze({
  maximumFiles: 8,
  maximumTotalBytes: 1_000_000,
  maximumObjectBytes: 500_000,
  maximumChunkBytes: 100_000,
  maximumRowsPerObject: 10_000,
  maximumRowsPerGeneration: 20_000,
  maximumHeaderColumns: 100,
  maximumFieldCharacters: 1_000,
  maximumRowCharacters: 10_000,
  maximumSelectedObservations: 1_000,
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function source(files: Readonly<Record<string, string>>) {
  const encoded = new Map(
    Object.entries(files).map(([id, value]) => [id, encoder.encode(value)]),
  );
  const references: RaceMergeOutcomeImportReference[] = Object.freeze(
    [...encoded.entries()].map(([objectId, bytes]) =>
      Object.freeze({
        objectId,
        sourceFamily: "race_merge" as const,
        expectedByteLength: bytes.byteLength,
        expectedSha256: sha256(bytes),
      }),
    ),
  ) as unknown as RaceMergeOutcomeImportReference[];
  const objectStore: PrivateRawImportObjectStore = Object.freeze({
    async openObject(input) {
      const bytes = encoded.get(input.objectId);
      if (bytes === undefined) throw new Error("missing");
      return Object.freeze({
        advertisedByteLength: bytes.byteLength,
        body: (async function* () {
          const split = Math.max(1, Math.floor(bytes.byteLength / 2));
          yield bytes.slice(0, split);
          yield bytes.slice(split);
        })(),
      });
    },
  });
  return { references, objectStore };
}

function request(
  files: Readonly<Record<string, string>>,
  overrides: Partial<
    Parameters<typeof materializeRaceMergeCoreOutcomeSourceCohort>[0]
  > = {},
) {
  const prepared = source(files);
  return {
    ownerId: "private-owner",
    generationId: "race-merge-generation",
    references: prepared.references,
    objectStore: prepared.objectStore,
    afterSourceCoreId: 0,
    maximumCores: 100,
    bounds,
    ...overrides,
  };
}

describe("Race Merge Core outcome cohort source", () => {
  it("streams old and new CSV shapes into the next deterministic Core slice", async () => {
    const result = await materializeRaceMergeCoreOutcomeSourceCohort(
      request(
        {
          "new-shape":
            "event_id,token_id,pos,time,rmode\nrace-3,300,3,13.003,Bike\nrace-1,101,2,11.001,Bike\n",
          "old-shape":
            "event_id,token_id,pos,time\nrace-2,202,1,12.002\nrace-1,101,2,11.001\nrace-4,99,4,14.004\n",
        },
        { afterSourceCoreId: 100, maximumCores: 2 },
      ),
    );

    expect(result).toMatchObject({
      sourceObjectCount: 2,
      sourceRowCount: 5,
      selectedCoreCount: 2,
      selectedObservationCount: 3,
      selectedUniqueOutcomeCount: 2,
      selectedExactReplayCount: 1,
      firstSourceCoreId: 101,
      lastSourceCoreId: 202,
      dnaProviderRequestCount: 0,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(result.sourceManifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.cores.map((core) => core.sourceCoreId)).toEqual([101, 202]);
    expect(result.cores[0]!.observations).toEqual([
      expect.objectContaining({
        sourceRaceId: "race-1",
        sourceCoreId: 101,
        finishPosition: 2,
        elapsedMilliseconds: 11_001,
        source: "race_merge",
        sourceRowNumber: 2,
      }),
      expect.objectContaining({
        sourceRaceId: "race-1",
        sourceCoreId: 101,
        sourceRowNumber: 2,
      }),
    ]);
  });

  it("evicts a larger early Core when a smaller identity appears later", async () => {
    const result = await materializeRaceMergeCoreOutcomeSourceCohort(
      request(
        {
          source:
            "event_id,token_id,pos,time\nrace-3,300,3,13.003\nrace-1,100,1,11.001\nrace-2,200,2,12.002\n",
        },
        { maximumCores: 1 },
      ),
    );
    expect(result.cores.map((core) => core.sourceCoreId)).toEqual([100]);
    expect(result.selectedObservationCount).toBe(1);
  });

  it("fails closed on conflicting selected Race/Core evidence", async () => {
    await expect(
      materializeRaceMergeCoreOutcomeSourceCohort(
        request({
          source:
            "event_id,token_id,pos,time\nrace-1,101,1,11.001\nrace-1,101,2,11.001\n",
        }),
      ),
    ).rejects.toThrow("sink_write_failed");
  });

  it("rejects checksum drift before returning any cohort", async () => {
    const value = request({
      source: "event_id,token_id,pos,time\nrace-1,101,1,11.001\n",
    });
    const references = [
      { ...value.references[0]!, expectedSha256: "a".repeat(64) },
    ];
    await expect(
      materializeRaceMergeCoreOutcomeSourceCohort({
        ...value,
        references,
      }),
    ).rejects.toThrow("checksum_mismatch");
  });

  it("fails closed when the retained observation bound is exceeded", async () => {
    await expect(
      materializeRaceMergeCoreOutcomeSourceCohort(
        request(
          {
            source:
              "event_id,token_id,pos,time\nrace-1,101,1,11.001\nrace-2,101,2,12.002\n",
          },
          {
            bounds: { ...bounds, maximumSelectedObservations: 1 },
          },
        ),
      ),
    ).rejects.toThrow("sink_write_failed");
  });
});
