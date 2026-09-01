import type { DnaRaceDocument } from "./dna-open-lab-v1-client";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";

export const DNA_FINISHED_RACE_WINDOW_LIMIT = 200 as const;

export type DnaFinishedRaceWindow = Readonly<{
  startTime: string;
  endTime: string;
}>;

export type DnaFinishedRaceWindowFetch = (
  window: DnaFinishedRaceWindow & Readonly<{ limit: 200 }>,
) => Promise<readonly DnaRaceDocument[]>;

export type DnaFinishedRaceWindowCrawlerResult = Readonly<{
  races: readonly DnaRaceDocument[];
  completedWindows: readonly DnaFinishedRaceWindow[];
  requestCount: number;
  splitCount: number;
  unresolvedIdentityObservationUpperBound: number;
}>;

export type DnaFinishedRaceInvalidRecordHandling =
  "reject" | "count_as_unresolved_observation";

export class DnaFinishedRaceWindowCrawlerError extends Error {
  readonly kind:
    | "invalid_window"
    | "invalid_record"
    | "source_limit_breach"
    | "unprovable_saturation"
    | "conflicting_duplicate";

  constructor(input: {
    kind: DnaFinishedRaceWindowCrawlerError["kind"];
    message: string;
  }) {
    super(input.message);
    this.name = "DnaFinishedRaceWindowCrawlerError";
    this.kind = input.kind;
  }
}

function crawlerError(
  kind: DnaFinishedRaceWindowCrawlerError["kind"],
  message: string,
): never {
  throw new DnaFinishedRaceWindowCrawlerError({ kind, message });
}

function parseTimestamp(value: string, field: string): number {
  if (typeof value !== "string" || value.trim() === "") {
    crawlerError("invalid_window", `${field} is required`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    crawlerError("invalid_window", `${field} must be a valid ISO timestamp`);
  }
  return milliseconds;
}

function normalizeWindow(window: DnaFinishedRaceWindow): Readonly<{
  startMilliseconds: number;
  endMilliseconds: number;
}> {
  const startMilliseconds = parseTimestamp(window.startTime, "startTime");
  const endMilliseconds = parseTimestamp(window.endTime, "endTime");
  if (startMilliseconds > endMilliseconds) {
    crawlerError("invalid_window", "startTime cannot be after endTime");
  }
  return Object.freeze({ startMilliseconds, endMilliseconds });
}

function raceKey(
  race: unknown,
  invalidRecordHandling: DnaFinishedRaceInvalidRecordHandling,
): string | null {
  const unresolved = (message: string): null => {
    if (invalidRecordHandling === "count_as_unresolved_observation") {
      return null;
    }
    return crawlerError("invalid_record", message);
  };
  if (typeof race !== "object" || race === null || Array.isArray(race)) {
    return unresolved(
      "finished-race row must be an object with a stable identifier",
    );
  }
  const rid = (race as Readonly<Record<string, unknown>>).rid;
  if (typeof rid === "number") {
    if (!Number.isSafeInteger(rid) || rid < 1) {
      return unresolved("race rid must be a positive safe integer");
    }
    return String(rid);
  }
  if (typeof rid !== "string") {
    return unresolved("race rid must be a string or positive safe integer");
  }
  const normalized = rid.trim();
  if (normalized === "") {
    return unresolved("race rid must not be empty");
  }
  return normalized;
}

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

/**
 * Walk a bounded finished-race time range without trusting a saturated 200-row
 * response to be complete. Saturated windows are split recursively and queried
 * with an exact shared midpoint. The deliberate boundary overlap is deduplicated
 * by stable race id so inclusive/exclusive range behavior cannot create a gap.
 *
 * This service is deliberately sequential. A Tier-1 request-budget scheduler can
 * wrap `fetchWindow` without changing completeness semantics.
 */
export async function crawlDnaFinishedRaceWindows(input: {
  startTime: string;
  endTime: string;
  fetchWindow: DnaFinishedRaceWindowFetch;
  minimumWindowMilliseconds?: number;
  invalidRecordHandling?: DnaFinishedRaceInvalidRecordHandling;
}): Promise<DnaFinishedRaceWindowCrawlerResult> {
  const root = normalizeWindow({
    startTime: input.startTime,
    endTime: input.endTime,
  });
  const minimumWindowMilliseconds = input.minimumWindowMilliseconds ?? 1;
  if (
    !Number.isSafeInteger(minimumWindowMilliseconds) ||
    minimumWindowMilliseconds < 1
  ) {
    crawlerError(
      "invalid_window",
      "minimumWindowMilliseconds must be a positive safe integer",
    );
  }

  const pending: Array<
    Readonly<{ startMilliseconds: number; endMilliseconds: number }>
  > = [root];
  const completedWindows: DnaFinishedRaceWindow[] = [];
  const racesByKey = new Map<
    string,
    Readonly<{ hash: string; race: DnaRaceDocument }>
  >();
  let requestCount = 0;
  let splitCount = 0;
  let unresolvedIdentityObservationUpperBound = 0;
  const invalidRecordHandling = input.invalidRecordHandling ?? "reject";
  if (
    invalidRecordHandling !== "reject" &&
    invalidRecordHandling !== "count_as_unresolved_observation"
  ) {
    crawlerError("invalid_window", "invalid-record handling is unsupported");
  }

  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) break;

    const requestWindow = Object.freeze({
      startTime: iso(current.startMilliseconds),
      endTime: iso(current.endMilliseconds),
      limit: DNA_FINISHED_RACE_WINDOW_LIMIT,
    });
    const races = await input.fetchWindow(requestWindow);
    requestCount += 1;

    if (races.length > DNA_FINISHED_RACE_WINDOW_LIMIT) {
      crawlerError(
        "source_limit_breach",
        `DNA finished-race window returned ${races.length} rows above the documented ${DNA_FINISHED_RACE_WINDOW_LIMIT}-row limit`,
      );
    }

    if (races.length === DNA_FINISHED_RACE_WINDOW_LIMIT) {
      const width = current.endMilliseconds - current.startMilliseconds;
      if (width <= minimumWindowMilliseconds) {
        crawlerError(
          "unprovable_saturation",
          `DNA finished-race window remains saturated at the minimum ${minimumWindowMilliseconds}ms width`,
        );
      }

      const midpoint =
        current.startMilliseconds +
        Math.floor((current.endMilliseconds - current.startMilliseconds) / 2);
      if (
        midpoint <= current.startMilliseconds ||
        midpoint >= current.endMilliseconds
      ) {
        crawlerError(
          "unprovable_saturation",
          "DNA finished-race window cannot be split further safely",
        );
      }

      splitCount += 1;
      pending.unshift(
        Object.freeze({
          startMilliseconds: midpoint,
          endMilliseconds: current.endMilliseconds,
        }),
      );
      pending.unshift(
        Object.freeze({
          startMilliseconds: current.startMilliseconds,
          endMilliseconds: midpoint,
        }),
      );
      continue;
    }

    completedWindows.push(
      Object.freeze({
        startTime: requestWindow.startTime,
        endTime: requestWindow.endTime,
      }),
    );

    for (const race of races) {
      const key = raceKey(race, invalidRecordHandling);
      if (key === null) {
        unresolvedIdentityObservationUpperBound += 1;
        if (!Number.isSafeInteger(unresolvedIdentityObservationUpperBound)) {
          crawlerError(
            "source_limit_breach",
            "unresolved finished-race observation count exceeds safe range",
          );
        }
        continue;
      }
      const hash = dnaOpenLabRawEvidenceSha256(race);
      const existing = racesByKey.get(key);
      if (existing !== undefined && existing.hash !== hash) {
        crawlerError(
          "conflicting_duplicate",
          `DNA finished-race overlap returned conflicting payloads for race ${key}`,
        );
      }
      if (existing === undefined) {
        racesByKey.set(key, Object.freeze({ hash, race }));
      }
    }
  }

  const races = Object.freeze(
    [...racesByKey.entries()]
      .sort(([left], [right]) =>
        left.localeCompare(right, undefined, { numeric: true }),
      )
      .map(([, entry]) => entry.race),
  );

  return Object.freeze({
    races,
    completedWindows: Object.freeze(completedWindows),
    requestCount,
    splitCount,
    unresolvedIdentityObservationUpperBound,
  });
}
