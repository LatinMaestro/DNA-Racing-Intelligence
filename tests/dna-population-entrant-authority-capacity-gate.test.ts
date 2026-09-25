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
  const fixture = input?.source
    ? null
    : readySource();
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
      test.value.assertFreshCurrentCapacity(authority),
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
    ).rejects.toThrow("current provider measurement is unavailable");
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
    ).rejects.toThrow("current provider measurement failed");
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

  it("rejects non-Standard R2 storage through the immediate provider projection", async () => {
    const fixture = readySource(measurement({ r2StorageClass: "Infrequent" }));
    const test = gate({ source: fixture.source });

    await expect(
      test.value.assertFreshCurrentCapacity(authority),
    ).rejects.toThrow("current zero-cost provider capacity is blocked");
  });

  it("rejects a full compact archive that no longer fits current R2 headroom", async () => {
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
      test.value.assertFreshCurrentCapacity(authority),
    ).rejects.toThrow("current zero-cost provider capacity is blocked");
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
      test.value.assertFreshCurrentCapacity(authority),
    ).rejects.toThrow("current zero-cost provider capacity is blocked");
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
    ).toThrow("verified incremental compact entrant authority bytes is invalid");
  });
});
