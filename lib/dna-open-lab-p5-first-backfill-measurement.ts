import { DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES } from "./dna-open-lab-p5-capacity-measurement";
import type { DnaOpenLabP5FirstBackfillMeasuredUpperBound } from "./dna-open-lab-p5-first-backfill-approval";
import { DNA_CURRENT_STATE_ACQUISITION_GROUPS } from "./dna-open-lab-current-state-acquisition-cadence";

export const DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES = Object.freeze([
  "finished_races",
  ...DNA_CURRENT_STATE_ACQUISITION_GROUPS,
] as const);

export type DnaOpenLabP5FirstBackfillSourceFamily =
  (typeof DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES)[number];

export type DnaOpenLabP5FirstBackfillAuthorityClass =
  | "available_paginated_history_at_cutoff"
  | "bounded_recent_state_only"
  | "current_state_only";

export type DnaOpenLabP5FirstBackfillFamilyMeasurement = Readonly<{
  family: DnaOpenLabP5FirstBackfillSourceFamily;
  authorityClass: DnaOpenLabP5FirstBackfillAuthorityClass;
  observedAt: string;
  terminalInventoryObserved: boolean;
  observedSourceRecordCount: number;
  unresolvedIdentityObservationUpperBound: number;
  sourceRecordUpperBound: number;
  observedApiRequestCount: number;
  apiRequestUpperBound: number;
  retainedR2BytesUpperBound: number;
  classAOperationsUpperBound: number;
  classBOperationsUpperBound: number;
  neonIncrementalBytesUpperBound: number;
  evidenceRef: string;
}>;

export type DnaOpenLabP5FirstBackfillMeasurementInput = Readonly<{
  exactMainCommit: string;
  acquisitionPlanChecksum: string;
  measuredAt: string;
  authorityCutoffAt: string;
  repositoryRef: "refs/heads/main";
  worktreeClean: boolean;
  executionMode: "non_persistent_complete_inventory";
  persistentOwnerDataWriteCount: number;
  temporaryProviderResidueCount: number;
  rawPayloadIncludedInEvidence: boolean;
  secretMaterialIncludedInEvidence: boolean;
  connectedRecoverySuite: Readonly<{
    status: "passed";
    exactMainCommit: string;
    runRef: string;
  }>;
  neon: Readonly<{
    limitBytes: number;
    baselineBytes: number;
  }>;
  pricing: Readonly<{
    authorityRef: string;
    effectiveAt: string;
    bytesPerBillableGb: number;
    storageMicroUsdPerGbMonth: number;
    classAMicroUsdPerMillion: number;
    classBMicroUsdPerMillion: number;
    dnaApiCostMicroUsdUpperBound: number;
    neonCostMicroUsdUpperBound: number;
  }>;
  families: readonly DnaOpenLabP5FirstBackfillFamilyMeasurement[];
}>;

export type DnaOpenLabP5FirstBackfillMeasurementReport = Readonly<{
  version: 1;
  executionMode: "non_persistent_complete_inventory";
  exactMainCommit: string;
  acquisitionPlanChecksum: string;
  repositoryRef: "refs/heads/main";
  connectedRecoverySuiteRunRef: string;
  sourceFamilies: readonly DnaOpenLabP5FirstBackfillSourceFamily[];
  currentOnlyFamilies: readonly DnaOpenLabP5FirstBackfillSourceFamily[];
  boundedRecentOnlyFamilies: readonly DnaOpenLabP5FirstBackfillSourceFamily[];
  historyFamilies: readonly DnaOpenLabP5FirstBackfillSourceFamily[];
  pricingAuthorityRef: string;
  r2CostMicroUsdUpperBound: number;
  dnaApiCostMicroUsdUpperBound: number;
  neonCostMicroUsdUpperBound: number;
  measuredUpperBound: DnaOpenLabP5FirstBackfillMeasuredUpperBound;
  sourceAuthorityComplete: boolean;
  persistentOwnerDataWriteCount: 0;
  temporaryProviderResidueCount: 0;
  ownerApprovalRecorded: false;
  firstPersistentPrivatePreviewBackfillAllowed: false;
  productionChangesAllowed: false;
}>;

const EXPECTED_AUTHORITY: Readonly<
  Record<
    DnaOpenLabP5FirstBackfillSourceFamily,
    DnaOpenLabP5FirstBackfillAuthorityClass
  >
> = Object.freeze({
  finished_races: "available_paginated_history_at_cutoff",
  race_activity: "current_state_only",
  token_prices: "current_state_only",
  vault_identity: "bounded_recent_state_only",
  core_current_state: "current_state_only",
  splice_arena: "current_state_only",
});

function measurementError(message: string): never {
  throw new Error(`DNA Open Lab P5 first backfill measurement: ${message}`);
}

function exactHex(value: string, field: string, length: number): string {
  const normalized = value.trim();
  if (!new RegExp(`^[0-9a-f]{${length}}$`, "u").test(normalized)) {
    measurementError(`${field} must be an exact lowercase hexadecimal value`);
  }
  return normalized;
}

function timestamp(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    ) ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    measurementError(`${field} must be a timezone-qualified ISO timestamp`);
  }
  return new Date(normalized).toISOString();
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    measurementError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function positiveCount(value: number, field: string): number {
  const result = count(value, field);
  if (result < 1) measurementError(`${field} must be positive`);
  return result;
}

function reference(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 2_048) {
    measurementError(`${field} is invalid`);
  }
  return normalized;
}

function add(values: readonly number[], field: string): number {
  const result = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(result)) {
    measurementError(`${field} exceeds safe integer range`);
  }
  return result;
}

function ceilScaledCost(
  units: number,
  microUsdRate: number,
  divisor: number,
  field: string,
): number {
  const numerator = BigInt(units) * BigInt(microUsdRate);
  const denominator = BigInt(divisor);
  const result = (numerator + denominator - 1n) / denominator;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    measurementError(`${field} exceeds safe integer range`);
  }
  return Number(result);
}

/**
 * Canonicalizes the non-persistent complete-inventory observation that feeds
 * the separately reviewed owner approval packet. It measures only and can
 * never authorize a persistent write or Production change.
 */
export function buildDnaOpenLabP5FirstBackfillMeasurementReport(
  input: DnaOpenLabP5FirstBackfillMeasurementInput,
): DnaOpenLabP5FirstBackfillMeasurementReport {
  const exactMainCommit = exactHex(
    input.exactMainCommit,
    "exactMainCommit",
    40,
  );
  const acquisitionPlanChecksum = exactHex(
    input.acquisitionPlanChecksum,
    "acquisitionPlanChecksum",
    64,
  );
  if (input.repositoryRef !== "refs/heads/main" || !input.worktreeClean) {
    measurementError("measurement must run from a clean refs/heads/main");
  }
  if (input.executionMode !== "non_persistent_complete_inventory") {
    measurementError("executionMode must be non-persistent");
  }
  if (input.persistentOwnerDataWriteCount !== 0) {
    measurementError("persistent owner-data writes are prohibited");
  }
  if (input.temporaryProviderResidueCount !== 0) {
    measurementError("temporary provider residue must be zero");
  }
  if (input.rawPayloadIncludedInEvidence) {
    measurementError("raw payloads are prohibited in measurement evidence");
  }
  if (input.secretMaterialIncludedInEvidence) {
    measurementError("secret material is prohibited in measurement evidence");
  }

  if (
    input.connectedRecoverySuite.status !== "passed" ||
    input.connectedRecoverySuite.exactMainCommit !== exactMainCommit
  ) {
    measurementError(
      "connected recovery suite must pass from the measured exact main commit",
    );
  }
  const connectedRecoverySuiteRunRef = reference(
    input.connectedRecoverySuite.runRef,
    "connectedRecoverySuite.runRef",
  );

  const measuredAt = timestamp(input.measuredAt, "measuredAt");
  const authorityCutoffAt = timestamp(
    input.authorityCutoffAt,
    "authorityCutoffAt",
  );
  if (Date.parse(authorityCutoffAt) > Date.parse(measuredAt)) {
    measurementError("authorityCutoffAt cannot postdate measuredAt");
  }

  const pricingAuthorityRef = reference(
    input.pricing.authorityRef,
    "pricing.authorityRef",
  );
  const priceAuthorityEffectiveAt = timestamp(
    input.pricing.effectiveAt,
    "pricing.effectiveAt",
  );
  if (Date.parse(priceAuthorityEffectiveAt) > Date.parse(measuredAt)) {
    measurementError("pricing authority cannot postdate the measurement");
  }
  if (
    Date.parse(measuredAt) - Date.parse(priceAuthorityEffectiveAt) >
    31 * 86_400_000
  ) {
    measurementError("pricing authority is stale");
  }

  const bytesPerBillableGb = positiveCount(
    input.pricing.bytesPerBillableGb,
    "pricing.bytesPerBillableGb",
  );
  const storageMicroUsdPerGbMonth = count(
    input.pricing.storageMicroUsdPerGbMonth,
    "pricing.storageMicroUsdPerGbMonth",
  );
  const classAMicroUsdPerMillion = count(
    input.pricing.classAMicroUsdPerMillion,
    "pricing.classAMicroUsdPerMillion",
  );
  const classBMicroUsdPerMillion = count(
    input.pricing.classBMicroUsdPerMillion,
    "pricing.classBMicroUsdPerMillion",
  );
  const dnaApiCostMicroUsdUpperBound = count(
    input.pricing.dnaApiCostMicroUsdUpperBound,
    "pricing.dnaApiCostMicroUsdUpperBound",
  );
  const neonCostMicroUsdUpperBound = count(
    input.pricing.neonCostMicroUsdUpperBound,
    "pricing.neonCostMicroUsdUpperBound",
  );

  if (
    input.families.length !==
    DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES.length
  ) {
    measurementError("every source family must appear exactly once");
  }
  const byFamily = new Map<
    DnaOpenLabP5FirstBackfillSourceFamily,
    DnaOpenLabP5FirstBackfillFamilyMeasurement
  >();
  for (const family of input.families) {
    if (
      !DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES.includes(family.family)
    ) {
      measurementError("source family is unsupported");
    }
    if (byFamily.has(family.family)) {
      measurementError(`source family ${family.family} is duplicated`);
    }
    if (family.authorityClass !== EXPECTED_AUTHORITY[family.family]) {
      measurementError(`source family ${family.family} authority is invalid`);
    }
    if (!family.terminalInventoryObserved) {
      measurementError(`source family ${family.family} is not complete`);
    }
    const observedAt = timestamp(
      family.observedAt,
      `${family.family}.observedAt`,
    );
    if (
      Date.parse(observedAt) < Date.parse(authorityCutoffAt) ||
      Date.parse(observedAt) > Date.parse(measuredAt)
    ) {
      measurementError(
        `${family.family}.observedAt must fall within the measurement interval`,
      );
    }
    const observedSourceRecordCount = count(
      family.observedSourceRecordCount,
      `${family.family}.observedSourceRecordCount`,
    );
    const unresolvedIdentityObservationUpperBound = count(
      family.unresolvedIdentityObservationUpperBound,
      `${family.family}.unresolvedIdentityObservationUpperBound`,
    );
    if (
      family.family !== "finished_races" &&
      unresolvedIdentityObservationUpperBound !== 0
    ) {
      measurementError(
        `${family.family} cannot report finished-race identity conflicts`,
      );
    }
    const sourceRecordUpperBound = count(
      family.sourceRecordUpperBound,
      `${family.family}.sourceRecordUpperBound`,
    );
    if (
      sourceRecordUpperBound <
      add(
        [observedSourceRecordCount, unresolvedIdentityObservationUpperBound],
        `${family.family}.projectedSourceRecordCount`,
      )
    ) {
      measurementError(
        `${family.family}.sourceRecordUpperBound is below the observation`,
      );
    }
    const observedApiRequestCount = positiveCount(
      family.observedApiRequestCount,
      `${family.family}.observedApiRequestCount`,
    );
    const apiRequestUpperBound = positiveCount(
      family.apiRequestUpperBound,
      `${family.family}.apiRequestUpperBound`,
    );
    if (apiRequestUpperBound < observedApiRequestCount) {
      measurementError(
        `${family.family}.apiRequestUpperBound is below the observation`,
      );
    }
    count(
      family.retainedR2BytesUpperBound,
      `${family.family}.retainedR2BytesUpperBound`,
    );
    count(
      family.classAOperationsUpperBound,
      `${family.family}.classAOperationsUpperBound`,
    );
    count(
      family.classBOperationsUpperBound,
      `${family.family}.classBOperationsUpperBound`,
    );
    count(
      family.neonIncrementalBytesUpperBound,
      `${family.family}.neonIncrementalBytesUpperBound`,
    );
    reference(family.evidenceRef, `${family.family}.evidenceRef`);
    byFamily.set(family.family, family);
  }
  if (
    DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES.some(
      (family) => !byFamily.has(family),
    )
  ) {
    measurementError("every source family must appear exactly once");
  }

  const families = DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES.map(
    (family) => byFamily.get(family)!,
  );
  const sourceRecordUpperBound = add(
    families.map((family) => family.sourceRecordUpperBound),
    "sourceRecordUpperBound",
  );
  const unresolvedIdentityObservationUpperBound = add(
    families.map((family) => family.unresolvedIdentityObservationUpperBound),
    "unresolvedIdentityObservationUpperBound",
  );
  const apiRequestUpperBound = add(
    families.map((family) => family.apiRequestUpperBound),
    "apiRequestUpperBound",
  );
  const retainedR2BytesUpperBound = add(
    families.map((family) => family.retainedR2BytesUpperBound),
    "retainedR2BytesUpperBound",
  );
  const classAOperationsUpperBound = add(
    families.map((family) => family.classAOperationsUpperBound),
    "classAOperationsUpperBound",
  );
  const classBOperationsUpperBound = add(
    families.map((family) => family.classBOperationsUpperBound),
    "classBOperationsUpperBound",
  );
  positiveCount(sourceRecordUpperBound, "sourceRecordUpperBound");
  positiveCount(apiRequestUpperBound, "apiRequestUpperBound");
  positiveCount(retainedR2BytesUpperBound, "retainedR2BytesUpperBound");
  positiveCount(classAOperationsUpperBound, "classAOperationsUpperBound");
  positiveCount(classBOperationsUpperBound, "classBOperationsUpperBound");

  if (input.neon.limitBytes !== DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES) {
    measurementError("Neon limit does not match the approved boundary");
  }
  const neonBaselineBytes = positiveCount(
    input.neon.baselineBytes,
    "neon.baselineBytes",
  );
  const neonPeakBytesUpperBound = add(
    [
      neonBaselineBytes,
      ...families.map((family) => family.neonIncrementalBytesUpperBound),
    ],
    "neonPeakBytesUpperBound",
  );
  if (neonPeakBytesUpperBound >= input.neon.limitBytes) {
    measurementError("Neon peak upper bound must leave positive headroom");
  }

  const storageCost = ceilScaledCost(
    retainedR2BytesUpperBound,
    storageMicroUsdPerGbMonth,
    bytesPerBillableGb,
    "R2 storage cost",
  );
  const classACost = ceilScaledCost(
    classAOperationsUpperBound,
    classAMicroUsdPerMillion,
    1_000_000,
    "R2 Class A cost",
  );
  const classBCost = ceilScaledCost(
    classBOperationsUpperBound,
    classBMicroUsdPerMillion,
    1_000_000,
    "R2 Class B cost",
  );
  const r2CostMicroUsdUpperBound = add(
    [storageCost, classACost, classBCost],
    "r2CostMicroUsdUpperBound",
  );
  const projectedCostMicroUsd = add(
    [
      r2CostMicroUsdUpperBound,
      dnaApiCostMicroUsdUpperBound,
      neonCostMicroUsdUpperBound,
    ],
    "projectedCostMicroUsd",
  );

  const measuredUpperBound = Object.freeze({
    measurementBasis: "complete_inventory_upper_bound" as const,
    exactMainCommit,
    measuredAt,
    authorityCutoffAt,
    priceAuthorityEffectiveAt,
    sourceRecordUpperBound,
    apiRequestUpperBound,
    retainedR2BytesUpperBound,
    classAOperationsUpperBound,
    classBOperationsUpperBound,
    neonPeakBytesUpperBound,
    projectedCostMicroUsd,
    unresolvedIdentityObservationUpperBound,
    evidenceRefs: Object.freeze([
      connectedRecoverySuiteRunRef,
      pricingAuthorityRef,
      ...families.map((family) =>
        reference(family.evidenceRef, `${family.family}.evidenceRef`),
      ),
    ]),
  });

  const selectFamilies = (
    authorityClass: DnaOpenLabP5FirstBackfillAuthorityClass,
  ) =>
    Object.freeze(
      families
        .filter((family) => family.authorityClass === authorityClass)
        .map((family) => family.family),
    );

  return Object.freeze({
    version: 1 as const,
    executionMode: "non_persistent_complete_inventory" as const,
    exactMainCommit,
    acquisitionPlanChecksum,
    repositoryRef: "refs/heads/main" as const,
    connectedRecoverySuiteRunRef,
    sourceFamilies: DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES,
    currentOnlyFamilies: selectFamilies("current_state_only"),
    boundedRecentOnlyFamilies: selectFamilies("bounded_recent_state_only"),
    historyFamilies: selectFamilies("available_paginated_history_at_cutoff"),
    pricingAuthorityRef,
    r2CostMicroUsdUpperBound,
    dnaApiCostMicroUsdUpperBound,
    neonCostMicroUsdUpperBound,
    measuredUpperBound,
    sourceAuthorityComplete: unresolvedIdentityObservationUpperBound === 0,
    persistentOwnerDataWriteCount: 0 as const,
    temporaryProviderResidueCount: 0 as const,
    ownerApprovalRecorded: false as const,
    firstPersistentPrivatePreviewBackfillAllowed: false as const,
    productionChangesAllowed: false as const,
  });
}
