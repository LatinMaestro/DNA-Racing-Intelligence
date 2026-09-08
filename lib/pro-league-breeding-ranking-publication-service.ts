import { createHash } from "node:crypto";

import {
  rankBreedingPairs,
  type BreedingPairRankingInput,
} from "@/domain/breeding-pair-ranking";
import type { NeonProLeagueBreedingRankingRepository } from "@/lib/neon-pro-league-breeding-ranking-repository";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAXIMUM_RANKINGS = 200;
const MAXIMUM_CANDIDATES = 2_000;

export type AcceptedProLeagueBreedingAnalysis = Readonly<{
  analysisId: string;
  acceptanceStatus: "accepted";
  completionStatus: "complete";
  acceptedAt: string;
  rosterEvidenceCutoffAt: string;
  latestAcceptedPerformanceImportAt: string;
  latestAcceptedArenaImportAt: string | null;
  proLeagueRaceTypeEvidence: "unavailable";
  expectedRankingCount: number;
  expectedCandidateCount: number;
  rankings: readonly BreedingPairRankingInput[];
}>;

export type AcceptedProLeagueBreedingAnalysisSnapshot =
  AcceptedProLeagueBreedingAnalysis &
    Readonly<{
      contentSha256: string;
    }>;

export type ProLeagueBreedingRankingPublisher = Readonly<{
  status: "ready";
  publish: NeonProLeagueBreedingRankingRepository["publish"];
}>;

function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new Error("Accepted breeding analysis contains an undefined value.");
  }
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new Error("Accepted breeding analysis cannot be serialized.");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function acceptedProLeagueBreedingAnalysisSha256(
  analysis: AcceptedProLeagueBreedingAnalysis,
): string {
  return createHash("sha256")
    .update(canonicalJson(analysis), "utf8")
    .digest("hex");
}

function identity(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Pro League breeding ${label} is required.`);
  }
  return value.trim();
}

function timestamp(value: unknown, label: string): string {
  const normalized = identity(value, label);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`Pro League breeding ${label} must be canonical.`);
  }
  return normalized;
}

function exactCount(value: unknown, label: string, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new Error(`Pro League breeding ${label} is outside its bound.`);
  }
  return value;
}

function withoutDigest(
  snapshot: AcceptedProLeagueBreedingAnalysisSnapshot,
): AcceptedProLeagueBreedingAnalysis {
  return Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== "contentSha256"),
  ) as AcceptedProLeagueBreedingAnalysis;
}

export async function publishAcceptedProLeagueBreedingAnalysis(
  input: Readonly<{
    authenticatedOwnerId: string;
    configuredOwnerId: string;
    generationId: string;
    workerId: string;
    publishedAt: string;
    snapshot: AcceptedProLeagueBreedingAnalysisSnapshot;
    publisher: ProLeagueBreedingRankingPublisher;
  }>,
): Promise<
  Readonly<{
    disposition: "published" | "existing";
    analysisId: string;
    rankingCount: number;
    candidateCount: number;
    contentSha256: string;
  }>
> {
  const authenticatedOwnerId = identity(
    input.authenticatedOwnerId,
    "authenticated owner",
  );
  const configuredOwnerId = identity(
    input.configuredOwnerId,
    "configured owner",
  );
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Pro League breeding publication owner scope denied.");
  }
  if (
    typeof input.publisher !== "object" ||
    input.publisher === null ||
    input.publisher.status !== "ready" ||
    typeof input.publisher.publish !== "function"
  ) {
    throw new Error("Pro League breeding publisher is not ready.");
  }
  const analysisId = identity(input.snapshot.analysisId, "analysis ID");
  if (
    input.snapshot.acceptanceStatus !== "accepted" ||
    input.snapshot.completionStatus !== "complete"
  ) {
    throw new Error(
      "Pro League breeding analysis must be accepted and complete.",
    );
  }
  if (input.snapshot.proLeagueRaceTypeEvidence !== "unavailable") {
    throw new Error(
      "Pro League race-type breeding evidence must remain unavailable.",
    );
  }

  const acceptedAt = timestamp(input.snapshot.acceptedAt, "acceptance time");
  const rosterEvidenceCutoffAt = timestamp(
    input.snapshot.rosterEvidenceCutoffAt,
    "roster evidence cutoff",
  );
  const latestAcceptedPerformanceImportAt = timestamp(
    input.snapshot.latestAcceptedPerformanceImportAt,
    "accepted performance import",
  );
  const latestAcceptedArenaImportAt =
    input.snapshot.latestAcceptedArenaImportAt === null
      ? null
      : timestamp(
          input.snapshot.latestAcceptedArenaImportAt,
          "accepted Arena import",
        );
  const publishedAt = timestamp(input.publishedAt, "publication time");
  if (
    [
      rosterEvidenceCutoffAt,
      latestAcceptedPerformanceImportAt,
      latestAcceptedArenaImportAt,
    ].some(
      (value) => value !== null && Date.parse(value) > Date.parse(acceptedAt),
    ) ||
    Date.parse(acceptedAt) > Date.parse(publishedAt)
  ) {
    throw new Error(
      "Pro League breeding accepted authority is chronologically invalid.",
    );
  }

  if (!Array.isArray(input.snapshot.rankings)) {
    throw new Error("Pro League breeding rankings must be an array.");
  }
  const expectedRankingCount = exactCount(
    input.snapshot.expectedRankingCount,
    "ranking count",
    MAXIMUM_RANKINGS,
  );
  if (input.snapshot.rankings.length !== expectedRankingCount) {
    throw new Error("Pro League breeding ranking coverage is incomplete.");
  }
  const expectedCandidateCount = exactCount(
    input.snapshot.expectedCandidateCount,
    "candidate count",
    MAXIMUM_CANDIDATES,
  );
  const candidateCount = input.snapshot.rankings.reduce(
    (count, ranking) =>
      count +
      (Array.isArray(ranking.candidates) ? ranking.candidates.length : 0),
    0,
  );
  if (candidateCount !== expectedCandidateCount) {
    throw new Error("Pro League breeding candidate coverage is incomplete.");
  }

  const rankingIds = new Set<string>();
  const rankingLabels = new Set<string>();
  for (const ranking of input.snapshot.rankings) {
    const validated = rankBreedingPairs(ranking);
    if (
      rankingIds.has(validated.rankingId) ||
      rankingLabels.has(validated.rankingLabel)
    ) {
      throw new Error("Pro League breeding ranking identity is duplicated.");
    }
    rankingIds.add(validated.rankingId);
    rankingLabels.add(validated.rankingLabel);
    if (
      ranking.lastImported !== latestAcceptedPerformanceImportAt ||
      ranking.arenaLastImported !== latestAcceptedArenaImportAt ||
      Date.parse(ranking.evaluatedAt) > Date.parse(acceptedAt) ||
      (ranking.dataCurrentThrough !== null &&
        Date.parse(ranking.dataCurrentThrough) >
          Date.parse(rosterEvidenceCutoffAt))
    ) {
      throw new Error(
        "Pro League breeding ranking does not match accepted authority.",
      );
    }
  }

  if (!SHA256_PATTERN.test(input.snapshot.contentSha256)) {
    throw new Error("Pro League breeding analysis digest is invalid.");
  }
  const contentSha256 = acceptedProLeagueBreedingAnalysisSha256(
    withoutDigest(input.snapshot),
  );
  if (contentSha256 !== input.snapshot.contentSha256) {
    throw new Error("Pro League breeding analysis digest does not match.");
  }

  const disposition = await input.publisher.publish(authenticatedOwnerId, {
    generationId: input.generationId,
    workerId: input.workerId,
    rosterEvidenceCutoffAt,
    latestAcceptedPerformanceImportAt,
    latestAcceptedArenaImportAt,
    publishedAt,
    rankings: input.snapshot.rankings,
  });
  return Object.freeze({
    disposition,
    analysisId,
    rankingCount: expectedRankingCount,
    candidateCount,
    contentSha256,
  });
}
