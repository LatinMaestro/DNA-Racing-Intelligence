import {
  normalizeEmpiricalRaceTimeObservations,
  normalizeExactRaceProbabilityContext,
  type EmpiricalRaceTimeObservation,
  type ExactRaceProbabilityContext,
} from "@/domain/race-probability-baseline";
import type { AcceptedOpenRaceScenarioEvidence } from "@/lib/open-race-persisted-scenario-service";
import type { OpenRaceWorkspaceSession } from "@/lib/open-race-workspace-service";

export const OPEN_RACE_ACCEPTED_HISTORY_MAXIMUM_CORES = 64;
export const OPEN_RACE_ACCEPTED_HISTORY_MAXIMUM_ROWS = 10_000;

const SHA_256 = /^[a-f0-9]{64}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const ERROR = "Open Race accepted history read unavailable.";

export type OpenRaceAcceptedHistoryRow = Readonly<{
  coreId: string;
  eventId: string;
  eventAt: string;
  elapsedTimeMilliseconds: number;
  context: ExactRaceProbabilityContext;
}>;

export type OpenRaceAcceptedHistorySource = Readonly<{
  authenticatedOwnerId: string;
  sourceIdentitySha256: string;
  historyGenerationVersion: string;
  historicalAggregateVersion: string;
  evidenceCutoff: string;
  context: ExactRaceProbabilityContext;
  coverage: Readonly<{
    state: "accepted" | "partial" | "unknown";
    generationIntegrityVerified: boolean;
    exactContextVerified: boolean;
    completeForRequestedCores: boolean;
    truncated: boolean;
    requestedCoreIds: readonly string[];
    totalMatchingRows: number;
  }>;
  rows: readonly OpenRaceAcceptedHistoryRow[];
}>;

export type OpenRaceAcceptedHistoryReadBoundary = Readonly<{
  /**
   * The implementation must perform one owner-scoped, exact-generation,
   * exact-context read and enforce maximumRows before returning any rows.
   */
  loadExactContextHistoryByOwner: (
    ownerId: string,
    request: Readonly<{
      historyGenerationVersion: string;
      historicalAggregateVersion: string;
      evidenceCutoff: string;
      context: ExactRaceProbabilityContext;
      requestedCoreIds: readonly string[];
      maximumRows: number;
    }>,
  ) => Promise<OpenRaceAcceptedHistorySource | null>;
  /** A bounded pointer read used to reject source drift after the row read. */
  readAcceptedSourceIdentityByOwner: (
    ownerId: string,
  ) => Promise<string | null>;
}>;

export type OpenRaceAcceptedHistoryReadOutcome =
  | Readonly<{
      status: "ready";
      evidence: AcceptedOpenRaceScenarioEvidence;
    }>
  | Readonly<{
      status: "source_unavailable" | "source_incomplete" | "source_changed";
      evidence: null;
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
  ) {
    return fail();
  }
  return value;
}

function timestamp(value: unknown): string {
  const supplied = text(value);
  const parsed = new Date(supplied);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== supplied) {
    return fail();
  }
  return supplied;
}

function positiveBound(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    return fail();
  }
  return value;
}

function sameValues(left: readonly string[], right: readonly string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function sameContext(
  left: ExactRaceProbabilityContext,
  right: ExactRaceProbabilityContext,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Loads complete point-in-time time observations for only the Cores required
 * by one persisted Open Race session. Partial, truncated, cross-owner or
 * drifting evidence never reaches the probability evaluator.
 *
 * This is an offline/read-only boundary. It creates no provider, Neon, R2,
 * Preview, recommendation, race-entry or game-action path.
 */
export async function readAcceptedOpenRaceScenarioEvidence(
  input: Readonly<{
    authenticatedOwnerId: string;
    session: OpenRaceWorkspaceSession;
    historyGenerationVersion: string;
    modelVersion: string;
    context: ExactRaceProbabilityContext;
    maximumRows: number;
    boundary: OpenRaceAcceptedHistoryReadBoundary;
  }>,
): Promise<OpenRaceAcceptedHistoryReadOutcome> {
  try {
    const ownerId = text(input.authenticatedOwnerId);
    const historyGenerationVersion = text(input.historyGenerationVersion);
    const modelVersion = text(input.modelVersion);
    const maximumRows = positiveBound(
      input.maximumRows,
      OPEN_RACE_ACCEPTED_HISTORY_MAXIMUM_ROWS,
    );
    if (
      typeof input.boundary?.loadExactContextHistoryByOwner !== "function" ||
      typeof input.boundary?.readAcceptedSourceIdentityByOwner !== "function"
    ) {
      fail();
    }
    if (
      input.session.stage !== "provisional_selection" ||
      input.session.lock !== null ||
      input.session.ranking === null ||
      input.session.bindings.rankingVersion === null ||
      input.session.field.status !== "ready_for_provisional_selection" ||
      input.session.field.freshness !== "current" ||
      input.session.eligibility.freshness !== "current"
    ) {
      return { status: "source_unavailable", evidence: null };
    }

    const candidateCoreIds = input.session.ranking.rankedCandidates.map(
      ({ coreId }) => text(coreId),
    );
    const opponentCoreIds = input.session.field.opponentCoreIds.map(text);
    const requestedCoreIds = [...candidateCoreIds, ...opponentCoreIds];
    if (
      requestedCoreIds.length < 1 ||
      requestedCoreIds.length > OPEN_RACE_ACCEPTED_HISTORY_MAXIMUM_CORES ||
      new Set(requestedCoreIds).size !== requestedCoreIds.length
    ) {
      fail();
    }

    const evidenceCutoff = timestamp(input.session.field.dataCurrentThrough);
    const context = normalizeExactRaceProbabilityContext(input.context);
    if (
      context.mode !== input.session.field.mode ||
      context.distanceMeters !== input.session.field.distanceMeters ||
      context.format !== input.session.field.raceFormat ||
      context.gateCount !== input.session.field.gateCount
    ) {
      fail();
    }
    const knownElement =
      context.element.status === "known" ? context.element.value : null;
    if (
      input.session.field.restrictions.some(
        ({ kind, evidenceStatus, value }) =>
          kind === "element" &&
          evidenceStatus === "confirmed" &&
          value !== knownElement,
      )
    ) {
      fail();
    }
    const source = await input.boundary.loadExactContextHistoryByOwner(
      ownerId,
      {
        historyGenerationVersion,
        historicalAggregateVersion:
          input.session.bindings.historicalAggregateVersion,
        evidenceCutoff,
        context,
        requestedCoreIds,
        maximumRows,
      },
    );
    if (source === null) {
      return { status: "source_unavailable", evidence: null };
    }
    if (
      source.authenticatedOwnerId !== ownerId ||
      !SHA_256.test(source.sourceIdentitySha256) ||
      source.historyGenerationVersion !== historyGenerationVersion ||
      source.historicalAggregateVersion !==
        input.session.bindings.historicalAggregateVersion ||
      timestamp(source.evidenceCutoff) !== evidenceCutoff ||
      !sameContext(
        normalizeExactRaceProbabilityContext(source.context),
        context,
      ) ||
      !Array.isArray(source.rows) ||
      !Array.isArray(source.coverage?.requestedCoreIds)
    ) {
      fail();
    }
    if (
      source.coverage.state !== "accepted" ||
      source.coverage.generationIntegrityVerified !== true ||
      source.coverage.exactContextVerified !== true ||
      source.coverage.completeForRequestedCores !== true ||
      source.coverage.truncated !== false ||
      !sameValues(source.coverage.requestedCoreIds, requestedCoreIds) ||
      !Number.isSafeInteger(source.coverage.totalMatchingRows) ||
      source.coverage.totalMatchingRows !== source.rows.length ||
      source.rows.length > maximumRows
    ) {
      return { status: "source_incomplete", evidence: null };
    }

    const rowsByCore = new Map<string, EmpiricalRaceTimeObservation[]>();
    for (const coreId of requestedCoreIds) rowsByCore.set(coreId, []);
    const rowKeys = new Set<string>();
    for (const row of source.rows) {
      const coreId = text(row.coreId);
      const eventId = text(row.eventId);
      const key = JSON.stringify([coreId, eventId]);
      if (
        !rowsByCore.has(coreId) ||
        rowKeys.has(key) ||
        !sameContext(normalizeExactRaceProbabilityContext(row.context), context)
      ) {
        fail();
      }
      rowKeys.add(key);
      rowsByCore.get(coreId)!.push({
        eventId,
        eventAt: timestamp(row.eventAt),
        elapsedTimeMilliseconds: row.elapsedTimeMilliseconds,
      });
    }

    const histories = new Map(
      [...rowsByCore].map(([coreId, observations]) => [
        coreId,
        normalizeEmpiricalRaceTimeObservations({
          observations,
          label: `Core ${coreId}`,
          evidenceCutoff,
        }),
      ]),
    );
    const acceptedIdentity =
      await input.boundary.readAcceptedSourceIdentityByOwner(ownerId);
    if (acceptedIdentity !== source.sourceIdentitySha256) {
      return { status: "source_changed", evidence: null };
    }

    return {
      status: "ready",
      evidence: {
        authenticatedOwnerId: ownerId,
        sessionVersion: input.session.bindings.sessionVersion,
        fieldVersion: input.session.bindings.fieldVersion,
        eligibilityVersion: input.session.bindings.eligibilityVersion,
        rankingVersion: input.session.bindings.rankingVersion,
        raceImportVersion: input.session.bindings.raceImportVersion,
        vaultSnapshotVersion: input.session.bindings.vaultSnapshotVersion,
        historicalAggregateVersion:
          input.session.bindings.historicalAggregateVersion,
        historyGenerationVersion,
        historySourceIdentitySha256: source.sourceIdentitySha256,
        evidenceCutoff,
        modelVersion,
        context,
        candidateHistories: candidateCoreIds.map((coreId) => ({
          coreId,
          observations: histories.get(coreId)!,
        })),
        opponentHistories: opponentCoreIds.map((coreId) => ({
          coreId,
          observations: histories.get(coreId)!,
        })),
      },
    };
  } catch {
    return fail();
  }
}
