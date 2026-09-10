import {
  createDnaFinishedRaceBackfillCheckpoint,
  DnaFinishedRaceBackfillError,
  DnaFinishedRaceBackfillProcessingError,
  runNextDnaFinishedRaceBackfillStep,
  type DnaFinishedRaceBackfillCheckpointRepository,
  type DnaFinishedRaceBackfillStepResult,
  type DnaFinishedRaceIdentityConflictQuarantine,
  type DnaFinishedRaceWindowPublisher,
} from "./dna-open-lab-finished-race-backfill";
import {
  beginReplacementDnaFinishedRaceIncrementalCycleAttempt,
  completeDnaFinishedRaceIncrementalCycle,
  createDnaFinishedRaceIncrementalCycle,
  dnaFinishedRaceIncrementalCycleId,
  pauseDnaFinishedRaceIncrementalCycle,
  resumeDnaFinishedRaceIncrementalCycle,
  validateDnaFinishedRaceIncrementalCycle,
  type DnaFinishedRaceIncrementalCycleRepository,
  type DnaFinishedRaceIncrementalPauseReason,
  type StoredDnaFinishedRaceIncrementalCycle,
  DNA_FINISHED_RACE_INCREMENTAL_BASELINE_CUTOFF_AT,
  DNA_FINISHED_RACE_INCREMENTAL_MAX_ATTEMPTS,
} from "./dna-open-lab-finished-race-incremental-cycle";
import { classifyDnaCurrentStateAcquisitionFailure } from "./dna-open-lab-current-state-acquisition-cadence";
import {
  DnaRaceDocumentHydrationError,
  DnaRaceDocumentHydrationProcessingError,
} from "./dna-open-lab-race-document-hydrator";
import { DnaOpenLabR2RaceEvidenceProviderError } from "./dna-open-lab-r2-race-evidence";
import type { DnaOpenLabRequestBudget } from "./dna-open-lab-request-budget";
import {
  DnaOpenLabApiError,
  type DnaOpenLabClient,
  type DnaOpenLabResponse,
} from "./dna-open-lab-v1-client";

export type DnaFinishedRaceIncrementalUnavailableDiagnostic =
  | "dna_transport_unavailable"
  | "dna_upstream_unavailable"
  | "finished_index_boundary_unavailable"
  | "race_document_boundary_unavailable"
  | "request_budget_boundary_unavailable"
  | "identity_quarantine_boundary_unavailable"
  | "evidence_publication_boundary_unavailable"
  | "backfill_orchestration_boundary_unavailable"
  | "checkpoint_progress_boundary_unavailable"
  | "cycle_completion_boundary_unavailable"
  | "finished_response_processing_unavailable"
  | "finished_window_partition_processing_unavailable"
  | "finished_identity_processing_unavailable"
  | "finished_publication_processing_unavailable"
  | "race_document_hydration_input_processing_unavailable"
  | "race_document_hydration_response_processing_unavailable"
  | "race_document_hydration_response_identity_processing_unavailable"
  | "race_document_hydration_response_hash_processing_unavailable"
  | "race_document_hydration_response_adaptation_processing_unavailable"
  | "race_document_adaptation_identity_unavailable"
  | "race_document_adaptation_descriptor_unavailable"
  | "race_document_adaptation_status_unavailable"
  | "race_document_adaptation_name_unavailable"
  | "race_document_adaptation_mode_unavailable"
  | "race_document_adaptation_mode_type_unavailable"
  | "race_document_adaptation_mode_blank_unavailable"
  | "race_document_adaptation_mode_vocabulary_unavailable"
  | "race_document_adaptation_format_unavailable"
  | "race_document_adaptation_class_unavailable"
  | "race_document_adaptation_participation_unavailable"
  | "race_document_adaptation_economics_unavailable"
  | "race_document_adaptation_fixed_fees_unavailable"
  | "race_document_adaptation_entry_fee_usd_unavailable"
  | "race_document_adaptation_payment_asset_unavailable"
  | "race_document_adaptation_payout_unavailable"
  | "race_document_adaptation_prize_unavailable"
  | "race_document_adaptation_prize_type_unavailable"
  | "race_document_adaptation_prize_value_unavailable"
  | "race_document_adaptation_prize_usd_unavailable"
  | "race_document_adaptation_schedule_unavailable"
  | "race_document_adaptation_results_unavailable"
  | "race_document_adaptation_evidence_unavailable"
  | "race_document_hydration_response_coverage_processing_unavailable"
  | "race_document_hydration_result_processing_unavailable"
  | "unclassified_unavailable";

export class DnaFinishedRaceIncrementalBoundaryError extends Error {
  readonly unavailableDiagnostic: DnaFinishedRaceIncrementalUnavailableDiagnostic;

  constructor(
    unavailableDiagnostic: DnaFinishedRaceIncrementalUnavailableDiagnostic,
  ) {
    super("DNA finished-race incremental boundary is unavailable");
    this.name = "DnaFinishedRaceIncrementalBoundaryError";
    this.unavailableDiagnostic = unavailableDiagnostic;
  }
}

export type DnaFinishedRaceIncrementalStepResult =
  | Readonly<{
      kind: "paused";
      reason: DnaFinishedRaceIncrementalPauseReason;
      retryAt: string | null;
      unavailableDiagnostic?: DnaFinishedRaceIncrementalUnavailableDiagnostic;
      stored: StoredDnaFinishedRaceIncrementalCycle;
    }>
  | Readonly<{
      kind: "superseded";
      stored: StoredDnaFinishedRaceIncrementalCycle;
    }>
  | Readonly<{
      kind: "collecting";
      step: Exclude<DnaFinishedRaceBackfillStepResult, { kind: "complete" }>;
      stored: StoredDnaFinishedRaceIncrementalCycle;
    }>
  | Readonly<{
      kind: "collection_complete";
      stored: StoredDnaFinishedRaceIncrementalCycle;
    }>;

export type DnaFinishedRaceIncrementalFailureDirective = Readonly<{
  reason: DnaFinishedRaceIncrementalPauseReason;
  retryAfterSeconds: number | null;
  unavailableDiagnostic?: DnaFinishedRaceIncrementalUnavailableDiagnostic;
}>;

function hasAuthoritativeFailureCategory(error: unknown): boolean {
  return (
    error instanceof DnaFinishedRaceBackfillError ||
    error instanceof DnaFinishedRaceBackfillProcessingError ||
    error instanceof DnaRaceDocumentHydrationError ||
    error instanceof DnaRaceDocumentHydrationProcessingError ||
    error instanceof DnaOpenLabR2RaceEvidenceProviderError ||
    error instanceof DnaOpenLabApiError ||
    error instanceof DnaFinishedRaceIncrementalBoundaryError
  );
}

async function executeBoundary<T>(
  unavailableDiagnostic: DnaFinishedRaceIncrementalUnavailableDiagnostic,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (hasAuthoritativeFailureCategory(error)) throw error;
    throw new DnaFinishedRaceIncrementalBoundaryError(unavailableDiagnostic);
  }
}

function timestamp(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `DNA finished-race incremental runner: ${field} is required`,
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `DNA finished-race incremental runner: ${field} must be a valid timestamp`,
    );
  }
  return new Date(parsed).toISOString();
}

export function classifyDnaFinishedRaceIncrementalFailure(
  error: unknown,
): DnaFinishedRaceIncrementalFailureDirective {
  if (
    error instanceof DnaFinishedRaceBackfillError ||
    error instanceof DnaRaceDocumentHydrationError
  ) {
    return Object.freeze({
      reason: "invalid_response",
      retryAfterSeconds: null,
    });
  }
  if (error instanceof DnaFinishedRaceBackfillProcessingError) {
    return Object.freeze({
      reason: "api_unavailable",
      retryAfterSeconds: null,
      unavailableDiagnostic: error.diagnostic,
    });
  }
  if (error instanceof DnaRaceDocumentHydrationProcessingError) {
    return Object.freeze({
      reason: "api_unavailable",
      retryAfterSeconds: null,
      unavailableDiagnostic: error.diagnostic,
    });
  }
  if (error instanceof DnaOpenLabR2RaceEvidenceProviderError) {
    return Object.freeze({
      reason: "operator_hold",
      retryAfterSeconds: null,
    });
  }
  if (error instanceof DnaFinishedRaceIncrementalBoundaryError) {
    return Object.freeze({
      reason: "api_unavailable",
      retryAfterSeconds: null,
      unavailableDiagnostic: error.unavailableDiagnostic,
    });
  }
  if (error instanceof DnaOpenLabApiError) {
    if (error.kind === "transport_error") {
      return Object.freeze({
        reason: "api_unavailable",
        retryAfterSeconds: null,
        unavailableDiagnostic: "dna_transport_unavailable",
      });
    }
    if (
      error.kind === "api_error" &&
      (error.httpStatus === null || error.httpStatus >= 500)
    ) {
      return Object.freeze({
        reason: "api_unavailable",
        retryAfterSeconds: null,
        unavailableDiagnostic: "dna_upstream_unavailable",
      });
    }
  }
  const recovery = classifyDnaCurrentStateAcquisitionFailure({
    error,
    operation: "current_state_request",
  });
  return Object.freeze({
    reason:
      recovery.reason === "api_ineligible"
        ? "tier_ineligible"
        : recovery.reason === "invalid_payload" ||
            recovery.reason === "partial_refresh"
          ? "invalid_response"
          : recovery.reason,
    retryAfterSeconds: recovery.retryAfterSeconds,
    ...(recovery.reason === "api_unavailable"
      ? {
          unavailableDiagnostic:
            "unclassified_unavailable" as DnaFinishedRaceIncrementalUnavailableDiagnostic,
        }
      : {}),
  });
}

async function loadOrCreateActiveCycle(input: {
  upperBoundAt: string;
  minimumWindowMilliseconds: number;
  repository: DnaFinishedRaceIncrementalCycleRepository;
}): Promise<StoredDnaFinishedRaceIncrementalCycle> {
  const latestComplete = await input.repository.loadLatestComplete();
  if (latestComplete !== null) {
    const comparison =
      Date.parse(latestComplete.cycle.upperBoundAt) -
      Date.parse(input.upperBoundAt);
    if (comparison === 0) return latestComplete;
    if (comparison > 0) {
      throw new Error(
        "DNA finished-race incremental runner: upperBoundAt precedes completed authority",
      );
    }
  }
  const lowerBoundAt =
    latestComplete?.cycle.upperBoundAt ??
    DNA_FINISHED_RACE_INCREMENTAL_BASELINE_CUTOFF_AT;
  const previousCompletedCycleId = latestComplete?.cycle.cycleId ?? null;
  const cycleId = dnaFinishedRaceIncrementalCycleId({
    lowerBoundAt,
    upperBoundAt: input.upperBoundAt,
    previousCompletedCycleId,
  });

  let predecessor: StoredDnaFinishedRaceIncrementalCycle | null = null;
  for (
    let attemptNumber = 1;
    attemptNumber <= DNA_FINISHED_RACE_INCREMENTAL_MAX_ATTEMPTS;
    attemptNumber += 1
  ) {
    const stored = await input.repository.load({ cycleId, attemptNumber });
    if (stored === null) {
      if (attemptNumber === 1) {
        const checkpoint = createDnaFinishedRaceBackfillCheckpoint({
          startTime: lowerBoundAt,
          endTime: input.upperBoundAt,
          minimumWindowMilliseconds: input.minimumWindowMilliseconds,
          identityOmissionAuthority: null,
        });
        return input.repository.save({
          expectedRevision: null,
          cycle: createDnaFinishedRaceIncrementalCycle({
            lowerBoundAt,
            upperBoundAt: input.upperBoundAt,
            previousCompletedCycleId,
            checkpoint,
          }),
        });
      }
      if (predecessor?.cycle.status !== "superseded") {
        throw new Error(
          "DNA finished-race incremental runner: replacement attempt authority is missing",
        );
      }
      return input.repository.save({
        expectedRevision: null,
        cycle: beginReplacementDnaFinishedRaceIncrementalCycleAttempt(
          predecessor.cycle,
        ),
      });
    }
    const cycle = validateDnaFinishedRaceIncrementalCycle(stored.cycle);
    if (cycle.status !== "superseded")
      return Object.freeze({ ...stored, cycle });
    predecessor = Object.freeze({ ...stored, cycle });
  }
  throw new Error(
    "DNA finished-race incremental runner: replacement attempt limit exhausted",
  );
}

function checkpointAdapter(input: {
  repository: DnaFinishedRaceIncrementalCycleRepository;
  initial: StoredDnaFinishedRaceIncrementalCycle;
}): {
  repository: DnaFinishedRaceBackfillCheckpointRepository;
  current: () => StoredDnaFinishedRaceIncrementalCycle;
} {
  let current = input.initial;
  return {
    current: () => current,
    repository: Object.freeze({
      async load() {
        return Object.freeze({
          revision: current.revision,
          checkpoint: current.cycle.checkpoint,
        });
      },
      async save(request) {
        if (request.expectedRevision !== current.revision) {
          throw new Error(
            "DNA finished-race incremental runner: checkpoint revision drifted",
          );
        }
        const cycle = validateDnaFinishedRaceIncrementalCycle({
          ...current.cycle,
          checkpoint: request.checkpoint,
        });
        current = await executeBoundary(
          "checkpoint_progress_boundary_unavailable",
          () =>
            input.repository.saveProgress({
              expectedRevision: current.revision,
              cycle,
              ...(request.publication === undefined
                ? {}
                : { publication: request.publication }),
            }),
        );
        return Object.freeze({
          revision: current.revision,
          checkpoint: current.cycle.checkpoint,
        });
      },
    }),
  };
}

/**
 * Advances one durable post-P5 collection step. This runner can write immutable
 * raw evidence and its window receipt, but it has no validation-generation or
 * last-good publication dependency and therefore cannot expose partial data.
 */
export async function runDnaFinishedRaceIncrementalStep(input: {
  upperBoundAt: string;
  attemptedAt: string;
  minimumWindowMilliseconds?: number;
  repository: DnaFinishedRaceIncrementalCycleRepository;
  client: Pick<DnaOpenLabClient, "racesFinished" | "raceDocs">;
  requestBudget: DnaOpenLabRequestBudget;
  publisher: DnaFinishedRaceWindowPublisher;
  identityConflictQuarantine: DnaFinishedRaceIdentityConflictQuarantine;
  classifyFailure?: (
    error: unknown,
  ) => DnaFinishedRaceIncrementalFailureDirective;
  pauseLastGood: (input: {
    reason: DnaFinishedRaceIncrementalPauseReason;
    attemptedAt: string;
    retryAfterSeconds: number | null;
  }) => Promise<void>;
}): Promise<DnaFinishedRaceIncrementalStepResult> {
  const upperBoundAt = timestamp(input.upperBoundAt, "upperBoundAt");
  const attemptedAt = timestamp(input.attemptedAt, "attemptedAt");
  if (Date.parse(attemptedAt) < Date.parse(upperBoundAt)) {
    throw new Error(
      "DNA finished-race incremental runner: attemptedAt cannot precede upperBoundAt",
    );
  }
  const minimumWindowMilliseconds = input.minimumWindowMilliseconds ?? 1;
  if (
    !Number.isSafeInteger(minimumWindowMilliseconds) ||
    minimumWindowMilliseconds < 1
  ) {
    throw new Error(
      "DNA finished-race incremental runner: minimumWindowMilliseconds is invalid",
    );
  }

  let stored = await loadOrCreateActiveCycle({
    upperBoundAt,
    minimumWindowMilliseconds,
    repository: input.repository,
  });
  if (stored.cycle.status === "complete") {
    return Object.freeze({ kind: "collection_complete", stored });
  }
  if (stored.cycle.status === "superseded") {
    return Object.freeze({ kind: "superseded", stored });
  }
  const pause = stored.cycle.status === "paused" ? stored.cycle.pause : null;
  if (stored.cycle.status === "paused" && pause === null) {
    throw new Error(
      "DNA finished-race incremental runner: paused cycle metadata is missing",
    );
  }
  const retryAt = pause?.retryAt ?? null;
  if (
    stored.cycle.status === "paused" &&
    retryAt !== null &&
    Date.parse(retryAt) > Date.parse(attemptedAt)
  ) {
    return Object.freeze({
      kind: "paused",
      reason: pause!.reason,
      retryAt,
      stored,
    });
  }
  if (stored.cycle.status === "paused") {
    stored = await input.repository.save({
      expectedRevision: stored.revision,
      cycle: resumeDnaFinishedRaceIncrementalCycle(stored.cycle),
    });
  }

  const adapter = checkpointAdapter({
    repository: input.repository,
    initial: stored,
  });
  try {
    const client = Object.freeze({
      racesFinished: (
        request: Parameters<typeof input.client.racesFinished>[0],
      ) =>
        executeBoundary("finished_index_boundary_unavailable", () =>
          input.client.racesFinished(request),
        ),
      raceDocs: (request: Parameters<typeof input.client.raceDocs>[0]) =>
        executeBoundary("race_document_boundary_unavailable", () =>
          input.client.raceDocs(request),
        ),
    });
    const requestBudget = Object.freeze({
      ...input.requestBudget,
      execute: <T>(request: () => Promise<DnaOpenLabResponse<T>>) =>
        executeBoundary("request_budget_boundary_unavailable", () =>
          input.requestBudget.execute(request),
        ),
    });
    const step = await executeBoundary(
      "backfill_orchestration_boundary_unavailable",
      () =>
        runNextDnaFinishedRaceBackfillStep({
          startTime: stored.cycle.lowerBoundAt,
          endTime: stored.cycle.upperBoundAt,
          client,
          requestBudget,
          checkpointRepository: adapter.repository,
          publisher: (publication) =>
            executeBoundary("evidence_publication_boundary_unavailable", () =>
              input.publisher(publication),
            ),
          identityConflictQuarantine: (conflict) =>
            executeBoundary("identity_quarantine_boundary_unavailable", () =>
              input.identityConflictQuarantine(conflict),
            ),
          observedAt: attemptedAt,
          minimumWindowMilliseconds,
          identityOmissionAuthority: null,
        }),
    );
    stored = adapter.current();
    if (step.kind !== "complete") {
      return Object.freeze({ kind: "collecting", step, stored });
    }
    stored = await executeBoundary(
      "cycle_completion_boundary_unavailable",
      () =>
        input.repository.save({
          expectedRevision: stored.revision,
          cycle: completeDnaFinishedRaceIncrementalCycle({
            cycle: stored.cycle,
            checkpoint: step.stored.checkpoint,
            completedAt: attemptedAt,
          }),
        }),
    );
    return Object.freeze({ kind: "collection_complete", stored });
  } catch (error) {
    const directive = (
      input.classifyFailure ?? classifyDnaFinishedRaceIncrementalFailure
    )(error);
    stored = adapter.current();
    const retryAt =
      directive.retryAfterSeconds === null
        ? null
        : new Date(
            Date.parse(attemptedAt) + directive.retryAfterSeconds * 1_000,
          ).toISOString();
    stored = await input.repository.save({
      expectedRevision: stored.revision,
      cycle: pauseDnaFinishedRaceIncrementalCycle({
        cycle: stored.cycle,
        reason: directive.reason,
        pausedAt: attemptedAt,
        retryAt,
      }),
    });
    await input.pauseLastGood({
      reason: directive.reason,
      attemptedAt,
      retryAfterSeconds: directive.retryAfterSeconds,
    });
    return Object.freeze({
      kind: "paused",
      reason: directive.reason,
      retryAt,
      ...(directive.unavailableDiagnostic === undefined
        ? {}
        : { unavailableDiagnostic: directive.unavailableDiagnostic }),
      stored,
    });
  }
}
