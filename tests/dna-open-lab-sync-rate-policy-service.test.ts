import { describe, expect, it, vi } from "vitest";

import { createDnaOpenLabSyncRatePolicy } from "@/domain/dna-open-lab-sync-rate-policy";
import {
  loadDnaOpenLabSyncRatePageState,
  loadDnaOpenLabSyncRateRuntimePolicy,
  updateDnaOpenLabSyncRatePolicy,
  type DnaOpenLabSyncRatePolicyRepository,
} from "@/lib/dna-open-lab-sync-rate-policy-service";

const now = new Date("2026-09-07T10:00:00Z");

function repository(): Extract<
  DnaOpenLabSyncRatePolicyRepository,
  { status: "ready" }
> {
  const policy = createDnaOpenLabSyncRatePolicy({
    requestedRequestsPerMinute: 150,
    elevatedUntil: "2026-09-08T10:00:00Z",
    now: now.toISOString(),
  });
  return {
    status: "ready",
    read: vi.fn(async () => policy),
    set: vi.fn(async () => policy),
    recordObservation: vi.fn(async () => policy),
  };
}

describe("DNA Open Lab sync rate policy service", () => {
  it("fails closed to 30 when persistence is unavailable", async () => {
    const state = await loadDnaOpenLabSyncRatePageState({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: { status: "not_configured" },
      now,
    });
    expect(state).toMatchObject({
      connectionStatus: "persistence_not_configured",
      expectedVersion: 0,
      policy: { effectiveRequestsPerMinute: 30 },
    });
  });

  it("denies a different authenticated owner", async () => {
    const store = repository();
    expect(
      await updateDnaOpenLabSyncRatePolicy({
        authenticatedOwnerId: "other",
        configuredOwnerId: "owner",
        repository: store,
        requestedRequestsPerMinute: 150,
        elevationHours: 24,
        expectedVersion: 1,
        now,
      }),
    ).toBe("denied");
    expect(store.set).not.toHaveBeenCalled();
  });

  it("persists a bounded owner elevation", async () => {
    const store = repository();
    expect(
      await updateDnaOpenLabSyncRatePolicy({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: store,
        requestedRequestsPerMinute: 150,
        elevationHours: 24,
        expectedVersion: 1,
        now,
      }),
    ).toBe("updated");
    expect(store.set).toHaveBeenCalledWith({
      ownerId: "owner",
      requestedRequestsPerMinute: 150,
      elevatedUntil: "2026-09-08T10:00:00.000Z",
      expectedVersion: 1,
      requestedAt: now.toISOString(),
    });
  });

  it("loads the effective runtime rate and persists sanitized observations", async () => {
    const store = repository();
    const runtime = await loadDnaOpenLabSyncRateRuntimePolicy({
      ownerId: "owner",
      repository: store,
      now: () => now,
    });
    expect(runtime.effectiveRequestsPerMinute).toBe(150);
    await runtime.recordObservation({ rateLimited: true, providerLimit: 30 });
    expect(store.recordObservation).toHaveBeenCalledWith({
      ownerId: "owner",
      rateLimited: true,
      providerLimit: 30,
      observedAt: now.toISOString(),
    });
  });
});
