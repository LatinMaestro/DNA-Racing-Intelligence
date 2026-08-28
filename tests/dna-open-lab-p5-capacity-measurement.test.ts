import { describe, expect, it } from "vitest";

import {
  buildDnaOpenLabP5CapacityMeasurementReport,
  DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES,
  type DnaOpenLabP5CapacityMeasurementInput,
} from "@/lib/dna-open-lab-p5-capacity-measurement";

function input(
  overrides: Partial<DnaOpenLabP5CapacityMeasurementInput> = {},
): DnaOpenLabP5CapacityMeasurementInput {
  return {
    codeHeadSha: "a".repeat(40),
    planChecksum: "b".repeat(64),
    providerScope: "synthetic_local",
    measurementAuthorityRef: "local:synthetic-capacity-run/1",
    measuredAt: "2026-08-28T18:00:00.000Z",
    postgresMajorVersion: 18,
    persistentOwnerDataWriteCount: 0,
    residueObjectCount: 0,
    rawPayloadIncluded: false,
    secretMaterialIncluded: false,
    postgres: {
      limitBytes: DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES,
      baselineDatabaseBytes: 20_000_000,
      settledDatabaseBytes: 80_000_000,
      peakDatabaseBytes: 120_000_000,
      ownerHeapBytes: 45_000_000,
      ownerIndexBytes: 20_000_000,
      ownerToastBytes: 5_000_000,
      measurementSamples: 12,
    },
    r2: {
      retainedObjectCount: 100,
      retainedPayloadBytes: 900_000_000,
      retainedMetadataBytes: 100_000_000,
      projectedMonthlyClassAOperations: 2_000_000,
      projectedMonthlyClassBOperations: 3_000_000,
      priceAuthorityRef: "provider-price-snapshot-2026-08-28",
      priceEffectiveAt: "2026-08-28T00:00:00.000Z",
      bytesPerBillableGb: 1_000_000_000,
      storageMicroUsdPerGbMonth: 15_000,
      classAMicroUsdPerMillion: 4_500_000,
      classBMicroUsdPerMillion: 360_000,
    },
    ...overrides,
  };
}

describe("DNA Open Lab P5 capacity measurement", () => {
  it("canonicalizes physical Postgres and private R2 evidence", () => {
    const report = buildDnaOpenLabP5CapacityMeasurementReport(input());

    expect(report).toMatchObject({
      postgresMajorVersion: 18,
      postgres: {
        ownerPhysicalBytes: 70_000_000,
        peakHeadroomBytes: 416_870_912,
        positivePeakHeadroom: true,
      },
      r2: {
        retainedTotalBytes: 1_000_000_000,
        projectedMonthlyCostMicroUsd: 10_095_000,
      },
      connectedCapacityEvidenceComplete: false,
      readyToUpdateP5CapacityRows: false,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
    });
  });

  it("recognizes complete connected capacity evidence without authorizing sync", () => {
    const report = buildDnaOpenLabP5CapacityMeasurementReport(
      input({ providerScope: "private_preview" }),
    );
    expect(report).toMatchObject({
      connectedCapacityEvidenceComplete: true,
      readyToUpdateP5CapacityRows: true,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
    });
  });

  it("keeps non-positive Neon headroom blocking", () => {
    const base = input();
    const report = buildDnaOpenLabP5CapacityMeasurementReport({
      ...base,
      providerScope: "private_preview",
      postgres: {
        ...base.postgres,
        peakDatabaseBytes: DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES,
      },
    });
    expect(report.postgres.positivePeakHeadroom).toBe(false);
    expect(report.readyToUpdateP5CapacityRows).toBe(false);
  });

  it("requires PostgreSQL 18, the approved limit and transient samples", () => {
    for (const candidate of [
      input({ postgresMajorVersion: 17 }),
      (() => {
        const base = input();
        return {
          ...base,
          postgres: { ...base.postgres, limitBytes: 1_000_000_000 },
        };
      })(),
      (() => {
        const base = input();
        return {
          ...base,
          postgres: { ...base.postgres, measurementSamples: 1 },
        };
      })(),
    ]) {
      expect(() =>
        buildDnaOpenLabP5CapacityMeasurementReport(candidate),
      ).toThrow();
    }
  });

  it("rejects impossible Postgres and R2 measurements", () => {
    const base = input();
    expect(() =>
      buildDnaOpenLabP5CapacityMeasurementReport({
        ...base,
        postgres: { ...base.postgres, peakDatabaseBytes: 10_000_000 },
      }),
    ).toThrow("must cover baseline and settled size");
    expect(() =>
      buildDnaOpenLabP5CapacityMeasurementReport({
        ...base,
        postgres: { ...base.postgres, settledDatabaseBytes: 60_000_000 },
      }),
    ).toThrow("owner relation bytes exceed settled database size");
    expect(() =>
      buildDnaOpenLabP5CapacityMeasurementReport({
        ...base,
        r2: {
          ...base.r2,
          retainedObjectCount: 0,
        },
      }),
    ).toThrow("R2 footprint measurement must be substantive");
  });

  it("requires contemporaneous explicit R2 price authority", () => {
    const base = input();
    expect(() =>
      buildDnaOpenLabP5CapacityMeasurementReport({
        ...base,
        r2: { ...base.r2, priceAuthorityRef: " " },
      }),
    ).toThrow("priceAuthorityRef is invalid");
    expect(() =>
      buildDnaOpenLabP5CapacityMeasurementReport({
        ...base,
        r2: {
          ...base.r2,
          priceEffectiveAt: "2026-08-29T00:00:00.000Z",
        },
      }),
    ).toThrow("cannot postdate the measurement");
    expect(() =>
      buildDnaOpenLabP5CapacityMeasurementReport({
        ...base,
        r2: {
          ...base.r2,
          priceEffectiveAt: "2026-07-01T00:00:00.000Z",
        },
      }),
    ).toThrow("price authority is stale");
  });

  it("rejects owner writes, residue, raw payloads and secrets", () => {
    for (const candidate of [
      input({ persistentOwnerDataWriteCount: 1 }),
      input({ residueObjectCount: 1 }),
      input({ rawPayloadIncluded: true }),
      input({ secretMaterialIncluded: true }),
    ]) {
      expect(() =>
        buildDnaOpenLabP5CapacityMeasurementReport(candidate),
      ).toThrow();
    }
  });

  it("binds evidence to exact head, plan and runtime scope", () => {
    for (const candidate of [
      input({ codeHeadSha: "main" }),
      input({ planChecksum: "b".repeat(63) }),
      input({ measurementAuthorityRef: " " }),
      input({ providerScope: "production" as "synthetic_local" }),
    ]) {
      expect(() =>
        buildDnaOpenLabP5CapacityMeasurementReport(candidate),
      ).toThrow();
    }
  });
});
