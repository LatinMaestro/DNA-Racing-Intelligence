import type { RaceMode } from "@/domain/import-contract";
import type {
  CanonicalCoreRaceHistoryResult,
  DnaCoreRaceHistoryEvidence,
} from "@/lib/dna-core-race-history-adapter";
import {
  dnaOpenLabRawEvidenceSha256,
  type CanonicalRaceDocumentMetadata,
  type DnaOpenLabEvidence,
} from "@/lib/dna-open-lab-v1-adapters";
import { publishedProLeagueRaceTypeFromArchive } from "@/lib/race-archive-pro-league-exact-format";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_CORE_ID_PATTERN = /^[1-9][0-9]*$/u;
const POSITIVE_DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaCoreRaceHistoryMaterializationDiagnostic =
  | "invalid_authority"
  | "invalid_cycle_evidence"
  | "invalid_page_evidence"
  | "incomplete_cycle_evidence"
  | "duplicate_page_identity"
  | "result_outside_owner_authority"
  | "result_identity_mismatch"
  | "result_replay_conflict"
  | "race_document_identity_mismatch"
  | "race_document_replay_conflict"
  | "race_document_missing"
  | "race_document_unexpected"
  | "race_document_entrant_authority_unavailable"
  | "race_document_entrant_mismatch"
  | "race_document_mode_unavailable"
  | "race_document_mode_mismatch"
  | "race_document_distance_unavailable"
  | "race_document_distance_mismatch"
  | "race_document_gate_count_unavailable"
  | "finish_position_exceeds_gate_count"
  | "event_time_unavailable"
  | "event_time_mismatch"
  | "elapsed_time_unrepresentable";

export class DnaCoreRaceHistoryMaterializationError extends Error {
  readonly diagnostic: DnaCoreRaceHistoryMaterializationDiagnostic;

  constructor(diagnostic: DnaCoreRaceHistoryMaterializationDiagnostic) {
    super("DNA Core race history materialization is unavailable");
    this.name = "DnaCoreRaceHistoryMaterializationError";
    this.diagnostic = diagnostic;
  }
}

export type DnaCoreRaceHistoryMaterializationPage = Readonly<{
  ownerId: string;
  cycleId: string;
  attemptNumber: number;
  coreId: number;
  pageNumber: number;
  sourceRowCount: number;
  terminal: boolean;
  results: readonly DnaCoreRaceHistoryEvidence<CanonicalCoreRaceHistoryResult>[];
}>;

export type DnaCoreRaceHistoryMaterializationCycle = Readonly<{
  ownerId: string;
  cycleId: string;
  attemptNumber: number;
  status: "complete";
  evaluatedAt: string;
  completedAt: string;
  coreIds: readonly string[];
}>;

export type DnaCoreRaceHistoryJoinedObservation = Readonly<{
  sourceType: "joined_core_race_history_result";
  naturalKey: string;
  resultEvidenceSha256: string;
  raceDocumentEvidenceSha256: string;
  sourceCoreId: string;
  sourceRaceId: string;
  mode: RaceMode;
  distanceMetres: number;
  distanceAuthority: "result_and_race_document";
  elapsedMilliseconds: number;
  finishPosition: number;
  eventAt: string;
  gateCount: number;
  payoutMechanismSourceValue: string | null;
  sourceFormat: string | null;
  sourceRaceClass: string | number | null;
  goldStar: boolean | null;
  blueStar: boolean | null;
  starEvidenceStatus: "available" | "missing";
  publishedCellStatus:
    "accepted" | "missing_format" | "unsupported_format" | "unpublished_cell";
  raceType: string | null;
  mapIds: readonly string[];
}>;

export type DnaCoreRaceHistoryMaterialization = Readonly<{
  ownerId: string;
  materializedAt: string;
  cycleSetSha256: string;
  observationSetSha256: string;
  inputCycleCount: number;
  inputPageCount: number;
  inputResultCount: number;
  replayDuplicateCount: number;
  raceDocumentCount: number;
  exactDistanceConfirmedCount: number;
  acceptedPublishedCellCount: number;
  missingFormatCount: number;
  unsupportedFormatCount: number;
  unpublishedCellCount: number;
  observations: readonly DnaCoreRaceHistoryJoinedObservation[];
}>;

function unavailable(
  diagnostic: DnaCoreRaceHistoryMaterializationDiagnostic,
): never {
  throw new DnaCoreRaceHistoryMaterializationError(diagnostic);
}

function safeText(value: unknown, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL_PATTERN.test(value)
  ) {
    return unavailable("invalid_authority");
  }
  return value;
}

function timestamp(
  value: unknown,
  diagnostic: DnaCoreRaceHistoryMaterializationDiagnostic,
): string {
  if (typeof value !== "string" || value.trim() !== value) {
    return unavailable(diagnostic);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return unavailable(diagnostic);
  return parsed.toISOString();
}

function positiveInteger(
  value: unknown,
  diagnostic: DnaCoreRaceHistoryMaterializationDiagnostic,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return unavailable(diagnostic);
  }
  return value;
}

function nonNegativeInteger(
  value: unknown,
  diagnostic: DnaCoreRaceHistoryMaterializationDiagnostic,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return unavailable(diagnostic);
  }
  return value;
}

function hash(
  value: unknown,
  diagnostic: DnaCoreRaceHistoryMaterializationDiagnostic,
): string {
  if (typeof value !== "string" || !SHA_256_PATTERN.test(value)) {
    return unavailable(diagnostic);
  }
  return value;
}

function sourceCoreId(
  value: unknown,
  diagnostic: DnaCoreRaceHistoryMaterializationDiagnostic,
): string {
  if (typeof value !== "string" || !SOURCE_CORE_ID_PATTERN.test(value)) {
    return unavailable(diagnostic);
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1)
    return unavailable(diagnostic);
  return value;
}

function elapsedMilliseconds(value: unknown): number {
  if (typeof value !== "string" || !POSITIVE_DECIMAL_PATTERN.test(value)) {
    return unavailable("elapsed_time_unrepresentable");
  }
  const [integerPart = "", fractionalPart = ""] = value.split(".");
  if (fractionalPart.length > 3 && !/^0*$/u.test(fractionalPart.slice(3))) {
    return unavailable("elapsed_time_unrepresentable");
  }
  const fraction = (fractionalPart.slice(0, 3) + "000").slice(0, 3);
  const milliseconds = BigInt(integerPart) * 1_000n + BigInt(fraction || "0");
  if (milliseconds < 1n || milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    return unavailable("elapsed_time_unrepresentable");
  }
  return Number(milliseconds);
}

function resultEvidence(
  evidence: DnaCoreRaceHistoryEvidence<CanonicalCoreRaceHistoryResult>,
): DnaCoreRaceHistoryEvidence<CanonicalCoreRaceHistoryResult> {
  const coreId = sourceCoreId(
    evidence.canonical.sourceCoreId,
    "invalid_page_evidence",
  );
  const raceId = safeText(evidence.canonical.sourceRaceId);
  if (
    evidence.source !== "dna_open_lab" ||
    evidence.sourceVersion !== "core-history-v1" ||
    evidence.scope !== "races" ||
    evidence.endpoint !== "core.history" ||
    evidence.canonical.sourceType !== "core_race_history_result" ||
    (evidence.canonical.mode !== "bike" &&
      evidence.canonical.mode !== "car" &&
      evidence.canonical.mode !== "horse") ||
    evidence.entityKey !==
      `core-result:${coreId}:${evidence.canonical.mode}:${raceId}`
  ) {
    return unavailable("result_identity_mismatch");
  }
  hash(evidence.rawEvidenceSha256, "invalid_page_evidence");
  timestamp(evidence.observedAt, "invalid_page_evidence");
  return evidence;
}

function raceDocumentEvidence(
  evidence: DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>,
): DnaOpenLabEvidence<CanonicalRaceDocumentMetadata> {
  const raceId = safeText(evidence.canonical.sourceRaceId);
  if (
    evidence.source !== "dna_open_lab" ||
    evidence.sourceVersion !== "v1" ||
    !(
      (evidence.endpoint === "races.docs" && evidence.scope === "races") ||
      (evidence.endpoint === "races.finished" && evidence.scope === "races") ||
      (evidence.endpoint === "vault.recent_races" && evidence.scope === "vault")
    ) ||
    evidence.canonical.sourceType !== "race_document" ||
    evidence.entityKey !== `race:${raceId}`
  ) {
    return unavailable("race_document_identity_mismatch");
  }
  hash(evidence.rawEvidenceSha256, "race_document_identity_mismatch");
  timestamp(evidence.observedAt, "race_document_identity_mismatch");
  return evidence;
}

function eventTime(input: {
  resultAt: string | null;
  documentAt: string | null | undefined;
}): string {
  const resultAt =
    input.resultAt === null
      ? null
      : timestamp(input.resultAt, "event_time_unavailable");
  const documentAt =
    input.documentAt == null
      ? null
      : timestamp(input.documentAt, "event_time_unavailable");
  if (resultAt !== null && documentAt !== null && resultAt !== documentAt) {
    return unavailable("event_time_mismatch");
  }
  return resultAt ?? documentAt ?? unavailable("event_time_unavailable");
}

/**
 * Replays accepted pages from any number of owner-scoped cycles into one
 * canonical history. Exact overlaps deduplicate; changed evidence under one
 * result or race identity blocks the entire candidate. Every result must join
 * to a race document by race ID, entrant Core ID, mode and normalized distance
 * before it is exposed to analytics.
 */
export function materializeDnaCoreRaceHistory(input: {
  ownerId: string;
  cycles: readonly DnaCoreRaceHistoryMaterializationCycle[];
  pages: readonly DnaCoreRaceHistoryMaterializationPage[];
  raceDocuments: readonly DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>[];
  materializedAt: string;
  maximumPages: number;
  maximumResults: number;
  maximumRaceDocuments: number;
}): DnaCoreRaceHistoryMaterialization {
  const ownerId = safeText(input.ownerId);
  const materializedAt = timestamp(input.materializedAt, "invalid_authority");
  const materializedAtMs = Date.parse(materializedAt);
  const maximumPages = positiveInteger(input.maximumPages, "invalid_authority");
  const maximumResults = positiveInteger(
    input.maximumResults,
    "invalid_authority",
  );
  const maximumRaceDocuments = positiveInteger(
    input.maximumRaceDocuments,
    "invalid_authority",
  );
  if (
    input.pages.length > maximumPages ||
    input.raceDocuments.length > maximumRaceDocuments
  ) {
    return unavailable("invalid_authority");
  }

  if (input.cycles.length < 1 || input.cycles.length > maximumPages) {
    return unavailable("invalid_authority");
  }
  const cycles = new Map<
    string,
    Readonly<{ evaluatedAt: string; completedAt: string; coreIds: Set<string> }>
  >();
  for (const cycle of input.cycles) {
    const attemptNumber = positiveInteger(
      cycle.attemptNumber,
      "invalid_cycle_evidence",
    );
    if (
      cycle.ownerId !== ownerId ||
      cycle.status !== "complete" ||
      !SHA_256_PATTERN.test(cycle.cycleId)
    ) {
      return unavailable("invalid_cycle_evidence");
    }
    const evaluatedAt = timestamp(cycle.evaluatedAt, "invalid_cycle_evidence");
    const completedAt = timestamp(cycle.completedAt, "invalid_cycle_evidence");
    if (
      Date.parse(completedAt) < Date.parse(evaluatedAt) ||
      Date.parse(completedAt) > materializedAtMs
    ) {
      return unavailable("invalid_cycle_evidence");
    }
    const coreIds = new Set(
      cycle.coreIds.map((value) =>
        sourceCoreId(value, "invalid_cycle_evidence"),
      ),
    );
    if (coreIds.size < 1 || coreIds.size !== cycle.coreIds.length) {
      return unavailable("invalid_cycle_evidence");
    }
    const key = `${cycle.cycleId}:${attemptNumber}`;
    if (cycles.has(key)) return unavailable("invalid_cycle_evidence");
    cycles.set(key, Object.freeze({ evaluatedAt, completedAt, coreIds }));
  }

  const resultByKey = new Map<
    string,
    DnaCoreRaceHistoryEvidence<CanonicalCoreRaceHistoryResult>
  >();
  const pageKeys = new Set<string>();
  const pagesByCycleCore = new Map<
    string,
    DnaCoreRaceHistoryMaterializationPage[]
  >();
  let inputResultCount = 0;
  let replayDuplicateCount = 0;
  for (const page of input.pages) {
    if (
      page.ownerId !== ownerId ||
      !SHA_256_PATTERN.test(page.cycleId) ||
      typeof page.terminal !== "boolean"
    ) {
      return unavailable("invalid_page_evidence");
    }
    const attemptNumber = positiveInteger(
      page.attemptNumber,
      "invalid_page_evidence",
    );
    const pageNumber = positiveInteger(
      page.pageNumber,
      "invalid_page_evidence",
    );
    const pageCoreId = String(
      positiveInteger(page.coreId, "invalid_page_evidence"),
    );
    const cycleKey = `${page.cycleId}:${attemptNumber}`;
    const cycle = cycles.get(cycleKey);
    if (cycle === undefined) return unavailable("invalid_page_evidence");
    if (!cycle.coreIds.has(pageCoreId))
      return unavailable("result_outside_owner_authority");
    const pageKey = `${page.cycleId}:${attemptNumber}:${pageCoreId}:${pageNumber}`;
    if (pageKeys.has(pageKey)) return unavailable("duplicate_page_identity");
    pageKeys.add(pageKey);
    const sourceRowCount = nonNegativeInteger(
      page.sourceRowCount,
      "invalid_page_evidence",
    );
    if (
      page.results.length > sourceRowCount ||
      (page.terminal && (sourceRowCount !== 0 || page.results.length !== 0)) ||
      (!page.terminal && sourceRowCount === 0)
    ) {
      return unavailable("invalid_page_evidence");
    }
    const cycleCoreKey = `${cycleKey}:${pageCoreId}`;
    const group = pagesByCycleCore.get(cycleCoreKey) ?? [];
    group.push(page);
    pagesByCycleCore.set(cycleCoreKey, group);
    inputResultCount += page.results.length;
    if (inputResultCount > maximumResults)
      return unavailable("invalid_authority");
    for (const source of page.results) {
      const evidence = resultEvidence(source);
      if (
        evidence.canonical.sourceCoreId !== pageCoreId ||
        !cycle.coreIds.has(pageCoreId)
      ) {
        return unavailable("result_outside_owner_authority");
      }
      if (
        Date.parse(evidence.observedAt) < Date.parse(cycle.evaluatedAt) ||
        Date.parse(evidence.observedAt) > Date.parse(cycle.completedAt) ||
        Date.parse(evidence.observedAt) > materializedAtMs
      )
        return unavailable("invalid_page_evidence");
      const previous = resultByKey.get(evidence.entityKey);
      if (previous === undefined) resultByKey.set(evidence.entityKey, evidence);
      else if (previous.rawEvidenceSha256 === evidence.rawEvidenceSha256)
        replayDuplicateCount += 1;
      else return unavailable("result_replay_conflict");
    }
  }

  for (const [cycleKey, cycle] of cycles) {
    for (const coreId of cycle.coreIds) {
      const pages = pagesByCycleCore.get(`${cycleKey}:${coreId}`) ?? [];
      pages.sort((left, right) => left.pageNumber - right.pageNumber);
      if (
        pages.length < 1 ||
        pages.some((page, index) => page.pageNumber !== index + 1) ||
        pages.slice(0, -1).some((page) => page.terminal) ||
        pages.at(-1)?.terminal !== true
      ) {
        return unavailable("incomplete_cycle_evidence");
      }
    }
  }

  const documentByRaceId = new Map<
    string,
    DnaOpenLabEvidence<CanonicalRaceDocumentMetadata>
  >();
  const expectedRaceIds = new Set(
    [...resultByKey.values()].map(
      (evidence) => evidence.canonical.sourceRaceId,
    ),
  );
  for (const source of input.raceDocuments) {
    const evidence = raceDocumentEvidence(source);
    if (Date.parse(evidence.observedAt) > materializedAtMs)
      return unavailable("race_document_identity_mismatch");
    const key = evidence.canonical.sourceRaceId;
    if (!expectedRaceIds.has(key))
      return unavailable("race_document_unexpected");
    const previous = documentByRaceId.get(key);
    if (previous === undefined) documentByRaceId.set(key, evidence);
    else if (previous.rawEvidenceSha256 !== evidence.rawEvidenceSha256) {
      return unavailable("race_document_replay_conflict");
    }
  }

  let acceptedPublishedCellCount = 0;
  let missingFormatCount = 0;
  let unsupportedFormatCount = 0;
  let unpublishedCellCount = 0;
  const observations = [...resultByKey.values()].map((result) => {
    const value = result.canonical;
    const documentEvidence = documentByRaceId.get(value.sourceRaceId);
    if (documentEvidence === undefined)
      return unavailable("race_document_missing");
    const document = documentEvidence.canonical;
    if (document.entrantCoreIds === undefined)
      return unavailable("race_document_entrant_authority_unavailable");
    if (!document.entrantCoreIds.includes(value.sourceCoreId))
      return unavailable("race_document_entrant_mismatch");
    if (document.mode === undefined)
      return unavailable("race_document_mode_unavailable");
    if (document.mode !== value.mode)
      return unavailable("race_document_mode_mismatch");
    positiveInteger(value.distance, "invalid_page_evidence");
    if (document.distanceMetres === undefined)
      return unavailable("race_document_distance_unavailable");
    positiveInteger(
      document.distanceMetres,
      "race_document_distance_unavailable",
    );
    if (document.distanceMetres !== value.distance)
      return unavailable("race_document_distance_mismatch");
    const gateCount = document.gateCount;
    if (gateCount === undefined)
      return unavailable("race_document_gate_count_unavailable");
    const finishPosition = positiveInteger(
      value.finishPosition,
      "invalid_page_evidence",
    );
    if (finishPosition > gateCount)
      return unavailable("finish_position_exceeds_gate_count");
    const eventAt = eventTime({
      resultAt: value.eventAt,
      documentAt: document.startAt,
    });
    if (Date.parse(eventAt) > materializedAtMs)
      return unavailable("invalid_page_evidence");
    const published = publishedProLeagueRaceTypeFromArchive({
      payoutMechanismSourceValue: document.payoutSourceValue ?? null,
      gateCount,
      distanceMetres: value.distance,
    });
    if (published.status === "accepted") acceptedPublishedCellCount += 1;
    if (published.status === "missing_format") missingFormatCount += 1;
    if (published.status === "unsupported_format") unsupportedFormatCount += 1;
    if (published.status === "unpublished_cell") unpublishedCellCount += 1;
    const starEvidenceStatus =
      document.yellowStarSourceCoreIds === undefined ||
      document.blueStarSourceCoreIds === undefined
        ? ("missing" as const)
        : ("available" as const);
    return Object.freeze({
      sourceType: "joined_core_race_history_result" as const,
      naturalKey: result.entityKey,
      resultEvidenceSha256: result.rawEvidenceSha256,
      raceDocumentEvidenceSha256: documentEvidence.rawEvidenceSha256,
      sourceCoreId: value.sourceCoreId,
      sourceRaceId: value.sourceRaceId,
      mode: value.mode,
      distanceMetres: value.distance,
      distanceAuthority: "result_and_race_document" as const,
      elapsedMilliseconds: elapsedMilliseconds(value.elapsedTimeSourceValue),
      finishPosition,
      eventAt,
      gateCount,
      payoutMechanismSourceValue: document.payoutSourceValue ?? null,
      sourceFormat: document.format ?? value.sourceFormat,
      sourceRaceClass: document.raceClassSourceValue ?? null,
      goldStar:
        starEvidenceStatus === "missing"
          ? null
          : (document.yellowStarSourceCoreIds?.includes(value.sourceCoreId) ??
            false),
      blueStar:
        starEvidenceStatus === "missing"
          ? null
          : (document.blueStarSourceCoreIds?.includes(value.sourceCoreId) ??
            false),
      starEvidenceStatus,
      publishedCellStatus: published.status,
      raceType:
        published.status === "accepted" ? published.cell.raceType : null,
      mapIds:
        published.status === "accepted"
          ? published.cell.mapIds
          : Object.freeze([]),
    });
  });

  observations.sort((left, right) =>
    left.naturalKey.localeCompare(right.naturalKey),
  );
  const cycleSetSha256 = dnaOpenLabRawEvidenceSha256(
    [...cycles.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([identity, cycle]) => ({
        identity,
        evaluatedAt: cycle.evaluatedAt,
        completedAt: cycle.completedAt,
        coreIds: [...cycle.coreIds].sort((left, right) =>
          left.localeCompare(right),
        ),
      })),
  );
  const observationSetSha256 = dnaOpenLabRawEvidenceSha256(observations);
  return Object.freeze({
    ownerId,
    materializedAt,
    cycleSetSha256,
    observationSetSha256,
    inputCycleCount: input.cycles.length,
    inputPageCount: input.pages.length,
    inputResultCount,
    replayDuplicateCount,
    raceDocumentCount: documentByRaceId.size,
    exactDistanceConfirmedCount: observations.length,
    acceptedPublishedCellCount,
    missingFormatCount,
    unsupportedFormatCount,
    unpublishedCellCount,
    observations: Object.freeze(observations),
  });
}
