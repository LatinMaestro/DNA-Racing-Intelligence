import {
  buildDnaPopulationEntrantAuthorityChunk,
  type DnaPopulationEntrantAuthorityChunk,
} from "./dna-population-entrant-authority-archive";
import type { DnaPopulationEntrantAuthorityCheckpointRepository } from "./dna-population-entrant-authority-checkpoint";
import type { DnaPopulationEntrantAuthorityLiveAuditSource } from "./dna-population-entrant-authority-cohort-command";
import type { DnaPopulationEntrantAuthoritySuccessorReadinessSource } from "./dna-population-entrant-authority-successor-commissioning";
import { createDnaPopulationEntrantAuthoritySuccessorCheckpointAuthority } from "./dna-population-entrant-authority-successor-checkpoint";
import { planDnaPopulationEntrantAuthoritySuccessor } from "./dna-population-entrant-authority-successor-plan";
import { verifyDnaPopulationEntrantAuthoritySuccessorPublication } from "./dna-population-entrant-authority-successor-publication";
import {
  isDnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityResolvedRecord,
} from "./dna-population-entrant-authority-record";
import type { DnaPopulationEntrantAuthorityR2RecoveryPort } from "./dna-population-entrant-authority-recovery";
import { replayDnaPopulationEntrantAuthority } from "./dna-population-entrant-authority-replay";
import { loadDnaPopulationCoreHistoryEntrantAuthority } from "./dna-population-core-history-entrant-source";
import { DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS } from "./dna-population-race-index-r2-chunk";

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaPopulationEntrantAuthoritySuccessorReplacementCandidate =
  Readonly<{
    version: 1;
    status: "ready";
    observedAt: string;
    baseGenerationId: string;
    baseRecordSetSha256: string;
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    replacements: readonly DnaPopulationEntrantAuthorityResolvedRecord[];
    providerRequestPerformed: false;
    persistentWritePerformed: false;
    providerWritePerformed: false;
    paidUsageAllowed: false;
  }>;

/**
 * Supplies already-retained replacement evidence. Implementations must not
 * contact DNA or persist anything during inspection. The readiness source
 * independently proves that every returned record is a strictly newer,
 * uniquely resolved replacement for an exact quarantined base identity.
 */
export type DnaPopulationEntrantAuthoritySuccessorReplacementSource = Readonly<{
  inspect: (request: {
    ownerId: string;
    exactCodeHeadSha: string;
    baseGenerationId: string;
    baseRecordSetSha256: string;
    unresolvedRaceCount: number;
    unresolvedRaceSetSha256: string;
    quarantinedRaceIds: readonly string[];
  }) => Promise<DnaPopulationEntrantAuthoritySuccessorReplacementCandidate>;
}>;

export type DnaPopulationEntrantAuthoritySuccessorReadinessDiagnostic =
  | "invalid_configuration"
  | "request_binding_mismatch"
  | "base_authority_unavailable"
  | "base_authority_incomplete"
  | "replacement_authority_unavailable"
  | "replacement_authority_mismatch"
  | "replacement_authority_empty"
  | "successor_candidate_unavailable";

export class DnaPopulationEntrantAuthoritySuccessorReadinessError extends Error {
  readonly diagnostic: DnaPopulationEntrantAuthoritySuccessorReadinessDiagnostic;

  constructor(
    diagnostic: DnaPopulationEntrantAuthoritySuccessorReadinessDiagnostic,
  ) {
    super("Population entrant successor readiness is unavailable");
    this.name = "DnaPopulationEntrantAuthoritySuccessorReadinessError";
    this.diagnostic = diagnostic;
  }
}

function readinessError(
  diagnostic: DnaPopulationEntrantAuthoritySuccessorReadinessDiagnostic,
): never {
  throw new DnaPopulationEntrantAuthoritySuccessorReadinessError(diagnostic);
}

function identity(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    readinessError("invalid_configuration");
  }
  return value;
}

function exactHead(value: string): string {
  if (
    typeof value !== "string" ||
    value.toLowerCase() !== value ||
    !COMMIT_PATTERN.test(value)
  ) {
    readinessError("invalid_configuration");
  }
  return value;
}

function exactTimestamp(value: string): string {
  if (typeof value !== "string") {
    readinessError("replacement_authority_mismatch");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    readinessError("replacement_authority_mismatch");
  }
  return parsed.toISOString();
}

function inspectionTimestamp(now: () => Date): string {
  let value: Date;
  try {
    value = now();
  } catch {
    readinessError("invalid_configuration");
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    readinessError("invalid_configuration");
  }
  return value.toISOString();
}

function chunks(input: {
  generationId: string;
  records: Parameters<
    typeof buildDnaPopulationEntrantAuthorityChunk
  >[0]["records"];
}): readonly DnaPopulationEntrantAuthorityChunk[] {
  const output: DnaPopulationEntrantAuthorityChunk[] = [];
  for (
    let offset = 0;
    offset < input.records.length;
    offset += DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS
  ) {
    output.push(
      buildDnaPopulationEntrantAuthorityChunk({
        generationId: input.generationId,
        chunkOrdinal: output.length + 1,
        records: input.records.slice(
          offset,
          offset + DNA_POPULATION_RACE_INDEX_R2_CHUNK_MAXIMUM_ROWS,
        ),
      }),
    );
  }
  if (output.length < 1) {
    readinessError("successor_candidate_unavailable");
  }
  return Object.freeze(output);
}

/**
 * Reconstructs one exact completed v1 entrant archive, consumes only already
 * retained replacement evidence, and independently proves the complete
 * successor archive. Inspection performs no DNA request or persistent write.
 */
export function createDnaPopulationEntrantAuthoritySuccessorReadinessSource(input: {
  configuredOwnerId: string;
  exactCodeHeadSha: string;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
  baseCheckpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests"
  >;
  baseR2Store: DnaPopulationEntrantAuthorityR2RecoveryPort;
  replacementSource: DnaPopulationEntrantAuthoritySuccessorReplacementSource;
  now?: () => Date;
}): DnaPopulationEntrantAuthoritySuccessorReadinessSource {
  const ownerId = identity(input.configuredOwnerId);
  const configuredHead = exactHead(input.exactCodeHeadSha);
  const now = input.now ?? (() => new Date());

  return Object.freeze({
    async inspect(request) {
      if (
        identity(request.ownerId) !== ownerId ||
        exactHead(request.exactCodeHeadSha) !== configuredHead
      ) {
        readinessError("request_binding_mismatch");
      }

      let audit: Awaited<ReturnType<typeof input.authoritySource.load>>;
      let base: Awaited<
        ReturnType<typeof loadDnaPopulationCoreHistoryEntrantAuthority>
      >;
      try {
        audit = await input.authoritySource.load({
          ownerId,
          exactCodeHeadSha: configuredHead,
        });
        if (audit.exactCodeHeadSha !== configuredHead) {
          readinessError("base_authority_unavailable");
        }
        base = await loadDnaPopulationCoreHistoryEntrantAuthority({
          ownerId,
          authority: audit.authority,
          checkpointRepository: input.baseCheckpointRepository,
          r2Store: input.baseR2Store,
        });
      } catch (error) {
        if (
          error instanceof DnaPopulationEntrantAuthoritySuccessorReadinessError
        ) {
          throw error;
        }
        readinessError("base_authority_unavailable");
      }

      let replay: ReturnType<typeof replayDnaPopulationEntrantAuthority>;
      try {
        replay = replayDnaPopulationEntrantAuthority({
          records: base.records,
          expectedUnresolvedRaceCount: audit.authority.unresolvedRaceCount,
          expectedUnresolvedRaceSetSha256:
            audit.authority.unresolvedRaceSetSha256,
        });
      } catch {
        readinessError("base_authority_incomplete");
      }
      if (
        replay.exactReplayDuplicateCount !== 0 ||
        replay.quarantinedRaceCount < 1 ||
        replay.authority.unresolvedRaceCount !== base.recoveredRaceCount
      ) {
        readinessError("base_authority_incomplete");
      }

      const quarantinedRaceIds = Object.freeze(
        base.records
          .filter(isDnaPopulationEntrantAuthorityQuarantineRecord)
          .map((record) => record.sourceRaceId),
      );
      let replacementCandidate: DnaPopulationEntrantAuthoritySuccessorReplacementCandidate;
      try {
        replacementCandidate = await input.replacementSource.inspect({
          ownerId,
          exactCodeHeadSha: configuredHead,
          baseGenerationId: audit.authority.generationId,
          baseRecordSetSha256: replay.recordSetSha256,
          unresolvedRaceCount: audit.authority.unresolvedRaceCount,
          unresolvedRaceSetSha256: audit.authority.unresolvedRaceSetSha256,
          quarantinedRaceIds,
        });
      } catch {
        readinessError("replacement_authority_unavailable");
      }

      const replacementObservedAt = exactTimestamp(
        replacementCandidate.observedAt,
      );
      if (
        replacementCandidate.version !== 1 ||
        replacementCandidate.status !== "ready" ||
        replacementCandidate.baseGenerationId !==
          audit.authority.generationId ||
        replacementCandidate.baseRecordSetSha256 !== replay.recordSetSha256 ||
        replacementCandidate.unresolvedRaceCount !==
          audit.authority.unresolvedRaceCount ||
        replacementCandidate.unresolvedRaceSetSha256 !==
          audit.authority.unresolvedRaceSetSha256 ||
        replacementCandidate.providerRequestPerformed !== false ||
        replacementCandidate.persistentWritePerformed !== false ||
        replacementCandidate.providerWritePerformed !== false ||
        replacementCandidate.paidUsageAllowed !== false
      ) {
        readinessError("replacement_authority_mismatch");
      }
      if (replacementCandidate.replacements.length < 1) {
        readinessError("replacement_authority_empty");
      }

      const observedAt = inspectionTimestamp(now);
      if (Date.parse(replacementObservedAt) > Date.parse(observedAt)) {
        readinessError("replacement_authority_mismatch");
      }

      try {
        const plan = planDnaPopulationEntrantAuthoritySuccessor({
          baseGenerationId: audit.authority.generationId,
          baseRecords: base.records,
          expectedUnresolvedRaceCount: audit.authority.unresolvedRaceCount,
          expectedUnresolvedRaceSetSha256:
            audit.authority.unresolvedRaceSetSha256,
          expectedBaseRecordSetSha256: replay.recordSetSha256,
          replacements: replacementCandidate.replacements,
        });
        const successorChunks = chunks({
          generationId: plan.successorGenerationId,
          records: plan.records,
        });
        const publicationProof =
          verifyDnaPopulationEntrantAuthoritySuccessorPublication({
            baseGenerationId: audit.authority.generationId,
            baseRecords: base.records,
            expectedUnresolvedRaceCount: audit.authority.unresolvedRaceCount,
            expectedUnresolvedRaceSetSha256:
              audit.authority.unresolvedRaceSetSha256,
            expectedBaseRecordSetSha256: replay.recordSetSha256,
            replacements: replacementCandidate.replacements,
            successorChunks,
          });
        const authority =
          createDnaPopulationEntrantAuthoritySuccessorCheckpointAuthority(plan);

        return Object.freeze({
          version: 1 as const,
          status: "ready" as const,
          exactCodeHeadSha: configuredHead,
          observedAt,
          authority,
          publicationProof,
          successorChunks,
          previewOnly: true as const,
          providerRequestPerformed: false as const,
          persistentWritePerformed: false as const,
          providerWritePerformed: false as const,
          publicationActivated: false as const,
          lastGoodBasePreserved: true as const,
          paidUsageAllowed: false as const,
        });
      } catch (error) {
        if (
          error instanceof DnaPopulationEntrantAuthoritySuccessorReadinessError
        ) {
          throw error;
        }
        readinessError("successor_candidate_unavailable");
      }
    },
  });
}
