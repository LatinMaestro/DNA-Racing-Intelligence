import type { NeonImportPersistenceSessionFactory } from "@/lib/neon-import-persistence-driver";
import { neonAcceptedProLeagueBreedingAnalysisSourceFromEnvironment } from "@/lib/neon-accepted-pro-league-breeding-analysis-repository";
import { neonProLeagueBreedingPublicationAuthoritySourceFromEnvironment } from "@/lib/neon-pro-league-breeding-publication-authority-repository";
import {
  acceptedProLeagueBreedingAnalysisSha256,
  publishAcceptedProLeagueBreedingAnalysis,
  type AcceptedProLeagueBreedingAnalysis,
  type AcceptedProLeagueBreedingAnalysisSnapshot,
} from "@/lib/pro-league-breeding-ranking-publication-service";
import type {
  AcceptedProLeagueBreedingAnalysisSource,
  ProLeagueBreedingPublicationAuthoritySource,
} from "@/lib/pro-league-breeding-ranking-publication-runner";

const PREFLIGHT_VERSION = "pro-league-breeding-preflight/v1" as const;
const PREFLIGHT_INTENT = "inspect_accepted_private_analysis" as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

type HeldReason =
  | "source_not_configured"
  | "authority_not_configured"
  | "authority_not_found"
  | "analysis_not_found"
  | "accepted_identity_changed"
  | "accepted_authority_stale"
  | "accepted_analysis_invalid";

export type ProLeagueBreedingPublicationPreflightInvocation = Readonly<{
  preflightVersion: typeof PREFLIGHT_VERSION;
  intent: typeof PREFLIGHT_INTENT;
  authenticatedOwnerId: string;
  analysisId: string;
  expectedContentSha256: string;
  checkedAt: string;
}>;

type SafeReceipt = Readonly<{
  persistentWritePerformed: false;
  writeAuthorized: false;
  pairRecommendationAllowed: false;
  breedingExecutionAllowed: false;
}>;

export type ProLeagueBreedingPublicationPreflightReceipt =
  | (SafeReceipt &
      Readonly<{
        status: "held";
        readyForGuardedPublication: false;
        reason: HeldReason;
      }>)
  | (SafeReceipt &
      Readonly<{
        status: "ready";
        readyForGuardedPublication: true;
        analysisId: string;
        contentSha256: string;
        rankingCount: number;
        candidateCount: number;
        rosterEvidenceCutoffAt: string;
        latestAcceptedPerformanceImportAt: string;
        latestAcceptedArenaImportAt: string | null;
        proLeagueRaceTypeEvidence: "unavailable";
      }>);

type Dependencies = Readonly<{
  configuredOwnerId: string;
  source: AcceptedProLeagueBreedingAnalysisSource;
  authoritySource: ProLeagueBreedingPublicationAuthoritySource;
}>;

const SAFE = Object.freeze({
  persistentWritePerformed: false as const,
  writeAuthorized: false as const,
  pairRecommendationAllowed: false as const,
  breedingExecutionAllowed: false as const,
});

function held(
  reason: HeldReason,
): ProLeagueBreedingPublicationPreflightReceipt {
  return Object.freeze({
    ...SAFE,
    status: "held",
    readyForGuardedPublication: false,
    reason,
  });
}

function identity(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Pro League breeding preflight ${label} is required.`);
  }
  return value.trim();
}

function timestamp(value: unknown, label: string): string {
  const normalized = identity(value, label);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(
      `Pro League breeding preflight ${label} must be canonical.`,
    );
  }
  return normalized;
}

function withoutDigest(
  snapshot: AcceptedProLeagueBreedingAnalysisSnapshot,
): AcceptedProLeagueBreedingAnalysis {
  return Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== "contentSha256"),
  ) as AcceptedProLeagueBreedingAnalysis;
}

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

/**
 * Read-only owner commissioning check. The in-memory target exists only to
 * reuse the complete accepted-analysis validator; it cannot access Neon and
 * its result is discarded. No real publisher is accepted by this boundary.
 */
export function createProLeagueBreedingPublicationPreflight(
  dependencies: Dependencies,
): Readonly<{
  inspect: (
    invocation: ProLeagueBreedingPublicationPreflightInvocation,
  ) => Promise<ProLeagueBreedingPublicationPreflightReceipt>;
}> {
  const configuredOwnerId = identity(
    dependencies.configuredOwnerId,
    "configured owner",
  );
  return Object.freeze({
    async inspect(invocation) {
      if (
        invocation.preflightVersion !== PREFLIGHT_VERSION ||
        invocation.intent !== PREFLIGHT_INTENT
      ) {
        throw new Error("Pro League breeding preflight invocation is invalid.");
      }
      const authenticatedOwnerId = identity(
        invocation.authenticatedOwnerId,
        "authenticated owner",
      );
      if (authenticatedOwnerId !== configuredOwnerId) {
        throw new Error("Pro League breeding preflight owner scope denied.");
      }
      const analysisId = identity(invocation.analysisId, "analysis ID");
      const expectedContentSha256 = identity(
        invocation.expectedContentSha256,
        "accepted analysis digest",
      );
      if (!SHA256_PATTERN.test(expectedContentSha256)) {
        throw new Error("Pro League breeding preflight digest is invalid.");
      }
      const checkedAt = timestamp(invocation.checkedAt, "check time");
      if (dependencies.source.status === "not_configured") {
        return held("source_not_configured");
      }
      if (dependencies.authoritySource.status === "not_configured") {
        return held("authority_not_configured");
      }
      const authority =
        await dependencies.authoritySource.loadCurrentAuthorityByOwner(
          authenticatedOwnerId,
        );
      if (authority === null) return held("authority_not_found");
      const accepted = await dependencies.source.loadAcceptedAnalysisByOwner(
        authenticatedOwnerId,
        analysisId,
      );
      if (accepted.status === "not_found") return held("analysis_not_found");
      if (
        accepted.status !== "ready" ||
        typeof accepted.snapshot !== "object" ||
        accepted.snapshot === null
      ) {
        return held("accepted_analysis_invalid");
      }
      const snapshot = accepted.snapshot;
      if (
        snapshot.analysisId !== analysisId ||
        snapshot.contentSha256 !== expectedContentSha256 ||
        acceptedProLeagueBreedingAnalysisSha256(withoutDigest(snapshot)) !==
          expectedContentSha256
      ) {
        return held("accepted_identity_changed");
      }
      if (
        snapshot.rosterEvidenceCutoffAt !== authority.rosterEvidenceCutoffAt ||
        snapshot.latestAcceptedPerformanceImportAt !==
          authority.latestAcceptedPerformanceImportAt ||
        snapshot.latestAcceptedArenaImportAt !==
          authority.latestAcceptedArenaImportAt
      ) {
        return held("accepted_authority_stale");
      }
      try {
        await publishAcceptedProLeagueBreedingAnalysis({
          authenticatedOwnerId,
          configuredOwnerId,
          generationId: "00000000-0000-4000-8000-000000000000",
          workerId: "read-only-preflight",
          publishedAt: checkedAt,
          snapshot,
          publisher: {
            status: "ready",
            publish: async () => "existing",
          },
        });
      } catch {
        return held("accepted_analysis_invalid");
      }
      return Object.freeze({
        ...SAFE,
        status: "ready",
        readyForGuardedPublication: true,
        analysisId,
        contentSha256: expectedContentSha256,
        rankingCount: snapshot.expectedRankingCount,
        candidateCount: snapshot.expectedCandidateCount,
        rosterEvidenceCutoffAt: snapshot.rosterEvidenceCutoffAt,
        latestAcceptedPerformanceImportAt:
          snapshot.latestAcceptedPerformanceImportAt,
        latestAcceptedArenaImportAt: snapshot.latestAcceptedArenaImportAt,
        proLeagueRaceTypeEvidence: "unavailable",
      });
    },
  });
}

export function proLeagueBreedingPublicationPreflightFromEnvironment(
  environment: Readonly<{
    databaseUrl?: string;
    databaseOwnerId?: string;
    ownerId?: string;
    runtimeRole?: string;
  }>,
  sessionFactory?: NeonImportPersistenceSessionFactory,
) {
  const ownerId = configured(environment.ownerId);
  if (ownerId === null) {
    return null;
  }
  return createProLeagueBreedingPublicationPreflight({
    configuredOwnerId: ownerId,
    source: neonAcceptedProLeagueBreedingAnalysisSourceFromEnvironment(
      environment,
      sessionFactory,
    ),
    authoritySource:
      neonProLeagueBreedingPublicationAuthoritySourceFromEnvironment(
        environment,
        sessionFactory,
      ),
  });
}
