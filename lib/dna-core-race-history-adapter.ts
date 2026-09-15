import { createHash } from "node:crypto";

import type { RaceMode } from "@/domain/import-contract";
import {
  dnaCoreRaceHistoryRaceIdentifier,
  type DnaCoreRaceHistoryRow,
} from "@/lib/dna-core-race-history-client";

export type DnaCoreRaceHistoryEvidence<T> = Readonly<{
  source: "dna_open_lab";
  sourceVersion: "core-history-v1";
  scope: "races";
  endpoint: "core.history";
  entityKey: string;
  observedAt: string;
  rawEvidenceSha256: string;
  canonical: T;
}>;

export type DnaCoreRaceHistoryDiagnostic =
  | "core_history_core_identity_unavailable"
  | "core_history_owner_core_mismatch"
  | "core_history_race_identity_unavailable"
  | "core_history_mode_unavailable"
  | "core_history_distance_unavailable"
  | "core_history_elapsed_time_unavailable"
  | "core_history_finish_position_unavailable"
  | "core_history_event_time_unavailable"
  | "core_history_format_unavailable"
  | "core_history_track_unavailable";

export type CanonicalCoreRaceHistoryResult = Readonly<{
  sourceType: "core_race_history_result";
  sourceCoreId: string;
  sourceRaceId: string;
  mode: RaceMode;
  distance: number;
  elapsedTimeSourceValue: string;
  finishPosition: number;
  eventAt: string | null;
  sourceFormat: string | null;
  trackSourceValue: string | null;
}>;

export type DnaCoreRaceHistoryAdaptation =
  | Readonly<{
      status: "ready";
      evidence: DnaCoreRaceHistoryEvidence<CanonicalCoreRaceHistoryResult>;
    }>
  | Readonly<{
      status: "quarantined";
      diagnostic: DnaCoreRaceHistoryDiagnostic;
      rawEvidenceSha256: string;
    }>;

export type DnaCoreRaceHistoryPageAdaptation = Readonly<{
  status: "ready" | "held_conflict";
  accepted: readonly DnaCoreRaceHistoryEvidence<CanonicalCoreRaceHistoryResult>[];
  quarantined: readonly Readonly<{
    rowIndex: number;
    diagnostic: DnaCoreRaceHistoryDiagnostic;
    rawEvidenceSha256: string;
  }>[];
  replayDuplicateCount: number;
  conflictCount: number;
}>;

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("source value is invalid");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function quarantined(
  raw: DnaCoreRaceHistoryRow,
  diagnostic: DnaCoreRaceHistoryDiagnostic,
): DnaCoreRaceHistoryAdaptation {
  return Object.freeze({
    status: "quarantined",
    diagnostic,
    rawEvidenceSha256: sha256(raw),
  });
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function positiveFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function mode(value: unknown): RaceMode | null {
  return value === "bike" || value === "car" || value === "horse"
    ? value
    : null;
}

function optionalTimestamp(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim() !== value) return "invalid";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "invalid" : parsed.toISOString();
}

function optionalText(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim() !== value) return "invalid";
  return value.length <= 512 ? value : "invalid";
}

export function adaptDnaCoreRaceHistoryResult(input: {
  requestedCoreId: number;
  raw: DnaCoreRaceHistoryRow;
  observedAt: string;
}): DnaCoreRaceHistoryAdaptation {
  const requestedCoreId = positiveInteger(input.requestedCoreId);
  if (requestedCoreId === null) {
    throw new TypeError("requestedCoreId must be a positive safe integer");
  }
  const observedAt = new Date(input.observedAt);
  if (Number.isNaN(observedAt.getTime())) {
    throw new TypeError("observedAt must be a valid timestamp");
  }

  const sourceCoreId = positiveInteger(input.raw.hid);
  if (sourceCoreId === null) {
    return quarantined(input.raw, "core_history_core_identity_unavailable");
  }
  if (sourceCoreId !== requestedCoreId) {
    return quarantined(input.raw, "core_history_owner_core_mismatch");
  }
  const rawRaceId = dnaCoreRaceHistoryRaceIdentifier(input.raw.rid);
  if (rawRaceId === null) {
    return quarantined(input.raw, "core_history_race_identity_unavailable");
  }
  const raceMode = mode(input.raw.rvmode);
  if (raceMode === null) {
    return quarantined(input.raw, "core_history_mode_unavailable");
  }
  const distanceCode = positiveInteger(input.raw.cb);
  if (distanceCode === null) {
    return quarantined(input.raw, "core_history_distance_unavailable");
  }
  const distance = distanceCode < 100 ? distanceCode * 100 : distanceCode;
  if (!Number.isSafeInteger(distance) || distance < 100 || distance > 100_000) {
    return quarantined(input.raw, "core_history_distance_unavailable");
  }
  const elapsedTime = positiveFinite(input.raw.time);
  if (elapsedTime === null) {
    return quarantined(input.raw, "core_history_elapsed_time_unavailable");
  }
  const finishPosition = positiveInteger(input.raw.pos);
  if (finishPosition === null) {
    return quarantined(input.raw, "core_history_finish_position_unavailable");
  }
  const eventAt = optionalTimestamp(input.raw.start_time);
  if (eventAt === "invalid") {
    return quarantined(input.raw, "core_history_event_time_unavailable");
  }
  const sourceFormat = optionalText(input.raw.format);
  if (sourceFormat === "invalid") {
    return quarantined(input.raw, "core_history_format_unavailable");
  }
  const trackSourceValue = optionalText(input.raw.track);
  if (trackSourceValue === "invalid") {
    return quarantined(input.raw, "core_history_track_unavailable");
  }

  const sourceRaceId = String(rawRaceId);
  const canonical: CanonicalCoreRaceHistoryResult = Object.freeze({
    sourceType: "core_race_history_result",
    sourceCoreId: String(sourceCoreId),
    sourceRaceId,
    mode: raceMode,
    distance,
    elapsedTimeSourceValue: String(elapsedTime),
    finishPosition,
    eventAt,
    sourceFormat,
    trackSourceValue,
  });
  return Object.freeze({
    status: "ready",
    evidence: Object.freeze({
      source: "dna_open_lab",
      sourceVersion: "core-history-v1",
      scope: "races",
      endpoint: "core.history",
      entityKey: `core-result:${sourceCoreId}:${raceMode}:${sourceRaceId}`,
      observedAt: observedAt.toISOString(),
      rawEvidenceSha256: sha256(input.raw),
      canonical,
    }),
  });
}

export function adaptDnaCoreRaceHistoryPage(input: {
  requestedCoreId: number;
  rows: readonly DnaCoreRaceHistoryRow[];
  observedAt: string;
}): DnaCoreRaceHistoryPageAdaptation {
  const acceptedByKey = new Map<
    string,
    DnaCoreRaceHistoryEvidence<CanonicalCoreRaceHistoryResult>
  >();
  const quarantinedRows: Array<{
    rowIndex: number;
    diagnostic: DnaCoreRaceHistoryDiagnostic;
    rawEvidenceSha256: string;
  }> = [];
  let replayDuplicateCount = 0;
  let conflictCount = 0;

  input.rows.forEach((raw, rowIndex) => {
    const result = adaptDnaCoreRaceHistoryResult({
      requestedCoreId: input.requestedCoreId,
      raw,
      observedAt: input.observedAt,
    });
    if (result.status === "quarantined") {
      quarantinedRows.push(
        Object.freeze({
          rowIndex,
          diagnostic: result.diagnostic,
          rawEvidenceSha256: result.rawEvidenceSha256,
        }),
      );
      return;
    }
    const previous = acceptedByKey.get(result.evidence.entityKey);
    if (previous === undefined) {
      acceptedByKey.set(result.evidence.entityKey, result.evidence);
    } else if (
      previous.rawEvidenceSha256 === result.evidence.rawEvidenceSha256
    ) {
      replayDuplicateCount += 1;
    } else {
      conflictCount += 1;
    }
  });

  return Object.freeze({
    status: conflictCount === 0 ? "ready" : "held_conflict",
    accepted: Object.freeze(
      [...acceptedByKey.values()].sort((left, right) =>
        left.entityKey.localeCompare(right.entityKey),
      ),
    ),
    quarantined: Object.freeze(quarantinedRows),
    replayDuplicateCount,
    conflictCount,
  });
}
