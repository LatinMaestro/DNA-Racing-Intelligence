import {
  DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS,
} from "./dna-open-lab-zero-cost-provider-capacity";
import { DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS } from "./dna-open-lab-zero-cost-refresh-policy";
import {
  materializeVaultPerformanceSummary,
  type VaultPerformanceSummaryMaterializer,
  type VaultPerformanceSummaryMaterializationResult,
} from "./vault-performance-summary-materializer";

const SHA = /^[a-f0-9]{40}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_MEASUREMENT_AGE_MS = 60_000;
const MAX_RESERVATION_LIFETIME_MS = 120_000;

export type PrivateWebsiteOperationResources = Readonly<{
  neonTransferBytes: number;
  neonStorageBytes: number;
  neonComputeMilliCuHours: number;
  r2StorageBytes: number;
  r2ClassAOperations: number;
  r2ClassBOperations: number;
}>;

const fields = [
  "neonTransferBytes",
  "neonStorageBytes",
  "neonComputeMilliCuHours",
  "r2StorageBytes",
  "r2ClassAOperations",
  "r2ClassBOperations",
] as const satisfies readonly (keyof PrivateWebsiteOperationResources)[];

const budgets: PrivateWebsiteOperationResources = Object.freeze({
  neonTransferBytes: DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.dataTransferBytes,
  neonStorageBytes: DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.storageBytes,
  neonComputeMilliCuHours:
    DNA_OPEN_LAB_ZERO_COST_NEON_BUDGETS.computeMilliCuHours,
  r2StorageBytes: DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.storageBytes,
  r2ClassAOperations: DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classAOperations,
  r2ClassBOperations: DNA_OPEN_LAB_ZERO_COST_R2_BUDGETS.classBOperations,
});

export type VaultPerformancePrivateMaterializationReservation = Readonly<{
  status: "reserved";
  reservationId: string;
  databaseOwnerId: string;
  authenticatedOwnerId: string;
  exactMainSha: string;
  issuedAt: string;
  validUntil: string;
  neonWindowEndAt: string;
  r2WindowEndAt: string;
  evidenceSource: "provider_api";
  atomicallyReserved: true;
  freePlansVerified: true;
  vercelFreeHeadroomVerified: true;
  zeroPaidUsageVerified: true;
  current: PrivateWebsiteOperationResources;
  otherReservations: PrivateWebsiteOperationResources;
  operation: PrivateWebsiteOperationResources;
  remainingMonthForecast: PrivateWebsiteOperationResources;
  websiteRecoveryReserve: PrivateWebsiteOperationResources;
}>;

type Request = Readonly<{
  databaseOwnerId: string;
  authenticatedOwnerId: string;
  exactMainSha: string;
  intendedWorstCaseNeonTransferBytes: number;
}>;

type Settlement =
  | VaultPerformanceSummaryMaterializationResult["status"]
  | "held"
  | "uncertain";

export type VaultPerformanceCapacityReservationPort = Readonly<{
  /** Must atomically account for concurrent reservations, provider meters,
   * remaining-month forecasts and website/recovery headroom. Never accept
   * a client-provided receipt or infer missing planned transfer as zero. */
  reserve: (
    request: Request,
  ) => Promise<
    | VaultPerformancePrivateMaterializationReservation
    | Readonly<{ status: "held" }>
  >;
  /** Retain estimated spend until independently reconciled against meters.
   * An uncertain operation must not automatically return reserved capacity. */
  settle: (
    reservationId: string,
    result: Settlement,
  ) => Promise<void>;
}>;

export type VaultPerformanceMainProofPort = Readonly<{
  inspect: () => Promise<
    Readonly<{
      mainSha: string;
      validatePassed: boolean;
      migrationPassed: boolean;
    }>
  >;
}>;

export type VaultPerformancePrivateMaterializationOutcome = Readonly<{
  status: Settlement;
  paidUsageAllowed: false;
  connectedAcceptanceProven: false;
}>;

function held(): VaultPerformancePrivateMaterializationOutcome {
  return Object.freeze({
    status: "held",
    paidUsageAllowed: false,
    connectedAcceptanceProven: false,
  });
}

function validTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
    ? parsed.getTime()
    : null;
}

function validHead(
  value: unknown,
  expectedSha: string,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const proof = value as Record<string, unknown>;
  return (
    proof.mainSha === expectedSha &&
    proof.validatePassed === true &&
    proof.migrationPassed === true
  );
}

/**
 * The reservation source is a trusted server-only provider/ledger adapter,
 * not a form input. This verification is a second fail-closed bound, not a
 * substitute for the adapter's atomic reservation or current provider data.
 */
export function validVaultPerformancePrivateReservation(
  receipt: VaultPerformancePrivateMaterializationReservation,
  request: Request,
  now: Date,
): boolean {
  const measuredAt = validTime(receipt?.issuedAt);
  const expiresAt = validTime(receipt?.validUntil);
  const neonEnd = validTime(receipt?.neonWindowEndAt);
  const r2End = validTime(receipt?.r2WindowEndAt);
  const nowMs = now.getTime();
  if (
    !Number.isFinite(nowMs) ||
    receipt?.status !== "reserved" ||
    !/^[A-Za-z0-9._:-]{8,128}$/.test(receipt.reservationId) ||
    receipt.databaseOwnerId !== request.databaseOwnerId ||
    receipt.authenticatedOwnerId !== request.authenticatedOwnerId ||
    receipt.exactMainSha !== request.exactMainSha ||
    receipt.evidenceSource !== "provider_api" ||
    receipt.atomicallyReserved !== true ||
    receipt.freePlansVerified !== true ||
    receipt.vercelFreeHeadroomVerified !== true ||
    receipt.zeroPaidUsageVerified !== true ||
    measuredAt === null ||
    expiresAt === null ||
    neonEnd === null ||
    r2End === null ||
    measuredAt > nowMs ||
    nowMs - measuredAt > MAX_MEASUREMENT_AGE_MS ||
    expiresAt <= nowMs ||
    expiresAt > measuredAt + MAX_RESERVATION_LIFETIME_MS ||
    expiresAt > neonEnd ||
    expiresAt > r2End ||
    !Number.isSafeInteger(request.intendedWorstCaseNeonTransferBytes) ||
    request.intendedWorstCaseNeonTransferBytes <= 0
  ) {
    return false;
  }
  const parts = [
    receipt.current,
    receipt.otherReservations,
    receipt.operation,
    receipt.remainingMonthForecast,
    receipt.websiteRecoveryReserve,
  ];
  if (
    parts.some((part) => typeof part !== "object" || part === null) ||
    receipt.operation.neonTransferBytes <
      request.intendedWorstCaseNeonTransferBytes ||
    receipt.operation.r2StorageBytes !== 0 ||
    receipt.operation.r2ClassAOperations !== 0 ||
    receipt.operation.r2ClassBOperations !== 0 ||
    receipt.websiteRecoveryReserve.neonTransferBytes <= 0 ||
    receipt.websiteRecoveryReserve.r2ClassAOperations <= 0 ||
    receipt.websiteRecoveryReserve.r2ClassBOperations <= 0
  ) {
    return false;
  }
  return fields.every((field) => {
    let total = 0;
    for (const part of parts) {
      const usage = part[field];
      if (!Number.isSafeInteger(usage) || usage < 0) return false;
      total += usage;
      if (!Number.isSafeInteger(total)) return false;
    }
    return total <= budgets[field];
  });
}

/**
 * Code/fixture commissioning boundary only: there is deliberately no live
 * capacity-reservation adapter, schedule, HTTP endpoint or CLI invocation.
 * A missing/unknown gate performs no Neon materialization or publication.
 */
export async function runVaultPerformancePrivateMaterialization(
  input: Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    configuredOwnerId: string;
    exactMainSha: string;
    intendedWorstCaseNeonTransferBytes: number;
    main: VaultPerformanceMainProofPort;
    capacity: VaultPerformanceCapacityReservationPort;
    materializer: VaultPerformanceSummaryMaterializer;
    now?: () => Date;
  }>,
): Promise<VaultPerformancePrivateMaterializationOutcome> {
  if (
    !UUID.test(input.databaseOwnerId) ||
    !SHA.test(input.exactMainSha) ||
    !input.authenticatedOwnerId.trim() ||
    input.authenticatedOwnerId !== input.configuredOwnerId ||
    !Number.isSafeInteger(input.intendedWorstCaseNeonTransferBytes) ||
    input.intendedWorstCaseNeonTransferBytes <= 0
  )
    return held();
  const request: Request = {
    databaseOwnerId: input.databaseOwnerId,
    authenticatedOwnerId: input.authenticatedOwnerId,
    exactMainSha: input.exactMainSha,
    intendedWorstCaseNeonTransferBytes:
      input.intendedWorstCaseNeonTransferBytes,
  };
  try {
    if (!validHead(await input.main.inspect(), input.exactMainSha))
      return held();
    const receipt = await input.capacity.reserve(request);
    if (receipt.status !== "reserved") return held();
    let settlement: Settlement = "uncertain";
    try {
      const now = (input.now ?? (() => new Date()))();
      if (
        !(now instanceof Date) ||
        !validVaultPerformancePrivateReservation(receipt, request, now) ||
        !validHead(await input.main.inspect(), input.exactMainSha)
      ) {
        settlement = "held";
        return held();
      }
      const result = await materializeVaultPerformanceSummary({
        databaseOwnerId: input.databaseOwnerId,
        materializer: input.materializer,
        now: () => now,
      });
      settlement = result.status;
      return Object.freeze({
        status: result.status,
        paidUsageAllowed: false,
        connectedAcceptanceProven: false,
      });
    } finally {
      await input.capacity.settle(receipt.reservationId, settlement);
    }
  } catch {
    // Do not expose provider counters, errors, owner identifiers or ledgers.
    return held();
  }
}
