import type { PrivateProductionReadiness } from "@/domain/private-production-readiness";
import {
  loadReadinessWorkspacePageState,
  type ReadinessAssessmentRepository,
} from "@/lib/readiness-workspace-service";

export type DashboardReadinessConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "assessment_unavailable"
  | "assessment_read_failed"
  | "assessment_integrity_failed"
  | "assessment_connected";

export type DashboardReadinessPageState = Readonly<{
  connectionStatus: DashboardReadinessConnectionStatus;
  exactHeadSha: string | null;
  evidenceCurrentThrough: string | null;
  evidenceFreshness: "current" | "ageing" | "stale" | null;
  readiness: PrivateProductionReadiness | null;
}>;

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function emptyState(
  connectionStatus: Exclude<
    DashboardReadinessConnectionStatus,
    "assessment_connected"
  >,
): DashboardReadinessPageState {
  return {
    connectionStatus,
    exactHeadSha: null,
    evidenceCurrentThrough: null,
    evidenceFreshness: null,
    readiness: null,
  };
}

export async function loadDashboardReadinessPageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: ReadinessAssessmentRepository;
    expectedHeadSha: string | null;
    now: Date;
  }>,
): Promise<DashboardReadinessPageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return emptyState("identity_not_connected");
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Dashboard readiness access denied.");
  }

  const state = await loadReadinessWorkspacePageState(input);
  if (state.connectionStatus === "persistence_not_configured") {
    return emptyState("persistence_not_configured");
  }
  if (state.connectionStatus === "assessment_read_failed") {
    return emptyState("assessment_read_failed");
  }
  if (state.connectionStatus === "assessment_integrity_failed") {
    return emptyState("assessment_integrity_failed");
  }
  if (state.readiness === null) {
    return emptyState("assessment_unavailable");
  }
  return {
    connectionStatus: "assessment_connected",
    exactHeadSha: state.exactHeadSha,
    evidenceCurrentThrough: state.evidenceCurrentThrough,
    evidenceFreshness: state.evidenceFreshness,
    readiness: state.readiness,
  };
}
