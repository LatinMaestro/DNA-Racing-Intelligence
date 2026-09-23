export const DNA_FINISHED_RACE_NEAR_LIVE_INTERVAL_MILLISECONDS =
  60_000 as const;
export const DNA_NON_RACE_CURRENT_STATE_INTERVAL_MILLISECONDS =
  24 * 60 * 60_000;

export type DnaFinishedRaceCadenceStatus =
  | "start_incremental_cycle"
  | "resume_active_cycle"
  | "idle"
  | "retry_blocked";

export type DnaRecurringRefreshCadenceDecision = Readonly<{
  evaluatedAt: string;
  finishedRaces: Readonly<{
    status: DnaFinishedRaceCadenceStatus;
    nextEvaluationAt: string;
    intervalMilliseconds: typeof DNA_FINISHED_RACE_NEAR_LIVE_INTERVAL_MILLISECONDS;
  }>;
  currentState: Readonly<{
    due: boolean;
    nextEvaluationAt: string;
    intervalMilliseconds: number;
  }>;
}>;

function instant(value: string, field: string): string {
  const normalized = value.trim();
  const parsed = Date.parse(normalized);
  if (
    normalized.length < 1 ||
    Number.isNaN(parsed) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    )
  ) {
    throw new Error(`DNA recurring refresh cadence ${field} is invalid.`);
  }
  return new Date(parsed).toISOString();
}

function optionalInstant(
  value: string | null | undefined,
  field: string,
): string | null {
  return value === null || value === undefined ? null : instant(value, field);
}

/**
 * Keeps the population race archive on a near-live one-minute polling clock
 * without coupling that clock to the slower current-state API families.
 *
 * An unfinished finished-race cycle is resumed rather than replaced. A provider
 * retry boundary can delay the next race tick. Current-state families remain on
 * their independent 24-hour owner-policy interval.
 */
export function createDnaRecurringRefreshCadenceDecision(input: {
  evaluatedAt: string;
  lastFinishedRaceCompletedAt?: string | null;
  finishedRaceCycleActive?: boolean;
  finishedRaceRetryNotBefore?: string | null;
  lastCurrentStateCompletedAt?: string | null;
}): DnaRecurringRefreshCadenceDecision {
  const evaluatedAt = instant(input.evaluatedAt, "evaluatedAt");
  const evaluatedMs = Date.parse(evaluatedAt);
  const lastRace = optionalInstant(
    input.lastFinishedRaceCompletedAt,
    "lastFinishedRaceCompletedAt",
  );
  const retryNotBefore = optionalInstant(
    input.finishedRaceRetryNotBefore,
    "finishedRaceRetryNotBefore",
  );
  const lastCurrent = optionalInstant(
    input.lastCurrentStateCompletedAt,
    "lastCurrentStateCompletedAt",
  );

  if (
    lastRace !== null &&
    Date.parse(lastRace) > evaluatedMs
  ) {
    throw new Error(
      "DNA recurring refresh cadence finished-race checkpoint is in the future.",
    );
  }
  if (
    lastCurrent !== null &&
    Date.parse(lastCurrent) > evaluatedMs
  ) {
    throw new Error(
      "DNA recurring refresh cadence current-state checkpoint is in the future.",
    );
  }

  let raceStatus: DnaFinishedRaceCadenceStatus;
  let raceNextMs: number;

  if (retryNotBefore !== null && Date.parse(retryNotBefore) > evaluatedMs) {
    raceStatus = "retry_blocked";
    raceNextMs = Date.parse(retryNotBefore);
  } else if (input.finishedRaceCycleActive === true) {
    raceStatus = "resume_active_cycle";
    raceNextMs = evaluatedMs + DNA_FINISHED_RACE_NEAR_LIVE_INTERVAL_MILLISECONDS;
  } else {
    const dueAt =
      lastRace === null
        ? evaluatedMs
        : Date.parse(lastRace) +
          DNA_FINISHED_RACE_NEAR_LIVE_INTERVAL_MILLISECONDS;
    if (dueAt <= evaluatedMs) {
      raceStatus = "start_incremental_cycle";
      raceNextMs =
        evaluatedMs + DNA_FINISHED_RACE_NEAR_LIVE_INTERVAL_MILLISECONDS;
    } else {
      raceStatus = "idle";
      raceNextMs = dueAt;
    }
  }

  const currentDueAt =
    lastCurrent === null
      ? evaluatedMs
      : Date.parse(lastCurrent) +
        DNA_NON_RACE_CURRENT_STATE_INTERVAL_MILLISECONDS;
  const currentDue = currentDueAt <= evaluatedMs;

  return Object.freeze({
    evaluatedAt,
    finishedRaces: Object.freeze({
      status: raceStatus,
      nextEvaluationAt: new Date(raceNextMs).toISOString(),
      intervalMilliseconds: DNA_FINISHED_RACE_NEAR_LIVE_INTERVAL_MILLISECONDS,
    }),
    currentState: Object.freeze({
      due: currentDue,
      nextEvaluationAt: new Date(
        currentDue
          ? evaluatedMs + DNA_NON_RACE_CURRENT_STATE_INTERVAL_MILLISECONDS
          : currentDueAt,
      ).toISOString(),
      intervalMilliseconds: DNA_NON_RACE_CURRENT_STATE_INTERVAL_MILLISECONDS,
    }),
  });
}
