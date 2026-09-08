import type { NeonImportPersistenceSessionFactory } from "@/lib/neon-import-persistence-driver";
import { neonAcceptedProLeagueBreedingAnalysisSourceFromEnvironment } from "@/lib/neon-accepted-pro-league-breeding-analysis-repository";
import { neonProLeagueBreedingPublicationAuthoritySourceFromEnvironment } from "@/lib/neon-pro-league-breeding-publication-authority-repository";
import { neonProLeagueBreedingRankingPublicationTargetFromEnvironment } from "@/lib/neon-pro-league-breeding-ranking-repository";
import {
  runProLeagueBreedingRankingPublication,
  type AcceptedProLeagueBreedingAnalysisSource,
  type ProLeagueBreedingPublicationAuthoritySource,
  type ProLeagueBreedingPublicationRunResult,
  type ProLeagueBreedingPublicationTarget,
} from "@/lib/pro-league-breeding-ranking-publication-runner";

const COMMAND_VERSION = "pro-league-breeding-publication/v1" as const;
const COMMAND_INTENT = "publish_accepted_private_analysis" as const;

export type ProLeagueBreedingPublicationInvocation = Readonly<{
  commandVersion: typeof COMMAND_VERSION;
  intent: typeof COMMAND_INTENT;
  allowPersistentWrite: true;
  authenticatedOwnerId: string;
  analysisId: string;
  expectedContentSha256: string;
  generationId: string;
  workerId: string;
  publishedAt: string;
}>;

export type ProLeagueBreedingPublicationCommand =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      execute: (
        invocation: ProLeagueBreedingPublicationInvocation,
      ) => Promise<ProLeagueBreedingPublicationRunResult>;
    }>;

type Dependencies = Readonly<{
  configuredOwnerId: string;
  source: AcceptedProLeagueBreedingAnalysisSource;
  authoritySource: ProLeagueBreedingPublicationAuthoritySource;
  target: ProLeagueBreedingPublicationTarget;
}>;

function identity(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Pro League breeding publication command ${label} is required.`,
    );
  }
  return value.trim();
}

export function createProLeagueBreedingPublicationCommand(
  dependencies: Dependencies,
): Extract<ProLeagueBreedingPublicationCommand, { status: "ready" }> {
  const configuredOwnerId = identity(
    dependencies.configuredOwnerId,
    "configured owner",
  );
  return Object.freeze({
    status: "ready" as const,
    async execute(invocation: ProLeagueBreedingPublicationInvocation) {
      if (
        invocation.commandVersion !== COMMAND_VERSION ||
        invocation.intent !== COMMAND_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        throw new Error(
          "Pro League breeding publication command invocation is not explicitly armed.",
        );
      }
      return runProLeagueBreedingRankingPublication({
        authenticatedOwnerId: invocation.authenticatedOwnerId,
        configuredOwnerId,
        analysisId: invocation.analysisId,
        expectedContentSha256: invocation.expectedContentSha256,
        generationId: invocation.generationId,
        workerId: invocation.workerId,
        publishedAt: invocation.publishedAt,
        source: dependencies.source,
        authoritySource: dependencies.authoritySource,
        target: dependencies.target,
      });
    },
  });
}

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

/**
 * Server-only composition root. It is deliberately not imported by a route,
 * scheduler or website read path; callers must supply one explicit write-armed
 * invocation packet for an already accepted immutable analysis.
 */
export function proLeagueBreedingPublicationCommandFromEnvironment(
  environment: Readonly<{
    databaseUrl?: string;
    databaseOwnerId?: string;
    ownerId?: string;
    runtimeRole?: string;
  }>,
  sessionFactory?: NeonImportPersistenceSessionFactory,
): ProLeagueBreedingPublicationCommand {
  const configuredOwnerId = configured(environment.ownerId);
  if (
    configured(environment.databaseUrl) === null ||
    configured(environment.databaseOwnerId) === null ||
    configuredOwnerId === null ||
    configured(environment.runtimeRole) === null
  ) {
    return Object.freeze({ status: "not_configured" });
  }
  const source = neonAcceptedProLeagueBreedingAnalysisSourceFromEnvironment(
    environment,
    sessionFactory,
  );
  const authoritySource =
    neonProLeagueBreedingPublicationAuthoritySourceFromEnvironment(
      environment,
      sessionFactory,
    );
  const target = neonProLeagueBreedingRankingPublicationTargetFromEnvironment(
    environment,
    sessionFactory,
  );
  return createProLeagueBreedingPublicationCommand({
    configuredOwnerId,
    source,
    authoritySource,
    target,
  });
}
