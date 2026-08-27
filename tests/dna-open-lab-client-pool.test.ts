import { describe, expect, it } from "vitest";

import { createDnaOpenLabClientPool } from "../lib/dna-open-lab-client-pool";
import {
  DnaOpenLabApiError,
  type DnaOpenLabClient,
  type DnaOpenLabRateLimit,
  type DnaOpenLabResponse,
  type DnaOpenLabScope,
} from "../lib/dna-open-lab-v1-client";

function client(): DnaOpenLabClient {
  return Object.freeze({}) as unknown as DnaOpenLabClient;
}

function rateLimit(
  input: Partial<DnaOpenLabRateLimit> = {},
): DnaOpenLabRateLimit {
  return Object.freeze({
    limit: input.limit ?? 30,
    remaining: input.remaining ?? 29,
    resetSeconds: input.resetSeconds ?? 30,
    rateClass: input.rateClass ?? "api_key",
    retryAfterSeconds: input.retryAfterSeconds ?? null,
  });
}

function response<T>(
  result: T,
  limit: DnaOpenLabRateLimit = rateLimit(),
): DnaOpenLabResponse<T> {
  return Object.freeze({ result, httpStatus: 200, rateLimit: limit });
}

function lane(
  id: string,
  laneScopes: readonly DnaOpenLabScope[] = [
    "vault",
    "races",
    "cores",
    "tokens",
    "splice",
  ],
) {
  return Object.freeze({ id, client: client(), scopes: laneScopes });
}

function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    nowMilliseconds: () => now,
    sleep: async (milliseconds: number) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
    now: () => now,
    sleeps,
  };
}

describe("DNA Open Lab client pool", () => {
  it("spreads normal requests round-robin across three eligible keys", async () => {
    const pool = createDnaOpenLabClientPool({
      lanes: [lane("key-1"), lane("key-2"), lane("key-3")],
    });
    const used: string[] = [];

    for (let index = 0; index < 6; index += 1) {
      await pool.execute({
        scope: "races",
        request: async (_client, laneId) => {
          used.push(laneId);
          return response({ laneId });
        },
      });
    }

    expect(used).toEqual([
      "key-1",
      "key-2",
      "key-3",
      "key-1",
      "key-2",
      "key-3",
    ]);
    expect(pool.snapshot().lanes.map((entry) => entry.requestCount)).toEqual([
      2, 2, 2,
    ]);
    expect(pool.snapshot().aggregateBudget?.requestsInCurrentWindow).toBe(6);
  });

  it("uses only lanes explicitly configured for the requested scope", async () => {
    const pool = createDnaOpenLabClientPool({
      lanes: [
        lane("key-1", ["vault"]),
        lane("key-2", ["races"]),
        lane("key-3", ["cores", "races"]),
      ],
    });
    const used: string[] = [];

    for (let index = 0; index < 4; index += 1) {
      await pool.execute({
        scope: "races",
        request: async (_client, laneId) => {
          used.push(laneId);
          return response({ ok: true });
        },
      });
    }

    expect(used).toEqual(["key-2", "key-3", "key-2", "key-3"]);
    expect(pool.snapshot().lanes[0]?.requestCount).toBe(0);
  });

  it("keeps one aggregate vault request cap even while spreading keys", async () => {
    const clock = fakeClock();
    const pool = createDnaOpenLabClientPool({
      lanes: [lane("key-1"), lane("key-2"), lane("key-3")],
      nowMilliseconds: clock.nowMilliseconds,
      sleep: clock.sleep,
      aggregateRequestsPerMinute: 2,
    });

    for (let index = 0; index < 3; index += 1) {
      await pool.execute({
        scope: "cores",
        request: async (_client, laneId) => response({ laneId }),
      });
    }

    expect(clock.sleeps).toEqual([60_000]);
    expect(clock.now()).toBe(60_000);
    expect(pool.snapshot().independentRateBucketsEnabled).toBe(false);
    expect(pool.snapshot().aggregateBudget?.effectiveRequestsPerMinute).toBe(2);
  });

  it("does not jump keys after a 429 in conservative aggregate mode", async () => {
    const pool = createDnaOpenLabClientPool({
      lanes: [lane("key-1"), lane("key-2"), lane("key-3")],
    });
    const attempts: string[] = [];

    await expect(
      pool.execute({
        scope: "races",
        request: async (_client, laneId) => {
          attempts.push(laneId);
          throw new DnaOpenLabApiError({
            kind: "rate_limited",
            message: "synthetic rate limit",
            httpStatus: 429,
            rateLimit: rateLimit({
              remaining: 0,
              resetSeconds: 10,
              retryAfterSeconds: 10,
            }),
          });
        },
      }),
    ).rejects.toMatchObject({ kind: "rate_limited" });

    expect(attempts).toEqual(["key-1"]);
    expect(pool.snapshot().lanes[0]?.rateLimitedCount).toBe(1);
    expect(pool.snapshot().lanes[1]?.requestCount).toBe(0);
  });

  it("can fail over a rate-limited read-only request only when independent buckets are explicitly enabled", async () => {
    const pool = createDnaOpenLabClientPool({
      lanes: [lane("key-1"), lane("key-2"), lane("key-3")],
      allowIndependentRateBuckets: true,
    });
    const attempts: string[] = [];

    const result = await pool.execute({
      scope: "races",
      request: async (_client, laneId) => {
        attempts.push(laneId);
        if (laneId === "key-1") {
          throw new DnaOpenLabApiError({
            kind: "rate_limited",
            message: "synthetic lane rate limit",
            httpStatus: 429,
            rateLimit: rateLimit({
              remaining: 0,
              resetSeconds: 10,
              retryAfterSeconds: 10,
            }),
          });
        }
        return response({ laneId });
      },
    });

    expect(result.result).toEqual({ laneId: "key-2" });
    expect(attempts).toEqual(["key-1", "key-2"]);
    expect(pool.snapshot().independentRateBucketsEnabled).toBe(true);
    expect(pool.snapshot().aggregateBudget).toBeNull();
    expect(pool.snapshot().lanes.map((entry) => entry.requestCount)).toEqual([
      1, 1, 0,
    ]);
  });

  it("retains each lane's own advertised rate state without multiplying the aggregate gate", async () => {
    const pool = createDnaOpenLabClientPool({
      lanes: [lane("key-1"), lane("key-2"), lane("key-3")],
      aggregateRequestsPerMinute: 30,
    });

    await pool.execute({
      scope: "cores",
      request: async () =>
        response(
          { ok: true },
          rateLimit({ limit: 80, remaining: 79, resetSeconds: 20 }),
        ),
    });

    const snapshot = pool.snapshot();
    expect(snapshot.lanes[0]?.budget.effectiveRequestsPerMinute).toBe(80);
    expect(snapshot.aggregateBudget?.effectiveRequestsPerMinute).toBe(30);
  });

  it("fails closed when no configured key has the requested scope", async () => {
    const pool = createDnaOpenLabClientPool({
      lanes: [lane("key-1", ["vault"]), lane("key-2", ["cores"])],
    });

    await expect(
      pool.execute({
        scope: "splice",
        request: async () => response({ ok: true }),
      }),
    ).rejects.toThrow("no lane is configured for scope splice");
  });

  it("rejects unsafe lane configuration and credential-like labels", () => {
    expect(() => createDnaOpenLabClientPool({ lanes: [] })).toThrow(
      "pool requires between 1 and 3 lanes",
    );
    expect(() =>
      createDnaOpenLabClientPool({
        lanes: [lane("key-1"), lane("key-2"), lane("key-3"), lane("key-4")],
      }),
    ).toThrow("pool requires between 1 and 3 lanes");
    expect(() =>
      createDnaOpenLabClientPool({
        lanes: [lane("key-1"), lane("key-1")],
      }),
    ).toThrow("duplicate lane id key-1");
    expect(() =>
      createDnaOpenLabClientPool({ lanes: [lane("dna_secret-looking")] }),
    ).toThrow("credential-like");
    expect(() =>
      createDnaOpenLabClientPool({ lanes: [lane("key-1", [])] }),
    ).toThrow("requires at least one scope");
  });
});
