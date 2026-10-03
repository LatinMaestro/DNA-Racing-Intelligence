import type {
  DnaOpenLabProviderCapacityMeasurement,
} from "./dna-open-lab-provider-capacity-preflight";
import type {
  DnaOpenLabR2BudgetWindow,
} from "./dna-open-lab-r2-budget-repository";
import type {
  DnaOpenLabR2Usage,
} from "./dna-open-lab-zero-cost-refresh-policy";

export const DNA_OPEN_LAB_R2_BUDGET_LEDGER_DIAGNOSTIC_VERSION =
  "dna-open-lab-r2-budget-ledger-diagnostic/v1" as const;

export type DnaOpenLabR2BudgetLedgerDiagnosticStatus =
  | "no_open_window"
  | "current_window"
  | "expired_window"
  | "overlapping_window_mismatch"
  | "future_window_mismatch";

export type DnaOpenLabR2BudgetLedgerDiagnostic = Readonly<{
  diagnosticVersion: typeof DNA_OPEN_LAB_R2_BUDGET_LEDGER_DIAGNOSTIC_VERSION;
  status: DnaOpenLabR2BudgetLedgerDiagnosticStatus;
  measuredAt: string;
  providerWindowStartAt: string;
  providerWindowEndAt: string;
  openWindowPresent: boolean;
  ledgerWindowStartAt: string | null;
  ledgerWindowEndAt: string | null;
  ledgerMeasuredAt: string | null;
  baselineUsage: DnaOpenLabR2Usage | null;
  accountedUsage: DnaOpenLabR2Usage | null;
  reservedUsage: DnaOpenLabR2Usage | null;
  reservedUsageOutstanding: boolean;
  expiredWindowRecoveryCandidate: boolean;
  requiresReservationRowInspection: boolean;
  ledgerRevision: number | null;
  persistentWritePerformed: false;
  providerWritePerformed: false;
  paidUsageAllowed: false;
}>;

function instant(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("R2 budget ledger diagnostic: " + field + " is invalid");
  }
  return value;
}

function anyUsage(value: DnaOpenLabR2Usage): boolean {
  return (
    value.storageBytes > 0 ||
    value.classAOperations > 0 ||
    value.classBOperations > 0
  );
}

export function diagnoseDnaOpenLabR2BudgetLedger(input: {
  measurement: DnaOpenLabProviderCapacityMeasurement;
  window: DnaOpenLabR2BudgetWindow | null;
}): DnaOpenLabR2BudgetLedgerDiagnostic {
  const measuredAt = instant(input.measurement.measuredAt, "measurement time");
  const providerWindowStartAt = instant(
    input.measurement.billingWindowStartAt,
    "provider window start",
  );
  const providerWindowEndAt = instant(
    input.measurement.billingWindowEndAt,
    "provider window end",
  );
  if (
    Date.parse(providerWindowStartAt) >= Date.parse(providerWindowEndAt) ||
    Date.parse(measuredAt) < Date.parse(providerWindowStartAt) ||
    Date.parse(measuredAt) >= Date.parse(providerWindowEndAt)
  ) {
    throw new Error(
      "R2 budget ledger diagnostic: provider billing window is invalid",
    );
  }

  const window = input.window;
  if (window === null) {
    return Object.freeze({
      diagnosticVersion: DNA_OPEN_LAB_R2_BUDGET_LEDGER_DIAGNOSTIC_VERSION,
      status: "no_open_window" as const,
      measuredAt,
      providerWindowStartAt,
      providerWindowEndAt,
      openWindowPresent: false,
      ledgerWindowStartAt: null,
      ledgerWindowEndAt: null,
      ledgerMeasuredAt: null,
      baselineUsage: null,
      accountedUsage: null,
      reservedUsage: null,
      reservedUsageOutstanding: false,
      expiredWindowRecoveryCandidate: false,
      requiresReservationRowInspection: false,
      ledgerRevision: null,
      persistentWritePerformed: false as const,
      providerWritePerformed: false as const,
      paidUsageAllowed: false as const,
    });
  }

  const ledgerWindowStartAt = instant(
    window.windowStartAt,
    "ledger window start",
  );
  const ledgerWindowEndAt = instant(window.windowEndAt, "ledger window end");
  const ledgerMeasuredAt = instant(
    window.measuredAt,
    "ledger measurement time",
  );
  if (
    Date.parse(ledgerWindowStartAt) >= Date.parse(ledgerWindowEndAt) ||
    Date.parse(ledgerMeasuredAt) < Date.parse(ledgerWindowStartAt) ||
    Date.parse(ledgerMeasuredAt) >= Date.parse(ledgerWindowEndAt)
  ) {
    throw new Error(
      "R2 budget ledger diagnostic: ledger billing window is invalid",
    );
  }

  let status: DnaOpenLabR2BudgetLedgerDiagnosticStatus;
  if (
    ledgerWindowStartAt === providerWindowStartAt &&
    ledgerWindowEndAt === providerWindowEndAt
  ) {
    status = "current_window";
  } else if (
    Date.parse(ledgerWindowEndAt) <= Date.parse(providerWindowStartAt)
  ) {
    status = "expired_window";
  } else if (
    Date.parse(ledgerWindowStartAt) >= Date.parse(providerWindowEndAt)
  ) {
    status = "future_window_mismatch";
  } else {
    status = "overlapping_window_mismatch";
  }

  const reservedUsageOutstanding = anyUsage(window.reservedUsage);
  return Object.freeze({
    diagnosticVersion: DNA_OPEN_LAB_R2_BUDGET_LEDGER_DIAGNOSTIC_VERSION,
    status,
    measuredAt,
    providerWindowStartAt,
    providerWindowEndAt,
    openWindowPresent: true,
    ledgerWindowStartAt,
    ledgerWindowEndAt,
    ledgerMeasuredAt,
    baselineUsage: window.baselineUsage,
    accountedUsage: window.accountedUsage,
    reservedUsage: window.reservedUsage,
    reservedUsageOutstanding,
    expiredWindowRecoveryCandidate:
      status === "expired_window" && reservedUsageOutstanding,
    requiresReservationRowInspection:
      status === "expired_window" && !reservedUsageOutstanding,
    ledgerRevision: window.revision,
    persistentWritePerformed: false as const,
    providerWritePerformed: false as const,
    paidUsageAllowed: false as const,
  });
}
