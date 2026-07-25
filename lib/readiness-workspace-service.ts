import {
  assessPrivateProductionReadiness,
  type PrivateProductionReadiness,
  type PrivateProductionReadinessInput,
} from "@/domain/private-production-readiness";

export type ReadinessAssessmentRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadLatestAssessmentByOwner: (
        ownerId: string,
      ) => Promise<PrivateProductionReadinessInput | null>;
    }>;

export type ReadinessWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type ReadinessWorkspacePageState = Readonly<{
  assessmentId: string | null;
  exactHeadSha: string | null;
  readiness: PrivateProductionReadiness | null;
  connectionStatus: ReadinessWorkspaceConnectionStatus;
}>;

export const unavailableReadinessAssessmentRepository: ReadinessAssessmentRepository =
  Object.freeze({ status: "not_configured" });

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

export async function loadReadinessWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: ReadinessAssessmentRepository;
  }>,
): Promise<ReadinessWorkspacePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      assessmentId: null,
      exactHeadSha: null,
      readiness: null,
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Readiness workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      assessmentId: null,
      exactHeadSha: null,
      readiness: null,
      connectionStatus: "persistence_not_configured",
    };
  }

  const assessment =
    await input.repository.loadLatestAssessmentByOwner(authenticatedOwnerId);
  return assessment === null
    ? {
        assessmentId: null,
        exactHeadSha: null,
        readiness: null,
        connectionStatus: "read_model_connected",
      }
    : {
        assessmentId: assessment.assessmentId,
        exactHeadSha: assessment.exactHeadSha.toLowerCase(),
        readiness: assessPrivateProductionReadiness(assessment),
        connectionStatus: "read_model_connected",
      };
}
