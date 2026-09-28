import { describe, expect, it, vi } from "vitest";

import { createDnaOpenLabIndependentRaceDocRuntime } from "@/lib/dna-open-lab-independent-race-doc-lanes";
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
