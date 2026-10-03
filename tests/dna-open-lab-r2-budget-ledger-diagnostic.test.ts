import { describe, expect, it } from "vitest";

import { diagnoseDnaOpenLabR2BudgetLedger } from "@/lib/dna-open-lab-r2-budget-ledger-diagnostic";
import type { DnaOpenLabProviderCapacityMeasurement } from "@/lib/dna-open-lab-provider-capacity-preflight";
import type { DnaOpenLabR2BudgetWindow } from "@/lib/dna-open-lab-r2-budget-repository";

function measurement(): DnaOpenLabProviderCapacityMeasurement {
  return Object.freeze({
    evidenceSource: "provider_api",
    r2StorageClass: "Standard",
    measuredAt: "2026-10-03T03:00:00.000Z",
    billingWindowStartAt: "2026-10-01T00:00:00.000Z",
    billingWindowEndAt: "2026-11-01T00:00:00.000Z",
    currentR2Usage: Object.freeze({
      storageBytes: 100,
      classAOperations: 10,
      classBOperations: 20,
    }),
    neonMeasuredAt: "2026-10-03T03:00:00.000Z",
    neonBillingWindowStartAt: "2026-10-01T00:00:00.000Z",
    neonBillingWindowEndAt: "2026-11-01T00:00:00.000Z",
    currentNeonUsage: Object.freeze({
      storageBytes: 200,
      computeMilliCuHours: 300,
    }),
  });
}

function window(
  overrides: Partial<DnaOpenLabR2BudgetWindow> = {},
): DnaOpenLabR2BudgetWindow {
  return Object.freeze({
    windowId: "a".repeat(64),
    windowStartAt: "2026-09-01T00:00:00.000Z",
    windowEndAt: "2026-10-01T00:00:00.000Z",
    measuredAt: "2026-09-22T12:00:00.000Z",
    baselineUsage: Object.freeze({
      storageBytes: 10,
      classAOperations: 1,
      classBOperations: 2,
    }),
    accountedUsage: Object.freeze({
      storageBytes: 20,
      classAOperations: 3,
      classBOperations: 4,
    }),
    reservedUsage: Object.freeze({
      storageBytes: 30,
      classAOperations: 5,
      classBOperations: 6,
    }),
    lastBlockedAt: null,
    lastBlockerIds: Object.freeze([]),
    revision: 7,
    updatedAt: "2026-09-22T12:05:00.000Z",
    ...overrides,
  });
}

describe("R2 budget ledger diagnostic", () => {
  it("identifies an expired window with conservatively charged outstanding usage", () => {
    expect(
      diagnoseDnaOpenLabR2BudgetLedger({
        measurement: measurement(),
        window: window(),
      }),
    ).toMatchObject({
      status: "expired_window",
      openWindowPresent: true,
      reservedUsageOutstanding: true,
      expiredWindowRecoveryCandidate: true,
      requiresReservationRowInspection: false,
      ledgerRevision: 7,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
  });

  it("recognizes the exact current provider billing window", () => {
    expect(
      diagnoseDnaOpenLabR2BudgetLedger({
        measurement: measurement(),
        window: window({
          windowStartAt: "2026-10-01T00:00:00.000Z",
          windowEndAt: "2026-11-01T00:00:00.000Z",
          measuredAt: "2026-10-02T00:00:00.000Z",
          reservedUsage: Object.freeze({
            storageBytes: 0,
            classAOperations: 0,
            classBOperations: 0,
          }),
        }),
      }),
    ).toMatchObject({
      status: "current_window",
      reservedUsageOutstanding: false,
      expiredWindowRecoveryCandidate: false,
      requiresReservationRowInspection: false,
    });
  });

  it("does not guess when an expired window has no visible reserved usage", () => {
    expect(
      diagnoseDnaOpenLabR2BudgetLedger({
        measurement: measurement(),
        window: window({
          reservedUsage: Object.freeze({
            storageBytes: 0,
            classAOperations: 0,
            classBOperations: 0,
          }),
        }),
      }),
    ).toMatchObject({
      status: "expired_window",
      reservedUsageOutstanding: false,
      expiredWindowRecoveryCandidate: false,
      requiresReservationRowInspection: true,
    });
  });

  it("reports no open ledger without inventing a recovery need", () => {
    expect(
      diagnoseDnaOpenLabR2BudgetLedger({
        measurement: measurement(),
        window: null,
      }),
    ).toMatchObject({
      status: "no_open_window",
      openWindowPresent: false,
      expiredWindowRecoveryCandidate: false,
      requiresReservationRowInspection: false,
    });
  });
});
