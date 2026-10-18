import { createHash } from "node:crypto";

import type { ExactRaceProbabilityContext } from "@/domain/race-probability-baseline";
import type { ActiveCoreHistoryCanonicalRaceAuthority } from "@/lib/active-core-history-pro-league-source";
import type {
  ActiveDnaCoreRaceHistoryGenerationReadRepository,
  SelectedDnaCoreRaceHistoryReadRepository,
} from "@/lib/neon-active-dna-core-race-history-generation";
import type {
  OpenRaceAcceptedHistoryReadBoundary,
  OpenRaceAcceptedHistorySource,
} from "@/lib/open-race-accepted-history-reader";
import {
  readSelectedCoreHistoryRaceSource,
  type SelectedCoreHistoryRaceObservation,
} from "@/lib/selected-core-history-race-source";

const HASH = /^[a-f0-9]{64}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const ERROR = "Accepted Open Race history composition is unavailable.";

export type AcceptedHistoricalRaceContext = Readonly<{
  eventId: string;
  competition: ExactRaceProbabilityContext["competition"];
  element: ExactRaceProbabilityContext["element"];
  evidenceSha256: string;
}>;

export type AcceptedHistoricalRaceContextSet = Readonly<{
  authenticatedOwnerId: string;
  historyGenerationVersion: string;
  observationSetSha256: string;
  historicalAggregateVersion: string;
  evidenceCutoff: string;
  contextSourceIdentitySha256: string;
  state: "accepted" | "partial" | "unknown";
  requestedEventIds: readonly string[];
  contexts: readonly AcceptedHistoricalRaceContext[];
}>;

export type AcceptedHistoricalRaceContextPointer = Readonly<{
  historyGenerationVersion: string;
  observationSetSha256: string;
  historicalAggregateVersion: string;
  contextSourceIdentitySha256: string;
}>;

export type AcceptedHistoricalRaceContextAuthority = Readonly<{
  loadAcceptedRaceContextsByOwner(
    ownerId: string,
    request: Readonly<{
      historyGenerationVersion: string;
      observationSetSha256: string;
      historicalAggregateVersion: string;
      evidenceCutoff: string;
      requestedEventIds: readonly string[];
    }>,
  ): Promise<AcceptedHistoricalRaceContextSet | null>;
  readAcceptedRaceContextPointerByOwner(
    ownerId: string,
  ): Promise<AcceptedHistoricalRaceContextPointer | null>;
}>;

type HistoryRepository = ActiveDnaCoreRaceHistoryGenerationReadRepository &
  SelectedDnaCoreRaceHistoryReadRepository;

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

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function sameValues(left: readonly string[], right: readonly string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameElement(
  left: ExactRaceProbabilityContext["element"],
  right: ExactRaceProbabilityContext["element"],
) {
  return left.status === right.status && left.value === right.value;
}

function sourceIdentity(input: AcceptedHistoricalRaceContextPointer): string {
  if (
    !HASH.test(input.historyGenerationVersion) ||
    !HASH.test(input.observationSetSha256) ||
    !HASH.test(input.contextSourceIdentitySha256)
  )
    fail();
  return hash([
    input.historyGenerationVersion,
    input.observationSetSha256,
    text(input.historicalAggregateVersion),
    input.contextSourceIdentitySha256,
  ]);
}

function contextFor(
  observation: SelectedCoreHistoryRaceObservation,
  classification: AcceptedHistoricalRaceContext,
): ExactRaceProbabilityContext {
  return Object.freeze({
    mode: observation.mode,
    distanceMeters: observation.distanceMeters,
    competition: classification.competition,
    format: observation.format,
    gateCount: observation.gateCount,
    element: Object.freeze({ ...classification.element }),
  });
}

/**
 * Completes the existing bounded selected-Core/Race join only when a separate,
 * accepted authority classifies every requested historical event. It adds no
 * classification rules: unknown or partial authority remains non-analytical.
 */
export function createSelectedCoreOpenRaceAcceptedHistoryBoundary(
  input: Readonly<{
    configuredOwnerId: string;
    maximumRaceDocuments: number;
    repository: HistoryRepository;
    raceAuthority: ActiveCoreHistoryCanonicalRaceAuthority;
    contextAuthority: AcceptedHistoricalRaceContextAuthority;
  }>,
): OpenRaceAcceptedHistoryReadBoundary {
  const configuredOwnerId = text(input.configuredOwnerId);
  if (
    !Number.isSafeInteger(input.maximumRaceDocuments) ||
    input.maximumRaceDocuments < 1 ||
    input.maximumRaceDocuments > 10_000
  )
    fail();

  return Object.freeze({
    async loadExactContextHistoryByOwner(ownerId, request) {
      const authenticatedOwnerId = text(ownerId);
      if (authenticatedOwnerId !== configuredOwnerId) fail();
      if (
        !HASH.test(request.historyGenerationVersion) ||
        !Array.isArray(request.requestedCoreIds) ||
        request.requestedCoreIds.length < 1 ||
        request.requestedCoreIds.length > 64 ||
        new Set(request.requestedCoreIds).size !==
          request.requestedCoreIds.length ||
        !Number.isSafeInteger(request.maximumRows) ||
        request.maximumRows < 1 ||
        request.maximumRows > 10_000
      )
        fail();
      const evidenceCutoff = timestamp(request.evidenceCutoff);
      const generation =
        await input.repository.readActiveGeneration(authenticatedOwnerId);
      if (
        generation === null ||
        generation.generationId !== request.historyGenerationVersion
      )
        return null;

      const selected = await readSelectedCoreHistoryRaceSource({
        authenticatedOwnerId,
        configuredOwnerId,
        selection: {
          generationId: generation.generationId,
          observationSetSha256: generation.observationSetSha256,
          coreIds: request.requestedCoreIds,
          maximumRows: request.maximumRows,
        },
        evidenceCutoff,
        maximumRaceDocuments: input.maximumRaceDocuments,
        repository: input.repository,
        raceAuthority: input.raceAuthority,
      });
      if (selected.status !== "ready") return null;

      const eventIds = [
        ...new Set(selected.observations.map(({ eventId }) => eventId)),
      ].sort();
      const classified =
        await input.contextAuthority.loadAcceptedRaceContextsByOwner(
          authenticatedOwnerId,
          {
            historyGenerationVersion: generation.generationId,
            observationSetSha256: generation.observationSetSha256,
            historicalAggregateVersion: text(
              request.historicalAggregateVersion,
            ),
            evidenceCutoff,
            requestedEventIds: eventIds,
          },
        );
      if (classified === null) return null;
      if (
        classified.authenticatedOwnerId !== authenticatedOwnerId ||
        classified.historyGenerationVersion !== generation.generationId ||
        classified.observationSetSha256 !== generation.observationSetSha256 ||
        classified.historicalAggregateVersion !==
          request.historicalAggregateVersion ||
        timestamp(classified.evidenceCutoff) !== evidenceCutoff ||
        !HASH.test(classified.contextSourceIdentitySha256) ||
        !["accepted", "partial", "unknown"].includes(classified.state) ||
        !Array.isArray(classified.requestedEventIds) ||
        !Array.isArray(classified.contexts) ||
        !sameValues(classified.requestedEventIds, eventIds)
      )
        fail();

      const contexts = new Map<string, AcceptedHistoricalRaceContext>();
      for (const value of classified.contexts) {
        const eventId = text(value.eventId);
        if (
          contexts.has(eventId) ||
          !eventIds.includes(eventId) ||
          (value.competition !== "normal" && value.competition !== "esports") ||
          (value.element.status !== "known" &&
            value.element.status !== "unknown") ||
          !HASH.test(value.evidenceSha256) ||
          (value.element.status === "known" &&
            (typeof value.element.value !== "string" ||
              value.element.value.trim() === "")) ||
          (value.element.status === "unknown" && value.element.value !== null)
        )
          fail();
        contexts.set(eventId, value);
      }
      const contextComplete =
        classified.state === "accepted" && contexts.size === eventIds.length;
      const rows = selected.observations.flatMap((observation) => {
        const classification = contexts.get(observation.eventId);
        if (classification === undefined) return [];
        const context = contextFor(observation, classification);
        return context.mode === request.context.mode &&
          context.distanceMeters === request.context.distanceMeters &&
          context.competition === request.context.competition &&
          context.format === request.context.format &&
          context.gateCount === request.context.gateCount &&
          sameElement(context.element, request.context.element)
          ? [
              Object.freeze({
                coreId: observation.coreId,
                eventId: observation.eventId,
                eventAt: observation.eventAt,
                elapsedTimeMilliseconds: observation.elapsedTimeMilliseconds,
                context,
              }),
            ]
          : [];
      });
      const pointer = {
        historyGenerationVersion: generation.generationId,
        observationSetSha256: generation.observationSetSha256,
        historicalAggregateVersion: request.historicalAggregateVersion,
        contextSourceIdentitySha256: classified.contextSourceIdentitySha256,
      };
      const result: OpenRaceAcceptedHistorySource = Object.freeze({
        authenticatedOwnerId,
        sourceIdentitySha256: sourceIdentity(pointer),
        historyGenerationVersion: generation.generationId,
        historicalAggregateVersion: request.historicalAggregateVersion,
        evidenceCutoff,
        context: Object.freeze({ ...request.context }),
        coverage: Object.freeze({
          state: contextComplete ? "accepted" : classified.state,
          generationIntegrityVerified: true,
          exactContextVerified: contextComplete,
          completeForRequestedCores: true,
          truncated: false,
          requestedCoreIds: Object.freeze([...request.requestedCoreIds]),
          totalMatchingRows: rows.length,
        }),
        rows: Object.freeze(rows),
      });
      return result;
    },

    async readAcceptedSourceIdentityByOwner(ownerId) {
      const authenticatedOwnerId = text(ownerId);
      if (authenticatedOwnerId !== configuredOwnerId) fail();
      const [generation, pointer] = await Promise.all([
        input.repository.readActiveGeneration(authenticatedOwnerId),
        input.contextAuthority.readAcceptedRaceContextPointerByOwner(
          authenticatedOwnerId,
        ),
      ]);
      if (
        generation === null ||
        pointer === null ||
        pointer.historyGenerationVersion !== generation.generationId ||
        pointer.observationSetSha256 !== generation.observationSetSha256
      )
        return null;
      return sourceIdentity(pointer);
    },
  });
}
