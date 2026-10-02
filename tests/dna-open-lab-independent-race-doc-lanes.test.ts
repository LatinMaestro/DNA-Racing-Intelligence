import { describe, expect, it, vi } from "vitest";

import { createDnaOpenLabIndependentRaceDocRuntime } from "@/lib/dna-open-lab-independent-race-doc-lanes";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE,
  DNA_POPULATION_ENTRANT_AUTHORITY_API_KEY_LANES,
  DNA_POPULATION_ENTRANT_AUTHORITY_LANE_REQUESTS_PER_MINUTE,
} from "@/lib/dna-population-entrant-authority-cohort";
import { createDnaOpenLabRequestBudget } from "@/lib/dna-open-lab-request-budget";
import type {
  DnaOpenLabClient,
  DnaOpenLabResponse,
  DnaRaceDocument,
} from "@/lib/dna-open-lab-v1-client";

function response(): DnaOpenLabResponse<readonly DnaRaceDocument[]> {
  return Object.freeze({
    result: Object.freeze([]),
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 30,
      remaining: 29,
      resetSeconds: 60,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
  });
}

describe("independent Race-doc API-key lanes", () => {
  it("allows 90 requests per minute across three independent 30-RPM key lanes without a shared 30-RPM cap", async () => {
    let now = 0;
    const sleeps = [vi.fn(), vi.fn(), vi.fn()];
    const calls = [vi.fn(), vi.fn(), vi.fn()];
    const runtime = createDnaOpenLabIndependentRaceDocRuntime(
      calls.map((call, index) =>
        Object.freeze({
          client: Object.freeze({
            raceDocs: (async (raceIds) => {
              call(raceIds);
              return response();
            }) satisfies Pick<DnaOpenLabClient, "raceDocs">["raceDocs"],
          }),
          requestBudget: createDnaOpenLabRequestBudget({
            nowMilliseconds: () => now,
            sleep: async (milliseconds) => {
              sleeps[index]?.(milliseconds);
              now += milliseconds;
            },
            initialRequestsPerMinute:
              DNA_POPULATION_ENTRANT_AUTHORITY_LANE_REQUESTS_PER_MINUTE,
            maximumRequestsPerMinute:
              DNA_POPULATION_ENTRANT_AUTHORITY_LANE_REQUESTS_PER_MINUTE,
          }),
        }),
      ),
    );

    for (
      let index = 0;
      index < DNA_POPULATION_ENTRANT_AUTHORITY_AGGREGATE_REQUESTS_PER_MINUTE;
      index += 1
    ) {
      await runtime.requestBudget.execute(() =>
        runtime.client.raceDocs([index + 1]),
      );
    }

    expect(DNA_POPULATION_ENTRANT_AUTHORITY_API_KEY_LANES).toBe(3);
    expect(calls.map((call) => call.mock.calls.length)).toEqual([30, 30, 30]);
    expect(sleeps.map((sleep) => sleep.mock.calls.length)).toEqual([0, 0, 0]);
    expect(runtime.requestBudget.snapshot()).toMatchObject({
      effectiveRequestsPerMinute: 90,
      requestsInCurrentWindow: 90,
    });

    await runtime.requestBudget.execute(() => runtime.client.raceDocs([91]));

    expect(sleeps.map((sleep) => sleep.mock.calls.length)).toEqual([1, 0, 0]);
    expect(sleeps[0]).toHaveBeenCalledWith(60_000);
  });

  it("round-robins requests while retaining one 30-RPM budget per key", async () => {
    const calls = [vi.fn(), vi.fn(), vi.fn()];
    const runtime = createDnaOpenLabIndependentRaceDocRuntime(
      calls.map((call) =>
        Object.freeze({
          client: Object.freeze({
            raceDocs: (async (raceIds) => {
              call(raceIds);
              return response();
            }) satisfies Pick<DnaOpenLabClient, "raceDocs">["raceDocs"],
          }),
          requestBudget: createDnaOpenLabRequestBudget({
            initialRequestsPerMinute: 30,
            maximumRequestsPerMinute: 30,
          }),
        }),
      ),
    );

    for (let index = 0; index < 6; index += 1) {
      await runtime.requestBudget.execute(() =>
        runtime.client.raceDocs([index + 1]),
      );
    }

    expect(calls.map((call) => call.mock.calls.length)).toEqual([2, 2, 2]);
    expect(runtime.requestBudget.snapshot()).toMatchObject({
      effectiveRequestsPerMinute: 90,
      requestsInCurrentWindow: 6,
      blockedUntilMilliseconds: null,
    });
  });

  it("retains the selected lane through an async wrapper", async () => {
    const calls = [vi.fn(), vi.fn(), vi.fn()];
    const runtime = createDnaOpenLabIndependentRaceDocRuntime(
      calls.map((call) =>
        Object.freeze({
          client: Object.freeze({
            raceDocs: (async (raceIds) => {
              call(raceIds);
              return response();
            }) satisfies Pick<DnaOpenLabClient, "raceDocs">["raceDocs"],
          }),
          requestBudget: createDnaOpenLabRequestBudget({
            initialRequestsPerMinute: 30,
            maximumRequestsPerMinute: 30,
          }),
        }),
      ),
    );
    const wrappedClient: Pick<DnaOpenLabClient, "raceDocs"> = Object.freeze({
      raceDocs: async (raceIds) => {
        await Promise.resolve();
        return runtime.client.raceDocs(raceIds);
      },
    });

    await runtime.requestBudget.execute(() => wrappedClient.raceDocs([101]));

    expect(calls.map((call) => call.mock.calls.length)).toEqual([1, 0, 0]);
    expect(runtime.requestBudget.snapshot()).toMatchObject({
      effectiveRequestsPerMinute: 90,
      requestsInCurrentWindow: 1,
      blockedUntilMilliseconds: null,
    });
  });

  it("allows concurrent keyed provider responses", async () => {
    let releaseBarrier: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    let inFlight = 0;
    let peakInFlight = 0;

    const lane = () =>
      Object.freeze({
        client: Object.freeze({
          raceDocs: async () => {
            inFlight += 1;
            peakInFlight = Math.max(peakInFlight, inFlight);
            await barrier;
            inFlight -= 1;
            return response();
          },
        }),
        requestBudget: createDnaOpenLabRequestBudget({
          initialRequestsPerMinute: 30,
          maximumRequestsPerMinute: 30,
        }),
      });

    const runtime = createDnaOpenLabIndependentRaceDocRuntime([
      lane(),
      lane(),
      lane(),
    ]);
    const execute = (raceId: number) =>
      runtime.requestBudget.execute(() => runtime.client.raceDocs([raceId]));

    const pending = [1, 2, 3, 4, 5, 6].map(execute);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(peakInFlight).toBe(6);
    releaseBarrier();
    await Promise.all(pending);
  });

  it("fails closed when the coupled client is used outside its budget", async () => {
    const runtime = createDnaOpenLabIndependentRaceDocRuntime([
      Object.freeze({
        client: Object.freeze({
          raceDocs: async () => response(),
        }),
        requestBudget: createDnaOpenLabRequestBudget(),
      }),
    ]);

    await expect(runtime.client.raceDocs([1])).rejects.toThrow(
      "race-doc lane is not selected",
    );
  });
});
