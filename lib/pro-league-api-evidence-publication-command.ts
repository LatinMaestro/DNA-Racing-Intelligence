import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { activeCoreHistoryProLeagueSource } from "./active-core-history-pro-league-source";
import { createEphemeralJsonlExternalSortedRunStore } from "./ephemeral-jsonl-external-sorted-run-store";
import {
  createNeonActiveDnaCoreRaceHistoryGenerationReadRepository,
  type ActiveDnaCoreRaceHistoryGenerationReadRepository,
} from "./neon-active-dna-core-race-history-generation";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";
import {
  createNeonProLeagueEvidenceGenerationRepository,
  type NeonProLeagueEvidenceGenerationRepository,
} from "./neon-pro-league-evidence-generation-repository";
import { publishSpillableProLeagueEvidence } from "./pro-league-evidence-publication-service";
import {
  spillableProLeagueExactFormatEvidence,
  type AcceptedProLeagueExactFormatObservation,
  type ProLeagueExactFormatAnalyticalObservation,
} from "./race-archive-spillable-pro-league-exact-format";

export const PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_VERSION =
  "pro-league-api-evidence-publication-command/v1" as const;
export const PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_INTENT =
  "publish_active_core_history_pro_league_evidence" as const;

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const RUNTIME_ROLE = "dna_app_runtime";

export type ProLeagueApiEvidencePublicationCommandInvocation = Readonly<{
  commandVersion: typeof PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_VERSION;
  intent: typeof PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_INTENT;
  allowPersistentWrite: true;
  exactCodeHeadSha: string;
  publishedAt: string;
}>;

export type ProLeagueApiEvidencePublicationCommandReceipt = Readonly<{
  status: "published" | "existing" | "source_unavailable";
  inputObservationCount: number;
  acceptedEntryCount: number;
  benchmarkCount: number;
  profileCount: number;
  unbenchmarkedEntryCount: number;
  exactCodeHeadSha: string;
  publishedAt: string;
  persistentWriteArmed: true;
  previewOnly: true;
  paidUsageAllowed: false;
  preserveLastGood: true;
}>;

export type ProLeagueApiEvidencePublicationCommand =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      execute: (
        invocation: ProLeagueApiEvidencePublicationCommandInvocation,
      ) => Promise<ProLeagueApiEvidencePublicationCommandReceipt>;
    }>;

type CommandEnvironment = Readonly<{
  databaseUrl?: string;
  databaseOwnerId?: string;
  ownerId?: string;
  runtimeRole?: string;
}>;

type CommandDependencies = Readonly<{
  sessionFactory?: NeonImportPersistenceSessionFactory;
  scratchRootFactory?: () => Promise<string>;
  sourceRepository?: ActiveDnaCoreRaceHistoryGenerationReadRepository;
  evidenceRepository?: NeonProLeagueEvidenceGenerationRepository;
}>;

function configured(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`Pro League API evidence command ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function exactHead(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(normalized)) {
    throw new Error("Pro League API evidence command head is invalid.");
  }
  return normalized;
}

function generationUuid(sourceGenerationId: string): string {
  const bytes = createHash("sha256")
    .update(
      `pro-league-api-evidence-generation/v1\u0000${sourceGenerationId}`,
      "utf8",
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function emptyReceipt(input: {
  exactCodeHeadSha: string;
  publishedAt: string;
}): ProLeagueApiEvidencePublicationCommandReceipt {
  return Object.freeze({
    status: "source_unavailable",
    inputObservationCount: 0,
    acceptedEntryCount: 0,
    benchmarkCount: 0,
    profileCount: 0,
    unbenchmarkedEntryCount: 0,
    exactCodeHeadSha: input.exactCodeHeadSha,
    publishedAt: input.publishedAt,
    persistentWriteArmed: true,
    previewOnly: true,
    paidUsageAllowed: false,
    preserveLastGood: true,
  });
}

/**
 * One-shot, server-only commissioning command. It reads the immutable active
 * Core-history generation, uses process-local spill files, and crosses the
 * database publication boundary only after exact-format evidence is complete.
 */
export function proLeagueApiEvidencePublicationCommandFromEnvironment(
  environment: CommandEnvironment,
  dependencies: CommandDependencies = {},
): ProLeagueApiEvidencePublicationCommand {
  const databaseUrl = configured(environment.databaseUrl);
  const databaseOwnerId = configured(environment.databaseOwnerId);
  const ownerId = configured(environment.ownerId);
  const runtimeRole = configured(environment.runtimeRole) ?? RUNTIME_ROLE;
  if (databaseUrl === null || databaseOwnerId === null || ownerId === null) {
    return Object.freeze({ status: "not_configured" });
  }
  const sessionFactory = dependencies.sessionFactory;
  const repositoryOptions = {
    databaseUrl,
    databaseOwnerId,
    ownerId,
    runtimeRole,
    ...(sessionFactory === undefined ? {} : { sessionFactory }),
  };
  const sourceRepository =
    dependencies.sourceRepository ??
    createNeonActiveDnaCoreRaceHistoryGenerationReadRepository(
      repositoryOptions,
    );
  const evidenceRepository =
    dependencies.evidenceRepository ??
    createNeonProLeagueEvidenceGenerationRepository(repositoryOptions);
  const scratchRootFactory =
    dependencies.scratchRootFactory ??
    (() => mkdtemp(join(tmpdir(), "dna-pro-league-evidence-")));

  return Object.freeze({
    status: "ready" as const,
    async execute(invocation) {
      if (
        invocation.commandVersion !==
          PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_VERSION ||
        invocation.intent !==
          PRO_LEAGUE_API_EVIDENCE_PUBLICATION_COMMAND_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        throw new Error(
          "Pro League API evidence command is not explicitly armed.",
        );
      }
      const exactCodeHeadSha = exactHead(invocation.exactCodeHeadSha);
      const publishedAt = timestamp(invocation.publishedAt, "publishedAt");
      const source = await activeCoreHistoryProLeagueSource({
        ownerId,
        repository: sourceRepository,
      });
      if (source === null) {
        return emptyReceipt({ exactCodeHeadSha, publishedAt });
      }
      if (
        Date.parse(publishedAt) < Date.parse(source.generation.materializedAt)
      ) {
        throw new Error(
          "Pro League API evidence publication predates its source.",
        );
      }
      const generationId = generationUuid(source.generation.generationId);
      const active = await evidenceRepository.readActiveGeneration(ownerId);
      if (
        active !== null &&
        active.generationId === generationId &&
        active.sourceKind === "core_history_generation" &&
        active.coreHistoryGenerationId === source.generation.generationId &&
        active.sourceVersionSetSha256 === source.generation.observationSetSha256
      ) {
        return Object.freeze({
          status: "existing" as const,
          inputObservationCount: active.inputObservationCount,
          acceptedEntryCount: active.acceptedEntryCount,
          benchmarkCount: active.benchmarkCount,
          profileCount: active.profileCount,
          unbenchmarkedEntryCount: active.unbenchmarkedEntryCount,
          exactCodeHeadSha,
          publishedAt: active.publishedAt,
          persistentWriteArmed: true as const,
          previewOnly: true as const,
          paidUsageAllowed: false as const,
          preserveLastGood: true as const,
        });
      }

      const scratchRoot = await scratchRootFactory();
      try {
        const observationStore =
          createEphemeralJsonlExternalSortedRunStore<ProLeagueExactFormatAnalyticalObservation>(
            { rootDirectory: scratchRoot, namespace: "observations" },
          );
        const acceptedStore =
          createEphemeralJsonlExternalSortedRunStore<AcceptedProLeagueExactFormatObservation>(
            { rootDirectory: scratchRoot, namespace: "accepted" },
          );
        const evidence = await spillableProLeagueExactFormatEvidence({
          observations: source.observations,
          observationStore,
          acceptedStore,
          runPrefix: "commission/pro-league-api-evidence",
          refreshedAt: source.generation.materializedAt,
          maximumRecordsInMemory: 5_000,
          mergeFanIn: 16,
          maximumObservations: 500_000,
          maximumRunObjects: 10_000,
          maximumBenchmarks: 100_000,
          maximumProfiles: 500_000,
        });
        if (
          evidence.inputObservationCount !==
            source.generation.observationCount ||
          evidence.acceptedPublishedCellEntryCount +
            evidence.nonBikeEntryCount +
            evidence.missingFormatEntryCount +
            evidence.unsupportedFormatEntryCount +
            evidence.unpublishedCellEntryCount !==
            source.generation.observationCount ||
          evidence.acceptedPublishedCellEntryCount >
            source.generation.acceptedPublishedCellCount ||
          evidence.missingFormatEntryCount >
            source.generation.missingFormatCount ||
          evidence.unsupportedFormatEntryCount >
            source.generation.unsupportedFormatCount ||
          evidence.unpublishedCellEntryCount >
            source.generation.unpublishedCellCount
        ) {
          await evidence.cleanup();
          throw new Error(
            "Pro League API evidence preparation changed source coverage.",
          );
        }
        const publication = await publishSpillableProLeagueEvidence({
          ownerId,
          generationId,
          coreHistoryGenerationId: source.generation.generationId,
          workerId: "pro-league-api-evidence-v1",
          sourceVersionSetSha256: source.generation.observationSetSha256,
          evidenceCutoffAt: source.generation.materializedAt,
          publishedAt,
          source: evidence,
          repository: evidenceRepository,
        });
        return Object.freeze({
          status: publication.disposition,
          inputObservationCount: evidence.inputObservationCount,
          acceptedEntryCount: evidence.acceptedPublishedCellEntryCount,
          benchmarkCount: publication.benchmarkCount,
          profileCount: publication.profileCount,
          unbenchmarkedEntryCount: publication.unbenchmarkedEntryCount,
          exactCodeHeadSha,
          publishedAt,
          persistentWriteArmed: true as const,
          previewOnly: true as const,
          paidUsageAllowed: false as const,
          preserveLastGood: true as const,
        });
      } finally {
        await rm(scratchRoot, { recursive: true, force: true });
      }
    },
  });
}
