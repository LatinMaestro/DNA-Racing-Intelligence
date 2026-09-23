import { createHash } from "node:crypto";

import { DNA_CORE_RACE_HISTORY_MAXIMUM_CORES } from "./dna-core-race-history-acquisition-cycle";

export const DNA_CORE_RACE_HISTORY_REFRESH_PLAN_VERSION = 1 as const;

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaCoreRaceHistoryRefreshPlan = Readonly<{
  version: typeof DNA_CORE_RACE_HISTORY_REFRESH_PLAN_VERSION;
  planId: string;
  mode: "initial_full_history" | "incremental_reconciliation";
  evaluatedAt: string;
  currentStateGenerationId: string;
  previousCompletedCycleId: string | null;
  activeGenerationId: string | null;
  currentOwnedCoreIds: readonly number[];
  previouslyCoveredCoreIds: readonly number[];
  fullHistoryCoreIds: readonly number[];
  incrementalProbeCoreIds: readonly number[];
  retainedLineageCoreIds: readonly number[];
  requiresHistoricalLineageComposition: boolean;
  requiresExistingCoreDeltaProof: boolean;
}>;

function unavailable(message: string): never {
  throw new Error(`DNA Core race history refresh plan: ${message}`);
}

function timestamp(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) ||
    Number.isNaN(Date.parse(value))
  ) {
    return unavailable("evaluatedAt is invalid");
  }
  return new Date(value).toISOString();
}

function sha256(value: string, field: string): string {
  if (typeof value !== "string" || !SHA_256_PATTERN.test(value)) {
    return unavailable(`${field} is invalid`);
  }
  return value;
}

function coreIds(values: readonly number[], field: string): readonly number[] {
  if (!Array.isArray(values)) return unavailable(`${field} is invalid`);
  if (values.length > DNA_CORE_RACE_HISTORY_MAXIMUM_CORES) {
    return unavailable(`${field} exceeds the safe bound`);
  }
  const normalized = [...values].sort((left, right) => left - right);
  if (
    normalized.some(
      (value, index) =>
        !Number.isSafeInteger(value) ||
        value < 1 ||
        (index > 0 && normalized[index - 1] === value),
    )
  ) {
    return unavailable(`${field} must contain unique positive Core IDs`);
  }
  return Object.freeze(normalized);
}

function identity(value: string | null, field: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    return unavailable(`${field} is invalid`);
  }
  return value;
}

function planId(value: Omit<DnaCoreRaceHistoryRefreshPlan, "planId">): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

/**
 * Produces the exact work split for an owner-scoped Core-history refresh.
 * Previously covered Cores must never be scheduled for another unbounded
 * lifetime pull: they require a separately proved bounded delta strategy.
 * Cores no longer owned remain explicit lineage so publication cannot erase
 * historical observations merely because current ownership changed.
 */
export function createDnaCoreRaceHistoryRefreshPlan(input: {
  evaluatedAt: string;
  currentStateGenerationId: string;
  currentOwnedCoreIds: readonly number[];
  previousCompletedCycleId: string | null;
  previouslyCoveredCoreIds: readonly number[];
  activeGenerationId: string | null;
}): DnaCoreRaceHistoryRefreshPlan {
  const evaluatedAt = timestamp(input.evaluatedAt);
  const currentStateGenerationId = sha256(
    input.currentStateGenerationId,
    "currentStateGenerationId",
  );
  const currentOwnedCoreIds = coreIds(
    input.currentOwnedCoreIds,
    "currentOwnedCoreIds",
  );
  if (currentOwnedCoreIds.length === 0) {
    return unavailable("current ownership is empty");
  }
  const previousCompletedCycleId = identity(
    input.previousCompletedCycleId,
    "previousCompletedCycleId",
  );
  const previouslyCoveredCoreIds = coreIds(
    input.previouslyCoveredCoreIds,
    "previouslyCoveredCoreIds",
  );
  const activeGenerationId =
    input.activeGenerationId === null
      ? null
      : sha256(input.activeGenerationId, "activeGenerationId");
  const isInitial = previousCompletedCycleId === null;
  if (
    (isInitial &&
      (previouslyCoveredCoreIds.length !== 0 || activeGenerationId !== null)) ||
    (!isInitial &&
      (previouslyCoveredCoreIds.length === 0 || activeGenerationId === null))
  ) {
    return unavailable(
      "completed-cycle and active-generation authority disagree",
    );
  }

  const current = new Set(currentOwnedCoreIds);
  const previous = new Set(previouslyCoveredCoreIds);
  const fullHistoryCoreIds = Object.freeze(
    currentOwnedCoreIds.filter((coreId) => !previous.has(coreId)),
  );
  const incrementalProbeCoreIds = Object.freeze(
    currentOwnedCoreIds.filter((coreId) => previous.has(coreId)),
  );
  const retainedLineageCoreIds = Object.freeze(
    previouslyCoveredCoreIds.filter((coreId) => !current.has(coreId)),
  );
  const authority = Object.freeze({
    version: DNA_CORE_RACE_HISTORY_REFRESH_PLAN_VERSION,
    mode: isInitial
      ? ("initial_full_history" as const)
      : ("incremental_reconciliation" as const),
    evaluatedAt,
    currentStateGenerationId,
    previousCompletedCycleId,
    activeGenerationId,
    currentOwnedCoreIds,
    previouslyCoveredCoreIds,
    fullHistoryCoreIds,
    incrementalProbeCoreIds,
    retainedLineageCoreIds,
    requiresHistoricalLineageComposition: !isInitial,
    requiresExistingCoreDeltaProof: incrementalProbeCoreIds.length > 0,
  });
  return Object.freeze({ ...authority, planId: planId(authority) });
}
