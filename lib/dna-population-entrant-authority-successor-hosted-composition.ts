import type { DnaPopulationEntrantAuthorityCheckpointRepository } from "./dna-population-entrant-authority-checkpoint";
import type { DnaPopulationEntrantAuthorityLiveAuditSource } from "./dna-population-entrant-authority-cohort-command";
import {
  createDnaPopulationEntrantAuthoritySuccessorCommissioning,
  dnaPopulationEntrantAuthoritySuccessorAuthoritySha256,
  dnaPopulationEntrantAuthoritySuccessorPublicationProofSha256,
  type DnaPopulationEntrantAuthorityExactMainGuard,
  type DnaPopulationEntrantAuthoritySuccessorCommissioningInvocation,
  type DnaPopulationEntrantAuthoritySuccessorCommissioningSession,
} from "./dna-population-entrant-authority-successor-commissioning";
import type { DnaPopulationEntrantAuthoritySuccessorCheckpointRepository } from "./dna-population-entrant-authority-successor-checkpoint";
import type {
  DnaPopulationEntrantAuthoritySuccessorCapacityGate,
  DnaPopulationEntrantAuthoritySuccessorR2CommitPort,
} from "./dna-population-entrant-authority-successor-commit-protocol";
import {
  createDnaPopulationEntrantAuthoritySuccessorReadinessSource,
  type DnaPopulationEntrantAuthoritySuccessorReplacementSource,
} from "./dna-population-entrant-authority-successor-readiness-source";
import type { DnaPopulationEntrantAuthorityR2RecoveryPort } from "./dna-population-entrant-authority-recovery";

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaPopulationEntrantAuthoritySuccessorHostedReadinessReceipt =
  Readonly<{
    status: "ready_uncommitted";
    exactCodeHeadSha: string;
    successorAuthoritySha256: string;
    publicationProofSha256: string;
    successorGenerationId: string;
    successorRecordSetSha256: string;
    unresolvedRaceCount: number;
    replacementRaceCount: number;
    quarantinedRaceCountBefore: number;
    quarantinedRaceCountAfter: number;
    chunkCount: number;
    readinessObservedAt: string;
    capacityObservedAt: string;
    capacityAllowed: true;
    previewOnly: true;
    providerRequestPerformed: false;
    persistentWritePerformed: false;
    providerWritePerformed: false;
    publicationActivated: false;
    lastGoodBasePreserved: true;
    paidUsageAllowed: false;
  }>;

export type DnaPopulationEntrantAuthoritySuccessorHostedCompositionDiagnostic =
  | "invalid_configuration"
  | "main_guard_unavailable"
  | "exact_head_mismatch"
  | "readiness_unavailable"
  | "capacity_unavailable"
  | "capacity_binding_mismatch";

export class DnaPopulationEntrantAuthoritySuccessorHostedCompositionError extends Error {
  readonly diagnostic: DnaPopulationEntrantAuthoritySuccessorHostedCompositionDiagnostic;

  constructor(
    diagnostic: DnaPopulationEntrantAuthoritySuccessorHostedCompositionDiagnostic,
  ) {
    super("Population entrant successor hosted composition is unavailable");
    this.name = "DnaPopulationEntrantAuthoritySuccessorHostedCompositionError";
    this.diagnostic = diagnostic;
  }
}

function compositionError(
  diagnostic: DnaPopulationEntrantAuthoritySuccessorHostedCompositionDiagnostic,
): never {
  throw new DnaPopulationEntrantAuthoritySuccessorHostedCompositionError(
    diagnostic,
  );
}

function identity(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_PATTERN.test(value)
  ) {
    compositionError("invalid_configuration");
  }
  return value;
}

function exactHead(
  value: string,
  diagnostic: "invalid_configuration" | "exact_head_mismatch",
): string {
  if (
    typeof value !== "string" ||
    value.toLowerCase() !== value ||
    !COMMIT_PATTERN.test(value)
  ) {
    compositionError(diagnostic);
  }
  return value;
}

function timestamp(value: string): string {
  if (typeof value !== "string") {
    compositionError("capacity_binding_mismatch");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    compositionError("capacity_binding_mismatch");
  }
  return parsed.toISOString();
}

async function assertCurrentMain(input: {
  mainGuard: DnaPopulationEntrantAuthorityExactMainGuard;
  exactCodeHeadSha: string;
}): Promise<void> {
  try {
    const main = await input.mainGuard.assertCurrentMain(
      input.exactCodeHeadSha,
    );
    if (
      exactHead(main.currentMainSha, "exact_head_mismatch") !==
      input.exactCodeHeadSha
    ) {
      compositionError("exact_head_mismatch");
    }
  } catch (error) {
    if (
      error instanceof
      DnaPopulationEntrantAuthoritySuccessorHostedCompositionError
    ) {
      throw error;
    }
    compositionError("main_guard_unavailable");
  }
}

/**
 * Composes the private read-only successor inspection and dormant commissioning
 * command. Construction performs no I/O. Inspection exposes only aggregate
 * counts and digests; successor rows and private object keys stay internal.
 * No route, schedule, or workflow imports this composition.
 */
export function createDnaPopulationEntrantAuthoritySuccessorHostedComposition(input: {
  configuredOwnerId: string;
  exactCodeHeadSha: string;
  mainGuard: DnaPopulationEntrantAuthorityExactMainGuard;
  authoritySource: DnaPopulationEntrantAuthorityLiveAuditSource;
  baseCheckpointRepository: Pick<
    DnaPopulationEntrantAuthorityCheckpointRepository,
    "read" | "listChunkManifests"
  >;
  baseR2Store: DnaPopulationEntrantAuthorityR2RecoveryPort;
  replacementSource: DnaPopulationEntrantAuthoritySuccessorReplacementSource;
  capacityGate: DnaPopulationEntrantAuthoritySuccessorCapacityGate;
  successorCheckpointRepository: DnaPopulationEntrantAuthoritySuccessorCheckpointRepository;
  successorR2Store: DnaPopulationEntrantAuthoritySuccessorR2CommitPort;
  now?: () => Date;
}): Readonly<{
  inspectReadiness: () => Promise<DnaPopulationEntrantAuthoritySuccessorHostedReadinessReceipt>;
  prepare: (
    invocation: DnaPopulationEntrantAuthoritySuccessorCommissioningInvocation,
  ) => Promise<DnaPopulationEntrantAuthoritySuccessorCommissioningSession>;
}> {
  const ownerId = identity(input.configuredOwnerId);
  const exactCodeHeadSha = exactHead(
    input.exactCodeHeadSha,
    "invalid_configuration",
  );
  const readinessSource =
    createDnaPopulationEntrantAuthoritySuccessorReadinessSource({
      configuredOwnerId: ownerId,
      exactCodeHeadSha,
      authoritySource: input.authoritySource,
      baseCheckpointRepository: input.baseCheckpointRepository,
      baseR2Store: input.baseR2Store,
      replacementSource: input.replacementSource,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
  const commissioning =
    createDnaPopulationEntrantAuthoritySuccessorCommissioning({
      configuredOwnerId: ownerId,
      runtimeCodeHeadSha: exactCodeHeadSha,
      mainGuard: input.mainGuard,
      readinessSource,
      capacityGate: input.capacityGate,
      checkpointRepository: input.successorCheckpointRepository,
      r2Store: input.successorR2Store,
      ...(input.now === undefined ? {} : { now: input.now }),
    });

  return Object.freeze({
    async inspectReadiness() {
      await assertCurrentMain({
        mainGuard: input.mainGuard,
        exactCodeHeadSha,
      });
      let candidate: Awaited<ReturnType<typeof readinessSource.inspect>>;
      try {
        candidate = await readinessSource.inspect({
          ownerId,
          exactCodeHeadSha,
        });
      } catch {
        compositionError("readiness_unavailable");
      }

      let approval: Awaited<
        ReturnType<typeof input.capacityGate.assertFreshCurrentCapacity>
      >;
      try {
        approval = await input.capacityGate.assertFreshCurrentCapacity(
          candidate.authority,
        );
      } catch {
        compositionError("capacity_unavailable");
      }
      if (
        approval.version !== 1 ||
        approval.successorGenerationId !==
          candidate.authority.successorGenerationId ||
        approval.successorRecordSetSha256 !==
          candidate.authority.successorRecordSetSha256 ||
        approval.unresolvedRaceCount !==
          candidate.authority.unresolvedRaceCount ||
        approval.capacityAllowed !== true ||
        approval.paidUsageAllowed !== false
      ) {
        compositionError("capacity_binding_mismatch");
      }
      const capacityObservedAt = timestamp(approval.observedAt);
      if (Date.parse(capacityObservedAt) < Date.parse(candidate.observedAt)) {
        compositionError("capacity_binding_mismatch");
      }

      return Object.freeze({
        status: "ready_uncommitted" as const,
        exactCodeHeadSha,
        successorAuthoritySha256:
          dnaPopulationEntrantAuthoritySuccessorAuthoritySha256(
            candidate.authority,
          ),
        publicationProofSha256:
          dnaPopulationEntrantAuthoritySuccessorPublicationProofSha256(
            candidate.publicationProof,
          ),
        successorGenerationId: candidate.authority.successorGenerationId,
        successorRecordSetSha256: candidate.authority.successorRecordSetSha256,
        unresolvedRaceCount: candidate.authority.unresolvedRaceCount,
        replacementRaceCount: candidate.authority.replacementRaceCount,
        quarantinedRaceCountBefore:
          candidate.authority.quarantinedRaceCountBefore,
        quarantinedRaceCountAfter:
          candidate.authority.quarantinedRaceCountAfter,
        chunkCount: candidate.successorChunks.length,
        readinessObservedAt: candidate.observedAt,
        capacityObservedAt,
        capacityAllowed: true as const,
        previewOnly: true as const,
        providerRequestPerformed: false as const,
        persistentWritePerformed: false as const,
        providerWritePerformed: false as const,
        publicationActivated: false as const,
        lastGoodBasePreserved: true as const,
        paidUsageAllowed: false as const,
      });
    },
    prepare: commissioning.prepare,
  });
}
