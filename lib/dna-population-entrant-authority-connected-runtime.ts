import {
  cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment,
  type CloudflareNeonDnaOpenLabProviderCapacityEnvironment,
} from "./cloudflare-neon-dna-open-lab-provider-capacity-source";
import { createCloudflareDnaOpenLabP5R2S3ListBinding } from "./cloudflare-dna-open-lab-p5-r2-s3-list-binding";
import { createCloudflareR2DatasetEvidencePort } from "./cloudflare-r2-dataset-evidence-port";
import {
  createDnaPopulationEntrantAuthorityCapacityGate,
  DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_BYTES_FLOOR,
} from "./dna-population-entrant-authority-capacity-gate";
import {
  createDnaPopulationEntrantAuthorityCohortCommand,
  type DnaPopulationEntrantAuthorityCohortCommandSession,
  type DnaPopulationEntrantAuthorityCohortCommandInvocation,
} from "./dna-population-entrant-authority-cohort-command";
import { createDnaPopulationEntrantAuthorityLiveAuditSource } from "./dna-population-entrant-authority-live-audit-source";
import { createDnaPopulationEntrantAuthorityR2ChunkStore } from "./dna-population-entrant-authority-r2-store";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "./dna-open-lab-p5-first-backfill-approval";
import { createDnaOpenLabP5FirstBackfillR2EvidenceWriter } from "./dna-open-lab-p5-first-backfill-r2-evidence";
import { createDnaOpenLabRequestBudget } from "./dna-open-lab-request-budget";
import { createDnaOpenLabV1Client } from "./dna-open-lab-v1-client";
import { createDnaPopulationRaceIndexR2ChunkStore } from "./dna-population-race-index-r2-chunk";
import { createNeonDnaOpenLabP5FirstBackfillLedger } from "./neon-dna-open-lab-p5-first-backfill-ledger";
import { createNeonDnaPopulationEntrantAuthorityCheckpointRepository } from "./neon-dna-population-entrant-authority-checkpoint";
import { createNeonDnaPopulationRaceIndexGenerationRepository } from "./neon-dna-population-race-index-generation";
import { createNeonDnaOpenLabSyncPublicationRepository } from "./neon-dna-open-lab-sync-publication";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/u;
const OWNER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
const BUCKET_NAME_PATTERN =
  /^(?!.*\.\.)(?!.*--)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaPopulationEntrantAuthorityConnectedEnvironment = Readonly<{
  authorizedOwnerId?: string;
  exactCodeHeadSha?: string;
  databaseUrl?: string;
  databaseOwnerId?: string;
  runtimeRole?: string;
  dnaOpenLabApiKey?: string;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
  cloudflareAnalyticsApiToken?: string;
  r2BucketName?: string;
  r2StorageClass?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  neonApiKey?: string;
  neonProjectId?: string;
}>;

export type DnaPopulationEntrantAuthorityConnectedRuntime =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      exactCodeHeadSha: string;
      execute: (
        invocation: DnaPopulationEntrantAuthorityCohortCommandInvocation,
      ) => Promise<DnaPopulationEntrantAuthorityCohortCommandSession>;
    }>;

export const unavailableDnaPopulationEntrantAuthorityConnectedRuntime: DnaPopulationEntrantAuthorityConnectedRuntime =
  Object.freeze({ status: "not_configured" });

type ConnectedConfiguration = Readonly<{
  ownerId: string;
  exactCodeHeadSha: string;
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  dnaApiKey: string;
  accountId: string;
  apiToken: string;
  analyticsApiToken: string;
  bucketName: string;
  r2StorageClass: "Standard";
  accessKeyId: string;
  secretAccessKey: string;
  neonApiKey: string;
  neonProjectId: string;
}>;

function secret(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (
    normalized.length < 1 ||
    normalized.length > 4_096 ||
    CONTROL_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function configured(
  environment: DnaPopulationEntrantAuthorityConnectedEnvironment,
): ConnectedConfiguration | null {
  const ownerId = environment.authorizedOwnerId?.trim() ?? "";
  const exactCodeHeadSha =
    environment.exactCodeHeadSha?.trim().toLowerCase() ?? "";
  const databaseUrl = secret(environment.databaseUrl);
  const databaseOwnerId =
    environment.databaseOwnerId?.trim().toLowerCase() ?? "";
  const runtimeRole = environment.runtimeRole?.trim() ?? "";
  const dnaApiKey = secret(environment.dnaOpenLabApiKey);
  const accountId = environment.cloudflareAccountId?.trim().toLowerCase() ?? "";
  const apiToken = secret(environment.cloudflareApiToken);
  const analyticsApiToken = secret(environment.cloudflareAnalyticsApiToken);
  const bucketName = environment.r2BucketName?.trim() ?? "";
  const r2StorageClass = environment.r2StorageClass?.trim() ?? "";
  const accessKeyId = secret(environment.r2AccessKeyId);
  const secretAccessKey = secret(environment.r2SecretAccessKey);
  const neonApiKey = secret(environment.neonApiKey);
  const neonProjectId = secret(environment.neonProjectId);

  if (
    !OWNER_ID_PATTERN.test(ownerId) ||
    !GIT_OBJECT_ID_PATTERN.test(exactCodeHeadSha) ||
    databaseUrl === null ||
    !UUID_PATTERN.test(databaseOwnerId) ||
    !ROLE_PATTERN.test(runtimeRole) ||
    dnaApiKey === null ||
    !ACCOUNT_ID_PATTERN.test(accountId) ||
    apiToken === null ||
    analyticsApiToken === null ||
    !BUCKET_NAME_PATTERN.test(bucketName) ||
    r2StorageClass !== "Standard" ||
    accessKeyId === null ||
    secretAccessKey === null ||
    neonApiKey === null ||
    neonProjectId === null
  ) {
    return null;
  }

  return Object.freeze({
    ownerId,
    exactCodeHeadSha,
    databaseUrl,
    databaseOwnerId,
    runtimeRole,
    dnaApiKey,
    accountId,
    apiToken,
    analyticsApiToken,
    bucketName,
    r2StorageClass: "Standard" as const,
    accessKeyId,
    secretAccessKey,
    neonApiKey,
    neonProjectId,
  });
}

function capacityEnvironment(
  config: ConnectedConfiguration,
): CloudflareNeonDnaOpenLabProviderCapacityEnvironment {
  return Object.freeze({
    authorizedOwnerId: config.ownerId,
    cloudflareAccountId: config.accountId,
    cloudflareAnalyticsApiToken: config.analyticsApiToken,
    r2BucketName: config.bucketName,
    r2StorageClass: config.r2StorageClass,
    neonApiKey: config.neonApiKey,
    neonProjectId: config.neonProjectId,
  });
}

/**
 * Composes the exact connected dependencies for one guarded private-Preview
 * unresolved-Race cohort command. Construction performs no provider request and
 * no persistent write. Missing or malformed configuration fails closed as
 * not_configured.
 */
export function dnaPopulationEntrantAuthorityConnectedRuntimeFromEnvironment(input: {
  environment: DnaPopulationEntrantAuthorityConnectedEnvironment;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
}): DnaPopulationEntrantAuthorityConnectedRuntime {
  const config = configured(input.environment);
  if (config === null) {
    return unavailableDnaPopulationEntrantAuthorityConnectedRuntime;
  }

  try {
    const fetcher = input.fetch ?? globalThis.fetch;
    const capacitySource =
      cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment(
        capacityEnvironment(config),
        {
          ...(input.now === undefined ? {} : { now: input.now }),
          fetch: fetcher,
        },
      );
    if (capacitySource.status !== "ready") {
      return unavailableDnaPopulationEntrantAuthorityConnectedRuntime;
    }

    const storage = createCloudflareR2DatasetEvidencePort({
      accountId: config.accountId,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      apiToken: config.apiToken,
      fetch: fetcher,
    });
    const listBinding = createCloudflareDnaOpenLabP5R2S3ListBinding({
      accountId: config.accountId,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      bucketName: config.bucketName,
    });

    const entrantStorage = Object.freeze({
      readBucketPrivacy: storage.readBucketPrivacy,
      putObjectIfAbsent: storage.putObjectIfAbsent,
      headObject: storage.headObject,
      getObject: storage.getObject,
      async listObjects(request: {
        bucketName: string;
        prefix: string;
        limit: 2;
      }) {
        if (request.bucketName !== config.bucketName) {
          throw new Error("entrant R2 bucket scope denied");
        }
        const page = await listBinding.list({
          prefix: request.prefix,
          limit: request.limit,
        });
        return Object.freeze({
          objects: Object.freeze(
            page.objects.map((entry) => Object.freeze({ key: entry.key })),
          ),
          truncated: page.truncated,
        });
      },
    });

    const baseline = createNeonDnaOpenLabP5FirstBackfillLedger({
      databaseUrl: config.databaseUrl,
      databaseOwnerId: config.databaseOwnerId,
      ownerId: config.ownerId,
      runtimeRole: config.runtimeRole,
      approvalPacket: DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
    });
    const populationIndex =
      createNeonDnaPopulationRaceIndexGenerationRepository({
        databaseUrl: config.databaseUrl,
        databaseOwnerId: config.databaseOwnerId,
        ownerId: config.ownerId,
        runtimeRole: config.runtimeRole,
      });
    const publicationRepository = createNeonDnaOpenLabSyncPublicationRepository(
      {
        databaseUrl: config.databaseUrl,
        databaseOwnerId: config.databaseOwnerId,
        runtimeRole: config.runtimeRole,
      },
    );
    const baselineEvidence = createDnaOpenLabP5FirstBackfillR2EvidenceWriter({
      ownerId: config.ownerId,
      bucketName: config.bucketName,
      storage,
      approvalPacket: DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
    });
    const populationChunkStore = createDnaPopulationRaceIndexR2ChunkStore({
      ownerId: config.ownerId,
      bucketName: config.bucketName,
      storage,
    });
    const authoritySource = createDnaPopulationEntrantAuthorityLiveAuditSource({
      configuredOwnerId: config.ownerId,
      exactCodeHeadSha: config.exactCodeHeadSha,
      bucketName: config.bucketName,
      baseline: Object.freeze({
        load: baseline.load,
        loadReceipts: baseline.loadReceipts,
        readEvidence: baselineEvidence.read,
      }),
      historySource: publicationRepository,
      populationIndex,
      chunkStore: populationChunkStore,
      storage,
      capacitySource,
    });

    const checkpointRepository =
      createNeonDnaPopulationEntrantAuthorityCheckpointRepository({
        databaseUrl: config.databaseUrl,
        databaseOwnerId: config.databaseOwnerId,
        ownerId: config.ownerId,
        runtimeRole: config.runtimeRole,
      });
    const r2Store = createDnaPopulationEntrantAuthorityR2ChunkStore({
      ownerId: config.ownerId,
      bucketName: config.bucketName,
      storage: entrantStorage,
    });

    const capacityGate = Object.freeze({
      async assertFreshCurrentCapacity(
        authority: Parameters<
          ReturnType<
            typeof createDnaPopulationEntrantAuthorityCapacityGate
          >["assertFreshCurrentCapacity"]
        >[0],
      ) {
        const gate = createDnaPopulationEntrantAuthorityCapacityGate({
          ownerId: config.ownerId,
          measurementSource: capacitySource,
          sizingAuthority: Object.freeze({
            version: 1 as const,
            unresolvedRaceCount: authority.unresolvedRaceCount,
            unresolvedRaceSetSha256: authority.unresolvedRaceSetSha256,
            measuredMaximumCompactEntrantAuthorityBytes:
              DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_BYTES_FLOOR,
            verifiedIncrementalMaximumCompactEntrantAuthorityBytes:
              DNA_POPULATION_ENTRANT_AUTHORITY_VERIFIED_COMPACT_BYTES_FLOOR,
          }),
          ...(input.now === undefined ? {} : { now: input.now }),
        });
        return gate.assertFreshCurrentCapacity(authority);
      },
    });

    const command = createDnaPopulationEntrantAuthorityCohortCommand({
      configuredOwnerId: config.ownerId,
      runtimeCodeHeadSha: config.exactCodeHeadSha,
      authoritySource,
      runtime: Object.freeze({
        client: createDnaOpenLabV1Client({ apiKey: config.dnaApiKey }),
        requestBudget: createDnaOpenLabRequestBudget(),
        capacityGate,
        checkpointRepository,
        r2Store,
      }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });

    return Object.freeze({
      status: "ready" as const,
      exactCodeHeadSha: config.exactCodeHeadSha,
      execute: command.execute,
    });
  } catch {
    return unavailableDnaPopulationEntrantAuthorityConnectedRuntime;
  }
}
