import { describe, expect, it, vi } from "vitest";

import {
  createDnaCoreRaceHistoryAcquisitionCycle,
  createDnaCoreRaceHistoryCoreCheckpoint,
  createDnaCoreRaceHistoryPageReceipt,
  DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE,
  supersedeDnaCoreRaceHistoryAcquisitionCycle,
  type DnaCoreRaceHistoryAcquisitionRepository,
  type StoredDnaCoreRaceHistoryAcquisitionCycle,
  type StoredDnaCoreRaceHistoryCoreCheckpoint,
} from "@/lib/dna-core-race-history-acquisition-cycle";
import {
  DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE,
  runDnaCoreRaceHistoryAcquisitionStep,
  type DnaCoreRaceHistoryEvidenceBudgetAuthority,
  type DnaCoreRaceHistoryEvidenceBudgetRequest,
} from "@/lib/dna-core-race-history-acquisition-runner";
import type { DnaCoreRaceHistoryClient } from "@/lib/dna-core-race-history-client";
import type {
  DnaCoreRaceHistoryR2EvidenceStore,
  DnaCoreRaceHistoryStoredPageEvidence,
} from "@/lib/dna-core-race-history-r2-evidence";
import {
  createDnaOpenLabRequestBudget,
  type DnaOpenLabRequestBudget,
} from "@/lib/dna-open-lab-request-budget";
import {
  DnaOpenLabApiError,
  type DnaOpenLabResponse,
} from "@/lib/dna-open-lab-v1-client";

const attemptedAt = "2026-09-15T07:00:00.000Z";

function response(
  rows: readonly Record<string, unknown>[],
): DnaOpenLabResponse<readonly Record<string, unknown>[]> {
  return Object.freeze({
    result: Object.freeze(rows),
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 150,
      remaining: 149,
      resetSeconds: 1,
      rateClass: "public",
      retryAfterSeconds: null,
    }),
  });
}

function evidenceBudgetAuthority(
  status: DnaCoreRaceHistoryEvidenceBudgetAuthority["status"],
  request: DnaCoreRaceHistoryEvidenceBudgetRequest,
): DnaCoreRaceHistoryEvidenceBudgetAuthority {
  return Object.freeze({
    status,
    requestSha256: request.requestSha256,
    paidUsageAllowed: false,
    preserveLastGood: true,
  });
}

function setup(input: { requestBudget?: DnaOpenLabRequestBudget } = {}) {
  const cycle = createDnaCoreRaceHistoryAcquisitionCycle({
    previousCompletedCycleId: null,
    currentStateGenerationId: "10000000-0000-4000-8000-000000000001",
    evaluatedAt: "2026-09-15T06:00:00.000Z",
    coreIds: [42],
  });
  let attempt: StoredDnaCoreRaceHistoryAcquisitionCycle = {
    revision: "1",
    cycle,
  };
  let core: StoredDnaCoreRaceHistoryCoreCheckpoint = {
    revision: "1",
    checkpoint: createDnaCoreRaceHistoryCoreCheckpoint({ cycle, coreId: 42 }),
  };
  const repository: DnaCoreRaceHistoryAcquisitionRepository = {
    loadAttempt: vi.fn(async () => attempt),
    loadNextCore: vi.fn(async () =>
      core.checkpoint.status === "running" ? core : null,
    ),
    loadCores: vi.fn(async () => [core]),
    loadLatestComplete: vi.fn(async () =>
      attempt.cycle.status === "complete" ? attempt : null,
    ),
    saveAttempt: vi.fn(async ({ cycle: next }) => {
      attempt = {
        revision: String(Number(attempt.revision) + 1),
        cycle: next,
      };
      return attempt;
    }),
    savePage: vi.fn(async ({ checkpoint }) => {
      core = {
        revision: String(Number(core.revision) + 1),
        checkpoint,
      };
      return core;
    }),
  };
  const client = {
    page: vi.fn(async () =>
      response([
        {
          hid: 42,
          rid: "race-1",
          rvmode: "bike",
          cb: 12,
          time: 65.125,
          pos: 2,
        },
      ]),
    ),
  } as DnaCoreRaceHistoryClient;
  const receipt = (sourceRowCount: number) =>
    createDnaCoreRaceHistoryPageReceipt({
      cycleId: cycle.cycleId,
      attemptNumber: cycle.attemptNumber,
      coreId: 42,
      pageNumber: 1,
      observedAt: attemptedAt,
      sourceRowCount,
      acceptedResultCount: sourceRowCount,
      quarantineCount: 0,
      replayDuplicateCount: 0,
      pageObjectKey: "dna-open-lab/v1/private/core-history/page-1.json",
      pageBodySha256: "a".repeat(64),
      pageByteLength: 512,
      quarantineObjectKey: null,
      quarantineBodySha256: null,
      quarantineByteLength: null,
    });
  const evidenceStore = {
    read: vi.fn(),
    recover: vi.fn(async () => null),
    write: vi.fn(async () => ({
      status: "ready" as const,
      receipt: receipt(1),
    })),
  } as DnaCoreRaceHistoryR2EvidenceStore;
  const authorizeEvidenceBudget = vi.fn<
    (
      request: DnaCoreRaceHistoryEvidenceBudgetRequest,
    ) => Promise<DnaCoreRaceHistoryEvidenceBudgetAuthority>
  >(async (request) => evidenceBudgetAuthority("ready", request));
  const accountEvidenceBudget = vi.fn(async () => undefined);
  const requestBudget = input.requestBudget ?? createDnaOpenLabRequestBudget();
  const run = (runAttemptedAt: string = attemptedAt) =>
    runDnaCoreRaceHistoryAcquisitionStep({
      cycleId: cycle.cycleId,
      attemptNumber: cycle.attemptNumber,
      attemptedAt: runAttemptedAt,
      repository,
      client,
      requestBudget,
      evidenceStore,
      authorizeEvidenceBudget,
      accountEvidenceBudget,
    });
  return {
    run,
    cycle,
    receipt,
    repository,
    client,
    evidenceStore,
    authorizeEvidenceBudget,
    accountEvidenceBudget,
    attempt: () => attempt,
    core: () => core,
    replaceCore: (next: StoredDnaCoreRaceHistoryCoreCheckpoint) => {
      core = next;
    },
  };
}

describe("DNA Core race history acquisition runner", () => {
  it("returns an unavailable attempt without consuming budget or external work", async () => {
    const state = setup();
    vi.mocked(state.repository.loadAttempt).mockResolvedValueOnce(null);

    await expect(state.run()).resolves.toEqual({ kind: "attempt_unavailable" });
    expect(state.authorizeEvidenceBudget).not.toHaveBeenCalled();
    expect(state.accountEvidenceBudget).not.toHaveBeenCalled();
    expect(state.evidenceStore.recover).not.toHaveBeenCalled();
    expect(state.client.page).not.toHaveBeenCalled();
  });

  it("refuses to advance a superseded attempt", async () => {
    const state = setup();
    vi.mocked(state.repository.loadAttempt).mockResolvedValueOnce({
      revision: "2",
      cycle: supersedeDnaCoreRaceHistoryAcquisitionCycle(state.cycle),
    });

    await expect(state.run()).rejects.toThrow(
      "superseded attempt cannot advance",
    );
    expect(state.authorizeEvidenceBudget).not.toHaveBeenCalled();
    expect(state.accountEvidenceBudget).not.toHaveBeenCalled();
    expect(state.evidenceStore.recover).not.toHaveBeenCalled();
    expect(state.client.page).not.toHaveBeenCalled();
  });

  it("reserves, reconciles, then advances at most one provider page", async () => {
    const state = setup();

    expect(DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE).toEqual({
      storageBytes: 16 * 1024 * 1024,
      classAOperations: 2,
      classBOperations: 7,
    });

    await expect(state.run()).resolves.toMatchObject({
      kind: "page_advanced",
      source: "provider",
      stored: { revision: "2", checkpoint: { nextPage: 2 } },
    });

    expect(state.authorizeEvidenceBudget).toHaveBeenCalledWith({
      requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      reservationId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      cycleId: state.cycle.cycleId,
      attemptNumber: 1,
      coreId: 42,
      pageNumber: 1,
      plannedUsage: DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE,
    });
    const budgetRequest = state.authorizeEvidenceBudget.mock.calls[0]![0];
    expect(budgetRequest.reservationId).not.toBe(budgetRequest.requestSha256);
    expect(state.accountEvidenceBudget).toHaveBeenCalledWith(budgetRequest, {
      storageBytes: 512,
      classAOperations: 2,
      classBOperations: 7,
    });
    expect(state.client.page).toHaveBeenCalledWith({ coreId: 42, page: 1 });
    expect(state.evidenceStore.write).toHaveBeenCalledTimes(1);
    expect(state.repository.savePage).toHaveBeenCalledTimes(1);
    expect(
      state.authorizeEvidenceBudget.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(state.evidenceStore.recover).mock.invocationCallOrder[0]!,
    );
    expect(
      state.accountEvidenceBudget.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(state.repository.savePage).mock.invocationCallOrder[0]!,
    );
  });

  it("replays the same budget identity after an interruption before evidence access", async () => {
    const state = setup();
    state.authorizeEvidenceBudget.mockRejectedValueOnce(
      new Error("synthetic budget interruption"),
    );

    await expect(state.run()).rejects.toThrow("synthetic budget interruption");
    await expect(state.run()).resolves.toMatchObject({
      kind: "page_advanced",
      source: "provider",
    });

    expect(state.authorizeEvidenceBudget).toHaveBeenCalledTimes(2);
    expect(state.authorizeEvidenceBudget.mock.calls[1]?.[0]).toEqual(
      state.authorizeEvidenceBudget.mock.calls[0]?.[0],
    );
    expect(state.evidenceStore.recover).toHaveBeenCalledTimes(1);
    expect(state.client.page).toHaveBeenCalledTimes(1);
  });

  it("uses a new reservation but the same page request identity for a later retry", async () => {
    const state = setup();
    state.authorizeEvidenceBudget.mockRejectedValueOnce(
      new Error("synthetic budget interruption"),
    );

    await expect(state.run()).rejects.toThrow("synthetic budget interruption");
    await expect(state.run("2026-09-15T07:00:01.000Z")).resolves.toMatchObject({
      kind: "page_advanced",
    });

    const first = state.authorizeEvidenceBudget.mock.calls[0]![0];
    const second = state.authorizeEvidenceBudget.mock.calls[1]![0];
    expect(second.requestSha256).toBe(first.requestSha256);
    expect(second.reservationId).not.toBe(first.reservationId);
  });

  it("recovers an immutable page after a crash without repeating the provider call", async () => {
    const state = setup();
    vi.mocked(state.evidenceStore.recover).mockResolvedValueOnce({
      status: "ready",
      receipt: state.receipt(0),
    });

    await expect(state.run()).resolves.toMatchObject({
      kind: "collection_complete",
      stored: { revision: "2", cycle: { status: "complete" } },
    });

    expect(state.client.page).not.toHaveBeenCalled();
    expect(state.evidenceStore.write).not.toHaveBeenCalled();
    expect(state.accountEvidenceBudget).toHaveBeenCalledWith(
      state.authorizeEvidenceBudget.mock.calls[0]![0],
      {
        storageBytes: 0,
        classAOperations: 2,
        classBOperations: 7,
      },
    );
    expect(state.repository.savePage).toHaveBeenCalledTimes(1);
    expect(state.repository.saveAttempt).toHaveBeenCalledTimes(1);

    await expect(state.run()).resolves.toMatchObject({
      kind: "collection_complete",
    });
    expect(state.authorizeEvidenceBudget).toHaveBeenCalledTimes(1);
    expect(state.client.page).not.toHaveBeenCalled();
    expect(state.repository.savePage).toHaveBeenCalledTimes(1);
  });

  it("closes before any R2 read or provider request when the budget authority is blocked", async () => {
    const state = setup();
    state.authorizeEvidenceBudget.mockImplementationOnce(async (request) =>
      evidenceBudgetAuthority("blocked", request),
    );

    await expect(state.run()).resolves.toMatchObject({
      kind: "paused",
      reason: "budget_closed",
      stored: { cycle: { status: "paused" } },
    });

    expect(state.evidenceStore.recover).not.toHaveBeenCalled();
    expect(state.client.page).not.toHaveBeenCalled();
    expect(state.accountEvidenceBudget).not.toHaveBeenCalled();
    expect(state.repository.savePage).not.toHaveBeenCalled();

    await expect(state.run()).resolves.toMatchObject({
      kind: "paused",
      reason: "budget_closed",
    });
    expect(state.authorizeEvidenceBudget).toHaveBeenCalledTimes(1);
  });

  it.each<
    [string, (request: DnaCoreRaceHistoryEvidenceBudgetRequest) => unknown]
  >([
    [
      "a stale request checksum",
      (request) => ({
        ...evidenceBudgetAuthority("ready", request),
        requestSha256: "f".repeat(64),
      }),
    ],
    [
      "paid usage",
      (request) => ({
        ...evidenceBudgetAuthority("ready", request),
        paidUsageAllowed: true,
      }),
    ],
    [
      "last-good replacement",
      (request) => ({
        ...evidenceBudgetAuthority("ready", request),
        preserveLastGood: false,
      }),
    ],
  ])("rejects %s authority before evidence access", async (_label, invalid) => {
    const state = setup();
    state.authorizeEvidenceBudget.mockImplementationOnce(
      async (request) =>
        invalid(request) as DnaCoreRaceHistoryEvidenceBudgetAuthority,
    );

    await expect(state.run()).rejects.toThrow(
      "evidence budget authority is invalid",
    );
    expect(state.evidenceStore.recover).not.toHaveBeenCalled();
    expect(state.client.page).not.toHaveBeenCalled();
    expect(state.accountEvidenceBudget).not.toHaveBeenCalled();
    expect(state.repository.savePage).not.toHaveBeenCalled();
  });

  it("retains the Core cursor and Retry-After authority when the provider rate-limits", async () => {
    const state = setup();
    vi.mocked(state.client.page).mockRejectedValueOnce(
      new DnaOpenLabApiError({
        kind: "rate_limited",
        message: "content-free",
        httpStatus: 429,
        rateLimit: {
          limit: 150,
          remaining: 0,
          resetSeconds: 20,
          rateClass: "public",
          retryAfterSeconds: 15,
        },
      }),
    );

    await expect(state.run()).resolves.toMatchObject({
      kind: "paused",
      reason: "rate_limited",
      stored: {
        cycle: {
          status: "paused",
          pause: { retryAt: "2026-09-15T07:00:15.000Z" },
        },
      },
    });
    expect(state.accountEvidenceBudget).toHaveBeenCalledWith(
      state.authorizeEvidenceBudget.mock.calls[0]![0],
      {
        storageBytes: 0,
        classAOperations: 2,
        classBOperations: 7,
      },
    );
    expect(state.core().checkpoint).toMatchObject({
      nextPage: 1,
      completedPageCount: 0,
    });
    expect(state.evidenceStore.write).not.toHaveBeenCalled();
  });

  it("uses the provider reset window when Retry-After is unavailable", async () => {
    const state = setup();
    vi.mocked(state.client.page).mockRejectedValueOnce(
      new DnaOpenLabApiError({
        kind: "rate_limited",
        message: "content-free",
        httpStatus: 429,
        rateLimit: {
          limit: 150,
          remaining: 0,
          resetSeconds: 20,
          rateClass: "public",
          retryAfterSeconds: null,
        },
      }),
    );

    await expect(state.run()).resolves.toMatchObject({
      kind: "paused",
      reason: "rate_limited",
      stored: {
        cycle: {
          pause: { retryAt: "2026-09-15T07:00:20.000Z" },
        },
      },
    });
    expect(state.repository.savePage).not.toHaveBeenCalled();
    expect(state.evidenceStore.write).not.toHaveBeenCalled();
    expect(state.accountEvidenceBudget).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["api_error", "api_unavailable"],
    ["transport_error", "api_unavailable"],
    ["malformed_response", "invalid_response"],
  ] as const)(
    "pauses %s failures as %s without advancing",
    async (kind, reason) => {
      const state = setup();
      vi.mocked(state.client.page).mockRejectedValueOnce(
        new DnaOpenLabApiError({ kind, message: "content-free" }),
      );

      await expect(state.run()).resolves.toMatchObject({
        kind: "paused",
        reason,
      });
      expect(state.repository.savePage).not.toHaveBeenCalled();
      expect(state.evidenceStore.write).not.toHaveBeenCalled();
      expect(state.accountEvidenceBudget).toHaveBeenCalledTimes(1);
      expect(state.core().checkpoint.nextPage).toBe(1);
    },
  );

  it.each(["invalid_configuration", "invalid_request"] as const)(
    "surfaces non-retryable %s failures without advancing",
    async (kind) => {
      const state = setup();
      vi.mocked(state.client.page).mockRejectedValueOnce(
        new DnaOpenLabApiError({ kind, message: "content-free" }),
      );

      await expect(state.run()).rejects.toMatchObject({ kind });
      expect(state.accountEvidenceBudget).toHaveBeenCalledTimes(1);
      expect(state.repository.saveAttempt).not.toHaveBeenCalled();
      expect(state.repository.savePage).not.toHaveBeenCalled();
      expect(state.evidenceStore.write).not.toHaveBeenCalled();
      expect(state.core().checkpoint.nextPage).toBe(1);
    },
  );

  it("drops an unusably large Retry-After value instead of creating invalid checkpoint time", async () => {
    const state = setup();
    vi.mocked(state.client.page).mockRejectedValueOnce(
      new DnaOpenLabApiError({
        kind: "rate_limited",
        message: "content-free",
        httpStatus: 429,
        rateLimit: {
          limit: 150,
          remaining: 0,
          resetSeconds: 1,
          rateClass: "public",
          retryAfterSeconds: Number.MAX_SAFE_INTEGER,
        },
      }),
    );

    await expect(state.run()).resolves.toMatchObject({
      kind: "paused",
      reason: "rate_limited",
      stored: { cycle: { pause: { retryAt: null } } },
    });
    expect(state.accountEvidenceBudget).toHaveBeenCalledTimes(1);
  });

  it("accounts a recovered quarantine conservatively before holding a conflict", async () => {
    const state = setup();
    vi.mocked(state.evidenceStore.recover).mockResolvedValueOnce({
      status: "held_conflict",
      cycleId: state.cycle.cycleId,
      attemptNumber: 1,
      coreId: 42,
      pageNumber: 1,
      observedAt: attemptedAt,
      conflictCount: 1,
      pageObjectKey: "private-page",
      pageBodySha256: "a".repeat(64),
      pageByteLength: 512,
      quarantineObjectKey: "private-quarantine",
      quarantineBodySha256: "b".repeat(64),
      quarantineByteLength: 128,
    } satisfies DnaCoreRaceHistoryStoredPageEvidence);

    await expect(state.run()).resolves.toMatchObject({
      kind: "paused",
      reason: "evidence_conflict",
    });
    expect(state.accountEvidenceBudget).toHaveBeenCalledWith(
      state.authorizeEvidenceBudget.mock.calls[0]![0],
      {
        storageBytes: 128,
        classAOperations: 2,
        classBOperations: 7,
      },
    );
    expect(state.repository.savePage).not.toHaveBeenCalled();
    expect(state.core().checkpoint.nextPage).toBe(1);
  });

  it("holds before evidence or provider work when the pagination safety cap is exhausted", async () => {
    const state = setup();
    state.replaceCore({
      revision: "10001",
      checkpoint: {
        ...state.core().checkpoint,
        nextPage: DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE + 1,
        completedPageCount: DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE,
        receiptChainSha256: "f".repeat(64),
      },
    });

    await expect(state.run()).resolves.toMatchObject({
      kind: "paused",
      reason: "operator_hold",
    });
    expect(state.authorizeEvidenceBudget).not.toHaveBeenCalled();
    expect(state.accountEvidenceBudget).not.toHaveBeenCalled();
    expect(state.evidenceStore.recover).not.toHaveBeenCalled();
    expect(state.client.page).not.toHaveBeenCalled();
  });

  it("rejects a request budget above the approved aggregate rate before external work", async () => {
    const state = setup({
      requestBudget: createDnaOpenLabRequestBudget({
        initialRequestsPerMinute: 31,
        maximumRequestsPerMinute: 31,
      }),
    });

    await expect(state.run()).rejects.toThrow(
      "request budget exceeds the conservative aggregate rate",
    );
    expect(state.authorizeEvidenceBudget).not.toHaveBeenCalled();
    expect(state.accountEvidenceBudget).not.toHaveBeenCalled();
    expect(state.evidenceStore.recover).not.toHaveBeenCalled();
    expect(state.client.page).not.toHaveBeenCalled();
  });

  it("rejects an observation time before cycle authority without consuming budget", async () => {
    const state = setup();

    await expect(state.run("2026-09-15T05:59:59.000Z")).rejects.toThrow(
      "attemptedAt predates the cycle evaluation",
    );
    expect(state.authorizeEvidenceBudget).not.toHaveBeenCalled();
    expect(state.accountEvidenceBudget).not.toHaveBeenCalled();
    expect(state.evidenceStore.recover).not.toHaveBeenCalled();
    expect(state.client.page).not.toHaveBeenCalled();
  });

  it("rejects an observation time without explicit timezone authority", async () => {
    const state = setup();

    await expect(state.run("2026-09-15T07:00:00")).rejects.toThrow(
      "attemptedAt is invalid",
    );
    expect(state.repository.loadAttempt).not.toHaveBeenCalled();
    expect(state.authorizeEvidenceBudget).not.toHaveBeenCalled();
    expect(state.accountEvidenceBudget).not.toHaveBeenCalled();
    expect(state.client.page).not.toHaveBeenCalled();
  });

  it("accounts the full bound and retains the cursor when immutable evidence storage is interrupted", async () => {
    const state = setup();
    vi.mocked(state.evidenceStore.write).mockRejectedValueOnce(
      new Error("synthetic evidence interruption"),
    );

    await expect(state.run()).rejects.toThrow(
      "synthetic evidence interruption",
    );
    expect(state.accountEvidenceBudget).toHaveBeenCalledWith(
      state.authorizeEvidenceBudget.mock.calls[0]![0],
      DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE,
    );
    expect(state.repository.savePage).not.toHaveBeenCalled();
    expect(state.core().checkpoint).toMatchObject({
      nextPage: 1,
      completedPageCount: 0,
    });
  });

  it("accounts the full bound and performs no provider work when immutable evidence recovery is interrupted", async () => {
    const state = setup();
    vi.mocked(state.evidenceStore.recover).mockRejectedValueOnce(
      new Error("synthetic recovery interruption"),
    );

    await expect(state.run()).rejects.toThrow(
      "synthetic recovery interruption",
    );
    expect(state.accountEvidenceBudget).toHaveBeenCalledWith(
      state.authorizeEvidenceBudget.mock.calls[0]![0],
      DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE,
    );
    expect(state.client.page).not.toHaveBeenCalled();
    expect(state.evidenceStore.write).not.toHaveBeenCalled();
    expect(state.repository.savePage).not.toHaveBeenCalled();
    expect(state.core().checkpoint.nextPage).toBe(1);
  });

  it("does not advance the cursor when budget accounting is interrupted", async () => {
    const state = setup();
    state.accountEvidenceBudget.mockRejectedValueOnce(
      new Error("synthetic accounting interruption"),
    );

    await expect(state.run()).rejects.toThrow(
      "synthetic accounting interruption",
    );
    expect(state.evidenceStore.write).toHaveBeenCalledTimes(1);
    expect(state.repository.savePage).not.toHaveBeenCalled();
    expect(state.core().checkpoint.nextPage).toBe(1);
  });
});
