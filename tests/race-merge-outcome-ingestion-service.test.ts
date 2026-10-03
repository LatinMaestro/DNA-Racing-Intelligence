import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createRaceMergeOutcomeGenerationLoader,
  ingestRaceMergeOutcomeEvidence,
  type RaceMergeOutcomeEvidenceRow,
  type RaceMergeOutcomeImportReference,
  type RaceMergeOutcomeIngestionRepository,
  type RaceMergeOutcomeObjectReceipt,
} from "@/lib/race-merge-outcome-ingestion-service";

const encoder = new TextEncoder();
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

function reference(
  objectId: string,
  csv: string,
): RaceMergeOutcomeImportReference {
  const bytes = encoder.encode(csv);
  return {
    objectId,
    sourceFamily: "race_merge",
    expectedByteLength: bytes.byteLength,
    expectedSha256: digest(bytes),
  };
}

const bounds = Object.freeze({
  maximumFiles: 8,
  maximumTotalBytes: 1_000_000,
  maximumObjectBytes: 500_000,
  maximumChunkBytes: 64,
  maximumRowsPerObject: 100,
  maximumRowsPerGeneration: 200,
  maximumHeaderColumns: 50,
  maximumFieldCharacters: 1_000,
  maximumRowCharacters: 10_000,
  rowsPerWrite: 2,
});
const now = new Date("2026-10-03T08:00:00.000Z");
const zeroCostCapacityGate = {
  async authorize(input: {
    ownerId: string;
    generationId: string;
    manifestDigestSha256: string;
  }) {
    return {
      ownerId: input.ownerId,
      generationId: input.generationId,
      manifestDigestSha256: input.manifestDigestSha256,
      measuredAt: "2026-10-03T07:59:00.000Z",
      validUntil: "2026-10-03T08:04:00.000Z",
      projectedR2RetainedBytes: 1_000_000,
      projectedNeonStorageBytes: 1_000_000,
      projectedPaidCostAud: 0 as const,
    };
  },
};

function objectStore(objects: ReadonlyMap<string, string>) {
  return {
    async openObject({ objectId }: { ownerId: string; objectId: string }) {
      const value = objects.get(objectId);
      if (value === undefined) throw new Error("missing");
      const bytes = encoder.encode(value);
      return {
        advertisedByteLength: bytes.byteLength,
        body: (async function* () {
          for (let offset = 0; offset < bytes.byteLength; offset += 17) {
            yield bytes.slice(offset, offset + 17);
          }
        })(),
      };
    },
  };
}

function repositoryHarness() {
  const outcomes = new Map<string, RaceMergeOutcomeEvidenceRow>();
  const receipts = new Map<string, RaceMergeOutcomeObjectReceipt>();
  const objectRows = new Map<string, RaceMergeOutcomeEvidenceRow[]>();
  const aborts: string[] = [];
  let exactReplayCount = 0;

  const repository: RaceMergeOutcomeIngestionRepository = {
    async resumeObject({ objectId, expectedByteLength, expectedSha256 }) {
      const existing = receipts.get(objectId);
      if (existing === undefined) return null;
      if (
        existing.byteLength !== expectedByteLength ||
        existing.sha256 !== expectedSha256
      ) {
        throw new Error("resume conflict");
      }
      return existing;
    },
    async beginObject(begin) {
      const pending: RaceMergeOutcomeEvidenceRow[] = [];
      return {
        async appendOutcomes(rows) {
          for (const row of rows) pending.push(row);
        },
        async commitVerified(verified) {
          for (const row of pending) {
            const key = `${row.sourceCoreId}\u0000${row.sourceRaceId}`;
            const existing = outcomes.get(key);
            if (existing === undefined) {
              outcomes.set(key, row);
            } else if (
              existing.finishPosition === row.finishPosition &&
              existing.elapsedMilliseconds === row.elapsedMilliseconds
            ) {
              exactReplayCount += 1;
            } else {
              throw new Error("Race/Core outcome conflict");
            }
          }
          objectRows.set(begin.objectId, [...pending]);
          const receipt = Object.freeze({
            objectId: begin.objectId,
            byteLength: verified.byteLength,
            sha256: verified.sha256,
            rowCount: verified.rowCount,
            orderedOutcomeDigestSha256: verified.orderedOutcomeDigestSha256,
          });
          receipts.set(begin.objectId, receipt);
          return receipt;
        },
        async rollback() {},
      };
    },
    async finalizeGeneration(input) {
      const ordered = [...outcomes.values()].sort(
        (left, right) =>
          left.sourceCoreId - right.sourceCoreId ||
          left.sourceRaceId.localeCompare(right.sourceRaceId),
      );
      return {
        status: "complete",
        generationId: input.generationId,
        objectCount: input.objects.length,
        sourceRowCount: input.objects.reduce(
          (total, object) => total + object.rowCount,
          0,
        ),
        uniqueOutcomeCount: outcomes.size,
        exactReplayCount,
        manifestDigestSha256: input.manifestDigestSha256,
        outcomeSetDigestSha256: digest(
          ordered
            .map(
              (row) =>
                `${row.sourceCoreId}\u0000${row.sourceRaceId}\u0000${row.finishPosition}\u0000${row.elapsedMilliseconds}\n`,
            )
            .join(""),
        ),
        dnaProviderRequestCount: 0,
      };
    },
    async abortGeneration({ reason }) {
      aborts.push(reason);
    },
  };

  return { repository, outcomes, receipts, objectRows, aborts };
}

describe("Race Merge outcome ingestion", () => {
  it("accepts the narrow outcome contract without rmode and deduplicates exact replays", async () => {
    const oldCsv = [
      "event_id,token_id,pos,time,rstart_time",
      'race-1,101,2,"12.345",2026-07-11T00:00:00Z',
    ].join("\n");
    const newCsv = [
      "token_id,event_id,time,pos,rmode",
      "101,race-1,12.345,2,bike",
      "202,race-2,9.5,1,horse",
      "",
    ].join("\r\n");
    const objects = new Map([
      ["old", oldCsv],
      ["new", newCsv],
    ]);
    const harness = repositoryHarness();

    const result = await ingestRaceMergeOutcomeEvidence({
      ownerId: "owner-1",
      generationId: "generation-1",
      references: [reference("new", newCsv), reference("old", oldCsv)],
      objectStore: objectStore(objects),
      repository: harness.repository,
      zeroCostCapacityGate,
      bounds,
      now,
    });

    expect(result).toMatchObject({
      status: "complete",
      objectCount: 2,
      sourceRowCount: 3,
      uniqueOutcomeCount: 2,
      exactReplayCount: 1,
      dnaProviderRequestCount: 0,
    });
    expect(harness.outcomes.get("101\u0000race-1")).toMatchObject({
      source: "race_merge",
      finishPosition: 2,
      elapsedMilliseconds: 12_345,
      sourceRowNumber: 1,
    });
    expect(harness.outcomes.get("202\u0000race-2")).toMatchObject({
      finishPosition: 1,
      elapsedMilliseconds: 9_500,
    });
    expect(harness.aborts).toEqual([]);
  });

  it("resumes checksum-bound objects without rereading private evidence", async () => {
    const csv = "event_id,token_id,pos,time\nrace-1,101,2,12.345\n";
    const harness = repositoryHarness();
    const objects = new Map([["one", csv]]);
    const request = {
      ownerId: "owner-1",
      generationId: "generation-1",
      references: [reference("one", csv)],
      repository: harness.repository,
      zeroCostCapacityGate,
      bounds,
      now,
    } as const;

    const first = await ingestRaceMergeOutcomeEvidence({
      ...request,
      objectStore: objectStore(objects),
    });
    const second = await ingestRaceMergeOutcomeEvidence({
      ...request,
      objectStore: {
        async openObject(): Promise<never> {
          throw new Error("resumed evidence must not be reread");
        },
      },
    });

    expect(second).toEqual(first);
  });

  it("fails closed when two source objects disagree on a Race/Core outcome", async () => {
    const first = "event_id,token_id,pos,time\nrace-1,101,2,12.345\n";
    const conflict = "event_id,token_id,pos,time\nrace-1,101,3,12.345\n";
    const harness = repositoryHarness();

    await expect(
      ingestRaceMergeOutcomeEvidence({
        ownerId: "owner-1",
        generationId: "generation-1",
        references: [reference("a", first), reference("b", conflict)],
        objectStore: objectStore(
          new Map([
            ["a", first],
            ["b", conflict],
          ]),
        ),
        repository: harness.repository,
        zeroCostCapacityGate,
        bounds,
        now,
      }),
    ).rejects.toThrow("sink_commit_failed");
    expect(harness.aborts).toEqual(["object_failed"]);
  });

  it("rejects missing minimal columns and invalid outcome values", async () => {
    for (const csv of [
      "event_id,token_id,pos\nrace-1,101,2\n",
      "event_id,token_id,pos,time\nrace-1,101,0,12.345\n",
    ]) {
      const harness = repositoryHarness();
      await expect(
        ingestRaceMergeOutcomeEvidence({
          ownerId: "owner-1",
          generationId: "generation-1",
          references: [reference("one", csv)],
          objectStore: objectStore(new Map([["one", csv]])),
          repository: harness.repository,
          zeroCostCapacityGate,
          bounds,
          now,
        }),
      ).rejects.toThrow();
      expect(harness.aborts).toEqual(["object_failed"]);
    }
  });

  it("binds a generation reader to one owner and generation", async () => {
    const calls: unknown[] = [];
    const loader = createRaceMergeOutcomeGenerationLoader({
      ownerId: "owner-1",
      generationId: "generation-1",
      reader: {
        async loadCoreOutcomes(input) {
          calls.push(input);
          return [];
        },
      },
    });

    await expect(loader(101)).resolves.toEqual([]);
    expect(calls).toEqual([
      {
        ownerId: "owner-1",
        generationId: "generation-1",
        sourceCoreId: 101,
      },
    ]);
    await expect(loader(0)).rejects.toThrow("sourceCoreId is invalid");
  });

  it("fails before opening evidence or a transaction without fresh A$0 capacity", async () => {
    const csv = "event_id,token_id,pos,time\nrace-1,101,2,12.345\n";
    const harness = repositoryHarness();
    let opened = false;

    await expect(
      ingestRaceMergeOutcomeEvidence({
        ownerId: "owner-1",
        generationId: "generation-1",
        references: [reference("one", csv)],
        objectStore: {
          async openObject(): Promise<never> {
            opened = true;
            throw new Error("must not open");
          },
        },
        repository: harness.repository,
        zeroCostCapacityGate: {
          async authorize(input) {
            return {
              ...input,
              measuredAt: "2026-10-03T07:59:00.000Z",
              validUntil: "2026-10-03T08:04:00.000Z",
              projectedR2RetainedBytes: 9_500_000_001,
              projectedNeonStorageBytes: 1_000_000,
              projectedPaidCostAud: 0,
            };
          },
        },
        bounds,
        now,
      }),
    ).rejects.toThrow("fresh zero-cost capacity authority is invalid");
    expect(opened).toBe(false);
    expect(harness.aborts).toEqual([]);
  });
});
