import {
  assessPrivateProductionReadiness,
  type PrivateProductionReadiness,
  type PrivateProductionReadinessInput,
} from "@/domain/private-production-readiness";

export type ReadinessAssessmentRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadLatestAssessmentByOwner: (ownerId: string) => Promise<
        Readonly<{
          assessment: PrivateProductionReadinessInput | null;
          acceptedAssessmentVersion: string | null;
          publishedAt: string | null;
        }>
      >;
    }>;

export type ReadinessWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type ReadinessWorkspacePageState = Readonly<{
  assessmentId: string | null;
  assessmentVersion: string | null;
  assessedAt: string | null;
  evidenceCurrentThrough: string | null;
  evidenceFreshness: "current" | "ageing" | "stale" | null;
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

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function canonicalTimestamp(value: unknown, label: string): string {
  const supplied = required(value, label);
  const parsed = new Date(supplied);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== supplied) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  return supplied;
}

export function deriveReadinessFreshness(
  evidenceCurrentThrough: string,
  now: Date,
): "current" | "ageing" | "stale" {
  if (Number.isNaN(now.getTime())) {
    throw new Error("Readiness server time must be valid.");
  }
  const cutoff = canonicalTimestamp(
    evidenceCurrentThrough,
    "Readiness evidence current through",
  );
  const ageMilliseconds = now.getTime() - Date.parse(cutoff);
  if (ageMilliseconds < 0) {
    throw new Error("Readiness evidence cannot be in the future.");
  }
  const ageDays = ageMilliseconds / 86_400_000;
  if (ageDays <= 3) return "current";
  if (ageDays <= 7) return "ageing";
  return "stale";
}

function emptyState(connectionStatus: ReadinessWorkspaceConnectionStatus) {
  return {
    assessmentId: null,
    assessmentVersion: null,
    assessedAt: null,
    evidenceCurrentThrough: null,
    evidenceFreshness: null,
    exactHeadSha: null,
    readiness: null,
    connectionStatus,
  } as const;
}

export async function loadReadinessWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: ReadinessAssessmentRepository;
    expectedHeadSha: string | null;
    now: Date;
  }>,
): Promise<ReadinessWorkspacePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return emptyState("identity_not_connected");
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Readiness workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return emptyState("persistence_not_configured");
  }
  if (input.repository.status !== "ready") {
    throw new Error("Readiness repository status is invalid.");
  }

  const envelope =
    await input.repository.loadLatestAssessmentByOwner(authenticatedOwnerId);
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    !("assessment" in envelope)
  ) {
    throw new Error("Readiness repository evidence is invalid.");
  }
  if (envelope.assessment === null) {
    return emptyState("read_model_connected");
  }
  if (Number.isNaN(input.now.getTime())) {
    throw new Error("Readiness server time must be valid.");
  }
  const expectedHeadSha = required(
    input.expectedHeadSha,
    "Expected deployed repository head",
  ).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedHeadSha)) {
    throw new Error("Expected deployed repository head must be an exact SHA.");
  }
  const assessment = envelope.assessment;
  const assessmentVersion = required(
    assessment.assessmentVersion,
    "Assessment version",
  );
  if (
    assessmentVersion !==
    required(envelope.acceptedAssessmentVersion, "Accepted assessment version")
  ) {
    throw new Error("Readiness assessment version is stale or inconsistent.");
  }
  const assessedAt = canonicalTimestamp(
    assessment.assessedAt,
    "Assessment time",
  );
  const evidenceCurrentThrough = canonicalTimestamp(
    assessment.evidenceCurrentThrough,
    "Readiness evidence current through",
  );
  const publishedAt = canonicalTimestamp(
    envelope.publishedAt,
    "Assessment publication time",
  );
  if (
    evidenceCurrentThrough > assessedAt ||
    assessedAt > publishedAt ||
    Date.parse(publishedAt) > input.now.getTime()
  ) {
    throw new Error("Readiness assessment chronology is inconsistent.");
  }
  if (assessment.exactHeadSha.toLowerCase() !== expectedHeadSha) {
    throw new Error(
      "Readiness assessment SHA does not match the deployed exact head.",
    );
  }
  const evidenceFreshness = deriveReadinessFreshness(
    evidenceCurrentThrough,
    input.now,
  );
  if (assessment.evidenceFreshness !== evidenceFreshness) {
    throw new Error(
      "Stored readiness freshness does not match server-derived freshness.",
    );
  }
  const readiness = assessPrivateProductionReadiness({
    ...assessment,
    exactHeadSha: expectedHeadSha,
    evidenceFreshness,
  });
  return {
    assessmentId: assessment.assessmentId,
    assessmentVersion,
    assessedAt,
    evidenceCurrentThrough,
    evidenceFreshness,
    exactHeadSha: expectedHeadSha,
    readiness,
    connectionStatus: "read_model_connected",
  };
}
