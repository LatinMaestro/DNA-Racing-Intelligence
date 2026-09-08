import type {
  AcceptedProLeagueBreedingAnalysisSnapshot,
  ProLeagueBreedingRankingPublisher,
} from "@/lib/pro-league-breeding-ranking-publication-service";
import { publishAcceptedProLeagueBreedingAnalysis } from "@/lib/pro-league-breeding-ranking-publication-service";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type ProLeagueBreedingPublicationAuthority = Readonly<{
  rosterEvidenceCutoffAt: string;
  latestAcceptedPerformanceImportAt: string;
  latestAcceptedArenaImportAt: string | null;
}>;

export type AcceptedProLeagueBreedingAnalysisSource =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadAcceptedAnalysisByOwner: (
        ownerId: string,
        analysisId: string,
      ) => Promise<
        | Readonly<{ status: "not_found" }>
        | Readonly<{
            status: "ready";
            snapshot: AcceptedProLeagueBreedingAnalysisSnapshot;
          }>
      >;
    }>;

export type ProLeagueBreedingPublicationAuthoritySource =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadCurrentAuthorityByOwner: (
        ownerId: string,
      ) => Promise<ProLeagueBreedingPublicationAuthority | null>;
    }>;

export type ProLeagueBreedingPublicationTarget =
  Readonly<{ status: "not_configured" }> | ProLeagueBreedingRankingPublisher;

export type ProLeagueBreedingPublicationRunResult =
  | Readonly<{
      status:
        | "source_not_configured"
        | "authority_not_configured"
        | "target_not_configured"
        | "analysis_not_found"
        | "authority_not_found";
      published: false;
    }>
  | Readonly<{
      status: "published" | "existing";
      published: true;
      analysisId: string;
      rankingCount: number;
      candidateCount: number;
      contentSha256: string;
    }>;

function identity(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Pro League breeding publication runner ${label} is required.`,
    );
  }
  return value.trim();
}

function sha256(value: unknown, label: string): string {
  const normalized = identity(value, label);
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error(
      `Pro League breeding publication runner ${label} is invalid.`,
    );
  }
  return normalized;
}

function timestamp(value: unknown, label: string): string {
  const normalized = identity(value, label);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(
      `Pro League breeding publication runner ${label} must be canonical.`,
    );
  }
  return normalized;
}

function currentAuthority(
  value: ProLeagueBreedingPublicationAuthority,
): ProLeagueBreedingPublicationAuthority {
  if (typeof value !== "object" || value === null) {
    throw new Error(
      "Pro League breeding publication runner authority is invalid.",
    );
  }
  const rosterEvidenceCutoffAt = timestamp(
    value.rosterEvidenceCutoffAt,
    "roster evidence cutoff",
  );
  const latestAcceptedPerformanceImportAt = timestamp(
    value.latestAcceptedPerformanceImportAt,
    "accepted performance import",
  );
  const latestAcceptedArenaImportAt =
    value.latestAcceptedArenaImportAt === null
      ? null
      : timestamp(value.latestAcceptedArenaImportAt, "accepted Arena import");
  return Object.freeze({
    rosterEvidenceCutoffAt,
    latestAcceptedPerformanceImportAt,
    latestAcceptedArenaImportAt,
  });
}

function isSource(
  value: AcceptedProLeagueBreedingAnalysisSource,
): value is Extract<
  AcceptedProLeagueBreedingAnalysisSource,
  { status: "ready" }
> {
  return value.status === "ready";
}

function isAuthoritySource(
  value: ProLeagueBreedingPublicationAuthoritySource,
): value is Extract<
  ProLeagueBreedingPublicationAuthoritySource,
  { status: "ready" }
> {
  return value.status === "ready";
}

/**
 * Crosses from an immutable accepted-analysis source into compact last-good
 * publication only after independently loaded current authority still matches.
 */
export async function runProLeagueBreedingRankingPublication(
  input: Readonly<{
    authenticatedOwnerId: string;
    configuredOwnerId: string;
    analysisId: string;
    expectedContentSha256: string;
    generationId: string;
    workerId: string;
    publishedAt: string;
    source: AcceptedProLeagueBreedingAnalysisSource;
    authoritySource: ProLeagueBreedingPublicationAuthoritySource;
    target: ProLeagueBreedingPublicationTarget;
  }>,
): Promise<ProLeagueBreedingPublicationRunResult> {
  const authenticatedOwnerId = identity(
    input.authenticatedOwnerId,
    "authenticated owner",
  );
  const configuredOwnerId = identity(
    input.configuredOwnerId,
    "configured owner",
  );
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error(
      "Pro League breeding publication runner owner scope denied.",
    );
  }
  const analysisId = identity(input.analysisId, "analysis ID");
  const expectedContentSha256 = sha256(
    input.expectedContentSha256,
    "accepted analysis digest",
  );

  if (input.source.status === "not_configured") {
    return Object.freeze({ status: "source_not_configured", published: false });
  }
  if (!isSource(input.source)) {
    throw new Error(
      "Pro League breeding publication runner source is invalid.",
    );
  }
  if (input.authoritySource.status === "not_configured") {
    return Object.freeze({
      status: "authority_not_configured",
      published: false,
    });
  }
  if (!isAuthoritySource(input.authoritySource)) {
    throw new Error(
      "Pro League breeding publication runner authority source is invalid.",
    );
  }
  if (input.target.status === "not_configured") {
    return Object.freeze({ status: "target_not_configured", published: false });
  }

  const authorityValue =
    await input.authoritySource.loadCurrentAuthorityByOwner(
      authenticatedOwnerId,
    );
  if (authorityValue === null) {
    return Object.freeze({ status: "authority_not_found", published: false });
  }
  const authority = currentAuthority(authorityValue);
  const accepted = await input.source.loadAcceptedAnalysisByOwner(
    authenticatedOwnerId,
    analysisId,
  );
  if (accepted.status === "not_found") {
    return Object.freeze({ status: "analysis_not_found", published: false });
  }
  if (
    accepted.status !== "ready" ||
    typeof accepted.snapshot !== "object" ||
    accepted.snapshot === null
  ) {
    throw new Error(
      "Pro League breeding publication runner accepted source is invalid.",
    );
  }
  if (
    accepted.snapshot.analysisId !== analysisId ||
    accepted.snapshot.contentSha256 !== expectedContentSha256
  ) {
    throw new Error(
      "Pro League breeding publication runner accepted source identity changed.",
    );
  }
  if (
    accepted.snapshot.rosterEvidenceCutoffAt !==
      authority.rosterEvidenceCutoffAt ||
    accepted.snapshot.latestAcceptedPerformanceImportAt !==
      authority.latestAcceptedPerformanceImportAt ||
    accepted.snapshot.latestAcceptedArenaImportAt !==
      authority.latestAcceptedArenaImportAt
  ) {
    throw new Error(
      "Pro League breeding publication runner accepted authority is stale.",
    );
  }

  const result = await publishAcceptedProLeagueBreedingAnalysis({
    authenticatedOwnerId,
    configuredOwnerId,
    generationId: input.generationId,
    workerId: input.workerId,
    publishedAt: input.publishedAt,
    snapshot: accepted.snapshot,
    publisher: input.target,
  });
  return Object.freeze({
    status: result.disposition,
    published: true,
    analysisId: result.analysisId,
    rankingCount: result.rankingCount,
    candidateCount: result.candidateCount,
    contentSha256: result.contentSha256,
  });
}
