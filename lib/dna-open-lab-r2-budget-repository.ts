import type {
  DnaOpenLabR2Usage,
  DnaOpenLabZeroCostBlockerId,
} from "./dna-open-lab-zero-cost-refresh-policy";

export type DnaOpenLabR2BudgetWindow = Readonly<{
  windowId: string;
  windowStartAt: string;
  windowEndAt: string;
  measuredAt: string;
  baselineUsage: DnaOpenLabR2Usage;
  accountedUsage: DnaOpenLabR2Usage;
  reservedUsage: DnaOpenLabR2Usage;
  lastBlockedAt: string | null;
  lastBlockerIds: readonly DnaOpenLabZeroCostBlockerId[];
  revision: number;
  updatedAt: string;
}>;

export type DnaOpenLabR2BudgetReservationDecision = Readonly<{
  allowed: boolean;
  blockerIds: readonly DnaOpenLabZeroCostBlockerId[];
  projectedUsage: DnaOpenLabR2Usage;
  reservationStatus: "reserved" | "accounted" | null;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

export type DnaOpenLabR2BudgetReservation = Readonly<{
  windowId: string;
  refreshCycleId: string;
  requestSha256: string;
  status: "reserved" | "accounted";
  plannedUsage: DnaOpenLabR2Usage;
  actualUsage: DnaOpenLabR2Usage | null;
  reservedAt: string;
  accountedAt: string | null;
}>;

export type DnaOpenLabR2BudgetRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      readWindow(ownerId: string): Promise<DnaOpenLabR2BudgetWindow | null>;
      openWindow(input: {
        ownerId: string;
        windowId: string;
        windowStartAt: string;
        windowEndAt: string;
        measuredAt: string;
        baselineUsage: DnaOpenLabR2Usage;
      }): Promise<DnaOpenLabR2BudgetWindow>;
      reserve(input: {
        ownerId: string;
        windowId: string;
        refreshCycleId: string;
        requestSha256: string;
        plannedUsage: DnaOpenLabR2Usage;
      }): Promise<DnaOpenLabR2BudgetReservationDecision>;
      account(input: {
        ownerId: string;
        windowId: string;
        refreshCycleId: string;
        requestSha256: string;
        actualUsage: DnaOpenLabR2Usage;
      }): Promise<DnaOpenLabR2BudgetReservation>;
    }>;
