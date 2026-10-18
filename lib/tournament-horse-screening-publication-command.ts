import type { ActiveCoreHistoryCanonicalRaceAuthority } from "@/lib/active-core-history-pro-league-source";
import { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";
import { createDnaOpenLabR2CanonicalRaceDocumentReader } from "@/lib/dna-open-lab-r2-race-evidence";
import {
  createNeonActiveDnaCoreRaceHistoryGenerationReadRepository,
  type ActiveDnaCoreRaceHistoryGenerationReadRepository,
  type SelectedDnaCoreRaceHistoryReadRepository,
} from "@/lib/neon-active-dna-core-race-history-generation";
import type { NeonImportPersistenceSessionFactory } from "@/lib/neon-import-persistence-driver";
import { createNeonOwnerVaultCatalogueRepository } from "@/lib/neon-owner-vault-catalogue-repository";
import {
  createNeonTournamentHorseOpponentPoolRepository,
  type TournamentHorseOpponentPoolRepository,
} from "@/lib/neon-tournament-horse-opponent-pool-repository";
import { createNeonTournamentHorseScreeningPublicationBoundary } from "@/lib/neon-tournament-horse-screening-materializer";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";
import { createTournamentHorseScreeningAcceptedSourceComposition } from "@/lib/tournament-horse-screening-accepted-authorities";
import {
  materializeTournamentHorseScreeningSnapshot,
  type TournamentHorseScreeningAcceptedSourceBoundary,
  type TournamentHorseScreeningMaterializationOutcome,
  type TournamentHorseScreeningPublicationBoundary,
} from "@/lib/tournament-horse-screening-materializer";

export const TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_VERSION =
  "tournament-horse-screening-publication-command/v1" as const;
export const TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_INTENT =
  "publish_accepted_tournament_horse_screening" as const;

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const RUNTIME_ROLE = "dna_app_runtime";
const CANONICAL_RACE_READ_CONCURRENCY = 16;

type HistoryRepository = Pick<
  ActiveDnaCoreRaceHistoryGenerationReadRepository,
  "readActiveGeneration"
> &
  SelectedDnaCoreRaceHistoryReadRepository;

export type TournamentHorseScreeningPublicationCommandInvocation = Readonly<{
  commandVersion: typeof TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_VERSION;
  intent: typeof TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_INTENT;
  allowPersistentWrite: true;
  exactCodeHeadSha: string;
  publishedAt: string;
}>;

export type TournamentHorseScreeningPublicationCommandReceipt = Readonly<{
  status: TournamentHorseScreeningMaterializationOutcome["status"];
  exactCodeHeadSha: string;
  publishedAt: string;
  persistentWriteArmed: true;
  previewOnly: true;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

export type TournamentHorseScreeningPublicationCommand =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      execute: (
        invocation: TournamentHorseScreeningPublicationCommandInvocation,
      ) => Promise<TournamentHorseScreeningPublicationCommandReceipt>;
    }>;

type CommandEnvironment = Readonly<{
  databaseUrl?: string;
  databaseOwnerId?: string;
  authenticatedOwnerId?: string;
  runtimeRole?: string;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
  r2BucketName?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
}>;

type CommandDependencies = Readonly<{
  sessionFactory?: NeonImportPersistenceSessionFactory;
  vaultRepository?: OwnerVaultCatalogueRepository;
  historyRepository?: HistoryRepository;
  raceAuthority?: ActiveCoreHistoryCanonicalRaceAuthority;
  opponentPools?: TournamentHorseOpponentPoolRepository;
  source?: TournamentHorseScreeningAcceptedSourceBoundary;
  publication?: TournamentHorseScreeningPublicationBoundary;
  materialize?: typeof materializeTournamentHorseScreeningSnapshot;
}>;

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(
      "Tournament Horse screening publication command timestamp is invalid.",
    );
  }
  return parsed.toISOString();
}

function exactHead(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(normalized)) {
    throw new Error(
      "Tournament Horse screening publication command head is invalid.",
    );
  }
  return normalized;
}

function createRaceAuthority(
  input: Readonly<{
    authenticatedOwnerId: string;
    accountId: string;
    apiToken: string;
    bucketName: string;
    accessKeyId: string;
    secretAccessKey: string;
  }>,
): ActiveCoreHistoryCanonicalRaceAuthority {
  const reader = createDnaOpenLabR2CanonicalRaceDocumentReader({
    ownerId: input.authenticatedOwnerId,
    bucketName: input.bucketName,
    storage: createCloudflareR2DatasetEvidencePort({
      accountId: input.accountId,
      apiToken: input.apiToken,
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    }),
  });
  return Object.freeze({
    async readRaceDocuments(ownerId, references) {
      if (ownerId !== input.authenticatedOwnerId) {
        throw new Error("Tournament Horse canonical Race owner scope denied.");
      }
      const documents: Awaited<ReturnType<typeof reader.read>>[] = [];
      for (
        let offset = 0;
        offset < references.length;
        offset += CANONICAL_RACE_READ_CONCURRENCY
      ) {
        documents.push(
          ...(await Promise.all(
            references
              .slice(offset, offset + CANONICAL_RACE_READ_CONCURRENCY)
              .map(reader.read),
          )),
        );
      }
      return Object.freeze(documents);
    },
  });
}

/**
 * One-shot, server-only Preview command. Construction performs no database or
 * R2 operation. Invocation remains outside routine web request paths and must
 * cross an explicit persistent-write arm after provider/cost clearance.
 */
export function tournamentHorseScreeningPublicationCommandFromEnvironment(
  environment: CommandEnvironment,
  dependencies: CommandDependencies = {},
): TournamentHorseScreeningPublicationCommand {
  const databaseUrl = configured(environment.databaseUrl);
  const databaseOwnerId = configured(environment.databaseOwnerId);
  const authenticatedOwnerId = configured(environment.authenticatedOwnerId);
  const runtimeRole = configured(environment.runtimeRole) ?? RUNTIME_ROLE;
  if (
    databaseUrl === null ||
    databaseOwnerId === null ||
    authenticatedOwnerId === null
  ) {
    return Object.freeze({ status: "not_configured" });
  }

  let source = dependencies.source;
  if (source === undefined) {
    let raceAuthority = dependencies.raceAuthority;
    if (raceAuthority === undefined) {
      const accountId = configured(environment.cloudflareAccountId);
      const apiToken = configured(environment.cloudflareApiToken);
      const bucketName = configured(environment.r2BucketName);
      const accessKeyId = configured(environment.r2AccessKeyId);
      const secretAccessKey = configured(environment.r2SecretAccessKey);
      if (
        accountId === null ||
        apiToken === null ||
        bucketName === null ||
        accessKeyId === null ||
        secretAccessKey === null
      ) {
        return Object.freeze({ status: "not_configured" });
      }
      raceAuthority = createRaceAuthority({
        authenticatedOwnerId,
        accountId,
        apiToken,
        bucketName,
        accessKeyId,
        secretAccessKey,
      });
    }
    const sessionFactory = dependencies.sessionFactory;
    const databaseOptions = {
      databaseUrl,
      databaseOwnerId,
      runtimeRole,
      ...(sessionFactory === undefined ? {} : { sessionFactory }),
    };
    const authenticatedDatabaseOptions = {
      ...databaseOptions,
      authenticatedOwnerId,
    };
    source = createTournamentHorseScreeningAcceptedSourceComposition({
      databaseOwnerId,
      authenticatedOwnerId,
      vaultRepository:
        dependencies.vaultRepository ??
        createNeonOwnerVaultCatalogueRepository(databaseOptions),
      historyRepository:
        dependencies.historyRepository ??
        createNeonActiveDnaCoreRaceHistoryGenerationReadRepository({
          ...databaseOptions,
          ownerId: authenticatedOwnerId,
        }),
      raceAuthority,
      opponentPools:
        dependencies.opponentPools ??
        createNeonTournamentHorseOpponentPoolRepository(
          authenticatedDatabaseOptions,
        ),
    });
  }

  const sessionFactory = dependencies.sessionFactory;
  const publication =
    dependencies.publication ??
    createNeonTournamentHorseScreeningPublicationBoundary({
      databaseUrl,
      databaseOwnerId,
      authenticatedOwnerId,
      runtimeRole,
      ...(sessionFactory === undefined ? {} : { sessionFactory }),
    });
  const materialize =
    dependencies.materialize ?? materializeTournamentHorseScreeningSnapshot;

  return Object.freeze({
    status: "ready" as const,
    async execute(invocation) {
      if (
        invocation.commandVersion !==
          TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_VERSION ||
        invocation.intent !==
          TOURNAMENT_HORSE_SCREENING_PUBLICATION_COMMAND_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        throw new Error(
          "Tournament Horse screening publication command is not explicitly armed.",
        );
      }
      const exactCodeHeadSha = exactHead(invocation.exactCodeHeadSha);
      const publishedAt = timestamp(invocation.publishedAt);
      const result = await materialize({
        databaseOwnerId,
        source,
        publication,
        now: () => new Date(publishedAt),
      });
      return Object.freeze({
        status: result.status,
        exactCodeHeadSha,
        publishedAt,
        persistentWriteArmed: true as const,
        previewOnly: true as const,
        paidUsageAllowed: false as const,
        preserveLastGood: true as const,
      });
    },
  });
}
