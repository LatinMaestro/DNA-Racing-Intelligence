import {
  rankLifecycleActions,
  type LifecycleActionRankingInput,
  type LifecycleActionRankingResult,
  type LifecycleFreshness,
} from "@/domain/lifecycle-action-ranking";

export type LifecycleRankingEvidence = Readonly<{
  ranking: LifecycleActionRankingInput | null;
  latestAcceptedImportAt: string | null;
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
  | "read_model_connected";

export type LifecycleWorkspacePageState = Readonly<{
  ranking: LifecycleActionRankingResult | null;
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
    return { ranking: null, connectionStatus: "identity_not_connected" };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Lifecycle workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return { ranking: null, connectionStatus: "persistence_not_configured" };
  }
  if (input.repository.status !== "ready") {
    throw new Error("Lifecycle repository status is invalid.");
  }
  if (Number.isNaN(input.now.getTime()))
    throw new Error("Lifecycle server time must be valid.");
  const evidence =
    await input.repository.loadRankingEvidenceByOwner(authenticatedOwnerId);
  if (
    evidence === null ||
    typeof evidence !== "object" ||
    !("ranking" in evidence) ||
    !("latestAcceptedImportAt" in evidence)
  ) {
    throw new Error("Lifecycle repository evidence is invalid.");
  }
  if (evidence.latestAcceptedImportAt === null) {
    return { ranking: null, connectionStatus: "read_model_connected" };
  }
  const latestAcceptedImportAt = canonicalTimestamp(
    evidence.latestAcceptedImportAt,
    "Latest accepted import",
  );
  if (Date.parse(latestAcceptedImportAt) > input.now.getTime()) {
    throw new Error("Latest accepted import cannot be in the future.");
  }
  if (evidence.ranking === null) {
    return { ranking: null, connectionStatus: "read_model_connected" };
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
  const freshness = deriveLifecycleFreshness(dataCurrentThrough, input.now);
  if (ranking.freshness !== freshness) {
    throw new Error(
      "Stored lifecycle freshness does not match server-derived freshness.",
    );
  }
  return {
    ranking: rankLifecycleActions({ ...ranking, freshness }),
    connectionStatus: "read_model_connected",
  };
}
