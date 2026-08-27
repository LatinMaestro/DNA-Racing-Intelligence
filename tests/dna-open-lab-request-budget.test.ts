import { describe, expect, it, vi } from "vitest";

import {
  createDnaOpenLabRequestBudget,
  type DnaOpenLabRequestBudget,
} from "../lib/dna-open-lab-request-budget";
import {
  DnaOpenLabApiError,
  type DnaOpenLabRateLimit,
  type DnaOpenLabResponse,
} from "../lib/dna-open-lab-v1-client";

function rateLimit(
  input: Partial<DnaOpenLabRateLimit> = {},
): DnaOpenLabRateLimit {
  return Object.freeze({
    limit: input.limit ?? null,
    remaining: input.remaining ?? null,
    resetSeconds: input.resetSeconds ?? null,
    rateClass: input.rateClass ?? null,
    retryAfterSeconds: input.retryAfterSeconds ?? null,
  });
}

function response<T>(
  result: T,
  limit: DnaOpenLabRateLimit = rateLimit(),
): DnaOpenLabResponse<T> {
  return Object.freeze({ result, httpStatus: 200, rateLimit: limit });
}

function fakeClock() {
  let now = 0;
  const sleep = vi.fn(async (milliseconds: number) => {
    now += milliseconds;
  });
  return {
    nowMilliseconds: () => now,
    sleep,
    now: () => now,
  };
}

describe("DNA Open Lab request budget", () => {
  it("starts at the Tier-1-safe 30 requests/minute allowance", () => {
    const budget = createDnaOpenLabRequestBudget();

    expect(budget.snapshot()).toMatchObject({
      effectiveRequestsPerMinute: 30,
      requestsInCurrentWindow: 0,
      blockedUntilMilliseconds: null,
    });
  });

  it("waits for the local sliding window before starting a request above its allowance", async () => {
    const clock = fakeClock();
    const budget = createDnaOpenLabRequestBudget({
      nowMilliseconds: clock.nowMilliseconds,
      sleep: clock.sleep,
      initialRequestsPerMinute: 2,
      maximumRequestsPerMinute: 2,
    });
    const request = vi.fn(async () => response({ ok: true }));

    await Promise.all([
      budget.execute(request),
      budget.execute(request),
      budget.execute(request),
    ]);

    expect(request).toHaveBeenCalledTimes(3);
    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(clock.sleep).toHaveBeenCalledWith(60_000);
    expect(clock.now()).toBe(60_000);
  });

  it("uses an advertised higher tier only after DNA reports it", async () => {
    const clock = fakeClock();
    const budget = createDnaOpenLabRequestBudget({
      nowMilliseconds: clock.nowMilliseconds,
      sleep: clock.sleep,
    });
    let call = 0;
    const request = vi.fn(async () => {
      call += 1;
      return response(
        { call },
        rateLimit({
          limit: 80,
          remaining: Math.max(0, 80 - call),
          resetSeconds: 30,
          rateClass: "api_key",
        }),
      );
    });

    await budget.execute(request);
    for (let index = 0; index < 30; index += 1) {
      await budget.execute(request);
    }

    expect(request).toHaveBeenCalledTimes(31);
    expect(clock.sleep).not.toHaveBeenCalled();
    expect(budget.snapshot().effectiveRequestsPerMinute).toBe(80);
  });

  it("honours a zero-remaining reset window before the next request", async () => {
    const clock = fakeClock();
    const budget = createDnaOpenLabRequestBudget({
      nowMilliseconds: clock.nowMilliseconds,
      sleep: clock.sleep,
    });
    const first = vi.fn(async () =>
      response(
        { ok: true },
        rateLimit({
          limit: 30,
          remaining: 0,
          resetSeconds: 10,
          rateClass: "api_key",
        }),
      ),
    );
    const second = vi.fn(async () => response({ ok: true }));

    await budget.execute(first);
    await budget.execute(second);

    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(clock.sleep).toHaveBeenCalledWith(10_000);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("surfaces a 429 without retrying and blocks later requests for Retry-After", async () => {
    const clock = fakeClock();
    const budget = createDnaOpenLabRequestBudget({
      nowMilliseconds: clock.nowMilliseconds,
      sleep: clock.sleep,
    });
    const limited = vi.fn(async () => {
      throw new DnaOpenLabApiError({
        kind: "rate_limited",
        message: "rate limit exceeded",
        httpStatus: 429,
        rateLimit: rateLimit({
          limit: 30,
          remaining: 0,
          resetSeconds: 12,
          rateClass: "api_key",
          retryAfterSeconds: 17,
        }),
      });
    });

    await expect(budget.execute(limited)).rejects.toMatchObject({
      kind: "rate_limited",
      httpStatus: 429,
    });
    expect(limited).toHaveBeenCalledTimes(1);

    const later = vi.fn(async () => response({ ok: true }));
    await budget.execute(later);

    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(clock.sleep).toHaveBeenCalledWith(17_000);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("caps an advertised tier at the configured safety maximum", () => {
    const budget: DnaOpenLabRequestBudget = createDnaOpenLabRequestBudget({
      maximumRequestsPerMinute: 80,
    });

    budget.observeRateLimit(rateLimit({ limit: 150, remaining: 149 }));

    expect(budget.snapshot().effectiveRequestsPerMinute).toBe(80);
  });

  it("rejects invalid budget configuration", () => {
    expect(() =>
      createDnaOpenLabRequestBudget({ initialRequestsPerMinute: 0 }),
    ).toThrow("initialRequestsPerMinute must be a positive safe integer");
    expect(() =>
      createDnaOpenLabRequestBudget({
        initialRequestsPerMinute: 80,
        maximumRequestsPerMinute: 30,
      }),
    ).toThrow(
      "initialRequestsPerMinute cannot exceed maximumRequestsPerMinute",
    );
  });
});
