import {
  applyDnaCoreRaceHistoryPageReceipt,
  completeDnaCoreRaceHistoryAcquisitionCycle,
  DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE,
  pauseDnaCoreRaceHistoryAcquisitionCycle,
  type DnaCoreRaceHistoryAcquisitionCycle,
  type DnaCoreRaceHistoryAcquisitionRepository,
  type StoredDnaCoreRaceHistoryAcquisitionCycle,
  type StoredDnaCoreRaceHistoryCoreCheckpoint,
} from "./dna-core-race-history-acquisition-cycle";
import type { DnaCoreRaceHistoryClient } from "./dna-core-race-history-client";
import {
  DNA_CORE_RACE_HISTORY_MAXIMUM_EVIDENCE_OBJECT_BYTES,
  type DnaCoreRaceHistoryR2EvidenceStore,
  type DnaCoreRaceHistoryStoredPageEvidence,
} from "./dna-core-race-history-r2-evidence";
import {
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
  type DnaOpenLabRequestBudget,
} from "./dna-open-lab-request-budget";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import { DnaOpenLabApiError } from "./dna-open-lab-v1-client";
import type { DnaOpenLabR2Usage } from "./dna-open-lab-zero-cost-refresh-policy";

export const DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE: DnaOpenLabR2Usage =
  Object.freeze({
    storageBytes: 2 * DNA_CORE_RACE_HISTORY_MAXIMUM_EVIDENCE_OBJECT_BYTES,
    classAOperations: 2,
    // One pre-provider recovery miss plus the evidence store's six-operation
    // worst case for a new page with quarantine.
    classBOperations: 7,
  });

export type DnaCoreRaceHistoryEvidenceBudgetAuthority =
  | Readonly<{
      status: "ready";
      requestSha256: string;
      paidUsageAllowed: false;
      preserveLastGood: true;
    }>
  | Readonly<{
      status: "blocked";
      requestSha256: string;
      paidUsageAllowed: false;
      preserveLastGood: true;
    }>;

export type DnaCoreRaceHistoryEvidenceBudgetRequest = Readonly<{
  requestSha256: string;
  cycleId: string;
  attemptNumber: number;
  coreId: number;
  pageNumber: number;
  plannedUsage: DnaOpenLabR2Usage;
}>;

export type DnaCoreRaceHistoryAcquisitionStepResult =
  | Readonly<{ kind: "attempt_unavailable" }>
  | Readonly<{
      kind: "paused";
      reason: NonNullable<
        DnaCoreRaceHistoryAcquisitionCycle["pause"]
      >["reason"];
      stored: StoredDnaCoreRaceHistoryAcquisitionCycle;
    }>
  | Readonly<{
      kind: "page_advanced";
      source: "recovered" | "provider";
      stored: StoredDnaCoreRaceHistoryCoreCheckpoint;
    }>
  | Readonly<{
      kind: "collection_complete";
      stored: StoredDnaCoreRaceHistoryAcquisitionCycle;
    }>;

function runnerError(message: string): never {
  throw new Error(`DNA Core race history acquisition runner: ${message}`);
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
    runnerError(`${field} is invalid`);
  }
  return new Date(value).toISOString();
}

function retryAt(input: {
  attemptedAt: string;
  retryAfterSeconds: number | null;
}): string | null {
  if (
    input.retryAfterSeconds === null ||
    !Number.isSafeInteger(input.retryAfterSeconds) ||
    input.retryAfterSeconds < 1
  ) {
    return null;
  }
  const retryAtMilliseconds =
    Date.parse(input.attemptedAt) + input.retryAfterSeconds * 1_000;
  if (!Number.isFinite(retryAtMilliseconds)) return null;
  const retryAt = new Date(retryAtMilliseconds);
  return Number.isNaN(retryAt.valueOf()) ? null : retryAt.toISOString();
}

function evidenceBudgetRequest(input: {
  cycleId: string;
  attemptNumber: number;
  coreId: number;
  pageNumber: number;
}): DnaCoreRaceHistoryEvidenceBudgetRequest {
  const authority = Object.freeze({
    cycleId: input.cycleId,
    attemptNumber: input.attemptNumber,
    coreId: input.coreId,
    pageNumber: input.pageNumber,
    plannedUsage: DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE,
  });
  return Object.freeze({
    requestSha256: dnaOpenLabRawEvidenceSha256({
      version: 1,
      sourceFamily: "core_race_history",
      operation: "page_evidence",
      ...authority,
    }),
    ...authority,
  });
}

function assertConservativeRequestBudget(
  requestBudget: DnaOpenLabRequestBudget,
): void {
  const snapshot = requestBudget.snapshot();
  if (
    !Number.isSafeInteger(snapshot.effectiveRequestsPerMinute) ||
    snapshot.effectiveRequestsPerMinute < 1 ||
    snapshot.effectiveRequestsPerMinute > DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
  ) {
    runnerError("request budget exceeds the conservative aggregate rate");
  }
}

function validateEvidenceBudgetAuthority(
  value: unknown,
  expectedRequestSha256: string,
): "ready" | "blocked" {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    runnerError("evidence budget authority is invalid");
  }
  const authority = value as Record<string, unknown>;
  if (
    (authority.status !== "ready" && authority.status !== "blocked") ||
    authority.requestSha256 !== expectedRequestSha256 ||
    authority.paidUsageAllowed !== false ||
    authority.preserveLastGood !== true
  ) {
    runnerError("evidence budget authority is invalid");
  }
  return authority.status as "ready" | "blocked";
}

function apiPause(error: DnaOpenLabApiError): {
  reason: "api_unavailable" | "rate_limited" | "invalid_response";
  retryAfterSeconds: number | null;
} | null {
  switch (error.kind) {
    case "rate_limited":
      return {
        reason: "rate_limited",
        retryAfterSeconds:
          error.rateLimit?.retryAfterSeconds ??
          error.rateLimit?.resetSeconds ??
          null,
      };
    case "api_error":
    case "transport_error":
      return { reason: "api_unavailable", retryAfterSeconds: null };
    case "malformed_response":
      return { reason: "invalid_response", retryAfterSeconds: null };
    case "invalid_configuration":
    case "invalid_request":
      return null;
  }
}

async function pause(input: {
  stored: StoredDnaCoreRaceHistoryAcquisitionCycle;
  repository: DnaCoreRaceHistoryAcquisitionRepository;
  attemptedAt: string;
  reason: NonNullable<DnaCoreRaceHistoryAcquisitionCycle["pause"]>["reason"];
  retryAt?: string | null;
}): Promise<
  Extract<DnaCoreRaceHistoryAcquisitionStepResult, { kind: "paused" }>
> {
  const cycle = pauseDnaCoreRaceHistoryAcquisitionCycle({
    cycle: input.stored.cycle,
    reason: input.reason,
    pausedAt: input.attemptedAt,
    retryAt: input.retryAt ?? null,
  });
  const stored = await input.repository.saveAttempt({
    expectedRevision: input.stored.revision,
    cycle,
  });
  return Object.freeze({ kind: "paused", reason: input.reason, stored });
}

async function completeIfReady(input: {
  stored: StoredDnaCoreRaceHistoryAcquisitionCycle;
  repository: DnaCoreRaceHistoryAcquisitionRepository;
  completedAt: string;
}): Promise<Extract<
  DnaCoreRaceHistoryAcquisitionStepResult,
  { kind: "collection_complete" }
> | null> {
  const next = await input.repository.loadNextCore({
    cycleId: input.stored.cycle.cycleId,
    attemptNumber: input.stored.cycle.attemptNumber,
  });
  if (next !== null) return null;
  const checkpoints = await input.repository.loadCores({
    cycleId: input.stored.cycle.cycleId,
    attemptNumber: input.stored.cycle.attemptNumber,
  });
  const complete = completeDnaCoreRaceHistoryAcquisitionCycle({
    cycle: input.stored.cycle,
    checkpoints: checkpoints.map((entry) => entry.checkpoint),
    completedAt: input.completedAt,
  });
  const stored = await input.repository.saveAttempt({
    expectedRevision: input.stored.revision,
    cycle: complete,
  });
  return Object.freeze({ kind: "collection_complete", stored });
}

async function applyEvidence(input: {
  evidence: DnaCoreRaceHistoryStoredPageEvidence;
  source: "recovered" | "provider";
  attempt: StoredDnaCoreRaceHistoryAcquisitionCycle;
  checkpoint: StoredDnaCoreRaceHistoryCoreCheckpoint;
  repository: DnaCoreRaceHistoryAcquisitionRepository;
  attemptedAt: string;
}): Promise<DnaCoreRaceHistoryAcquisitionStepResult> {
  if (input.evidence.status === "held_conflict") {
    return pause({
      stored: input.attempt,
      repository: input.repository,
      attemptedAt: input.attemptedAt,
      reason: "evidence_conflict",
    });
  }
  const checkpoint = applyDnaCoreRaceHistoryPageReceipt({
    checkpoint: input.checkpoint.checkpoint,
    receipt: input.evidence.receipt,
  });
  const stored = await input.repository.savePage({
    expectedCoreRevision: input.checkpoint.revision,
    checkpoint,
    receipt: input.evidence.receipt,
  });
  const completed = await completeIfReady({
    stored: input.attempt,
    repository: input.repository,
    completedAt: input.attemptedAt,
  });
  return (
    completed ??
    Object.freeze({
      kind: "page_advanced" as const,
      source: input.source,
      stored,
    })
  );
}

/**
 * Advances no more than one provider page. A caller must first grant a
 * conservative R2 upper-bound authority for the whole step. The runner checks
 * immutable evidence before requesting the provider, so a crash after the R2
 * write resumes without another API call. It advances the compact Neon cursor
 * only after the page/quarantine evidence is verified.
 */
export async function runDnaCoreRaceHistoryAcquisitionStep(input: {
  cycleId: string;
  attemptNumber: number;
  attemptedAt: string;
  repository: DnaCoreRaceHistoryAcquisitionRepository;
  client: DnaCoreRaceHistoryClient;
  requestBudget: DnaOpenLabRequestBudget;
  evidenceStore: DnaCoreRaceHistoryR2EvidenceStore;
  authorizeEvidenceBudget: (
    request: DnaCoreRaceHistoryEvidenceBudgetRequest,
  ) => Promise<DnaCoreRaceHistoryEvidenceBudgetAuthority>;
}): Promise<DnaCoreRaceHistoryAcquisitionStepResult> {
  const attemptedAt = timestamp(input.attemptedAt, "attemptedAt");
  const stored = await input.repository.loadAttempt({
    cycleId: input.cycleId,
    attemptNumber: input.attemptNumber,
  });
  if (stored === null) return Object.freeze({ kind: "attempt_unavailable" });
  if (stored.cycle.status === "complete") {
    return Object.freeze({ kind: "collection_complete", stored });
  }
  if (stored.cycle.status === "paused") {
    return Object.freeze({
      kind: "paused",
      reason: stored.cycle.pause!.reason,
      stored,
    });
  }
  if (stored.cycle.status !== "running") {
    return runnerError("superseded attempt cannot advance");
  }
  if (Date.parse(attemptedAt) < Date.parse(stored.cycle.evaluatedAt)) {
    return runnerError("attemptedAt predates the cycle evaluation");
  }

  const checkpoint = await input.repository.loadNextCore({
    cycleId: stored.cycle.cycleId,
    attemptNumber: stored.cycle.attemptNumber,
  });
  if (checkpoint === null) {
    const completed = await completeIfReady({
      stored,
      repository: input.repository,
      completedAt: attemptedAt,
    });
    return (
      completed ?? runnerError("completion readiness changed unexpectedly")
    );
  }

  if (
    checkpoint.checkpoint.nextPage >
    DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE
  ) {
    return pause({
      stored,
      repository: input.repository,
      attemptedAt,
      reason: "operator_hold",
    });
  }

  assertConservativeRequestBudget(input.requestBudget);

  const identity = {
    cycle: stored.cycle,
    coreId: checkpoint.checkpoint.coreId,
    pageNumber: checkpoint.checkpoint.nextPage,
  };

  const budgetRequest = evidenceBudgetRequest({
    cycleId: identity.cycle.cycleId,
    attemptNumber: identity.cycle.attemptNumber,
    coreId: identity.coreId,
    pageNumber: identity.pageNumber,
  });
  const authority = await input.authorizeEvidenceBudget(budgetRequest);
  if (
    validateEvidenceBudgetAuthority(authority, budgetRequest.requestSha256) !==
    "ready"
  ) {
    return pause({
      stored,
      repository: input.repository,
      attemptedAt,
      reason: "budget_closed",
    });
  }
  const recovered = await input.evidenceStore.recover(identity);
  if (recovered !== null) {
    return applyEvidence({
      evidence: recovered,
      source: "recovered",
      attempt: stored,
      checkpoint,
      repository: input.repository,
      attemptedAt,
    });
  }

  let response;
  try {
    response = await input.requestBudget.execute(() =>
      input.client.page({
        coreId: identity.coreId,
        page: identity.pageNumber,
      }),
    );
  } catch (error) {
    if (!(error instanceof DnaOpenLabApiError)) throw error;
    const held = apiPause(error);
    if (held === null) throw error;
    return pause({
      stored,
      repository: input.repository,
      attemptedAt,
      reason: held.reason,
      retryAt: retryAt({
        attemptedAt,
        retryAfterSeconds: held.retryAfterSeconds,
      }),
    });
  }
  const evidence = await input.evidenceStore.write({
    ...identity,
    observedAt: attemptedAt,
    response,
  });
  return applyEvidence({
    evidence,
    source: "provider",
    attempt: stored,
    checkpoint,
    repository: input.repository,
    attemptedAt,
  });
}
