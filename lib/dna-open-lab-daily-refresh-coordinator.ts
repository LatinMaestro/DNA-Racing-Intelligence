import type {
  DnaOpenLabR2BudgetRepository,
  DnaOpenLabR2BudgetReservation,
  DnaOpenLabR2BudgetReservationDecision,
} from "./dna-open-lab-r2-budget-repository";
import type { DnaCurrentStateOperatorStepResult } from "./dna-open-lab-current-state-operator";
import type { DnaFinishedRaceIncrementalStepResult } from "./dna-open-lab-finished-race-incremental-runner";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import type { DnaOpenLabR2Usage } from "./dna-open-lab-zero-cost-refresh-policy";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const DNA_OPEN_LAB_DAILY_REFRESH_GENERATION_VERSION = 1 as const;

export type DnaOpenLabDailyRefreshGeneration = Readonly<{
  version: typeof DNA_OPEN_LAB_DAILY_REFRESH_GENERATION_VERSION;
  refreshCycleId: string;
  budgetWindowId: string;
  budgetRequestSha256: string;
  finishedHistoryCycleId: string;
  currentStateGenerationId: string;
  actualR2Usage: DnaOpenLabR2Usage;
  publishedAt: string;
}>;

export type DnaOpenLabDailyRefreshGenerationRepository = Readonly<{
  load(
    refreshCycleId: string,
  ): Promise<DnaOpenLabDailyRefreshGeneration | null>;
  publish(
    generation: DnaOpenLabDailyRefreshGeneration,
  ): Promise<DnaOpenLabDailyRefreshGeneration>;
}>;

export type DnaOpenLabDailyRefreshBudgetUnavailableReason =
  "not_configured" | "window_missing" | "window_mismatch";

export type DnaOpenLabDailyRefreshStepResult =
  | Readonly<{
      kind: "budget_unavailable";
      reason: DnaOpenLabDailyRefreshBudgetUnavailableReason;
    }>
  | Readonly<{
      kind: "budget_blocked";
      decision: DnaOpenLabR2BudgetReservationDecision;
    }>
  | Readonly<{
      kind: "finished_history";
      step: DnaFinishedRaceIncrementalStepResult;
    }>
  | Readonly<{
      kind: "current_state";
      historyCycleId: string;
      step: DnaCurrentStateOperatorStepResult;
    }>
  | Readonly<{
      kind: "complete";
      generation: DnaOpenLabDailyRefreshGeneration;
      accounting: DnaOpenLabR2BudgetReservation;
    }>;

function coordinatorError(message: string): never {
  throw new Error(`DNA Open Lab daily refresh coordinator: ${message}`);
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    coordinatorError(`${field} must be a SHA-256 value`);
  }
  return normalized;
}

function timestamp(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) coordinatorError(`${field} is invalid`);
  return new Date(parsed).toISOString();
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    coordinatorError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function usage(value: DnaOpenLabR2Usage, field: string): DnaOpenLabR2Usage {
  return Object.freeze({
    storageBytes: count(value.storageBytes, `${field}.storageBytes`),
    classAOperations: count(
      value.classAOperations,
      `${field}.classAOperations`,
    ),
    classBOperations: count(
      value.classBOperations,
      `${field}.classBOperations`,
    ),
  });
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 512) {
    coordinatorError(`${field} is invalid`);
  }
  return normalized;
}

function generation(
  value: DnaOpenLabDailyRefreshGeneration,
  expected: {
    refreshCycleId: string;
    budgetWindowId: string;
    budgetRequestSha256: string;
  },
): DnaOpenLabDailyRefreshGeneration {
  if (value.version !== DNA_OPEN_LAB_DAILY_REFRESH_GENERATION_VERSION) {
    coordinatorError("generation version is unsupported");
  }
  const normalized = Object.freeze({
    version: DNA_OPEN_LAB_DAILY_REFRESH_GENERATION_VERSION,
    refreshCycleId: sha256(value.refreshCycleId, "generation.refreshCycleId"),
    budgetWindowId: sha256(value.budgetWindowId, "generation.budgetWindowId"),
    budgetRequestSha256: sha256(
      value.budgetRequestSha256,
      "generation.budgetRequestSha256",
    ),
    finishedHistoryCycleId: sha256(
      value.finishedHistoryCycleId,
      "generation.finishedHistoryCycleId",
    ),
    currentStateGenerationId: nonEmpty(
      value.currentStateGenerationId,
      "generation.currentStateGenerationId",
    ),
    actualR2Usage: usage(value.actualR2Usage, "generation.actualR2Usage"),
    publishedAt: timestamp(value.publishedAt, "generation.publishedAt"),
  });
  if (
    normalized.refreshCycleId !== expected.refreshCycleId ||
    normalized.budgetWindowId !== expected.budgetWindowId ||
    normalized.budgetRequestSha256 !== expected.budgetRequestSha256
  ) {
    coordinatorError("published generation belongs to different authority");
  }
  return normalized;
}

function assertActualWithinPlan(
  actual: DnaOpenLabR2Usage,
  planned: DnaOpenLabR2Usage,
): void {
  if (
    actual.storageBytes > planned.storageBytes ||
    actual.classAOperations > planned.classAOperations ||
    actual.classBOperations > planned.classBOperations
  ) {
    coordinatorError("actual R2 usage exceeds the reserved upper bound");
  }
}

export function dnaOpenLabDailyRefreshBudgetRequestSha256(input: {
  refreshCycleId: string;
  budgetWindowId: string;
  plannedR2Usage: DnaOpenLabR2Usage;
}): string {
  return dnaOpenLabRawEvidenceSha256({
    version: DNA_OPEN_LAB_DAILY_REFRESH_GENERATION_VERSION,
    refreshCycleId: sha256(input.refreshCycleId, "refreshCycleId"),
    budgetWindowId: sha256(input.budgetWindowId, "budgetWindowId"),
    plannedR2Usage: usage(input.plannedR2Usage, "plannedR2Usage"),
  });
}

/**
 * Advances at most one provider request through the existing bounded history or
 * current-state runner. One durable upper-bound reservation covers both source
 * families and remains charged across pauses and process restarts. Actual use
 * is reconciled only after an immutable complete-generation record exists.
 *
 * Generation publication must be idempotent. If the process stops after that
 * publication but before budget accounting, the next invocation loads the
 * generation and performs accounting without issuing another provider request.
 */
export async function runDnaOpenLabDailyRefreshStep(input: {
  ownerId: string;
  refreshCycleId: string;
  budgetWindowId: string;
  plannedR2Usage: DnaOpenLabR2Usage;
  budgetRepository: DnaOpenLabR2BudgetRepository;
  generationRepository: DnaOpenLabDailyRefreshGenerationRepository;
  advanceFinishedHistory: () => Promise<DnaFinishedRaceIncrementalStepResult>;
  advanceCurrentState: () => Promise<DnaCurrentStateOperatorStepResult>;
  measureActualR2Usage: () => Promise<DnaOpenLabR2Usage>;
  publishedAt: string;
}): Promise<DnaOpenLabDailyRefreshStepResult> {
  const refreshCycleId = sha256(input.refreshCycleId, "refreshCycleId");
  const budgetWindowId = sha256(input.budgetWindowId, "budgetWindowId");
  const plannedR2Usage = usage(input.plannedR2Usage, "plannedR2Usage");
  const budgetRequestSha256 = dnaOpenLabDailyRefreshBudgetRequestSha256({
    refreshCycleId,
    budgetWindowId,
    plannedR2Usage,
  });

  if (input.budgetRepository.status !== "ready") {
    return Object.freeze({
      kind: "budget_unavailable",
      reason: "not_configured",
    });
  }
  const window = await input.budgetRepository.readWindow(input.ownerId);
  if (window === null) {
    return Object.freeze({
      kind: "budget_unavailable",
      reason: "window_missing",
    });
  }
  if (window.windowId !== budgetWindowId) {
    return Object.freeze({
      kind: "budget_unavailable",
      reason: "window_mismatch",
    });
  }

  const decision = await input.budgetRepository.reserve({
    ownerId: input.ownerId,
    windowId: budgetWindowId,
    refreshCycleId,
    requestSha256: budgetRequestSha256,
    plannedUsage: plannedR2Usage,
  });
  if (!decision.allowed || decision.reservationStatus === null) {
    return Object.freeze({ kind: "budget_blocked", decision });
  }

  const expected = { refreshCycleId, budgetWindowId, budgetRequestSha256 };
  const prior = await input.generationRepository.load(refreshCycleId);
  if (prior !== null) {
    const accepted = generation(prior, expected);
    assertActualWithinPlan(accepted.actualR2Usage, plannedR2Usage);
    const accounting = await input.budgetRepository.account({
      ownerId: input.ownerId,
      windowId: budgetWindowId,
      refreshCycleId,
      requestSha256: budgetRequestSha256,
      actualUsage: accepted.actualR2Usage,
    });
    return Object.freeze({
      kind: "complete",
      generation: accepted,
      accounting,
    });
  }
  if (decision.reservationStatus === "accounted") {
    coordinatorError("accounted reservation has no published generation");
  }

  const history = await input.advanceFinishedHistory();
  if (history.kind !== "collection_complete") {
    return Object.freeze({ kind: "finished_history", step: history });
  }
  const finishedHistoryCycleId = sha256(
    history.stored.cycle.cycleId,
    "finishedHistoryCycleId",
  );

  const current = await input.advanceCurrentState();
  if (
    current.kind !== "scheduled" ||
    current.scheduled.kind !== "published" ||
    current.scheduled.state.servingGenerationId === null
  ) {
    return Object.freeze({
      kind: "current_state",
      historyCycleId: finishedHistoryCycleId,
      step: current,
    });
  }

  const actualR2Usage = usage(
    await input.measureActualR2Usage(),
    "actualR2Usage",
  );
  assertActualWithinPlan(actualR2Usage, plannedR2Usage);
  const candidate = generation(
    {
      version: DNA_OPEN_LAB_DAILY_REFRESH_GENERATION_VERSION,
      refreshCycleId,
      budgetWindowId,
      budgetRequestSha256,
      finishedHistoryCycleId,
      currentStateGenerationId: current.scheduled.state.servingGenerationId,
      actualR2Usage,
      publishedAt: input.publishedAt,
    },
    expected,
  );
  const published = generation(
    await input.generationRepository.publish(candidate),
    expected,
  );
  if (JSON.stringify(published) !== JSON.stringify(candidate)) {
    coordinatorError(
      "stored generation drifted from the publication candidate",
    );
  }
  const accounting = await input.budgetRepository.account({
    ownerId: input.ownerId,
    windowId: budgetWindowId,
    refreshCycleId,
    requestSha256: budgetRequestSha256,
    actualUsage: published.actualR2Usage,
  });
  return Object.freeze({ kind: "complete", generation: published, accounting });
}
