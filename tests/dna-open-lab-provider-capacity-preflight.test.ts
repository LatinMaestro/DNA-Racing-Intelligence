import { describe, expect, it, vi } from "vitest";

import {
  createDnaOpenLabProviderCapacityPreflight,
  DnaOpenLabProviderCapacityMeasurementError,
  type DnaOpenLabProviderCapacityMeasurement,
  type DnaOpenLabProviderCapacityMeasurementSource,
  type DnaOpenLabProviderCapacityPreflightInvocation,
} from "@/lib/dna-open-lab-provider-capacity-preflight";

const ownerId = "private-owner";
const now = new Date("2026-09-09T00:04:00.000Z");

const measurement: DnaOpenLabProviderCapacityMeasurement = Object.freeze({
  evidenceSource: "provider_api",
  r2StorageClass: "Standard",
  measuredAt: "2026-09-09T00:02:00.000Z",
  billingWindowStartAt: "2026-09-01T00:00:00.000Z",
  billingWindowEndAt: "2026-10-01T00:00:00.000Z",
  currentR2Usage: {
    storageBytes: 874_370_990,
    classAOperations: 35_000,
    classBOperations: 105_000,
  },
  neonMeasuredAt: "2026-09-09T00:01:00.000Z",
  neonBillingWindowStartAt: "2026-09-05T00:00:00.000Z",
  neonBillingWindowEndAt: "2026-10-05T00:00:00.000Z",
  currentNeonUsage: {
    storageBytes: 28_082_176,
    computeMilliCuHours: 5_000,
  },
});

const invocation: DnaOpenLabProviderCapacityPreflightInvocation = Object.freeze(
  {
    preflightVersion: "dna-open-lab-provider-capacity-preflight/v1",
    intent: "inspect_private_daily_refresh_capacity",
    authenticatedOwnerId: ownerId,
    exactCodeHeadSha: "a".repeat(64),
    refreshCycleId: "b".repeat(64),
    budgetWindowId: "c".repeat(64),
    plannedR2UsagePerRefresh: {
      storageBytes: 1_000_000,
      classAOperations: 100,
      classBOperations: 200,
    },
    plannedNeonUsagePerRefresh: {
      storageBytes: 250_000,
      computeMilliCuHours: 500,
    },
  },
);

function preflight(input?: {
  measured?: DnaOpenLabProviderCapacityMeasurement;
  measure?: Extract<
    DnaOpenLabProviderCapacityMeasurementSource,
    { status: "ready" }
  >["measure"];
  now?: Date;
}) {
  const measure =
    input?.measure ??
    vi
      .fn<
        Extract<
          DnaOpenLabProviderCapacityMeasurementSource,
          { status: "ready" }
        >["measure"]
      >()
      .mockResolvedValue(input?.measured ?? measurement);
  return {
    measure,
    value: createDnaOpenLabProviderCapacityPreflight({
      configuredOwnerId: ownerId,
      measurementSource: { status: "ready", measure },
      now: () => input?.now ?? now,
    }),
  };
}

describe("DNA Open Lab provider capacity preflight", () => {
  it("binds one fresh provider projection to exact replay authority", async () => {
    const gate = preflight();
    const first = await gate.value.inspect(invocation);
    const replay = await gate.value.inspect(invocation);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      status: "ready",
      readyForRefresh: true,
      exactCodeHeadSha: "a".repeat(64),
      refreshCycleId: "b".repeat(64),
      budgetWindowId: "c".repeat(64),
      checkedAt: now.toISOString(),
      validUntil: "2026-09-09T00:06:00.000Z",
      persistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
      preserveLastGood: true,
      projection: { allowed: true, action: "commission_refresh" },
    });
    if (first.status !== "ready") throw new Error("expected ready preflight");
    expect(first.ownerScopeSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.measurementSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.planSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.preflightSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(gate.measure).toHaveBeenNthCalledWith(1, { ownerId });
  });

  it("checks freshness after the provider measurement completes", async () => {
    const started = new Date("2026-09-09T00:04:00.000Z");
    const measuredAfterStart = new Date("2026-09-09T00:04:00.500Z");
    const checkedAfterMeasurement = new Date("2026-09-09T00:04:01.000Z");
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(started)
      .mockReturnValueOnce(checkedAfterMeasurement);
    const gate = createDnaOpenLabProviderCapacityPreflight({
      configuredOwnerId: ownerId,
      measurementSource: {
        status: "ready",
        measure: vi.fn().mockResolvedValue({
          ...measurement,
          measuredAt: measuredAfterStart.toISOString(),
          neonMeasuredAt: measuredAfterStart.toISOString(),
        }),
      },
      now: clock,
    });

    await expect(gate.inspect(invocation)).resolves.toMatchObject({
      status: "ready",
      checkedAt: checkedAfterMeasurement.toISOString(),
    });
    expect(clock).toHaveBeenCalledTimes(2);
  });

  it("changes replay identity when code, cycle, window or a bound changes", async () => {
    const gate = preflight();
    const original = await gate.value.inspect(invocation);
    const changed = await Promise.all([
      gate.value.inspect({ ...invocation, exactCodeHeadSha: "d".repeat(64) }),
      gate.value.inspect({ ...invocation, refreshCycleId: "e".repeat(64) }),
      gate.value.inspect({ ...invocation, budgetWindowId: "f".repeat(64) }),
      gate.value.inspect({
        ...invocation,
        plannedNeonUsagePerRefresh: {
          ...invocation.plannedNeonUsagePerRefresh,
          computeMilliCuHours: 501,
        },
      }),
    ]);
    if (original.status !== "ready")
      throw new Error("expected ready preflight");
    expect(
      changed.map((item) =>
        item.status === "ready" ? item.preflightSha256 : item.status,
      ),
    ).not.toContain(original.preflightSha256);
  });

  it("binds the exact 40-character GitHub commit head", async () => {
    const gate = preflight();
    const exactGitHubHead = "7c36605b42d4a807be12b8abe49ee3885ff3af68";
    const result = await gate.value.inspect({
      ...invocation,
      exactCodeHeadSha: exactGitHubHead,
    });
    expect(result).toMatchObject({
      status: "ready",
      exactCodeHeadSha: exactGitHubHead,
    });
  });

  it("keeps the authority digest stable while the same measurement remains fresh", async () => {
    const firstGate = preflight();
    const laterGate = preflight({
      now: new Date("2026-09-09T00:05:00.000Z"),
    });
    const first = await firstGate.value.inspect(invocation);
    const later = await laterGate.value.inspect(invocation);
    if (first.status !== "ready" || later.status !== "ready") {
      throw new Error("expected ready preflight");
    }
    expect(later.checkedAt).not.toBe(first.checkedAt);
    expect(later.preflightSha256).toBe(first.preflightSha256);
    expect(later.validUntil).toBe(first.validUntil);
  });

  it("denies owner drift and invalid authority before measuring", async () => {
    const gate = preflight();
    await expect(
      gate.value.inspect({ ...invocation, authenticatedOwnerId: "other" }),
    ).rejects.toThrow("owner scope denied");
    await expect(
      gate.value.inspect({ ...invocation, exactCodeHeadSha: "not-a-sha" }),
    ).rejects.toThrow("exact code head is invalid");
    expect(gate.measure).not.toHaveBeenCalled();
  });

  it("holds without measuring when provider authority is not configured", async () => {
    const gate = createDnaOpenLabProviderCapacityPreflight({
      configuredOwnerId: ownerId,
      measurementSource: { status: "not_configured" },
      now: () => now,
    });
    await expect(gate.inspect(invocation)).resolves.toMatchObject({
      status: "held",
      reason: "measurement_not_configured",
      blockerIds: [],
      persistentWritePerformed: false,
      providerWritePerformed: false,
    });
  });

  it("sanitizes provider failures and rejects stale, future or malformed evidence", async () => {
    const failed = preflight({
      measure: vi.fn().mockRejectedValue(new Error("secret provider detail")),
    });
    await expect(failed.value.inspect(invocation)).resolves.toMatchObject({
      status: "held",
      reason: "measurement_failed",
      measurementFailureId: "unexpected_measurement_failure",
    });

    const classified = preflight({
      measure: vi
        .fn()
        .mockRejectedValue(
          new DnaOpenLabProviderCapacityMeasurementError("neon_http_rejected"),
        ),
    });
    await expect(classified.value.inspect(invocation)).resolves.toMatchObject({
      status: "held",
      reason: "measurement_failed",
      measurementFailureId: "neon_http_rejected",
      blockerIds: [],
    });

    const stale = preflight({
      measured: { ...measurement, measuredAt: "2026-09-08T23:58:59.999Z" },
    });
    await expect(stale.value.inspect(invocation)).resolves.toMatchObject({
      status: "held",
      reason: "measurement_stale",
    });

    const future = preflight({
      measured: {
        ...measurement,
        neonMeasuredAt: "2026-09-09T00:04:00.001Z",
      },
    });
    await expect(future.value.inspect(invocation)).resolves.toMatchObject({
      status: "held",
      reason: "measurement_stale",
    });

    const malformed = preflight({
      measured: {
        ...measurement,
        billingWindowEndAt: "not-a-timestamp",
      },
    });
    await expect(malformed.value.inspect(invocation)).resolves.toMatchObject({
      status: "held",
      reason: "measurement_invalid",
    });
  });

  it("returns only safe blocker identifiers when projected capacity is closed", async () => {
    const gate = preflight({
      measured: {
        ...measurement,
        currentNeonUsage: {
          storageBytes: 499_999_999,
          computeMilliCuHours: 79_999,
        },
      },
    });
    await expect(gate.value.inspect(invocation)).resolves.toMatchObject({
      status: "held",
      readyForRefresh: false,
      reason: "capacity_blocked",
      blockerIds: [
        "neon_storage_budget_exhausted",
        "neon_compute_budget_exhausted",
      ],
      preserveLastGood: true,
      paidUsageAllowed: false,
    });
  });

  it("refuses a relaxed freshness policy", () => {
    expect(() =>
      createDnaOpenLabProviderCapacityPreflight({
        configuredOwnerId: ownerId,
        measurementSource: { status: "not_configured" },
        maximumMeasurementAgeMilliseconds: 300_001,
      }),
    ).toThrow("measurement age is invalid");
  });
});
