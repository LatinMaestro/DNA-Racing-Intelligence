import {
  createDnaCoreRaceHistoryAcquisitionCycle,
  resumeDnaCoreRaceHistoryAcquisitionCycle,
  type DnaCoreRaceHistoryAcquisitionCycle,
  type DnaCoreRaceHistoryAcquisitionRepository,
  type StoredDnaCoreRaceHistoryAcquisitionCycle,
} from "./dna-core-race-history-acquisition-cycle";
import {
  runDnaCoreRaceHistoryAcquisitionStep,
  type DnaCoreRaceHistoryAcquisitionStepResult,
  type DnaCoreRaceHistoryEvidenceBudgetAuthority,
  type DnaCoreRaceHistoryEvidenceBudgetRequest,
} from "./dna-core-race-history-acquisition-runner";
import type { DnaCoreRaceHistoryClient } from "./dna-core-race-history-client";
import type { DnaCoreRaceHistoryR2EvidenceStore } from "./dna-core-race-history-r2-evidence";
import type { DnaOpenLabR2BudgetRepository } from "./dna-open-lab-r2-budget-repository";
import type { DnaOpenLabRequestBudget } from "./dna-open-lab-request-budget";

const SOURCE_CORE_ID_PATTERN = /^[1-9][0-9]*$/u;

export type DnaCoreRaceHistoryServingAuthorityRow = Readonly<{
  generationId: string;
  canonical: Readonly<{ sourceCoreId: string }>;
}>;

export type DnaCoreRaceHistoryPrivateCollectorResult =
  | DnaCoreRaceHistoryAcquisitionStepResult
  | Readonly<{
      kind: "authority_unavailable";
      reason: "no_owned_cores";
    }>;

type ServingAuthority = Readonly<{
  currentStateGenerationId: string;
  coreIds: readonly number[];
}>;

function collectorError(message: string): never {
  throw new Error(`DNA Core race history private collector: ${message}`);
}

function timestamp(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) ||
    Number.isNaN(Date.parse(value))
  ) {
    collectorError(`${field} must be a timezone-qualified timestamp`);
  }
  return new Date(value).toISOString();
}

function sourceCoreId(value: string): number {
  if (typeof value !== "string" || !SOURCE_CORE_ID_PATTERN.test(value)) {
    collectorError("serving Core identity is invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    collectorError("serving Core identity exceeds the safe integer range");
  }
  return parsed;
}

function servingAuthority(
  rows: readonly DnaCoreRaceHistoryServingAuthorityRow[],
): ServingAuthority | null {
  if (rows.length === 0) return null;
  const currentStateGenerationId = rows[0]!.generationId.trim().toLowerCase();
  if (
    currentStateGenerationId === "" ||
    rows.some(
      (row) => row.generationId.trim().toLowerCase() !== currentStateGenerationId,
    )
  ) {
    collectorError("serving owned Cores span multiple generations");
  }
  const coreIds = rows
    .map((row) => sourceCoreId(row.canonical.sourceCoreId))
    .sort((left, right) => left - right);
  if (new Set(coreIds).size !== coreIds.length) {
    collectorError("serving owned Core identities are duplicated");
  }
  return Object.freeze({
    currentStateGenerationId,
    coreIds: Object.freeze(coreIds),
  });
}

function sameCoreSet(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isSameCompletedCycle(input: {
  stored: StoredDnaCoreRaceHistoryAcquisitionCycle;
  authority: ServingAuthority;
  evaluatedAt: string;
}): boolean {
  const cycle = input.stored.cycle;
  return (
    cycle.status === "complete" &&
    cycle.currentStateGenerationId === input.authority.currentStateGenerationId &&
    cycle.evaluatedAt === input.evaluatedAt &&
    sameCoreSet(cycle.coreIds, input.authority.coreIds)
  );
}

async function loadOrCreateAttempt(input: {
  repository: DnaCoreRaceHistoryAcquisitionRepository;
  cycle: DnaCoreRaceHistoryAcquisitionCycle;
}): Promise<StoredDnaCoreRaceHistoryAcquisitionCycle> {
  let stored = await input.repository.loadAttempt({
    cycleId: input.cycle.cycleId,
    attemptNumber: 1,
  });
  if (stored === null) {
    try {
      stored = await input.repository.saveAttempt({
        expectedRevision: null,
        cycle: input.cycle,
      });
    } catch (error) {
      const replay = await input.repository.loadAttempt({
        cycleId: input.cycle.cycleId,
        attemptNumber: 1,
      });
      if (replay === null) throw error;
      stored = replay;
    }
  }

  while (stored.cycle.status === "superseded") {
    const nextAttempt = stored.cycle.supersededByAttemptNumber;
    if (nextAttempt === null) {
      collectorError("superseded attempt has no replacement identity");
    }
    const replacement = await input.repository.loadAttempt({
      cycleId: stored.cycle.cycleId,
      attemptNumber: nextAttempt,
    });
    if (replacement === null) {
      collectorError("superseded attempt replacement is unavailable");
    }
    stored = replacement;
  }
  return stored;
}

function canResumePausedAttempt(input: {
  cycle: DnaCoreRaceHistoryAcquisitionCycle;
  attemptedAt: string;
}): boolean {
  if (input.cycle.status !== "paused" || input.cycle.pause === null) {
    return false;
  }
  if (
    input.cycle.pause.reason === "evidence_conflict" ||
    input.cycle.pause.reason === "operator_hold"
  ) {
    return false;
  }
  return (
    input.cycle.pause.retryAt === null ||
    Date.parse(input.attemptedAt) >= Date.parse(input.cycle.pause.retryAt)
  );
}

async function resumeIfEligible(input: {
  repository: DnaCoreRaceHistoryAcquisitionRepository;
  stored: StoredDnaCoreRaceHistoryAcquisitionCycle;
  attemptedAt: string;
}): Promise<StoredDnaCoreRaceHistoryAcquisitionCycle> {
  if (
    !canResumePausedAttempt({
      cycle: input.stored.cycle,
      attemptedAt: input.attemptedAt,
    })
  ) {
    return input.stored;
  }
  return input.repository.saveAttempt({
    expectedRevision: input.stored.revision,
    cycle: resumeDnaCoreRaceHistoryAcquisitionCycle(input.stored.cycle),
  });
}

function createEvidenceBudgetAuthorizer(input: {
  ownerId: string;
  budgetWindowId: string;
  budgetRepository: DnaOpenLabR2BudgetRepository;
}): (
  request: DnaCoreRaceHistoryEvidenceBudgetRequest,
) => Promise<DnaCoreRaceHistoryEvidenceBudgetAuthority> {
  return async (request) => {
    if (input.budgetRepository.status !== "ready") {
      return Object.freeze({ status: "blocked" as const });
    }
    const window = await input.budgetRepository.readWindow(input.ownerId);
    if (window === null || window.windowId !== input.budgetWindowId) {
      return Object.freeze({ status: "blocked" as const });
    }
    const decision = await input.budgetRepository.reserve({
      ownerId: input.ownerId,
      windowId: input.budgetWindowId,
      refreshCycleId: request.cycleId,
      requestSha256: request.requestSha256,
      plannedUsage: request.plannedUsage,
    });
    return Object.freeze({
      status:
        decision.allowed && decision.reservationStatus !== null
          ? ("ready" as const)
          : ("blocked" as const),
    });
  };
}

/**
 * Composes one durable private Core-result acquisition step from the currently
 * serving owned-Core generation. A stable evaluatedAt value identifies one
 * refresh cycle; replaying the same invocation resumes that cycle rather than
 * creating another. The runner itself advances at most one provider page.
 *
 * Retryable pauses resume only when their retry boundary has elapsed. Evidence
 * conflicts and explicit operator holds remain stopped until separately
 * resolved. Every R2/provider step must first obtain its exact durable
 * fail-closed reservation from the shared free-budget repository.
 */
export async function runDnaCoreRaceHistoryPrivateCollectorStep(input: {
  ownerId: string;
  budgetWindowId: string;
  evaluatedAt: string;
  attemptedAt: string;
  loadServingOwnedCores: () => Promise<
    readonly DnaCoreRaceHistoryServingAuthorityRow[]
  >;
  acquisitionRepository: DnaCoreRaceHistoryAcquisitionRepository;
  budgetRepository: DnaOpenLabR2BudgetRepository;
  client: DnaCoreRaceHistoryClient;
  requestBudget: DnaOpenLabRequestBudget;
  evidenceStore: DnaCoreRaceHistoryR2EvidenceStore;
}): Promise<DnaCoreRaceHistoryPrivateCollectorResult> {
  const evaluatedAt = timestamp(input.evaluatedAt, "evaluatedAt");
  const attemptedAt = timestamp(input.attemptedAt, "attemptedAt");
  if (Date.parse(attemptedAt) < Date.parse(evaluatedAt)) {
    collectorError("attemptedAt cannot precede evaluatedAt");
  }

  const authority = servingAuthority(await input.loadServingOwnedCores());
  if (authority === null) {
    return Object.freeze({
      kind: "authority_unavailable" as const,
      reason: "no_owned_cores" as const,
    });
  }

  const latestComplete = await input.acquisitionRepository.loadLatestComplete();
  if (
    latestComplete !== null &&
    Date.parse(latestComplete.cycle.evaluatedAt) > Date.parse(evaluatedAt)
  ) {
    collectorError("evaluation predates the latest completed acquisition");
  }
  if (
    latestComplete !== null &&
    isSameCompletedCycle({ stored: latestComplete, authority, evaluatedAt })
  ) {
    return Object.freeze({
      kind: "collection_complete" as const,
      stored: latestComplete,
    });
  }

  const cycle = createDnaCoreRaceHistoryAcquisitionCycle({
    previousCompletedCycleId: latestComplete?.cycle.cycleId ?? null,
    currentStateGenerationId: authority.currentStateGenerationId,
    evaluatedAt,
    coreIds: authority.coreIds,
  });
  let stored = await loadOrCreateAttempt({
    repository: input.acquisitionRepository,
    cycle,
  });
  stored = await resumeIfEligible({
    repository: input.acquisitionRepository,
    stored,
    attemptedAt,
  });

  if (stored.cycle.status === "paused") {
    return Object.freeze({
      kind: "paused" as const,
      reason: stored.cycle.pause!.reason,
      stored,
    });
  }

  return runDnaCoreRaceHistoryAcquisitionStep({
    cycleId: stored.cycle.cycleId,
    attemptNumber: stored.cycle.attemptNumber,
    attemptedAt,
    repository: input.acquisitionRepository,
    client: input.client,
    requestBudget: input.requestBudget,
    evidenceStore: input.evidenceStore,
    authorizeEvidenceBudget: createEvidenceBudgetAuthorizer({
      ownerId: input.ownerId,
      budgetWindowId: input.budgetWindowId,
      budgetRepository: input.budgetRepository,
    }),
  });
}
