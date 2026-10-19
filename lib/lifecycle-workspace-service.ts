import {
  rankLifecycleActions,
  type LifecycleActionRankingInput,
  type LifecycleActionRankingResult,
  type LifecycleFreshness,
} from "@/domain/lifecycle-action-ranking";

export type LifecycleRankingEvidence = Readonly<{
  ranking: LifecycleActionRankingInput | null;
  latestAcceptedImportAt: string | null;
  publishedAt: string | null;
  snapshotSha256: string | null;
}>;

export type LifecycleRankingRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadRankingEvidenceByOwner: (
        ownerId: string,
      ) => Promise<LifecycleRankingEvidence>;
    }>;

export type LifecycleWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_failed"
  | "integrity_failed"
  | "read_model_connected";

export type LifecycleWorkspacePageState = Readonly<{
  ranking: LifecycleActionRankingResult | null;
  publishedAt: string | null;
  snapshotSha256: string | null;
  connectionStatus: LifecycleWorkspaceConnectionStatus;
}>;

export const unavailableLifecycleRankingRepository: LifecycleRankingRepository =
  Object.freeze({ status: "not_configured" });

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  return value;
}

export function deriveLifecycleFreshness(
  dataCurrentThrough: string | null,
  now: Date,
): LifecycleFreshness {
  if (Number.isNaN(now.getTime()))
    throw new Error("Lifecycle server time must be valid.");
  if (dataCurrentThrough === null) return "unknown";
  const cutoff = canonicalTimestamp(dataCurrentThrough, "Data current through");
  const ageMilliseconds = now.getTime() - Date.parse(cutoff);
  if (ageMilliseconds < 0)
    throw new Error("Lifecycle cutoff cannot be in the future.");
  const ageDays = ageMilliseconds / 86_400_000;
  if (ageDays <= 3) return "current";
  if (ageDays <= 7) return "ageing";
  return "stale";
}

export async function loadLifecycleWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: LifecycleRankingRepository;
    now: Date;
  }>,
): Promise<LifecycleWorkspacePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      ranking: null,
      publishedAt: null,
      snapshotSha256: null,
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Lifecycle workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      ranking: null,
      publishedAt: null,
      snapshotSha256: null,
      connectionStatus: "persistence_not_configured",
    };
  }
  if (input.repository.status !== "ready") {
    throw new Error("Lifecycle repository status is invalid.");
  }
  if (Number.isNaN(input.now.getTime()))
    throw new Error("Lifecycle server time must be valid.");
  let evidence: LifecycleRankingEvidence;
  try {
    evidence =
      await input.repository.loadRankingEvidenceByOwner(authenticatedOwnerId);
  } catch {
    return {
      ranking: null,
      publishedAt: null,
      snapshotSha256: null,
      connectionStatus: "read_failed",
    };
  }
  try {
    if (
      evidence === null ||
      typeof evidence !== "object" ||
      !("ranking" in evidence) ||
      !("latestAcceptedImportAt" in evidence) ||
      !("publishedAt" in evidence) ||
      !("snapshotSha256" in evidence)
    ) {
      throw new Error("Lifecycle repository evidence is invalid.");
    }
    if (evidence.latestAcceptedImportAt === null) {
      if (
        evidence.ranking !== null ||
        evidence.publishedAt !== null ||
        evidence.snapshotSha256 !== null
      ) {
        throw new Error("Lifecycle empty publication evidence is invalid.");
      }
      return {
        ranking: null,
        publishedAt: null,
        snapshotSha256: null,
        connectionStatus: "read_model_connected",
      };
    }
    const latestAcceptedImportAt = canonicalTimestamp(
      evidence.latestAcceptedImportAt,
      "Latest accepted import",
    );
    if (Date.parse(latestAcceptedImportAt) > input.now.getTime()) {
      throw new Error("Latest accepted import cannot be in the future.");
    }
    if (evidence.ranking === null) {
      throw new Error("Lifecycle publication is missing its ranking.");
    }
    if (
      typeof evidence.snapshotSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(evidence.snapshotSha256)
    ) {
      throw new Error("Lifecycle snapshot identity is invalid.");
    }
    const publishedAt = canonicalTimestamp(
      evidence.publishedAt,
      "Lifecycle publication time",
    );
    if (Date.parse(publishedAt) > input.now.getTime()) {
      throw new Error("Lifecycle publication cannot be in the future.");
    }
    const ranking = evidence.ranking;
    const dataCurrentThrough = canonicalTimestamp(
      ranking.dataCurrentThrough,
      "Data current through",
    );
    const lastImported = canonicalTimestamp(
      ranking.lastImported,
      "Last imported",
    );
    const evaluatedAt = canonicalTimestamp(
      ranking.evaluatedAt,
      "Evaluation time",
    );
    if (lastImported !== latestAcceptedImportAt) {
      throw new Error(
        "Lifecycle ranking is not bound to the latest accepted import.",
      );
    }
    if (Date.parse(dataCurrentThrough) > Date.parse(lastImported)) {
      throw new Error("Lifecycle cutoff cannot follow its accepted import.");
    }
    if (Date.parse(evaluatedAt) > input.now.getTime()) {
      throw new Error("Lifecycle evaluation cannot be in the future.");
    }
    if (Date.parse(evaluatedAt) > Date.parse(publishedAt)) {
      throw new Error("Lifecycle publication cannot precede evaluation.");
    }
    const freshness = deriveLifecycleFreshness(dataCurrentThrough, input.now);
    if (ranking.freshness !== freshness) {
      throw new Error(
        "Stored lifecycle freshness does not match server-derived freshness.",
      );
    }
    return {
      ranking: rankLifecycleActions({ ...ranking, freshness }),
      publishedAt,
      snapshotSha256: evidence.snapshotSha256,
      connectionStatus: "read_model_connected",
    };
  } catch {
    return {
      ranking: null,
      publishedAt: null,
      snapshotSha256: null,
      connectionStatus: "integrity_failed",
    };
  }
}
