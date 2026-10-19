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
  assessmentId: string | null;
  assessmentVersion: string | null;
  assessmentSnapshotSha256: string | null;
  exactHeadSha: string | null;
  publishedAt: string | null;
  evidenceCurrentThrough: string | null;
  evidenceFreshness: "current" | "ageing" | "stale" | null;
  moduleBoundarySummary: Readonly<{
    total: number;
    notVerified: number;
    fixtureVerified: number;
    connectedVerified: number;
    failed: number;
  }> | null;
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
    assessmentId: null,
    assessmentVersion: null,
    assessmentSnapshotSha256: null,
    exactHeadSha: null,
    publishedAt: null,
    evidenceCurrentThrough: null,
    evidenceFreshness: null,
    moduleBoundarySummary: null,
    readiness: null,
  };
}

function summarizeModuleBoundaries(
  readiness: PrivateProductionReadiness,
): NonNullable<DashboardReadinessPageState["moduleBoundarySummary"]> {
  const summary = {
    total: 0,
    notVerified: 0,
    fixtureVerified: 0,
    connectedVerified: 0,
    failed: 0,
  };

  for (const moduleBoundaries of Object.values(readiness.moduleBoundaries)) {
    for (const state of Object.values(moduleBoundaries)) {
      summary.total += 1;
      if (state === "not_verified") summary.notVerified += 1;
      if (state === "fixture_verified") summary.fixtureVerified += 1;
      if (state === "connected_verified") summary.connectedVerified += 1;
      if (state === "failed") summary.failed += 1;
    }
  }

  return summary;
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
    assessmentId: state.assessmentId,
    assessmentVersion: state.assessmentVersion,
    assessmentSnapshotSha256: state.assessmentSnapshotSha256,
    exactHeadSha: state.exactHeadSha,
    publishedAt: state.publishedAt,
    evidenceCurrentThrough: state.evidenceCurrentThrough,
    evidenceFreshness: state.evidenceFreshness,
    moduleBoundarySummary: summarizeModuleBoundaries(state.readiness),
    readiness: state.readiness,
  };
}
