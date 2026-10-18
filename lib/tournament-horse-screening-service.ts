import type { HorseOneVOneCandidateScreening } from "@/domain/horse-one-v-one-tournament-screening";

export type TournamentHorseScreeningRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      readActiveByOwner: (ownerId: string) => Promise<Readonly<{
        snapshotVersion: string;
        payloadJson: string;
        publishedAt: string;
      }> | null>;
    }>;

export type TournamentHorseScreeningSnapshot = Readonly<{
  snapshotVersion: string;
  sourceSnapshotVersion: string;
  modelVersion: "horse-1v1-exact-distance-transfer-v2";
  evidenceCutoff: string;
  publishedAt: string;
  candidates: readonly HorseOneVOneCandidateScreening[];
}>;

export type TournamentHorseScreeningState =
  | Readonly<{
      connectionStatus:
        | "identity_not_connected"
        | "persistence_not_configured"
        | "snapshot_unavailable";
      snapshot: null;
    }>
  | Readonly<{
      connectionStatus: "snapshot_connected";
      snapshot: TournamentHorseScreeningSnapshot;
    }>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label);
  const parsed = new Date(result);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== result) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return result;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

function probability(value: unknown, label: string): number | null {
  if (value === null) return null;
  const result = integer(value, label);
  if (result > 1_000_000) throw new Error(`${label} is invalid.`);
  return result;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as T;
}

function candidate(value: unknown): HorseOneVOneCandidateScreening {
  const item = record(value, "Horse screening candidate");
  const decisionUseAllowed = item.decisionUseAllowed;
  const provenOneVOneSpecialist = item.provenOneVOneSpecialist;
  if (decisionUseAllowed !== false || provenOneVOneSpecialist !== false) {
    throw new Error("Horse screening decision boundary is invalid.");
  }
  if (!Array.isArray(item.reasons)) {
    throw new Error("Horse screening reasons are invalid.");
  }
  const reasons = item.reasons.map((reason) =>
    text(reason, "Horse screening reason"),
  );
  const distanceMetres = integer(
    item.distanceMetres,
    "Horse screening distance",
  );
  if (![1000, 1400, 2200].includes(distanceMetres)) {
    throw new Error("Horse screening distance is invalid.");
  }
  return {
    coreId: text(item.coreId, "Horse screening Core ID"),
    name: text(item.name, "Horse screening Core name"),
    element: text(item.element, "Horse screening element"),
    distanceMetres,
    status: oneOf(
      item.status,
      ["available", "unavailable", "review_required"],
      "Horse screening status",
    ),
    disposition: oneOf(
      item.disposition,
      [
        "screened_candidate",
        "inferred_candidate",
        "best_shot",
        "evidence_unavailable",
      ],
      "Horse screening disposition",
    ),
    expectedFieldPWinMillionths: probability(
      item.expectedFieldPWinMillionths,
      "Horse screening field probability",
    ),
    topTenPercentStressPWinMillionths: probability(
      item.topTenPercentStressPWinMillionths,
      "Horse screening stress probability",
    ),
    projectedFieldOutperformanceMillionths: probability(
      item.projectedFieldOutperformanceMillionths,
      "Horse screening projected field outperformance",
    ),
    projectedTopTenPercentOutperformanceMillionths: probability(
      item.projectedTopTenPercentOutperformanceMillionths,
      "Horse screening projected stress outperformance",
    ),
    candidateSampleCount: integer(
      item.candidateSampleCount,
      "Horse screening sample count",
    ),
    candidateDirectOneVOneSampleCount: integer(
      item.candidateDirectOneVOneSampleCount,
      "Horse screening direct sample count",
    ),
    fieldOpponentCoreCount: integer(
      item.fieldOpponentCoreCount,
      "Horse screening field opponent count",
    ),
    stressOpponentCoreCount: integer(
      item.stressOpponentCoreCount,
      "Horse screening stress opponent count",
    ),
    evidenceBasis: oneOf(
      item.evidenceBasis,
      ["same_mode_exact_distance_all_accepted_races"],
      "Horse screening evidence basis",
    ),
    formatTransferStatus: oneOf(
      item.formatTransferStatus,
      ["direct", "inference_only", "unavailable"],
      "Horse screening format transfer status",
    ),
    provenOneVOneSpecialist,
    analyticalStatus: oneOf(
      item.analyticalStatus,
      ["experimental"],
      "Horse screening analytical status",
    ),
    decisionUseAllowed,
    economicStatus: oneOf(
      item.economicStatus,
      ["unavailable"],
      "Horse screening economic status",
    ),
    economicReason: oneOf(
      item.economicReason,
      ["CONFIRMED_FEE_PRIZE_RULE_NOT_SUPPLIED"],
      "Horse screening economic reason",
    ),
    reasons,
  };
}

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

export async function loadTournamentHorseScreeningState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: TournamentHorseScreeningRepository;
    now: Date;
  }>,
): Promise<TournamentHorseScreeningState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { connectionStatus: "identity_not_connected", snapshot: null };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Tournament Horse screening access denied.");
  }
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw new Error("Tournament Horse screening now must be valid.");
  }
  if (input.repository.status === "not_configured") {
    return { connectionStatus: "persistence_not_configured", snapshot: null };
  }
  const stored = await input.repository.readActiveByOwner(authenticatedOwnerId);
  if (stored === null) {
    return { connectionStatus: "snapshot_unavailable", snapshot: null };
  }
  if (!/^[a-f0-9]{64}$/.test(stored.snapshotVersion)) {
    throw new Error("Horse screening snapshot version is invalid.");
  }
  const publishedAt = timestamp(
    stored.publishedAt,
    "Horse screening publication time",
  );
  if (Date.parse(publishedAt) > input.now.getTime()) {
    throw new Error("Horse screening publication cannot be in the future.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.payloadJson);
  } catch {
    throw new Error("Horse screening payload is invalid.");
  }
  const payload = record(parsed, "Horse screening payload");
  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    throw new Error("Horse screening candidates are invalid.");
  }
  const modelVersion = oneOf(
    payload.modelVersion,
    ["horse-1v1-exact-distance-transfer-v2"],
    "Horse screening model version",
  );
  const evidenceCutoff = timestamp(
    payload.evidenceCutoff,
    "Horse screening evidence cutoff",
  );
  if (Date.parse(evidenceCutoff) > Date.parse(publishedAt)) {
    throw new Error(
      "Horse screening evidence cutoff cannot follow publication.",
    );
  }
  const candidates = payload.candidates.map(candidate);
  const keys = candidates.map((item) =>
    JSON.stringify([item.coreId, item.element, item.distanceMetres]),
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error("Horse screening candidates must be unique.");
  }
  return {
    connectionStatus: "snapshot_connected",
    snapshot: {
      snapshotVersion: stored.snapshotVersion,
      sourceSnapshotVersion: text(
        payload.sourceSnapshotVersion,
        "Horse screening source snapshot version",
      ),
      modelVersion,
      evidenceCutoff,
      publishedAt,
      candidates,
    },
  };
}
