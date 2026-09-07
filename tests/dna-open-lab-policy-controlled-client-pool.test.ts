import { describe, expect, it, vi } from "vitest";

import { createDnaOpenLabSyncRatePolicy } from "@/domain/dna-open-lab-sync-rate-policy";
import { createDnaOpenLabPolicyControlledClientPool } from "@/lib/dna-open-lab-policy-controlled-client-pool";
import type { DnaOpenLabSyncRatePolicyRepository } from "@/lib/dna-open-lab-sync-rate-policy-service";
import {
  DnaOpenLabApiError,
  type DnaOpenLabClient,
} from "@/lib/dna-open-lab-v1-client";

const elevated = createDnaOpenLabSyncRatePolicy({
  requestedRequestsPerMinute: 150,
  elevatedUntil: "2026-09-08T10:00:00Z",
  now: "2026-09-07T10:00:00Z",
});

function repository(): Extract<
  DnaOpenLabSyncRatePolicyRepository,
  { status: "ready" }
> {
  return {
    status: "ready",
    read: vi.fn(async () => elevated),
    set: vi.fn(async () => elevated),
    recordObservation: vi.fn(async () => ({
      ...elevated,
      effectiveRequestsPerMinute: 30,
      fallbackReason: "rate_limit_observed" as const,
    })),
  };
}

describe("DNA Open Lab policy-controlled client pool", () => {
  it("uses the saved effective rate and durably reports only rate limits", async () => {
    const store = repository();
    const controlled = await createDnaOpenLabPolicyControlledClientPool({
      ownerId: "owner_1",
      repository: store,
      lanes: [
        {
          id: "key-1",
          scopes: ["races"],
          client: {} as DnaOpenLabClient,
        },
      ],
      now: () => new Date("2026-09-07T10:01:00Z"),
    });
    expect(controlled.effectiveRequestsPerMinute).toBe(150);

    await controlled.pool.execute({
      scope: "races",
      request: async () => ({
        result: { ok: true },
        httpStatus: 200,
        rateLimit: {
          limit: 150,
          remaining: 149,
          resetSeconds: null,
          rateClass: "api_key",
          retryAfterSeconds: null,
        },
      }),
    });
    expect(store.recordObservation).not.toHaveBeenCalled();

    await expect(
      controlled.pool.execute({
        scope: "races",
        request: async () => {
          throw new DnaOpenLabApiError({
            kind: "rate_limited",
            message: "synthetic",
            rateLimit: {
              limit: null,
              remaining: null,
              resetSeconds: null,
              rateClass: null,
              retryAfterSeconds: null,
            },
          });
        },
      }),
    ).rejects.toMatchObject({ kind: "rate_limited" });
    expect(store.recordObservation).toHaveBeenCalledWith({
      ownerId: "owner_1",
      rateLimited: true,
      providerLimit: null,
      observedAt: "2026-09-07T10:01:00.000Z",
    });
    expect(
      controlled.pool.snapshot().aggregateBudget?.effectiveRequestsPerMinute,
    ).toBe(30);
  });

  it("starts at 30 when the saved elevation has expired", async () => {
    const store = repository();
    const controlled = await createDnaOpenLabPolicyControlledClientPool({
      ownerId: "owner_1",
      repository: store,
      lanes: [
        {
          id: "key-1",
          scopes: ["races"],
          client: {} as DnaOpenLabClient,
        },
      ],
      now: () => new Date("2026-09-08T10:00:00Z"),
    });
    expect(controlled.effectiveRequestsPerMinute).toBe(30);
    expect(
      controlled.pool.snapshot().aggregateBudget?.effectiveRequestsPerMinute,
    ).toBe(30);
  });
});
