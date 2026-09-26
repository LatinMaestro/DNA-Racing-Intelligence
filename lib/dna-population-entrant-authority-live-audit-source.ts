import type {
  DnaPopulationEntrantAuthorityCheckpointAuthority,
} from "./dna-population-entrant-authority-checkpoint";
import type {
  DnaPopulationEntrantAuthorityLiveAuditSource,
} from "./dna-population-entrant-authority-cohort-command";
import {
  planDnaPopulationHistoryAcquisition,
  type DnaPopulationHistoryAcquisitionPlan,
} from "./dna-population-history-acquisition-plan";
import {
  DNA_POPULATION_RACE_INDEX_P5_AUTHORITY,
} from "./dna-population-race-index-private-preview-operator";
import type {
  DnaPopulationRaceIndexGenerationRepository,
  DnaPopulationRaceIndexR2ChunkManifest,
} from "./dna-population-race-index-generation";
import type { DnaPopulationRaceIndexDocument } from "./dna-population-race-index-checkpoint";
import type { createDnaPopulationRaceIndexR2ChunkStore } from "./dna-population-race-index-r2-chunk";
import type { DnaOpenLabP5FirstBackfillStatusReadRepository } from "./neon-dna-open-lab-p5-first-backfill-ledger";
import type { CanonicalRaceDocumentMetadata } from "./dna-open-lab-v1-adapters";

const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MANIFEST_PAGE_LIMIT = 100 as const;
const CHUNK_READ_CONCURRENCY = 24 as const;

type PopulationIndexReadRepository = Pick<
  DnaPopulationRaceIndexGenerationRepository,
  "load" | "listPublishedR2ChunkManifests"
>;

type PopulationChunkReadStore = Pick<
  ReturnType<typeof createDnaPopulationRaceIndexR2ChunkStore>,
  "read"
>;

function auditError(message: string): never {
  throw new Error(`Population entrant live audit: ${message}`);
}

function identity(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    auditError(`${field} is invalid`);
  }
  return value;
}

function exactHead(value: string): string {
  const normalized = identity(value, "exactCodeHeadSha").toLowerCase();
  if (!GIT_OBJECT_ID_PATTERN.test(normalized)) {
    auditError("exactCodeHeadSha is invalid");
  }
  return normalized;
}

function sameRequest(input: {
  configuredOwnerId: string;
  configuredHead: string;
  requestedOwnerId: string;
  requestedHead: string;
}): void {
  if (
    identity(input.requestedOwnerId, "ownerId") !== input.configuredOwnerId ||
    exactHead(input.requestedHead) !== input.configuredHead
  ) {
    auditError("request binding is invalid");
  }
}

function validateManifestSequence(input: {
  manifests: readonly DnaPopulationRaceIndexR2ChunkManifest[];
  expectedCount: number;
  expectedRaceCount: number;
}): void {
  if (input.manifests.length !== input.expectedCount) {
    auditError("published manifest count is invalid");
  }
  let rowCount = 0;
  let previousLast: string | null = null;
  for (const [index, manifest] of input.manifests.entries()) {
    if (
      manifest.version !== 1 ||
      manifest.chunkOrdinal !== index + 1 ||
      manifest.identityRegisteredAt === null ||
      !Number.isSafeInteger(manifest.rowCount) ||
      manifest.rowCount < 1 ||
      (previousLast !== null &&
        manifest.firstSourceRaceId <= previousLast)
    ) {
      auditError("published manifest sequence is invalid");
    }
    rowCount += manifest.rowCount;
    if (!Number.isSafeInteger(rowCount)) {
      auditError("published manifest row count is invalid");
    }
    previousLast = manifest.lastSourceRaceId;
  }
  if (rowCount !== input.expectedRaceCount) {
    auditError("published manifest rows do not reconcile");
  }
}

function validateChunkDocuments(input: {
  manifest: DnaPopulationRaceIndexR2ChunkManifest;
  documents: readonly DnaPopulationRaceIndexDocument[];
  previousLast: string | null;
}): string {
  if (
    input.documents.length !== input.manifest.rowCount ||
    input.documents[0]?.sourceRaceId !== input.manifest.firstSourceRaceId ||
    input.documents.at(-1)?.sourceRaceId !== input.manifest.lastSourceRaceId
  ) {
    auditError("published chunk disagrees with its manifest");
  }
  let last = input.previousLast;
  for (const document of input.documents) {
    if (
      document.canonical.sourceType !== "race_document" ||
      document.canonical.sourceRaceId !== document.sourceRaceId ||
      document.sourceRaceId.trim() !== document.sourceRaceId ||
      document.sourceRaceId.length < 1 ||
      CONTROL_PATTERN.test(document.sourceRaceId) ||
      (last !== null && document.sourceRaceId <= last)
    ) {
      auditError("published Race document sequence is invalid");
    }
    last = document.sourceRaceId;
  }
  return last ?? auditError("published chunk is empty");
}

async function readPublishedRaceDocuments(input: {
  manifests: readonly DnaPopulationRaceIndexR2ChunkManifest[];
  chunkStore: PopulationChunkReadStore;
}): Promise<readonly CanonicalRaceDocumentMetadata[]> {
  const raceDocuments: CanonicalRaceDocumentMetadata[] = [];
  let previousLast: string | null = null;

  for (
    let start = 0;
    start < input.manifests.length;
    start += CHUNK_READ_CONCURRENCY
  ) {
    const batch = input.manifests.slice(
      start,
      start + CHUNK_READ_CONCURRENCY,
    );
    const chunks = await Promise.all(
      batch.map((manifest) => input.chunkStore.read(manifest)),
    );
    for (const [index, documents] of chunks.entries()) {
      const manifest = batch[index]!;
      previousLast = validateChunkDocuments({
        manifest,
        documents,
        previousLast,
      });
      raceDocuments.push(...documents.map((document) => document.canonical));
    }
  }

  return Object.freeze(raceDocuments);
}

function entrantAuthority(
  plan: DnaPopulationHistoryAcquisitionPlan,
): DnaPopulationEntrantAuthorityCheckpointAuthority {
  if (
    plan.status !== "held_incomplete_race_authority" ||
    plan.unresolvedRaceCount < 1 ||
    plan.unresolvedRaceSetSha256 === null
  ) {
    auditError("unresolved Race authority is unavailable");
  }
  return Object.freeze({
    version: 1 as const,
    generationId: plan.unresolvedRaceSetSha256,
    unresolvedRaceCount: plan.unresolvedRaceCount,
    unresolvedRaceSetSha256: plan.unresolvedRaceSetSha256,
  });
}

/**
 * Rebuilds the exact unresolved-Race authority from the published compact P5
 * population Race index. This source performs only Neon/R2 reads. It makes no
 * DNA provider request and performs no persistent write.
 */
export function createDnaPopulationEntrantAuthorityLiveAuditSource(input: {
  configuredOwnerId: string;
  exactCodeHeadSha: string;
  baseline: DnaOpenLabP5FirstBackfillStatusReadRepository;
  populationIndex: PopulationIndexReadRepository;
  chunkStore: PopulationChunkReadStore;
}): DnaPopulationEntrantAuthorityLiveAuditSource {
  const configuredOwnerId = identity(
    input.configuredOwnerId,
    "configuredOwnerId",
  );
  const configuredHead = exactHead(input.exactCodeHeadSha);

  return Object.freeze({
    async load(request) {
      sameRequest({
        configuredOwnerId,
        configuredHead,
        requestedOwnerId: request.ownerId,
        requestedHead: request.exactCodeHeadSha,
      });

      const baseline = await input.baseline.load();
      if (
        baseline === null ||
        baseline.status !== "complete" ||
        baseline.completionSha256 === null ||
        baseline.logicalRequestCount !==
          DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.logicalRequestCount ||
        baseline.retainedR2Bytes !==
          DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.retainedR2Bytes ||
        baseline.omittedIdentityObservationCount !==
          DNA_POPULATION_RACE_INDEX_P5_AUTHORITY.omittedIdentityObservationCount
      ) {
        auditError("immutable P5 baseline authority is unavailable");
      }

      const populationIndex = await input.populationIndex.load(
        configuredOwnerId,
        baseline.completionSha256,
      );
      if (
        populationIndex === null ||
        populationIndex.state !== "published" ||
        populationIndex.generationId !== baseline.completionSha256 ||
        populationIndex.lastRequestOrdinal !== baseline.logicalRequestCount ||
        populationIndex.processedReceiptCount !==
          baseline.logicalRequestCount ||
        populationIndex.processedReceiptBytes !== baseline.retainedR2Bytes ||
        populationIndex.processedIdentityOmissionCount !==
          baseline.omittedIdentityObservationCount ||
        populationIndex.storageLayout !== "r2_chunked_v1" ||
        populationIndex.r2ChunkCount < 1 ||
        populationIndex.r2IdentityChunkCount !==
          populationIndex.r2ChunkCount ||
        populationIndex.r2CompactedRaceCount !==
          populationIndex.uniqueRaceCount ||
        populationIndex.legacyStorageRetiredAt === null
      ) {
        auditError("published compact P5 population authority is unavailable");
      }

      const manifests: DnaPopulationRaceIndexR2ChunkManifest[] = [];
      let afterChunkOrdinal = 0;
      while (manifests.length < populationIndex.r2ChunkCount) {
        const page =
          await input.populationIndex.listPublishedR2ChunkManifests(
            configuredOwnerId,
            {
              generationId: baseline.completionSha256,
              afterChunkOrdinal,
              limit: MANIFEST_PAGE_LIMIT,
            },
          );
        if (
          page.length < 1 ||
          page.length > MANIFEST_PAGE_LIMIT ||
          manifests.length + page.length > populationIndex.r2ChunkCount
        ) {
          auditError("published manifest pagination is invalid");
        }
        manifests.push(...page);
        afterChunkOrdinal = page.at(-1)!.chunkOrdinal;
      }

      validateManifestSequence({
        manifests,
        expectedCount: populationIndex.r2ChunkCount,
        expectedRaceCount: populationIndex.uniqueRaceCount,
      });

      const raceDocuments = await readPublishedRaceDocuments({
        manifests,
        chunkStore: input.chunkStore,
      });
      if (raceDocuments.length !== populationIndex.uniqueRaceCount) {
        auditError("published Race documents do not reconcile");
      }

      const plan = planDnaPopulationHistoryAcquisition({ raceDocuments });
      const authority = entrantAuthority(plan);

      return Object.freeze({
        exactCodeHeadSha: configuredHead,
        plan,
        raceDocuments,
        authority,
      });
    },
  });
}
