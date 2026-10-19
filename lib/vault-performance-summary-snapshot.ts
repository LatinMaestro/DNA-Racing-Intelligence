import { createHash } from "node:crypto";
import type {
  VaultPerformanceAssetTotal,
  VaultPerformanceSummary,
} from "@/domain/vault-performance-summary";
import { normalizeVaultPerformanceReadSummary } from "@/lib/vault-performance-workspace-service";

// A transport/storage limit, never permission to truncate financial evidence.
export const VAULT_PERFORMANCE_SNAPSHOT_MAX_BYTES = 256 * 1024;
const VERSION = 1;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;

const summaryFields = {
  periodStart: true,
  periodEnd: true,
  dataCurrentThrough: true,
  lastImported: true,
  freshnessState: true,
  status: true,
  cashCryptoTotals: true,
  bgcTotals: true,
  includedTransactionCount: true,
  excludedTransactionCount: true,
  nonOperatingTransactionCount: true,
  unclassifiedTransactionCount: true,
  unresolvedReconciliationCount: true,
  warnings: true,
  combinedAssetTotalAvailable: true,
  bgcIncludedInCashCryptoProfit: true,
  lifetimeProfitClaimAllowed: true,
} satisfies Record<keyof VaultPerformanceSummary, true>;

const totalFields = {
  assetCode: true,
  assetKind: true,
  openRaceEntryFees: true,
  openRacePayouts: true,
  openRacingNet: true,
  qualificationEntryFees: true,
  qualificationRacePayouts: true,
  qualificationNet: true,
  tournamentRoundPayouts: true,
  tournamentFinalPayouts: true,
  manualTournamentPayouts: true,
  campaignExpenses: true,
  tournamentRecordedNet: true,
  breedingIncome: true,
  breedingExpenses: true,
  breedingNet: true,
  corePurchases: true,
  coreSaleProceeds: true,
  sellingFees: true,
  realisedCoreTradingResult: true,
  burnBgcCredits: true,
  arenaBgcSpend: true,
  netBgcMovement: true,
  otherLifecycleIncome: true,
  otherLifecycleExpenses: true,
  totalRecordedOperatingCashflow: true,
  nonOperatingMovement: true,
  includedTransactionCount: true,
} satisfies Record<keyof VaultPerformanceAssetTotal, true>;

type Snapshot = Readonly<{
  version: typeof VERSION;
  databaseOwnerId: string;
  sourceLedgerSha256: string;
  materializedAt: string;
  summary: VaultPerformanceSummary;
}>;

export type DecodedVaultPerformanceSummarySnapshot = Readonly<{
  sourceLedgerSha256: string;
  materializedAt: string;
  summary: VaultPerformanceSummary;
}>;

function fail(): never {
  // Never interpolate owner identities, source evidence or financial values.
  throw new Error("Invalid Vault Performance summary snapshot.");
}

function exactObject(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail();
  const row = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(row);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key)) ||
    fields.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(row, key);
      return !descriptor || !("value" in descriptor) || !descriptor.enumerable;
    })
  )
    fail();
  return row;
}

function canonical(value: unknown): string {
  if (
    value === null ||
    ["string", "boolean", "number"].includes(typeof value)
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) fail();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object") fail();
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

function digest(json: string): string {
  return createHash("sha256").update(json, "utf8").digest("hex");
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") fail();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) fail();
  return value;
}

function validNow(now: Date): void {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail();
}

function summaryShape(value: unknown): VaultPerformanceSummary {
  const row = exactObject(value, Object.keys(summaryFields));
  for (const field of ["cashCryptoTotals", "bgcTotals"] as const) {
    const totals = row[field];
    if (!Array.isArray(totals)) fail();
    for (const total of totals) {
      const asset = exactObject(total, Object.keys(totalFields));
      for (const [key, amount] of Object.entries(asset)) {
        if (key === "includedTransactionCount") {
          if (typeof amount !== "number") fail();
        } else if (key === "realisedCoreTradingResult" && amount === null) {
          continue;
        } else if (typeof amount !== "string") fail();
      }
    }
  }
  if (
    !Array.isArray(row.warnings) ||
    row.warnings.some((v) => typeof v !== "string")
  )
    fail();
  for (const key of ["periodStart", "periodEnd", "freshnessState", "status"]) {
    if (typeof row[key] !== "string") fail();
  }
  for (const key of ["dataCurrentThrough", "lastImported"]) {
    if (row[key] !== null && typeof row[key] !== "string") fail();
  }
  for (const key of Object.keys(summaryFields).filter((key) =>
    key.endsWith("Count"),
  )) {
    if (typeof row[key] !== "number") fail();
  }
  return row as VaultPerformanceSummary;
}

function validateSnapshot(value: unknown, now: Date): Snapshot {
  validNow(now);
  const row = exactObject(value, [
    "version",
    "databaseOwnerId",
    "sourceLedgerSha256",
    "materializedAt",
    "summary",
  ]);
  if (
    row.version !== VERSION ||
    typeof row.databaseOwnerId !== "string" ||
    !UUID.test(row.databaseOwnerId) ||
    typeof row.sourceLedgerSha256 !== "string" ||
    !HASH.test(row.sourceLedgerSha256)
  )
    fail();
  const materializedAt = timestamp(row.materializedAt);
  if (Date.parse(materializedAt) > now.getTime()) fail();
  const summary = summaryShape(row.summary);
  if (
    summary.dataCurrentThrough !== null &&
    Date.parse(timestamp(summary.dataCurrentThrough)) >
      Date.parse(materializedAt)
  )
    fail();
  if (
    summary.lastImported !== null &&
    Date.parse(timestamp(summary.lastImported)) > Date.parse(materializedAt)
  )
    fail();
  // Reuse accepted validation/freshness policy; do not recompute economic totals.
  const normalized = normalizeVaultPerformanceReadSummary(
    summary,
    new Date(materializedAt),
  );
  return {
    version: VERSION,
    databaseOwnerId: row.databaseOwnerId,
    sourceLedgerSha256: row.sourceLedgerSha256,
    materializedAt,
    summary: normalized,
  };
}

export function encodeVaultPerformanceSummarySnapshot(
  input: Readonly<{
    databaseOwnerId: string;
    sourceLedgerSha256: string;
    materializedAt: string;
    summary: VaultPerformanceSummary;
    now: Date;
  }>,
): Readonly<{ json: string; sha256: string }> {
  try {
    const snapshot = validateSnapshot(
      {
        version: VERSION,
        databaseOwnerId: input.databaseOwnerId,
        sourceLedgerSha256: input.sourceLedgerSha256,
        materializedAt: input.materializedAt,
        summary: input.summary,
      },
      input.now,
    );
    const json = canonical(snapshot);
    if (Buffer.byteLength(json, "utf8") > VAULT_PERFORMANCE_SNAPSHOT_MAX_BYTES)
      fail();
    return { json, sha256: digest(json) };
  } catch {
    return fail();
  }
}

export function decodeVaultPerformanceSummarySnapshot(
  input: Readonly<{
    json: string;
    sha256: string;
    databaseOwnerId: string;
    sourceLedgerSha256: string;
    now: Date;
  }>,
): VaultPerformanceSummary {
  return decodeVaultPerformanceSummarySnapshotEnvelope(input).summary;
}

export function decodeVaultPerformanceSummarySnapshotEnvelope(
  input: Readonly<{
    json: string;
    sha256: string;
    databaseOwnerId: string;
    sourceLedgerSha256: string;
    now: Date;
  }>,
): DecodedVaultPerformanceSummarySnapshot {
  try {
    if (
      typeof input.json !== "string" ||
      Buffer.byteLength(input.json, "utf8") >
        VAULT_PERFORMANCE_SNAPSHOT_MAX_BYTES ||
      !HASH.test(input.sha256) ||
      digest(input.json) !== input.sha256
    )
      fail();
    const snapshot = validateSnapshot(JSON.parse(input.json), input.now);
    if (
      snapshot.databaseOwnerId !== input.databaseOwnerId ||
      snapshot.sourceLedgerSha256 !== input.sourceLedgerSha256 ||
      canonical(snapshot) !== input.json
    )
      fail();
    return {
      sourceLedgerSha256: snapshot.sourceLedgerSha256,
      materializedAt: snapshot.materializedAt,
      summary: normalizeVaultPerformanceReadSummary(
        snapshot.summary,
        input.now,
      ),
    };
  } catch {
    return fail();
  }
}
