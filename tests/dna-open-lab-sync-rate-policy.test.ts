import { describe, expect, it } from "vitest";

import {
  createDnaOpenLabSyncRatePolicy,
  evaluateDnaOpenLabSyncRatePolicy,
  observeDnaOpenLabRateLimit,
  observeDnaOpenLabRateSuccess,
} from "@/domain/dna-open-lab-sync-rate-policy";

describe("DNA Open Lab sync rate policy", () => {
  it("keeps 30 rpm as the expiry-free safe default", () => {
    expect(
      createDnaOpenLabSyncRatePolicy({
        requestedRequestsPerMinute: 30,
        now: "2026-09-07T10:00:00Z",
      }),
    ).toMatchObject({
      requestedRequestsPerMinute: 30,
      effectiveRequestsPerMinute: 30,
      elevatedUntil: null,
      fallbackReason: null,
    });
  });

  it("requires elevated rates to expire within 31 days", () => {
    expect(() =>
      createDnaOpenLabSyncRatePolicy({
        requestedRequestsPerMinute: 150,
        now: "2026-09-07T10:00:00Z",
      }),
    ).toThrow("requires a future expiry");
    expect(() =>
      createDnaOpenLabSyncRatePolicy({
        requestedRequestsPerMinute: 151,
        elevatedUntil: "2026-09-08T10:00:00Z",
        now: "2026-09-07T10:00:00Z",
      }),
    ).toThrow("between 30 and 150");
    expect(() =>
      createDnaOpenLabSyncRatePolicy({
        requestedRequestsPerMinute: 29,
        now: "2026-09-07T10:00:00Z",
      }),
    ).toThrow("between 30 and 150");
  });

  it("falls back to 30 when elevation expires", () => {
    const policy = createDnaOpenLabSyncRatePolicy({
      requestedRequestsPerMinute: 150,
      elevatedUntil: "2026-09-08T10:00:00Z",
      now: "2026-09-07T10:00:00Z",
    });
    expect(
      evaluateDnaOpenLabSyncRatePolicy(policy, "2026-09-08T10:00:00Z"),
    ).toMatchObject({
      requestedRequestsPerMinute: 150,
      effectiveRequestsPerMinute: 30,
      fallbackReason: "elevation_expired",
    });
  });

  it("falls back immediately when provider authority reports 30", () => {
    const policy = createDnaOpenLabSyncRatePolicy({
      requestedRequestsPerMinute: 150,
      elevatedUntil: "2026-09-08T10:00:00Z",
      now: "2026-09-07T10:00:00Z",
    });
    expect(
      observeDnaOpenLabRateLimit(policy, {
        observedAt: "2026-09-07T10:01:00Z",
        providerLimit: 30,
      }),
    ).toMatchObject({
      effectiveRequestsPerMinute: 30,
      fallbackReason: "provider_limit_reduced",
      consecutiveRateLimits: 1,
      lastProviderLimit: 30,
    });
  });

  it("falls back after one rate limit when no limit is advertised", () => {
    const policy = createDnaOpenLabSyncRatePolicy({
      requestedRequestsPerMinute: 150,
      elevatedUntil: "2026-09-08T10:00:00Z",
      now: "2026-09-07T10:00:00Z",
    });
    expect(
      observeDnaOpenLabRateLimit(policy, {
        observedAt: "2026-09-07T10:01:00Z",
        providerLimit: null,
      }),
    ).toMatchObject({
      effectiveRequestsPerMinute: 30,
      fallbackReason: "rate_limit_observed",
      consecutiveRateLimits: 1,
    });
  });

  it("does not silently re-elevate after a successful request", () => {
    const elevated = createDnaOpenLabSyncRatePolicy({
      requestedRequestsPerMinute: 150,
      elevatedUntil: "2026-09-08T10:00:00Z",
      now: "2026-09-07T10:00:00Z",
    });
    const fallenBack = observeDnaOpenLabRateLimit(elevated, {
      observedAt: "2026-09-07T10:01:00Z",
      providerLimit: 30,
    });
    expect(
      observeDnaOpenLabRateSuccess(fallenBack, {
        observedAt: "2026-09-07T10:02:00Z",
        providerLimit: 150,
      }),
    ).toMatchObject({
      requestedRequestsPerMinute: 150,
      effectiveRequestsPerMinute: 30,
      fallbackReason: "provider_limit_reduced",
      consecutiveRateLimits: 0,
    });
  });
});
