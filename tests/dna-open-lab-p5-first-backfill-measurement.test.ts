import { describe, expect, it } from "vitest";

import {
  buildDnaOpenLabP5FirstBackfillMeasurementReport,
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES,
  type DnaOpenLabP5FirstBackfillFamilyMeasurement,
  type DnaOpenLabP5FirstBackfillMeasurementInput,
} from "@/lib/dna-open-lab-p5-first-backfill-measurement";

const exactMainCommit = "0123456789abcdef0123456789abcdef01234567";

const families: readonly DnaOpenLabP5FirstBackfillFamilyMeasurement[] = [
  {
    family: "finished_races",
    authorityClass: "available_paginated_history_at_cutoff",
    observedAt: "2026-08-31T23:59:59.999Z",
    terminalInventoryObserved: true,
    observedSourceRecordCount: 100,
    unresolvedIdentityObservationUpperBound: 0,
    sourceRecordUpperBound: 120,
    observedApiRequestCount: 11,
    apiRequestUpperBound: 12,
    retainedR2BytesUpperBound: 1_000_000_000,
    classAOperationsUpperBound: 120,
    classBOperationsUpperBound: 240,
    neonIncrementalBytesUpperBound: 120_000_000,
    evidenceRef: "evidence/finished-races-sanitized.json",
  },
  {
    family: "race_activity",
    authorityClass: "current_state_only",
    observedAt: "2026-09-01T00:00:00.000Z",
    terminalInventoryObserved: true,
    observedSourceRecordCount: 0,
    unresolvedIdentityObservationUpperBound: 0,
    sourceRecordUpperBound: 10,
    observedApiRequestCount: 2,
    apiRequestUpperBound: 2,
    retainedR2BytesUpperBound: 10_000,
    classAOperationsUpperBound: 2,
    classBOperationsUpperBound: 4,
    neonIncrementalBytesUpperBound: 20_000,
    evidenceRef: "evidence/race-activity-sanitized.json",
  },
  {
    family: "token_prices",
    authorityClass: "current_state_only",
    observedAt: "2026-09-01T00:00:00.000Z",
    terminalInventoryObserved: true,
    observedSourceRecordCount: 3,
    unresolvedIdentityObservationUpperBound: 0,
    sourceRecordUpperBound: 3,
    observedApiRequestCount: 1,
    apiRequestUpperBound: 1,
    retainedR2BytesUpperBound: 1_000,
    classAOperationsUpperBound: 1,
    classBOperationsUpperBound: 2,
    neonIncrementalBytesUpperBound: 2_000,
    evidenceRef: "evidence/token-prices-sanitized.json",
  },
  {
    family: "vault_identity",
    authorityClass: "bounded_recent_state_only",
    observedAt: "2026-09-01T00:00:00.000Z",
    terminalInventoryObserved: true,
    observedSourceRecordCount: 25,
    unresolvedIdentityObservationUpperBound: 0,
    sourceRecordUpperBound: 25,
    observedApiRequestCount: 4,
    apiRequestUpperBound: 4,
    retainedR2BytesUpperBound: 100_000,
    classAOperationsUpperBound: 4,
    classBOperationsUpperBound: 8,
    neonIncrementalBytesUpperBound: 200_000,
    evidenceRef: "evidence/vault-identity-sanitized.json",
  },
  {
    family: "core_current_state",
    authorityClass: "current_state_only",
    observedAt: "2026-09-01T00:00:00.000Z",
    terminalInventoryObserved: true,
    observedSourceRecordCount: 25,
    unresolvedIdentityObservationUpperBound: 0,
    sourceRecordUpperBound: 25,
    observedApiRequestCount: 16,
    apiRequestUpperBound: 16,
    retainedR2BytesUpperBound: 500_000,
    classAOperationsUpperBound: 16,
    classBOperationsUpperBound: 32,
    neonIncrementalBytesUpperBound: 1_000_000,
    evidenceRef: "evidence/core-current-state-sanitized.json",
  },
  {
    family: "splice_arena",
    authorityClass: "current_state_only",
    observedAt: "2026-09-01T00:00:00.000Z",
    terminalInventoryObserved: true,
    observedSourceRecordCount: 30,
    unresolvedIdentityObservationUpperBound: 0,
    sourceRecordUpperBound: 35,
    observedApiRequestCount: 6,
    apiRequestUpperBound: 7,
    retainedR2BytesUpperBound: 200_000,
    classAOperationsUpperBound: 7,
    classBOperationsUpperBound: 14,
    neonIncrementalBytesUpperBound: 400_000,
    evidenceRef: "evidence/splice-arena-sanitized.json",
  },
];

const input = (): DnaOpenLabP5FirstBackfillMeasurementInput => ({
  exactMainCommit,
  acquisitionPlanChecksum:
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  measuredAt: "2026-09-01T00:00:00.000Z",
  authorityCutoffAt: "2026-08-31T23:59:59.999Z",
  repositoryRef: "refs/heads/main",
  worktreeClean: true,
  executionMode: "non_persistent_complete_inventory",
  persistentOwnerDataWriteCount: 0,
  temporaryProviderResidueCount: 0,
  rawPayloadIncludedInEvidence: false,
  secretMaterialIncludedInEvidence: false,
  connectedRecoverySuite: {
    status: "passed",
    exactMainCommit,
    runRef: "actions/runs/connected-ten-case-exact-main",
  },
  neon: {
    limitBytes: 536_870_912,
    baselineBytes: 10_000_000,
  },
  pricing: {
    authorityRef: "https://developers.cloudflare.com/r2/pricing/",
    effectiveAt: "2026-08-07T00:00:00.000Z",
    bytesPerBillableGb: 1_000_000_000,
    storageMicroUsdPerGbMonth: 15_000,
    classAMicroUsdPerMillion: 4_500_000,
    classBMicroUsdPerMillion: 360_000,
    dnaApiCostMicroUsdUpperBound: 0,
    neonCostMicroUsdUpperBound: 0,
  },
  families,
});

describe("DNA Open Lab P5 first backfill measurement", () => {
  it("builds a bounded non-persistent six-family approval input", () => {
    const report = buildDnaOpenLabP5FirstBackfillMeasurementReport(input());

    expect(report.sourceFamilies).toEqual(
      DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES,
    );
    expect(report.historyFamilies).toEqual(["finished_races"]);
    expect(report.boundedRecentOnlyFamilies).toEqual(["vault_identity"]);
    expect(report.currentOnlyFamilies).toEqual([
      "race_activity",
      "token_prices",
      "core_current_state",
      "splice_arena",
    ]);
    expect(report.measuredUpperBound).toMatchObject({
      measurementBasis: "complete_inventory_upper_bound",
      sourceRecordUpperBound: 218,
      apiRequestUpperBound: 42,
      retainedR2BytesUpperBound: 1_000_811_000,
      classAOperationsUpperBound: 150,
      classBOperationsUpperBound: 300,
      neonPeakBytesUpperBound: 131_622_000,
      projectedCostMicroUsd: 15_796,
    });
    expect(report).toMatchObject({
      sourceAuthorityComplete: true,
      unresolvedIdentityDisposition: "none",
      ownerAuthorizedDeMinimisIdentityOmissionLimit: 25,
      unresolvedIdentityCriticalNotificationThreshold: 1_000,
      persistentOwnerDataWriteCount: 0,
      temporaryProviderResidueCount: 0,
      ownerApprovalRecorded: false,
      firstPersistentPrivatePreviewBackfillAllowed: false,
      productionChangesAllowed: false,
    });
  });

  it("emits a cost bound but blocks source authority for unidentified race observations", () => {
    const base = input();
    const report = buildDnaOpenLabP5FirstBackfillMeasurementReport({
      ...base,
      families: base.families.map((family) =>
        family.family === "finished_races"
          ? {
              ...family,
              unresolvedIdentityObservationUpperBound: 2,
            }
          : family,
      ),
    });

    expect(report.sourceAuthorityComplete).toBe(false);
    expect(report.unresolvedIdentityDisposition).toBe(
      "owner_authorized_de_minimis_candidate",
    );
    expect(
      report.measuredUpperBound.unresolvedIdentityObservationUpperBound,
    ).toBe(2);
  });

  it("classifies review and critical-notification volumes without authorizing persistence", () => {
    const base = input();
    const reportAt = (unresolvedIdentityObservationUpperBound: number) =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        families: base.families.map((family) =>
          family.family === "finished_races"
            ? {
                ...family,
                unresolvedIdentityObservationUpperBound,
                sourceRecordUpperBound:
                  family.observedSourceRecordCount +
                  unresolvedIdentityObservationUpperBound,
              }
            : family,
        ),
      });

    expect(reportAt(26).unresolvedIdentityDisposition).toBe(
      "owner_review_required",
    );
    expect(reportAt(1_000)).toMatchObject({
      unresolvedIdentityDisposition: "critical_volume_notification_required",
      sourceAuthorityComplete: false,
      firstPersistentPrivatePreviewBackfillAllowed: false,
    });
  });

  it("rejects incomplete, missing, duplicate or misclassified families", () => {
    const base = input();
    expect(() =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        families: base.families.slice(1),
      }),
    ).toThrow("every source family must appear exactly once");

    expect(() =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        families: [base.families[0]!, ...base.families.slice(0, -1)],
      }),
    ).toThrow("source family finished_races is duplicated");

    expect(() =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        families: base.families.map((family) =>
          family.family === "finished_races"
            ? { ...family, terminalInventoryObserved: false }
            : family,
        ),
      }),
    ).toThrow("source family finished_races is not complete");

    expect(() =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        families: base.families.map((family) =>
          family.family === "token_prices"
            ? {
                ...family,
                authorityClass: "available_paginated_history_at_cutoff",
              }
            : family,
        ),
      }),
    ).toThrow("source family token_prices authority is invalid");
  });

  it("requires exact-main connected recovery and a zero-write clean run", () => {
    const base = input();
    expect(() =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        connectedRecoverySuite: {
          ...base.connectedRecoverySuite,
          exactMainCommit: "f".repeat(40),
        },
      }),
    ).toThrow(
      "connected recovery suite must pass from the measured exact main",
    );

    expect(() =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        persistentOwnerDataWriteCount: 1,
      }),
    ).toThrow("persistent owner-data writes are prohibited");

    expect(() =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        temporaryProviderResidueCount: 1,
      }),
    ).toThrow("temporary provider residue must be zero");
  });

  it("requires every family observation to fall inside the measured interval", () => {
    const base = input();
    expect(() =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        families: base.families.map((family) =>
          family.family === "race_activity"
            ? { ...family, observedAt: "2026-08-31T23:59:59.998Z" }
            : family,
        ),
      }),
    ).toThrow(
      "race_activity.observedAt must fall within the measurement interval",
    );

    expect(() =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        families: base.families.map((family) =>
          family.family === "splice_arena"
            ? { ...family, observedAt: "2026-09-01T00:00:00.001Z" }
            : family,
        ),
      }),
    ).toThrow(
      "splice_arena.observedAt must fall within the measurement interval",
    );
  });

  it("rejects stale pricing, unsafe bounds and exhausted Neon headroom", () => {
    const base = input();
    expect(() =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        pricing: { ...base.pricing, effectiveAt: "2026-07-01T00:00:00.000Z" },
      }),
    ).toThrow("pricing authority is stale");

    expect(() =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        families: base.families.map((family) =>
          family.family === "finished_races"
            ? { ...family, sourceRecordUpperBound: 99 }
            : family,
        ),
      }),
    ).toThrow("sourceRecordUpperBound is below the observation");

    expect(() =>
      buildDnaOpenLabP5FirstBackfillMeasurementReport({
        ...base,
        neon: { ...base.neon, baselineBytes: 536_000_000 },
      }),
    ).toThrow("Neon peak upper bound must leave positive headroom");
  });
});
