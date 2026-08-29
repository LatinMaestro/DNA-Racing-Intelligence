import { describe, expect, it } from "vitest";

import {
  dispatchDnaCurrentStateRequest,
  runDnaCurrentStateAcquisitionStep,
  type DnaCurrentStateAcquisitionCycleCheckpoint,
  type DnaCurrentStateAcquisitionCycleCheckpointRepository,
  type StoredDnaCurrentStateAcquisitionCycleCheckpoint,
} from "@/lib/dna-open-lab-current-state-acquisition-runner";
import {
  createDnaCurrentStateAcquisitionSchedule,
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  type DnaCurrentStateAcquisitionGroup,
} from "@/lib/dna-open-lab-current-state-acquisition-cadence";
import type { DnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import type { DnaCurrentStateSyncPlan } from "@/lib/dna-open-lab-current-state-sync-plan";
import {
  DnaOpenLabApiError,
  type DnaOpenLabClient,
  type DnaOpenLabResponse,
} from "@/lib/dna-open-lab-v1-client";

const cycleId = "80000000-0000-4000-8000-000000000001";
const evaluatedAt = "2026-08-28T12:30:00.000Z";
const sha = "a".repeat(64);

class MemoryCheckpointRepository implements DnaCurrentStateAcquisitionCycleCheckpointRepository {
  stored: StoredDnaCurrentStateAcquisitionCycleCheckpoint | null = null;
  saveCount = 0;
  failSaveNumber: number | null = null;

  async load(requestedCycleId: string) {
    return this.stored?.checkpoint.cycleId === requestedCycleId
      ? this.stored
      : null;
  }

  async save(input: {
    expectedRevision: string | null;
    checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  }) {
    this.saveCount += 1;
    if (this.failSaveNumber === this.saveCount) {
      throw new Error("synthetic checkpoint save failure");
    }
    if (this.stored === null) {
      if (input.expectedRevision !== null) {
        throw new Error("synthetic checkpoint missing");
      }
      this.stored = Object.freeze({
        revision: "1",
        checkpoint: input.checkpoint,
      });
      return this.stored;
    }
    if (input.expectedRevision !== this.stored.revision) {
      throw new Error("synthetic checkpoint revision conflict");
    }
    this.stored = Object.freeze({
      revision: String(Number(this.stored.revision) + 1),
      checkpoint: input.checkpoint,
    });
    return this.stored;
  }
}

function tokenOnlyPlan(): DnaCurrentStateSyncPlan {
  return Object.freeze({
    bootstrap: Object.freeze([
      Object.freeze({
        scope: "tokens" as const,
        endpoint: "tokens.prices" as const,
        payload: Object.freeze({}),
      }),
    ]),
    hydrate: Object.freeze([]),
    deferredUntilP3: Object.freeze([
      "cores.telemetry",
      "cores.telemetry_bulk",
      "cores.telemetry_benchmark",
    ] as const),
  });
}

function cachedEvidence(): Record<DnaCurrentStateAcquisitionGroup, string> {
  return Object.fromEntries(
    DNA_CURRENT_STATE_ACQUISITION_GROUPS.map((group) => [
      group,
      "2026-08-28T12:29:30.000Z",
    ]),
  ) as Record<DnaCurrentStateAcquisitionGroup, string>;
}

function schedule(currentPlan: DnaCurrentStateSyncPlan = tokenOnlyPlan()) {
  const daily = createDnaCurrentStateAcquisitionSchedule({
    evaluatedAt,
    plan: currentPlan,
  });
  const tokenRequests = daily.requestBatches
    .flat()
    .filter((entry) => entry.group === "token_prices");
  return Object.freeze({
    ...daily,
    dueGroups: Object.freeze(["token_prices"] as const),
    requestBatches: Object.freeze([Object.freeze(tokenRequests)]),
    scheduledRequestCount: tokenRequests.length,
  });
}

function response(): DnaOpenLabResponse<unknown> {
  return Object.freeze({
    result: Object.freeze({ synthetic: true }),
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 150,
      remaining: 149,
      resetSeconds: 60,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
  });
}

function pool(input: { error?: unknown; calls: { count: number } }) {
  return {
    execute: async () => {
      input.calls.count += 1;
      if (input.error !== undefined) throw input.error;
      return response();
    },
    snapshot: () => ({
      independentRateBucketsEnabled: false,
      aggregateBudget: null,
      lanes: [],
    }),
  } as unknown as DnaOpenLabClientPool;
}

function runnerInput(input: {
  repository: MemoryCheckpointRepository;
  requestPool: DnaOpenLabClientPool;
  persistCalls?: { count: number };
  pauseCalls?: { count: number };
}) {
  return {
    cycleId,
    attemptedAt: evaluatedAt,
    schedule: schedule(),
    checkpointRepository: input.repository,
    pool: input.requestPool,
    cachedEvidenceObservedAt: cachedEvidence(),
    persistEvidence: async ({ requestKey }: { requestKey: string }) => {
      if (input.persistCalls !== undefined) input.persistCalls.count += 1;
      return Object.freeze({
        requestKey,
        observedAt: evaluatedAt,
        contentSha256: sha,
        evidenceObjectKey: `synthetic/${cycleId}/${requestKey}.json`,
      });
    },
    pauseLastGood: async () => {
      if (input.pauseCalls !== undefined) input.pauseCalls.count += 1;
    },
  };
}

describe("DNA Open Lab current-state acquisition runner", () => {
  it("checkpoints one accepted request and resumes without replaying it", async () => {
    const repository = new MemoryCheckpointRepository();
    const calls = { count: 0 };
    const persistCalls = { count: 0 };
    const requestPool = pool({ calls });

    const first = await runDnaCurrentStateAcquisitionStep(
      runnerInput({ repository, requestPool, persistCalls }),
    );
    expect(first).toMatchObject({
      kind: "request_completed",
      group: "token_prices",
      remainingRequestCount: 0,
      stored: { revision: "2" },
    });
    expect(repository.stored?.checkpoint.completedGroups).toEqual([
      "token_prices",
    ]);

    const resumed = await runDnaCurrentStateAcquisitionStep(
      runnerInput({ repository, requestPool, persistCalls }),
    );
    expect(resumed).toMatchObject({
      kind: "ready_to_publish",
      incompleteGroups: [],
      stored: { revision: "3" },
    });
    expect(calls.count).toBe(1);
    expect(persistCalls.count).toBe(1);
  });

  it("replays an idempotent evidence key after a crash before checkpoint advancement", async () => {
    const repository = new MemoryCheckpointRepository();
    repository.failSaveNumber = 2;
    const calls = { count: 0 };
    const persistCalls = { count: 0 };
    const requestPool = pool({ calls });

    await expect(
      runDnaCurrentStateAcquisitionStep(
        runnerInput({ repository, requestPool, persistCalls }),
      ),
    ).rejects.toThrow("synthetic checkpoint save failure");
    expect(repository.stored?.checkpoint.receipts).toHaveLength(0);

    repository.failSaveNumber = null;
    await expect(
      runDnaCurrentStateAcquisitionStep(
        runnerInput({ repository, requestPool, persistCalls }),
      ),
    ).resolves.toMatchObject({ kind: "request_completed" });
    expect(calls.count).toBe(2);
    expect(persistCalls.count).toBe(2);
    expect(repository.stored?.checkpoint.receipts).toHaveLength(1);
  });

  it("pauses last-good state on 429 and honors the durable retry boundary", async () => {
    const repository = new MemoryCheckpointRepository();
    const calls = { count: 0 };
    const pauseCalls = { count: 0 };
    const requestPool = pool({
      calls,
      error: new DnaOpenLabApiError({
        kind: "rate_limited",
        message: "synthetic 429",
        httpStatus: 429,
        rateLimit: {
          limit: 150,
          remaining: 0,
          resetSeconds: 60,
          rateClass: "api_key",
          retryAfterSeconds: 17,
        },
      }),
    });

    const paused = await runDnaCurrentStateAcquisitionStep(
      runnerInput({ repository, requestPool, pauseCalls }),
    );
    expect(paused).toMatchObject({
      kind: "paused",
      reason: "rate_limited",
      retryNotBefore: "2026-08-28T12:30:17.000Z",
    });
    expect(repository.stored?.checkpoint).toMatchObject({
      status: "paused",
      pauseReason: "rate_limited",
      retryNotBefore: "2026-08-28T12:30:17.000Z",
    });

    const stillPaused = await runDnaCurrentStateAcquisitionStep({
      ...runnerInput({ repository, requestPool, pauseCalls }),
      attemptedAt: "2026-08-28T12:30:16.000Z",
    });
    expect(stillPaused).toMatchObject({
      kind: "paused",
      reason: "rate_limited",
    });
    expect(calls.count).toBe(1);
    expect(pauseCalls.count).toBe(1);
  });

  it("rejects schedule drift before another request can run", async () => {
    const repository = new MemoryCheckpointRepository();
    const calls = { count: 0 };
    const requestPool = pool({ calls });
    await runDnaCurrentStateAcquisitionStep(
      runnerInput({ repository, requestPool }),
    );

    const drifted = schedule(
      Object.freeze({
        ...tokenOnlyPlan(),
        bootstrap: Object.freeze([
          Object.freeze({
            scope: "tokens" as const,
            endpoint: "tokens.prices" as const,
            payload: Object.freeze({ syntheticPlanRevision: 2 }),
          }),
        ]),
      }),
    );
    await expect(
      runDnaCurrentStateAcquisitionStep({
        ...runnerInput({ repository, requestPool }),
        schedule: drifted,
      }),
    ).rejects.toThrow("stored cycle authority does not match");
    await expect(
      runDnaCurrentStateAcquisitionStep({
        ...runnerInput({ repository, requestPool }),
        schedule: Object.freeze({
          ...schedule(),
          completionScope: "scheduled_requests_only" as const,
        }),
      }),
    ).rejects.toThrow("stored cycle authority does not match");
    expect(calls.count).toBe(1);
  });

  it("dispatches through the pool and rejects on-demand pairs", async () => {
    const scopes: string[] = [];
    const arenaCalls: unknown[] = [];
    const fakeClient = {
      tokenPrices: async () => response(),
      spliceArena: async (input: unknown) => {
        arenaCalls.push(input);
        return response();
      },
    } as unknown as DnaOpenLabClient;
    const requestPool = {
      execute: async (input: {
        scope: string;
        request: (
          client: DnaOpenLabClient,
          laneId: string,
        ) => Promise<DnaOpenLabResponse<unknown>>;
      }) => {
        scopes.push(input.scope);
        return input.request(fakeClient, "key-1");
      },
      snapshot: () => ({
        independentRateBucketsEnabled: false,
        aggregateBudget: null,
        lanes: [],
      }),
    } as unknown as DnaOpenLabClientPool;

    await expect(
      dispatchDnaCurrentStateRequest({
        pool: requestPool,
        request: tokenOnlyPlan().bootstrap[0]!,
      }),
    ).resolves.toMatchObject({ httpStatus: 200 });
    expect(scopes).toEqual(["tokens"]);

    await expect(
      dispatchDnaCurrentStateRequest({
        pool: requestPool,
        request: {
          scope: "splice",
          endpoint: "splice.arena",
          payload: { filter: { rvmode: "bike" }, page: 3 },
        },
      }),
    ).resolves.toMatchObject({ httpStatus: 200 });
    expect(arenaCalls).toEqual([{ filter: { rvmode: "bike" }, page: 3 }]);

    await expect(
      dispatchDnaCurrentStateRequest({
        pool: requestPool,
        request: {
          scope: "splice",
          endpoint: "splice.pair_validate",
          payload: { fatherCoreId: 1, motherCoreId: 2 },
        },
      }),
    ).rejects.toThrow("on-demand pair reads cannot enter");
  });
});
