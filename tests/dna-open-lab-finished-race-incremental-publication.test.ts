import { describe, expect, it, vi } from "vitest";

import type { DnaFinishedRaceBackfillCheckpoint } from "@/lib/dna-open-lab-finished-race-backfill";
import {
  completeDnaFinishedRaceIncrementalCycle,
  createDnaFinishedRaceIncrementalCycle,
} from "@/lib/dna-open-lab-finished-race-incremental-cycle";
import {
  publishDnaFinishedRaceIncrementalCycle,
  validateDnaFinishedRaceIncrementalReceiptSet,
  type DnaFinishedRaceIncrementalPublicationRepository,
  type DnaFinishedRaceIncrementalWindowReceipt,
} from "@/lib/dna-open-lab-finished-race-incremental-publication";

const lowerBoundAt = "2026-09-02T00:11:55.961Z";
const midpointAt = "2026-09-02T12:11:55.961Z";
const upperBoundAt = "2026-09-03T00:11:55.961Z";

function completedCycle() {
  const checkpoint: DnaFinishedRaceBackfillCheckpoint = Object.freeze({
    version: 1,
    rootWindow: Object.freeze({
      startTime: lowerBoundAt,
      endTime: upperBoundAt,
    }),
    pendingWindows: Object.freeze([]),
    minimumWindowMilliseconds: 1,
    completedWindowCount: 2,
    splitCount: 1,
    successfulFinishedRaceRequestCount: 3,
    raceDocumentRequestCount: 2,
    publishedWindowDocumentCount: 3,
    identityOmissionAuthority: null,
    omittedIdentityObservationCount: 0,
  });
  const initialCheckpoint = Object.freeze({
    ...checkpoint,
    pendingWindows: Object.freeze([checkpoint.rootWindow]),
    completedWindowCount: 0,
    splitCount: 0,
    successfulFinishedRaceRequestCount: 0,
    raceDocumentRequestCount: 0,
    publishedWindowDocumentCount: 0,
  });
  return completeDnaFinishedRaceIncrementalCycle({
    cycle: createDnaFinishedRaceIncrementalCycle({
      lowerBoundAt,
      upperBoundAt,
      previousCompletedCycleId: null,
      checkpoint: initialCheckpoint,
    }),
    checkpoint,
    completedAt: "2026-09-03T00:12:00.000Z",
  });
}

function receipt(input: {
  start: string;
  end: string;
  key: string;
  documents: number;
}): DnaFinishedRaceIncrementalWindowReceipt {
  const cycle = completedCycle();
  return Object.freeze({
    cycleId: cycle.cycleId,
    firstAttemptNumber: 1,
    windowStartAt: input.start,
    windowEndAt: input.end,
    windowKey: input.key.repeat(64),
    contentSha256: "c".repeat(64),
    documentCount: input.documents,
    manifestObjectKey: `dna-open-lab/v1/${"d".repeat(64)}/races/finished-windows/${input.key.repeat(64)}.json`,
    manifestBodySha256: "e".repeat(64),
    manifestByteLength: 256,
  });
}

function receipts() {
  return Object.freeze([
    receipt({ start: lowerBoundAt, end: midpointAt, key: "a", documents: 1 }),
    receipt({ start: midpointAt, end: upperBoundAt, key: "b", documents: 2 }),
  ]);
}

describe("DNA finished-race incremental publication", () => {
  it("validates an unordered complete receipt set into one stable candidate", () => {
    const candidate = validateDnaFinishedRaceIncrementalReceiptSet({
      cycle: completedCycle(),
      receipts: [...receipts()].reverse(),
      validatedAt: "2026-09-03T00:13:00.000Z",
    });
    expect(candidate).toMatchObject({
      version: 1,
      previousPublishedCycleId: null,
      lowerBoundAt,
      upperBoundAt,
      receiptCount: 2,
      documentCount: 3,
      manifestByteLength: 512,
    });
    expect(candidate.receiptSetSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects gaps, overlaps, duplicates, count drift and incomplete cycles", () => {
    const cycle = completedCycle();
    expect(() =>
      validateDnaFinishedRaceIncrementalReceiptSet({
        cycle,
        receipts: [
          receipt({
            start: lowerBoundAt,
            end: midpointAt,
            key: "a",
            documents: 1,
          }),
          receipt({
            start: "2026-09-02T13:11:55.961Z",
            end: upperBoundAt,
            key: "b",
            documents: 2,
          }),
        ],
        validatedAt: "2026-09-03T00:13:00.000Z",
      }),
    ).toThrow("contiguous exact cover");
    expect(() =>
      validateDnaFinishedRaceIncrementalReceiptSet({
        cycle,
        receipts: [receipts()[0]!, receipts()[0]!],
        validatedAt: "2026-09-03T00:13:00.000Z",
      }),
    ).toThrow("repeats immutable evidence identity");
    expect(() =>
      validateDnaFinishedRaceIncrementalReceiptSet({
        cycle,
        receipts: receipts().map((value, index) =>
          index === 1 ? { ...value, documentCount: 1 } : value,
        ),
        validatedAt: "2026-09-03T00:13:00.000Z",
      }),
    ).toThrow("document count");
    expect(() =>
      validateDnaFinishedRaceIncrementalReceiptSet({
        cycle: createDnaFinishedRaceIncrementalCycle({
          lowerBoundAt,
          upperBoundAt,
          previousCompletedCycleId: null,
          checkpoint: {
            ...cycle.checkpoint,
            pendingWindows: [cycle.checkpoint.rootWindow],
            completedWindowCount: 0,
            splitCount: 0,
            successfulFinishedRaceRequestCount: 0,
            raceDocumentRequestCount: 0,
            publishedWindowDocumentCount: 0,
          },
        }),
        receipts: receipts(),
        validatedAt: "2026-09-03T00:13:00.000Z",
      }),
    ).toThrow("not complete");
  });

  it("publishes only after validation and rejects a drifted stored result", async () => {
    const cycle = completedCycle();
    const publish = vi.fn(async ({ candidate, publishedAt }) => ({
      ...candidate,
      publishedAt,
    }));
    const repository: DnaFinishedRaceIncrementalPublicationRepository = {
      loadReceiptSet: vi.fn(async () => receipts()),
      publish,
    };
    await expect(
      publishDnaFinishedRaceIncrementalCycle({
        cycle,
        repository,
        validatedAt: "2026-09-03T00:13:00.000Z",
        publishedAt: "2026-09-03T00:14:00.000Z",
      }),
    ).resolves.toMatchObject({ receiptCount: 2, documentCount: 3 });
    expect(publish).toHaveBeenCalledTimes(1);

    await expect(
      publishDnaFinishedRaceIncrementalCycle({
        cycle,
        repository: {
          ...repository,
          publish: async ({ candidate, publishedAt }) => ({
            ...candidate,
            receiptSetSha256: "f".repeat(64),
            publishedAt,
          }),
        },
        validatedAt: "2026-09-03T00:13:00.000Z",
        publishedAt: "2026-09-03T00:14:00.000Z",
      }),
    ).rejects.toThrow("receiptSetSha256 drifted");
  });
});
