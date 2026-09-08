import {
  createDnaFinishedRaceBackfillCheckpoint,
  DnaFinishedRaceBackfillError,
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
import type { DnaOpenLabRequestBudget } from "./dna-open-lab-request-budget";
import type { DnaOpenLabClient } from "./dna-open-lab-v1-client";

export type DnaFinishedRaceIncrementalStepResult =
  | Readonly<{
      kind: "paused";
      reason: DnaFinishedRaceIncrementalPauseReason;
      retryAt: string | null;
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
}>;

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
  if (error instanceof DnaFinishedRaceBackfillError) {
    return Object.freeze({
      reason: "invalid_response",
      retryAfterSeconds: null,
    });
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
        current = await input.repository.saveProgress({
          expectedRevision: current.revision,
          cycle,
          ...(request.publication === undefined
            ? {}
            : { publication: request.publication }),
        });
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
    const step = await runNextDnaFinishedRaceBackfillStep({
      startTime: stored.cycle.lowerBoundAt,
      endTime: stored.cycle.upperBoundAt,
      client: input.client,
      requestBudget: input.requestBudget,
      checkpointRepository: adapter.repository,
      publisher: input.publisher,
      identityConflictQuarantine: input.identityConflictQuarantine,
      observedAt: attemptedAt,
      minimumWindowMilliseconds,
      identityOmissionAuthority: null,
    });
    stored = adapter.current();
    if (step.kind !== "complete") {
      return Object.freeze({ kind: "collecting", step, stored });
    }
    stored = await input.repository.save({
      expectedRevision: stored.revision,
      cycle: completeDnaFinishedRaceIncrementalCycle({
        cycle: stored.cycle,
        checkpoint: step.stored.checkpoint,
        completedAt: attemptedAt,
      }),
    });
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
      stored,
    });
  }
}
