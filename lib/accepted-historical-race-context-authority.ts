import { createHash } from "node:crypto";

import type { ExactRaceProbabilityContext } from "@/domain/race-probability-baseline";
import type {
  AcceptedHistoricalRaceContext,
  AcceptedHistoricalRaceContextAuthority,
  AcceptedHistoricalRaceContextPointer,
} from "@/lib/selected-core-open-race-history-boundary";

const HASH = /^[a-f0-9]{64}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const ERROR = "Accepted historical Race context authority is unavailable.";

export const ACCEPTED_HISTORICAL_RACE_CONTEXT_MAXIMUM_EVENTS = 10_000;

export type AcceptedHistoricalRaceContextStoredRow =
  AcceptedHistoricalRaceContext &
    Readonly<{
      rowSha256: string;
    }>;

export type AcceptedHistoricalRaceContextStoredSelection = Readonly<{
  authenticatedOwnerId: string;
  historyGenerationVersion: string;
  observationSetSha256: string;
  historicalAggregateVersion: string;
  evidenceCutoff: string;
  contextSourceIdentitySha256: string;
  publicationState: "accepted" | "partial" | "unknown";
  requestedEventIds: readonly string[];
  truncated: boolean;
  rows: readonly AcceptedHistoricalRaceContextStoredRow[];
}>;

/**
 * Storage remains responsible for forced owner isolation and an indexed,
 * bounded read. This adapter independently validates every returned binding,
 * row digest and active pointer before exposing accepted analytical context.
 */
export type AcceptedHistoricalRaceContextReadRepository = Readonly<{
  readActivePointerByOwner(
    ownerId: string,
  ): Promise<AcceptedHistoricalRaceContextPointer | null>;
  readPublishedContextsByOwner(
    ownerId: string,
    request: Readonly<{
      historyGenerationVersion: string;
      observationSetSha256: string;
      historicalAggregateVersion: string;
      evidenceCutoff: string;
      requestedEventIds: readonly string[];
      maximumRows: number;
    }>,
  ): Promise<AcceptedHistoricalRaceContextStoredSelection | null>;
}>;

function fail(): never {
  throw new Error(ERROR);
}

function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL.test(value)
  )
    fail();
  return value;
}

function timestamp(value: unknown): string {
  const supplied = text(value);
  const parsed = new Date(supplied);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== supplied)
    fail();
  return supplied;
}

function sha256(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) fail();
  return value;
}

function sameValues(left: readonly string[], right: readonly string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function samePointer(
  left: AcceptedHistoricalRaceContextPointer,
  right: AcceptedHistoricalRaceContextPointer,
) {
  return (
    left.historyGenerationVersion === right.historyGenerationVersion &&
    left.observationSetSha256 === right.observationSetSha256 &&
    left.historicalAggregateVersion === right.historicalAggregateVersion &&
    left.contextSourceIdentitySha256 === right.contextSourceIdentitySha256
  );
}

export function acceptedHistoricalRaceContextRowSha256(
  row: AcceptedHistoricalRaceContext,
): string {
  const canonical = {
    eventId: text(row.eventId),
    competition: row.competition,
    element: {
      status: row.element.status,
      value: row.element.value,
    },
    evidenceSha256: sha256(row.evidenceSha256),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

function validatePointer(
  value: AcceptedHistoricalRaceContextPointer,
): AcceptedHistoricalRaceContextPointer {
  return Object.freeze({
    historyGenerationVersion: sha256(value.historyGenerationVersion),
    observationSetSha256: sha256(value.observationSetSha256),
    historicalAggregateVersion: text(value.historicalAggregateVersion),
    contextSourceIdentitySha256: sha256(value.contextSourceIdentitySha256),
  });
}

function validateElement(
  value: ExactRaceProbabilityContext["element"],
): ExactRaceProbabilityContext["element"] {
  if (value.status === "known") {
    return Object.freeze({ status: "known", value: text(value.value) });
  }
  if (
    (value.status === "not_applicable" || value.status === "unknown") &&
    value.value === null
  ) {
    return Object.freeze({ status: value.status, value: null });
  }
  return fail();
}

/**
 * Adapts an immutable published context read model to the Open Race boundary.
 * It does not infer competition or element: only explicitly stored accepted
 * values survive, while partial/unknown coverage remains non-analytical.
 */
export function createAcceptedHistoricalRaceContextAuthority(input: {
  configuredOwnerId: string;
  repository: AcceptedHistoricalRaceContextReadRepository;
}): AcceptedHistoricalRaceContextAuthority {
  const configuredOwnerId = text(input.configuredOwnerId);

  return Object.freeze({
    async loadAcceptedRaceContextsByOwner(ownerId, request) {
      const authenticatedOwnerId = text(ownerId);
      if (authenticatedOwnerId !== configuredOwnerId) fail();
      const requestedEventIds = request.requestedEventIds.map(text);
      if (
        requestedEventIds.length < 1 ||
        requestedEventIds.length >
          ACCEPTED_HISTORICAL_RACE_CONTEXT_MAXIMUM_EVENTS ||
        new Set(requestedEventIds).size !== requestedEventIds.length
      )
        fail();
      const initial =
        await input.repository.readActivePointerByOwner(authenticatedOwnerId);
      if (initial === null) return null;
      const expectedPointer = validatePointer(initial);
      if (
        expectedPointer.historyGenerationVersion !==
          request.historyGenerationVersion ||
        expectedPointer.observationSetSha256 !== request.observationSetSha256 ||
        expectedPointer.historicalAggregateVersion !==
          request.historicalAggregateVersion
      )
        return null;
      const cutoff = timestamp(request.evidenceCutoff);
      const stored = await input.repository.readPublishedContextsByOwner(
        authenticatedOwnerId,
        {
          historyGenerationVersion: expectedPointer.historyGenerationVersion,
          observationSetSha256: expectedPointer.observationSetSha256,
          historicalAggregateVersion:
            expectedPointer.historicalAggregateVersion,
          evidenceCutoff: cutoff,
          requestedEventIds: Object.freeze([...requestedEventIds]),
          maximumRows: requestedEventIds.length,
        },
      );
      if (stored === null) return null;
      if (
        stored.authenticatedOwnerId !== authenticatedOwnerId ||
        stored.historyGenerationVersion !==
          expectedPointer.historyGenerationVersion ||
        stored.observationSetSha256 !== expectedPointer.observationSetSha256 ||
        stored.historicalAggregateVersion !==
          expectedPointer.historicalAggregateVersion ||
        timestamp(stored.evidenceCutoff) !== cutoff ||
        stored.contextSourceIdentitySha256 !==
          expectedPointer.contextSourceIdentitySha256 ||
        !["accepted", "partial", "unknown"].includes(stored.publicationState) ||
        stored.truncated !== false ||
        !Array.isArray(stored.requestedEventIds) ||
        !Array.isArray(stored.rows) ||
        !sameValues(stored.requestedEventIds, requestedEventIds) ||
        stored.rows.length > requestedEventIds.length
      )
        fail();

      const seen = new Set<string>();
      const contexts = stored.rows.map((row) => {
        const eventId = text(row.eventId);
        const competition = row.competition;
        const element = validateElement(row.element);
        if (
          seen.has(eventId) ||
          !requestedEventIds.includes(eventId) ||
          (competition !== "normal" && competition !== "esports") ||
          sha256(row.rowSha256) !== acceptedHistoricalRaceContextRowSha256(row)
        )
          fail();
        seen.add(eventId);
        return Object.freeze({
          eventId,
          competition,
          element,
          evidenceSha256: sha256(row.evidenceSha256),
        });
      });
      const confirmed =
        await input.repository.readActivePointerByOwner(authenticatedOwnerId);
      if (
        confirmed === null ||
        !samePointer(expectedPointer, validatePointer(confirmed))
      )
        return null;
      const complete = contexts.length === requestedEventIds.length;
      return Object.freeze({
        authenticatedOwnerId,
        historyGenerationVersion: expectedPointer.historyGenerationVersion,
        observationSetSha256: expectedPointer.observationSetSha256,
        historicalAggregateVersion: expectedPointer.historicalAggregateVersion,
        evidenceCutoff: cutoff,
        contextSourceIdentitySha256:
          expectedPointer.contextSourceIdentitySha256,
        state:
          stored.publicationState === "accepted" && complete
            ? "accepted"
            : stored.publicationState === "unknown"
              ? "unknown"
              : "partial",
        requestedEventIds: Object.freeze([...requestedEventIds]),
        contexts: Object.freeze(contexts),
      });
    },

    async readAcceptedRaceContextPointerByOwner(ownerId) {
      const authenticatedOwnerId = text(ownerId);
      if (authenticatedOwnerId !== configuredOwnerId) fail();
      const pointer =
        await input.repository.readActivePointerByOwner(authenticatedOwnerId);
      return pointer === null ? null : validatePointer(pointer);
    },
  });
}
