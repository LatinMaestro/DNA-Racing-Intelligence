import { describe, expect, it } from "vitest";

import {
  applyDnaCoreRaceHistoryPageReceipt,
  beginReplacementDnaCoreRaceHistoryAcquisitionAttempt,
  completeDnaCoreRaceHistoryAcquisitionCycle,
  createDnaCoreRaceHistoryAcquisitionCycle,
  createDnaCoreRaceHistoryCoreCheckpoint,
  createDnaCoreRaceHistoryPageReceipt,
  DNA_CORE_RACE_HISTORY_EMPTY_RECEIPT_CHAIN_SHA256,
  DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE,
  pauseDnaCoreRaceHistoryAcquisitionCycle,
  resumeDnaCoreRaceHistoryAcquisitionCycle,
  supersedeDnaCoreRaceHistoryAcquisitionCycle,
  validateDnaCoreRaceHistoryAcquisitionCycle,
  validateDnaCoreRaceHistoryPageReceipt,
  type DnaCoreRaceHistoryAcquisitionCycle,
  type DnaCoreRaceHistoryPageReceipt,
} from "../lib/dna-core-race-history-acquisition-cycle";

const CURRENT_STATE_GENERATION_ID = "10000000-0000-4000-8000-000000000001";
const EVALUATED_AT = "2026-09-15T06:00:00.000Z";
const PAGE_SHA = "a".repeat(64);
const QUARANTINE_SHA = "b".repeat(64);

function cycle(): DnaCoreRaceHistoryAcquisitionCycle {
  return createDnaCoreRaceHistoryAcquisitionCycle({
    previousCompletedCycleId: null,
    currentStateGenerationId: CURRENT_STATE_GENERATION_ID,
    evaluatedAt: EVALUATED_AT,
    coreIds: [20, 10],
  });
}

function receipt(input: {
  cycle?: DnaCoreRaceHistoryAcquisitionCycle;
  coreId?: number;
  pageNumber: number;
  sourceRowCount: number;
  acceptedResultCount?: number;
  quarantineCount?: number;
  replayDuplicateCount?: number;
}): DnaCoreRaceHistoryPageReceipt {
  const authority = input.cycle ?? cycle();
  const quarantineCount = input.quarantineCount ?? 0;
  return createDnaCoreRaceHistoryPageReceipt({
    cycleId: authority.cycleId,
    attemptNumber: authority.attemptNumber,
    coreId: input.coreId ?? 10,
    pageNumber: input.pageNumber,
    observedAt: `2026-09-15T06:0${input.pageNumber}:00.000Z`,
    sourceRowCount: input.sourceRowCount,
    acceptedResultCount: input.acceptedResultCount ?? input.sourceRowCount,
    quarantineCount,
    replayDuplicateCount: input.replayDuplicateCount ?? 0,
    pageObjectKey: `dna-open-lab/v1/private/core-history/page-${input.pageNumber}.json`,
    pageBodySha256: PAGE_SHA,
    pageByteLength: 512,
    quarantineObjectKey:
      quarantineCount === 0
        ? null
        : `dna-open-lab/v1/private/core-history/page-${input.pageNumber}.quarantine.json`,
    quarantineBodySha256: quarantineCount === 0 ? null : QUARANTINE_SHA,
    quarantineByteLength: quarantineCount === 0 ? null : 128,
  });
}

describe("DNA Core race history acquisition cycle", () => {
  it("builds stable cycle, attempt and sorted Core-set identities", () => {
    const first = cycle();
    const replay = createDnaCoreRaceHistoryAcquisitionCycle({
      previousCompletedCycleId: null,
      currentStateGenerationId: CURRENT_STATE_GENERATION_ID,
      evaluatedAt: EVALUATED_AT,
      coreIds: [10, 20],
    });

    expect(first).toEqual(replay);
    expect(first.coreIds).toEqual([10, 20]);
    expect(first.cycleId).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.attemptId).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.status).toBe("running");
  });

  it("requires an explicit empty page after a short page and advances monotonically", () => {
    const authority = cycle();
    const initial = createDnaCoreRaceHistoryCoreCheckpoint({
      cycle: authority,
      coreId: 10,
    });
    expect(initial).toMatchObject({
      status: "running",
      nextPage: 1,
      completedPageCount: 0,
      receiptChainSha256: DNA_CORE_RACE_HISTORY_EMPTY_RECEIPT_CHAIN_SHA256,
    });

    const firstReceipt = receipt({
      cycle: authority,
      pageNumber: 1,
      sourceRowCount: DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE,
      acceptedResultCount: 48,
      quarantineCount: 1,
      replayDuplicateCount: 1,
    });
    const afterFirst = applyDnaCoreRaceHistoryPageReceipt({
      checkpoint: initial,
      receipt: firstReceipt,
    });
    expect(afterFirst).toMatchObject({
      status: "running",
      nextPage: 2,
      completedPageCount: 1,
      sourceRowCount: 50,
      acceptedResultCount: 48,
      quarantineCount: 1,
      replayDuplicateCount: 1,
      terminalPageNumber: null,
    });

    const shortReceipt = receipt({
      cycle: authority,
      pageNumber: 2,
      sourceRowCount: 7,
      acceptedResultCount: 6,
      replayDuplicateCount: 1,
    });
    expect(shortReceipt.terminal).toBe(false);
    const afterShort = applyDnaCoreRaceHistoryPageReceipt({
      checkpoint: afterFirst,
      receipt: shortReceipt,
    });
    expect(afterShort).toMatchObject({
      status: "running",
      nextPage: 3,
      completedPageCount: 2,
      sourceRowCount: 57,
      acceptedResultCount: 54,
    });

    const terminalReceipt = receipt({
      cycle: authority,
      pageNumber: 3,
      sourceRowCount: 0,
    });
    expect(terminalReceipt.terminal).toBe(true);
    const complete = applyDnaCoreRaceHistoryPageReceipt({
      checkpoint: afterShort,
      receipt: terminalReceipt,
    });
    expect(complete).toMatchObject({
      status: "complete",
      nextPage: 4,
      completedPageCount: 3,
      terminalPageNumber: 3,
      sourceRowCount: 57,
      acceptedResultCount: 54,
      quarantineCount: 1,
      replayDuplicateCount: 2,
      completionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("replays the same immutable receipt deterministically and rejects cursor drift", () => {
    const authority = cycle();
    const initial = createDnaCoreRaceHistoryCoreCheckpoint({
      cycle: authority,
      coreId: 10,
    });
    const page = receipt({
      cycle: authority,
      pageNumber: 1,
      sourceRowCount: 2,
    });
    const replay = receipt({
      cycle: authority,
      pageNumber: 1,
      sourceRowCount: 2,
    });

    expect(replay).toEqual(page);
    expect(
      applyDnaCoreRaceHistoryPageReceipt({
        checkpoint: initial,
        receipt: page,
      }),
    ).toEqual(
      applyDnaCoreRaceHistoryPageReceipt({
        checkpoint: initial,
        receipt: replay,
      }),
    );
    const advanced = applyDnaCoreRaceHistoryPageReceipt({
      checkpoint: initial,
      receipt: page,
    });
    expect(() =>
      applyDnaCoreRaceHistoryPageReceipt({
        checkpoint: advanced,
        receipt: page,
      }),
    ).toThrowError(expect.objectContaining({ kind: "authority_drift" }));
  });

  it("fails closed on inconsistent counts, oversized pages and false terminal claims", () => {
    const valid = receipt({ pageNumber: 1, sourceRowCount: 1 });

    expect(() =>
      validateDnaCoreRaceHistoryPageReceipt({
        ...valid,
        sourceRowCount: DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE + 1,
      }),
    ).toThrowError(expect.objectContaining({ kind: "invalid_receipt" }));
    expect(() =>
      validateDnaCoreRaceHistoryPageReceipt({
        ...valid,
        acceptedResultCount: 0,
      }),
    ).toThrowError(expect.objectContaining({ kind: "invalid_receipt" }));
    expect(() =>
      validateDnaCoreRaceHistoryPageReceipt({ ...valid, terminal: true }),
    ).toThrowError(expect.objectContaining({ kind: "invalid_receipt" }));
  });

  it("pauses without progress loss and starts a clean replacement attempt after supersession", () => {
    const initial = cycle();
    const paused = pauseDnaCoreRaceHistoryAcquisitionCycle({
      cycle: initial,
      reason: "rate_limited",
      pausedAt: "2026-09-15T06:10:00.000Z",
      retryAt: "2026-09-15T06:11:00.000Z",
    });
    const resumed = resumeDnaCoreRaceHistoryAcquisitionCycle(paused);
    expect(resumed).toEqual(initial);

    const superseded = supersedeDnaCoreRaceHistoryAcquisitionCycle(paused);
    const replacement =
      beginReplacementDnaCoreRaceHistoryAcquisitionAttempt(superseded);
    expect(replacement).toMatchObject({
      cycleId: initial.cycleId,
      attemptNumber: 2,
      status: "running",
      coreIds: [10, 20],
    });
    expect(replacement.attemptId).not.toBe(initial.attemptId);
    expect(
      createDnaCoreRaceHistoryCoreCheckpoint({
        cycle: replacement,
        coreId: 10,
      }),
    ).toMatchObject({ nextPage: 1, completedPageCount: 0 });
  });

  it("completes only from exact ordered Core coverage and binds aggregate identity", () => {
    const authority = cycle();
    const completed = authority.coreIds.map((coreId) => {
      const checkpoint = createDnaCoreRaceHistoryCoreCheckpoint({
        cycle: authority,
        coreId,
      });
      return applyDnaCoreRaceHistoryPageReceipt({
        checkpoint,
        receipt: receipt({
          cycle: authority,
          coreId,
          pageNumber: 1,
          sourceRowCount: 0,
        }),
      });
    });

    const complete = completeDnaCoreRaceHistoryAcquisitionCycle({
      cycle: authority,
      checkpoints: [...completed].reverse(),
      completedAt: "2026-09-15T06:15:00.000Z",
    });
    expect(complete.status).toBe("complete");
    expect(complete.completion).toMatchObject({
      completedCoreCount: 2,
      pageReceiptCount: 2,
      sourceRowCount: 0,
      acceptedResultCount: 0,
      quarantineCount: 0,
      replayDuplicateCount: 0,
      coreCompletionSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      completionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(validateDnaCoreRaceHistoryAcquisitionCycle(complete)).toEqual(
      complete,
    );
    expect(() =>
      completeDnaCoreRaceHistoryAcquisitionCycle({
        cycle: authority,
        checkpoints: completed.slice(0, 1),
        completedAt: "2026-09-15T06:15:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ kind: "authority_drift" }));
  });
});
