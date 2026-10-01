import { describe, expect, it, vi } from "vitest";

import type { DnaPopulationEntrantAuthorityCheckpointAuthority } from "@/lib/dna-population-entrant-authority-checkpoint";
import {
  createDnaPopulationEntrantAuthorityCapacityGate,
  type DnaPopulationEntrantAuthoritySizingAuthority,
} from "@/lib/dna-population-entrant-authority-capacity-gate";
import type {
  DnaOpenLabProviderCapacityMeasurement,
  DnaOpenLabProviderCapacityMeasurementSource,
} from "@/lib/dna-open-lab-provider-capacity-preflight";
import { DNA_POPULATION_ENTRANT_AUTHORITY_ZERO_COST_R2_BUDGETS } from "@/lib/dna-population-entrant-authority-zero-cost-policy";
import { DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES } from "@/lib/dna-open-lab-zero-cost-refresh-policy";

const generationId = "a".repeat(64);
const authority: DnaPopulationEntrantAuthorityCheckpointAuthority =
  Object.freeze({
    version: 1,
    generationId,
    unresolvedRaceCount: 1_135_198,
    unresolvedRaceSetSha256: generationId,
  });
const sizingAuthority: DnaPopulationEntrantAuthoritySizingAuthority =
  Object.freeze({
    version: 1,
    unresolvedRaceCount: 1_135_198,
    unresolvedRaceSetSha256: generationId,
    measuredMaximumCompactEntrantAuthorityBytes: 257,
    verifiedIncrementalMaximumCompactEntrantAuthorityBytes: 902,
  });
const checkedAt = "2026-09-25T23:00:00.000Z";

function measurement(
  overrides: Partial<DnaOpenLabProviderCapacityMeasurement> = {},
): DnaOpenLabProviderCapacityMeasurement {
  return Object.freeze({
    evidenceSource: "provider_api" as const,
    r2StorageClass: "Standard",
    measuredAt: "2026-09-25T22:59:00.000Z",
    billingWindowStartAt: "2026-09-01T00:00:00.000Z",
    billingWindowEndAt: "2026-10-01T00:00:00.000Z",
    currentR2Usage: Object.freeze({
      storageBytes: 1_500_631_079,
      classAOperations: 58_080,
      classBOperations: 1_177_686,
    }),
    neonMeasuredAt: "2026-09-25T22:59:00.000Z",
    neonBillingWindowStartAt: "2026-09-01T00:00:00.000Z",
    neonBillingWindowEndAt: "2026-10-01T00:00:00.000Z",
    currentNeonUsage: Object.freeze({
      storageBytes: 408_821_760,
      computeMilliCuHours: 16_770,
    }),
    ...overrides,
  });
}

function readySource(
  value: DnaOpenLabProviderCapacityMeasurement = measurement(),
): {
  source: DnaOpenLabProviderCapacityMeasurementSource;
  measure: ReturnType<typeof vi.fn>;
} {
  const measure = vi.fn(async () => value);
  return {
    source: Object.freeze({
      status: "ready" as const,
      measure,
    }),
    measure,
  };
}

function gate(input?: {
  source?: DnaOpenLabProviderCapacityMeasurementSource;
  sizing?: DnaPopulationEntrantAuthoritySizingAuthority;
}) {
  const fixture = input?.source ? null : readySource();
  return {
    fixture,
    value: createDnaPopulationEntrantAuthorityCapacityGate({
      ownerId: "private-owner",
      measurementSource: input?.source ?? fixture!.source,
      sizingAuthority: input?.sizing ?? sizingAuthority,
      now: () => new Date(checkedAt),
    }),
  };
}

describe("DNA population entrant authority capacity gate", () => {
  it("returns an exact zero-cost approval from a fresh current provider measurement", async () => {
    const test = gate();

    await expect(
      test.value.assertFreshCurrentCapacity(authority, 100),
    ).resolves.toEqual({
      version: 1,
      generationId,
      unresolvedRaceCount: 1_135_198,
      unresolvedRaceSetSha256: generationId,
      observedAt: checkedAt,
      capacityAllowed: true,
      paidUsageAllowed: false,
    });
    expect(test.fixture!.measure).toHaveBeenCalledWith({
      ownerId: "private-owner",
    });
  });

  it("fails closed when the provider measurement source is unavailable", async () => {
    const test = gate({
      source: Object.freeze({ status: "not_configured" as const }),
    });

    await expect(
      test.value.assertFreshCurrentCapacity(authority),
    ).rejects.toMatchObject({
      diagnostic: "measurement_unavailable",
    });
  });

  it("sanitizes provider measurement failures", async () => {
    const source: DnaOpenLabProviderCapacityMeasurementSource = Object.freeze({
      status: "ready" as const,
      measure: vi.fn(async () => {
        throw new Error("sensitive provider response");
      }),
    });
    const test = gate({ source });

    await expect(
      test.value.assertFreshCurrentCapacity(authority),
    ).rejects.toMatchObject({
      diagnostic: "measurement_failed",
    });
  });

  it("rejects stale Cloudflare evidence before capacity approval", async () => {
    const fixture = readySource(
      measurement({ measuredAt: "2026-09-25T22:54:59.999Z" }),
    );
    const test = gate({ source: fixture.source });

    await expect(
      test.value.assertFreshCurrentCapacity(authority),
    ).rejects.toThrow("measurement is stale or future-dated");
  });

  it("rejects future-dated Neon evidence before capacity approval", async () => {
    const fixture = readySource(
      measurement({ neonMeasuredAt: "2026-09-25T23:00:00.001Z" }),
    );
    const test = gate({ source: fixture.source });

    await expect(
      test.value.assertFreshCurrentCapacity(authority),
    ).rejects.toThrow("measurement is stale or future-dated");
  });

  it("keeps a 10% R2 operation reserve while allowing one bounded zero-cost cohort", async () => {
    expect(DNA_POPULATION_ENTRANT_AUTHORITY_ZERO_COST_R2_BUDGETS).toEqual({
      storageBytes: 8_000_000_000,
      classAOperations: 900_000,
      classBOperations: 9_000_000,
    });
    expect(
      DNA_POPULATION_ENTRANT_AUTHORITY_ZERO_COST_R2_BUDGETS.classAOperations,
    ).toBeLessThan(DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classAOperations);
    expect(
      DNA_POPULATION_ENTRANT_AUTHORITY_ZERO_COST_R2_BUDGETS.classBOperations,
    ).toBeLessThan(DNA_OPEN_LAB_R2_STANDARD_FREE_ALLOWANCES.classBOperations);

    const base = measurement();
    const fixture = readySource(
      measurement({
        currentR2Usage: Object.freeze({
          ...base.currentR2Usage,
          classAOperations: 850_000,
          classBOperations: 8_500_000,
        }),
      }),
    );
    const test = gate({ source: fixture.source });

    await expect(
      test.value.assertFreshCurrentCapacity(authority, 100),
    ).resolves.toMatchObject({
      capacityAllowed: true,
      paidUsageAllowed: false,
    });
  });

  it("uses checkpoint-verified remaining work instead of re-reserving the full archive", async () => {
    const base = measurement();
    const fixture = readySource(
      measurement({
        currentR2Usage: Object.freeze({
          ...base.currentR2Usage,
          classAOperations: 899_950,
        }),
      }),
    );
    const test = gate({ source: fixture.source });

    await expect(
      test.value.assertFreshCurrentCapacity(authority),
    ).rejects.toMatchObject({
      diagnostic: "r2_cost_ceiling_blocked",
    });

    await expect(
      test.value.assertFreshCurrentCapacity(authority, 10),
    ).resolves.toMatchObject({
      capacityAllowed: true,
      paidUsageAllowed: false,
    });
  });

  it("rejects a remaining count above the audited unresolved authority before provider access", async () => {
    const test = gate();

    await expect(
      test.value.assertFreshCurrentCapacity(
        authority,
        authority.unresolvedRaceCount + 1,
      ),
    ).rejects.toThrow("remainingRaceCount exceeds audited authority");
    expect(test.fixture!.measure).not.toHaveBeenCalled();
  });

  it("fails closed before projected usage exceeds the entrant zero-cost reserve", async () => {
    const base = measurement();
    const fixture = readySource(
      measurement({
        currentR2Usage: Object.freeze({
          ...base.currentR2Usage,
          classAOperations: 900_000,
        }),
      }),
    );
    const test = gate({ source: fixture.source });

    await expect(
      test.value.assertFreshCurrentCapacity(authority),
    ).rejects.toMatchObject({
      diagnostic: "r2_cost_ceiling_blocked",
    });
  });

  it("rejects non-Standard R2 storage", async () => {
    const fixture = readySource(measurement({ r2StorageClass: "Infrequent" }));
    const test = gate({ source: fixture.source });

    await expect(
      test.value.assertFreshCurrentCapacity(authority),
    ).rejects.toMatchObject({
      diagnostic: "r2_storage_class_blocked",
    });
  });

  it("allows bounded R2 storage only while it remains below the zero-cost reserve", async () => {
    const base = measurement();
    const fixture = readySource(
      measurement({
        currentR2Usage: Object.freeze({
          ...base.currentR2Usage,
          storageBytes: 7_500_000_000,
        }),
      }),
    );
    const test = gate({ source: fixture.source });

    await expect(
      test.value.assertFreshCurrentCapacity(authority, 100),
    ).resolves.toMatchObject({
      capacityAllowed: true,
      paidUsageAllowed: false,
    });
  });

  it("reserves conservative Neon compute headroom for the next commit", async () => {
    const base = measurement();
    const fixture = readySource(
      measurement({
        currentNeonUsage: Object.freeze({
          ...base.currentNeonUsage,
          computeMilliCuHours: 79_500,
        }),
      }),
    );
    const test = gate({ source: fixture.source });

    await expect(
      test.value.assertFreshCurrentCapacity(authority, 100),
    ).rejects.toMatchObject({
      diagnostic: "neon_compute_blocked",
    });
  });

  it("rejects malformed audited authority before requesting provider capacity", async () => {
    const test = gate();

    await expect(
      test.value.assertFreshCurrentCapacity({
        ...authority,
        generationId: "b".repeat(64),
      }),
    ).rejects.toThrow("audited authority binding is invalid");
    expect(test.fixture!.measure).not.toHaveBeenCalled();
  });

  it("rejects sizing authority bound to a different unresolved Race set before provider access", async () => {
    const test = gate({
      sizing: {
        ...sizingAuthority,
        unresolvedRaceSetSha256: "b".repeat(64),
      },
    });

    await expect(
      test.value.assertFreshCurrentCapacity(authority),
    ).rejects.toThrow("sizing authority disagrees with audited authority");
    expect(test.fixture!.measure).not.toHaveBeenCalled();
  });

  it("rejects sizing authority below the accepted historical compact-size floor", () => {
    expect(() =>
      gate({
        sizing: {
          ...sizingAuthority,
          verifiedIncrementalMaximumCompactEntrantAuthorityBytes: 901,
        },
      }),
    ).toThrow("verified compact entrant sizing authority regressed");
  });

  it("rejects malformed sizing authority at composition time", () => {
    expect(() =>
      gate({
        sizing: {
          ...sizingAuthority,
          verifiedIncrementalMaximumCompactEntrantAuthorityBytes: 0,
        },
      }),
    ).toThrow(
      "verified incremental compact entrant authority bytes is invalid",
    );
  });
});
