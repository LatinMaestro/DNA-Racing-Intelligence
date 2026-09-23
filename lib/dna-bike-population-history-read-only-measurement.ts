import { createHash } from "node:crypto";

import {
  DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE,
  DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE,
} from "./dna-core-race-history-acquisition-cycle";
import type {
  DnaCoreRaceHistoryClient,
  DnaCoreRaceHistoryRow,
} from "./dna-core-race-history-client";
import { DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE } from "./dna-core-race-history-acquisition-runner";
import type { DnaBikePopulationHistoryAcquisitionPlan } from "./dna-bike-population-history-acquisition-plan";
import {
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
  type DnaOpenLabRequestBudget,
} from "./dna-open-lab-request-budget";
import { DnaOpenLabApiError } from "./dna-open-lab-v1-client";
import type { DnaOpenLabR2Usage } from "./dna-open-lab-zero-cost-refresh-policy";

export const DNA_BIKE_POPULATION_HISTORY_MEASUREMENT_MAXIMUM_CORES =
  64 as const;
export const DNA_BIKE_POPULATION_HISTORY_MEASUREMENT_MAXIMUM_PAGES_PER_CORE =
  100 as const;

type MeasurementHeldReason =
  | "acquisition_plan_not_ready"
  | "api_unavailable"
  | "rate_limited"
  | "invalid_response"
  | "page_bound_reached";

type MeasurementSafety = Readonly<{
  persistentWritePerformed: false;
  providerWritePerformed: false;
  paidUsageAllowed: false;
}>;

export type DnaBikePopulationHistoryReadOnlyMeasurement = MeasurementSafety &
  Readonly<{
    status: "complete" | "held";
    reason: MeasurementHeldReason | null;
    measurementSliceSha256: string | null;
    acquisitionCoreSetSha256: string | null;
    cohortOrdinal: number;
    cohortOffset: number;
    selectedCoreCount: number;
    completeCoreCount: number;
    providerRequestCount: number;
    sourceRowCount: number;
    canonicalResultBytes: number;
    acquisitionR2Ceiling: DnaOpenLabR2Usage;
    fullAcquisitionMeasured: boolean;
    providerReadPerformed: boolean;
  }>;

const SAFE = Object.freeze({
  persistentWritePerformed: false as const,
  providerWritePerformed: false as const,
  paidUsageAllowed: false as const,
});

function measurementError(message: string): never {
  throw new Error(`Bike population history measurement: ${message}`);
}

function boundedInteger(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    measurementError(`${field} is invalid`);
  }
  return value;
}

function add(left: number, right: number, field: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    measurementError(`${field} exceeds safe integer capacity`);
  }
  return value;
}

function multiply(left: number, right: number, field: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) {
    measurementError(`${field} exceeds safe integer capacity`);
  }
  return value;
}

function resultBytes(rows: readonly DnaCoreRaceHistoryRow[]): number {
  return new TextEncoder().encode(JSON.stringify(rows)).byteLength;
}

function sliceSha256(input: {
  acquisitionCoreSetSha256: string;
  cohortOrdinal: number;
  cohortOffset: number;
  maximumPagesPerCore: number;
  coreIds: readonly number[];
}): string {
  return createHash("sha256")
    .update(
      [
        "dna_open_lab",
        "bike_population_history_read_only_measurement",
        input.acquisitionCoreSetSha256,
        input.cohortOrdinal,
        input.cohortOffset,
        input.maximumPagesPerCore,
        ...input.coreIds,
      ].join("\u0000"),
      "utf8",
    )
    .digest("hex");
}

function acquisitionR2Ceiling(requestCount: number): DnaOpenLabR2Usage {
  return Object.freeze({
    storageBytes: multiply(
      requestCount,
      DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.storageBytes,
      "R2 storage ceiling",
    ),
    classAOperations: multiply(
      requestCount,
      DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.classAOperations,
      "R2 Class A ceiling",
    ),
    classBOperations: multiply(
      requestCount,
      DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.classBOperations,
      "R2 Class B ceiling",
    ),
  });
}

function held(input: {
  reason: MeasurementHeldReason;
  plan: DnaBikePopulationHistoryAcquisitionPlan;
  cohortOrdinal: number;
  cohortOffset: number;
  selectedCoreCount?: number;
  completeCoreCount?: number;
  providerRequestCount?: number;
  sourceRowCount?: number;
  canonicalResultBytes?: number;
  measurementSliceSha256?: string | null;
}): DnaBikePopulationHistoryReadOnlyMeasurement {
  const providerRequestCount = input.providerRequestCount ?? 0;
  return Object.freeze({
    ...SAFE,
    status: "held" as const,
    reason: input.reason,
    measurementSliceSha256: input.measurementSliceSha256 ?? null,
    acquisitionCoreSetSha256: input.plan.acquisitionCoreSetSha256,
    cohortOrdinal: input.cohortOrdinal,
    cohortOffset: input.cohortOffset,
    selectedCoreCount: input.selectedCoreCount ?? 0,
    completeCoreCount: input.completeCoreCount ?? 0,
    providerRequestCount,
    sourceRowCount: input.sourceRowCount ?? 0,
    canonicalResultBytes: input.canonicalResultBytes ?? 0,
    acquisitionR2Ceiling: acquisitionR2Ceiling(providerRequestCount),
    fullAcquisitionMeasured: false,
    providerReadPerformed: providerRequestCount > 0,
  });
}

function apiHeldReason(error: unknown): MeasurementHeldReason | null {
  if (!(error instanceof DnaOpenLabApiError)) return null;
  switch (error.kind) {
    case "rate_limited":
      return "rate_limited";
    case "api_error":
    case "transport_error":
      return "api_unavailable";
    case "malformed_response":
      return "invalid_response";
    case "invalid_configuration":
    case "invalid_request":
      return null;
  }
}

/**
 * Measures a deterministic, bounded slice of the planned unowned Bike
 * population through the existing Core-history client. The scan is memory
 * only: it stores neither response bodies nor checkpoints, and it returns
 * aggregates rather than Core identities or raw evidence.
 *
 * A full provider page at the configured page ceiling is not treated as a
 * terminal history. The result holds instead of understating requests, rows,
 * or storage. The R2 projection uses the collector's existing per-page worst
 * case even though this read-only operation performs no R2 work itself.
 */
export async function measureDnaBikePopulationHistoryReadOnly(input: {
  plan: DnaBikePopulationHistoryAcquisitionPlan;
  cohortOrdinal: number;
  cohortOffset?: number;
  maximumCoreCount: number;
  maximumPagesPerCore: number;
  client: DnaCoreRaceHistoryClient;
  requestBudget: DnaOpenLabRequestBudget;
}): Promise<DnaBikePopulationHistoryReadOnlyMeasurement> {
  const cohortOrdinal = boundedInteger(
    input.cohortOrdinal,
    "cohortOrdinal",
    0,
    Math.max(0, input.plan.cohorts.length - 1),
  );
  const cohortOffset = boundedInteger(
    input.cohortOffset ?? 0,
    "cohortOffset",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const maximumCoreCount = boundedInteger(
    input.maximumCoreCount,
    "maximumCoreCount",
    1,
    DNA_BIKE_POPULATION_HISTORY_MEASUREMENT_MAXIMUM_CORES,
  );
  const maximumPagesPerCore = boundedInteger(
    input.maximumPagesPerCore,
    "maximumPagesPerCore",
    1,
    Math.min(
      DNA_BIKE_POPULATION_HISTORY_MEASUREMENT_MAXIMUM_PAGES_PER_CORE,
      DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE,
    ),
  );
  if (
    input.requestBudget.snapshot().effectiveRequestsPerMinute < 1 ||
    input.requestBudget.snapshot().effectiveRequestsPerMinute >
      DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
  ) {
    measurementError("request budget exceeds the conservative aggregate rate");
  }
  if (
    input.plan.status !== "ready_for_budget_measurement" ||
    input.plan.acquisitionCoreSetSha256 === null
  ) {
    return held({
      reason: "acquisition_plan_not_ready",
      plan: input.plan,
      cohortOrdinal,
      cohortOffset,
    });
  }
  const cohort = input.plan.cohorts[cohortOrdinal];
  if (cohort === undefined || cohortOffset >= cohort.coreIds.length) {
    measurementError("measurement slice is outside its cohort");
  }
  const coreIds = Object.freeze(
    cohort.coreIds.slice(cohortOffset, cohortOffset + maximumCoreCount),
  );
  const measurementSliceSha256 = sliceSha256({
    acquisitionCoreSetSha256: input.plan.acquisitionCoreSetSha256,
    cohortOrdinal,
    cohortOffset,
    maximumPagesPerCore,
    coreIds,
  });
  let completeCoreCount = 0;
  let providerRequestCount = 0;
  let sourceRowCount = 0;
  let canonicalResultBytes = 0;

  for (const coreId of coreIds) {
    let terminal = false;
    for (let page = 1; page <= maximumPagesPerCore; page += 1) {
      try {
        providerRequestCount = add(
          providerRequestCount,
          1,
          "provider request count",
        );
        const response = await input.requestBudget.execute(() =>
          input.client.page({ coreId, page }),
        );
        sourceRowCount = add(
          sourceRowCount,
          response.result.length,
          "source row count",
        );
        canonicalResultBytes = add(
          canonicalResultBytes,
          resultBytes(response.result),
          "canonical result bytes",
        );
        if (response.result.length < DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE) {
          terminal = true;
          completeCoreCount += 1;
          break;
        }
      } catch (error) {
        const reason = apiHeldReason(error);
        if (reason === null) throw error;
        return held({
          reason,
          plan: input.plan,
          cohortOrdinal,
          cohortOffset,
          selectedCoreCount: coreIds.length,
          completeCoreCount,
          providerRequestCount,
          sourceRowCount,
          canonicalResultBytes,
          measurementSliceSha256,
        });
      }
    }
    if (!terminal) {
      return held({
        reason: "page_bound_reached",
        plan: input.plan,
        cohortOrdinal,
        cohortOffset,
        selectedCoreCount: coreIds.length,
        completeCoreCount,
        providerRequestCount,
        sourceRowCount,
        canonicalResultBytes,
        measurementSliceSha256,
      });
    }
  }

  const fullAcquisitionMeasured =
    input.plan.cohorts.length === 1 &&
    cohortOrdinal === 0 &&
    cohortOffset === 0 &&
    coreIds.length === input.plan.acquisitionCoreCount;
  return Object.freeze({
    ...SAFE,
    status: "complete" as const,
    reason: null,
    measurementSliceSha256,
    acquisitionCoreSetSha256: input.plan.acquisitionCoreSetSha256,
    cohortOrdinal,
    cohortOffset,
    selectedCoreCount: coreIds.length,
    completeCoreCount,
    providerRequestCount,
    sourceRowCount,
    canonicalResultBytes,
    acquisitionR2Ceiling: acquisitionR2Ceiling(providerRequestCount),
    fullAcquisitionMeasured,
    providerReadPerformed: providerRequestCount > 0,
  });
}
