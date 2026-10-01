import { createHash } from "node:crypto";

import type { DnaPopulationEntrantAuthorityChunk } from "./dna-population-entrant-authority-archive";
import type { DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority } from "./dna-population-entrant-authority-successor-checkpoint";
import {
  commitDnaPopulationEntrantAuthoritySuccessor,
  type DnaPopulationEntrantAuthoritySuccessorCapacityApproval,
  type DnaPopulationEntrantAuthoritySuccessorCapacityGate,
  type DnaPopulationEntrantAuthoritySuccessorCommitResult,
  type DnaPopulationEntrantAuthoritySuccessorR2CommitPort,
} from "./dna-population-entrant-authority-successor-commit-protocol";
import type { DnaPopulationEntrantAuthoritySuccessorCheckpointRepository } from "./dna-population-entrant-authority-successor-checkpoint";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PUBLICATION_PROOF_VERSION,
  type DnaPopulationEntrantAuthoritySuccessorPublicationProof,
} from "./dna-population-entrant-authority-successor-publication";
import { DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS } from "./dna-open-lab-provider-capacity-preflight";

export const DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_VERSION =
  "dna-population-entrant-authority-successor-commissioning/v1" as const;
export const DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_INTENT =
  "commission_private_preview_entrant_authority_successor" as const;

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaPopulationEntrantAuthoritySuccessorReadinessCandidate =
  Readonly<{
    version: 1;
    status: "ready";
    exactCodeHeadSha: string;
    observedAt: string;
    authority: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority;
    publicationProof: DnaPopulationEntrantAuthoritySuccessorPublicationProof;
    successorChunks: readonly DnaPopulationEntrantAuthorityChunk[];
    previewOnly: true;
    providerRequestPerformed: false;
    persistentWritePerformed: false;
    providerWritePerformed: false;
    publicationActivated: false;
    lastGoodBasePreserved: true;
    paidUsageAllowed: false;
  }>;

export type DnaPopulationEntrantAuthoritySuccessorReadinessSource = Readonly<{
  inspect: (request: {
    ownerId: string;
    exactCodeHeadSha: string;
  }) => Promise<DnaPopulationEntrantAuthoritySuccessorReadinessCandidate>;
}>;

export type DnaPopulationEntrantAuthorityExactMainGuard = Readonly<{
  assertCurrentMain: (expectedHeadSha: string) => Promise<{
    currentMainSha: string;
  }>;
}>;

export type DnaPopulationEntrantAuthoritySuccessorCommissioningInvocation =
  Readonly<{
    commandVersion: typeof DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_VERSION;
    intent: typeof DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_INTENT;
    allowPersistentWrite: true;
    exactCodeHeadSha: string;
    expectedSuccessorAuthoritySha256: string;
    expectedPublicationProofSha256: string;
  }>;

export type DnaPopulationEntrantAuthoritySuccessorCommissioningPreparedReceipt =
  Readonly<{
    status: "prepared_uncommitted";
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
    persistentWriteArmed: true;
    previewOnly: true;
    providerRequestPerformed: false;
    persistentWritePerformed: false;
    providerWritePerformed: false;
    publicationActivated: false;
    lastGoodBasePreserved: true;
    paidUsageAllowed: false;
  }>;

export type DnaPopulationEntrantAuthoritySuccessorCommissioningReceipt =
  Readonly<{
    status: "committed_unpublished";
    exactCodeHeadSha: string;
    successorAuthoritySha256: string;
    publicationProofSha256: string;
    successorGenerationId: string;
    successorRecordSetSha256: string;
    unresolvedRaceCount: number;
    replacementRaceCount: number;
    quarantinedRaceCountAfter: number;
    chunkCount: number;
    resumedRegisteredChunkCount: number;
    registeredChunkCount: number;
    persistedRaceCount: number;
    readinessObservedAt: string;
    capacityObservedAt: string;
    committedAt: string;
    persistentWriteArmed: true;
    previewOnly: true;
    providerRequestPerformed: false;
    persistentWritePerformed: true;
    providerWritePerformed: false;
    publicationActivated: false;
    lastGoodBasePreserved: true;
    paidUsageAllowed: false;
  }>;

export type DnaPopulationEntrantAuthoritySuccessorCommissioningSession =
  Readonly<{
    prepared: DnaPopulationEntrantAuthoritySuccessorCommissioningPreparedReceipt;
    commit: () => Promise<DnaPopulationEntrantAuthoritySuccessorCommissioningReceipt>;
  }>;

export type DnaPopulationEntrantAuthoritySuccessorCommissioningDiagnostic =
  | "invalid_configuration"
  | "not_explicitly_armed"
  | "exact_head_mismatch"
  | "main_guard_unavailable"
  | "readiness_unavailable"
  | "readiness_binding_mismatch"
  | "stale_readiness"
  | "capacity_unavailable"
  | "capacity_binding_mismatch"
  | "stale_capacity"
  | "successor_commit_unavailable";

export class DnaPopulationEntrantAuthoritySuccessorCommissioningError extends Error {
  readonly diagnostic: DnaPopulationEntrantAuthoritySuccessorCommissioningDiagnostic;

  constructor(
    diagnostic: DnaPopulationEntrantAuthoritySuccessorCommissioningDiagnostic,
  ) {
    super("Population entrant successor commissioning is unavailable");
    this.name = "DnaPopulationEntrantAuthoritySuccessorCommissioningError";
    this.diagnostic = diagnostic;
  }
}

type SuccessorCommit = (
  input: Parameters<typeof commitDnaPopulationEntrantAuthoritySuccessor>[0],
) => Promise<DnaPopulationEntrantAuthoritySuccessorCommitResult>;

function commissioningError(
  diagnostic: DnaPopulationEntrantAuthoritySuccessorCommissioningDiagnostic,
): never {
  throw new DnaPopulationEntrantAuthoritySuccessorCommissioningError(
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
    commissioningError("invalid_configuration");
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
    commissioningError(diagnostic);
  }
  return value;
}

function sha256(
  value: string,
  diagnostic:
    | "invalid_configuration"
    | "readiness_binding_mismatch"
    | "capacity_binding_mismatch",
): string {
  if (
    typeof value !== "string" ||
    value.toLowerCase() !== value ||
    !SHA_256_PATTERN.test(value)
  ) {
    commissioningError(diagnostic);
  }
  return value;
}

function exactTimestamp(
  value: string,
  diagnostic: "readiness_binding_mismatch" | "capacity_binding_mismatch",
): string {
  if (typeof value !== "string") commissioningError(diagnostic);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    commissioningError(diagnostic);
  }
  return parsed.toISOString();
}

function checkedAt(now: () => Date): string {
  let value: Date;
  try {
    value = now();
  } catch {
    commissioningError("invalid_configuration");
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    commissioningError("invalid_configuration");
  }
  return value.toISOString();
}

function assertFresh(input: {
  observedAt: string;
  checkedAt: string;
  diagnostic: "stale_readiness" | "stale_capacity";
}): void {
  const observed = Date.parse(input.observedAt);
  const checked = Date.parse(input.checkedAt);
  if (
    observed > checked ||
    checked - observed > DNA_OPEN_LAB_PROVIDER_CAPACITY_MAXIMUM_AGE_MILLISECONDS
  ) {
    commissioningError(input.diagnostic);
  }
}

function canonicalSha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

export function dnaPopulationEntrantAuthoritySuccessorAuthoritySha256(
  authority: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority,
): string {
  return canonicalSha256({
    version: authority.version,
    baseGenerationId: authority.baseGenerationId,
    baseRecordSetSha256: authority.baseRecordSetSha256,
    successorGenerationId: authority.successorGenerationId,
    successorRecordSetSha256: authority.successorRecordSetSha256,
    unresolvedRaceCount: authority.unresolvedRaceCount,
    unresolvedRaceSetSha256: authority.unresolvedRaceSetSha256,
    replacementRaceCount: authority.replacementRaceCount,
    replacementRaceSetSha256: authority.replacementRaceSetSha256,
    replacementRecordSetSha256: authority.replacementRecordSetSha256,
    quarantinedRaceCountBefore: authority.quarantinedRaceCountBefore,
    quarantinedRaceCountAfter: authority.quarantinedRaceCountAfter,
  });
}

export function dnaPopulationEntrantAuthoritySuccessorPublicationProofSha256(
  proof: DnaPopulationEntrantAuthoritySuccessorPublicationProof,
): string {
  return canonicalSha256({
    version: proof.version,
    baseGenerationId: proof.baseGenerationId,
    baseRecordSetSha256: proof.baseRecordSetSha256,
    successorGenerationId: proof.successorGenerationId,
    successorRecordSetSha256: proof.successorRecordSetSha256,
    unresolvedRaceCount: proof.unresolvedRaceCount,
    unresolvedRaceSetSha256: proof.unresolvedRaceSetSha256,
    replacementRaceCount: proof.replacementRaceCount,
    replacementRaceSetSha256: proof.replacementRaceSetSha256,
    replacementRecordSetSha256: proof.replacementRecordSetSha256,
    quarantinedRaceCountBefore: proof.quarantinedRaceCountBefore,
    quarantinedRaceCountAfter: proof.quarantinedRaceCountAfter,
    chunkCount: proof.chunkCount,
    archiveRecordSetSha256: proof.archiveRecordSetSha256,
    publicationIntegrityStatus: proof.publicationIntegrityStatus,
    lastGoodBasePreserved: proof.lastGoodBasePreserved,
    providerRequestPerformed: proof.providerRequestPerformed,
    persistentWritePerformed: proof.persistentWritePerformed,
    publicationAllowed: proof.publicationAllowed,
    paidUsageAllowed: proof.paidUsageAllowed,
  });
}

function validateReadiness(input: {
  candidate: DnaPopulationEntrantAuthoritySuccessorReadinessCandidate;
  exactCodeHeadSha: string;
  expectedSuccessorAuthoritySha256: string;
  expectedPublicationProofSha256: string;
}): Readonly<{
  observedAt: string;
  successorAuthoritySha256: string;
  publicationProofSha256: string;
}> {
  const candidate = input.candidate;
  const authority = candidate.authority;
  const proof = candidate.publicationProof;
  if (
    candidate.version !== 1 ||
    candidate.status !== "ready" ||
    candidate.exactCodeHeadSha !== input.exactCodeHeadSha ||
    candidate.previewOnly !== true ||
    candidate.providerRequestPerformed !== false ||
    candidate.persistentWritePerformed !== false ||
    candidate.providerWritePerformed !== false ||
    candidate.publicationActivated !== false ||
    candidate.lastGoodBasePreserved !== true ||
    candidate.paidUsageAllowed !== false ||
    candidate.successorChunks.length < 1 ||
    authority.version !==
      "dna-population-entrant-authority-successor-checkpoint/v1" ||
    !SHA_256_PATTERN.test(authority.baseGenerationId) ||
    !SHA_256_PATTERN.test(authority.baseRecordSetSha256) ||
    !SHA_256_PATTERN.test(authority.successorGenerationId) ||
    !SHA_256_PATTERN.test(authority.successorRecordSetSha256) ||
    !SHA_256_PATTERN.test(authority.unresolvedRaceSetSha256) ||
    !SHA_256_PATTERN.test(authority.replacementRaceSetSha256) ||
    !SHA_256_PATTERN.test(authority.replacementRecordSetSha256) ||
    !Number.isSafeInteger(authority.unresolvedRaceCount) ||
    authority.unresolvedRaceCount < 1 ||
    !Number.isSafeInteger(authority.replacementRaceCount) ||
    authority.replacementRaceCount < 1 ||
    !Number.isSafeInteger(authority.quarantinedRaceCountBefore) ||
    authority.quarantinedRaceCountBefore < 1 ||
    !Number.isSafeInteger(authority.quarantinedRaceCountAfter) ||
    authority.quarantinedRaceCountAfter < 0 ||
    authority.baseGenerationId !== authority.unresolvedRaceSetSha256 ||
    authority.successorGenerationId === authority.baseGenerationId ||
    authority.replacementRaceCount > authority.unresolvedRaceCount ||
    authority.quarantinedRaceCountBefore -
      authority.quarantinedRaceCountAfter !==
      authority.replacementRaceCount ||
    proof.version !==
      DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_PUBLICATION_PROOF_VERSION ||
    proof.baseGenerationId !== authority.baseGenerationId ||
    proof.baseRecordSetSha256 !== authority.baseRecordSetSha256 ||
    proof.successorGenerationId !== authority.successorGenerationId ||
    proof.successorRecordSetSha256 !== authority.successorRecordSetSha256 ||
    proof.unresolvedRaceCount !== authority.unresolvedRaceCount ||
    proof.unresolvedRaceSetSha256 !== authority.unresolvedRaceSetSha256 ||
    proof.replacementRaceCount !== authority.replacementRaceCount ||
    proof.replacementRaceSetSha256 !== authority.replacementRaceSetSha256 ||
    proof.replacementRecordSetSha256 !== authority.replacementRecordSetSha256 ||
    proof.quarantinedRaceCountBefore !== authority.quarantinedRaceCountBefore ||
    proof.quarantinedRaceCountAfter !== authority.quarantinedRaceCountAfter ||
    proof.chunkCount !== candidate.successorChunks.length ||
    proof.publicationIntegrityStatus !== "proven_immutable_successor_archive" ||
    proof.lastGoodBasePreserved !== true ||
    proof.providerRequestPerformed !== false ||
    proof.persistentWritePerformed !== false ||
    proof.publicationAllowed !== false ||
    proof.paidUsageAllowed !== false ||
    candidate.successorChunks.some(
      (chunk, index) =>
        chunk.receipt.generationId !== authority.successorGenerationId ||
        chunk.receipt.chunkOrdinal !== index + 1,
    )
  ) {
    commissioningError("readiness_binding_mismatch");
  }
  const successorAuthoritySha256 =
    dnaPopulationEntrantAuthoritySuccessorAuthoritySha256(candidate.authority);
  const publicationProofSha256 =
    dnaPopulationEntrantAuthoritySuccessorPublicationProofSha256(
      candidate.publicationProof,
    );
  if (
    successorAuthoritySha256 !== input.expectedSuccessorAuthoritySha256 ||
    publicationProofSha256 !== input.expectedPublicationProofSha256
  ) {
    commissioningError("readiness_binding_mismatch");
  }
  return Object.freeze({
    observedAt: exactTimestamp(
      candidate.observedAt,
      "readiness_binding_mismatch",
    ),
    successorAuthoritySha256,
    publicationProofSha256,
  });
}

function validateCapacity(input: {
  authority: DnaPopulationEntrantAuthoritySuccessorCheckpointAuthority;
  approval: DnaPopulationEntrantAuthoritySuccessorCapacityApproval;
}): string {
  const approval = input.approval;
  if (
    approval.version !== 1 ||
    approval.successorGenerationId !== input.authority.successorGenerationId ||
    approval.successorRecordSetSha256 !==
      input.authority.successorRecordSetSha256 ||
    approval.unresolvedRaceCount !== input.authority.unresolvedRaceCount ||
    approval.capacityAllowed !== true ||
    approval.paidUsageAllowed !== false
  ) {
    commissioningError("capacity_binding_mismatch");
  }
  return exactTimestamp(approval.observedAt, "capacity_binding_mismatch");
}

async function assertCurrentMain(input: {
  guard: DnaPopulationEntrantAuthorityExactMainGuard;
  expectedHeadSha: string;
}): Promise<void> {
  try {
    const result = await input.guard.assertCurrentMain(input.expectedHeadSha);
    if (
      exactHead(result.currentMainSha, "exact_head_mismatch") !==
      input.expectedHeadSha
    ) {
      commissioningError("exact_head_mismatch");
    }
  } catch (error) {
    if (
      error instanceof DnaPopulationEntrantAuthoritySuccessorCommissioningError
    ) {
      throw error;
    }
    commissioningError("main_guard_unavailable");
  }
}

/**
 * Creates a dormant, exact-main private Preview commissioning boundary.
 *
 * Preparation is read-only and returns no archive rows or private R2 object
 * keys. The commit closure remains separately owner-gated. It rechecks main,
 * rejects stale readiness/capacity, and delegates the only persistent phase to
 * the proven R2-first/Neon-second successor protocol. No route, schedule or
 * workflow imports this command.
 */
export function createDnaPopulationEntrantAuthoritySuccessorCommissioning(input: {
  configuredOwnerId: string;
  runtimeCodeHeadSha: string;
  mainGuard: DnaPopulationEntrantAuthorityExactMainGuard;
  readinessSource: DnaPopulationEntrantAuthoritySuccessorReadinessSource;
  capacityGate: DnaPopulationEntrantAuthoritySuccessorCapacityGate;
  checkpointRepository: DnaPopulationEntrantAuthoritySuccessorCheckpointRepository;
  r2Store: DnaPopulationEntrantAuthoritySuccessorR2CommitPort;
  now?: () => Date;
  successorCommit?: SuccessorCommit;
}): Readonly<{
  prepare: (
    invocation: DnaPopulationEntrantAuthoritySuccessorCommissioningInvocation,
  ) => Promise<DnaPopulationEntrantAuthoritySuccessorCommissioningSession>;
}> {
  const ownerId = identity(input.configuredOwnerId);
  const runtimeCodeHeadSha = exactHead(
    input.runtimeCodeHeadSha,
    "invalid_configuration",
  );
  const now = input.now ?? (() => new Date());
  const successorCommit =
    input.successorCommit ?? commitDnaPopulationEntrantAuthoritySuccessor;

  return Object.freeze({
    async prepare(invocation) {
      if (
        invocation.commandVersion !==
          DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_VERSION ||
        invocation.intent !==
          DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_INTENT ||
        invocation.allowPersistentWrite !== true
      ) {
        commissioningError("not_explicitly_armed");
      }
      const exactCodeHeadSha = exactHead(
        invocation.exactCodeHeadSha,
        "exact_head_mismatch",
      );
      if (exactCodeHeadSha !== runtimeCodeHeadSha) {
        commissioningError("exact_head_mismatch");
      }
      const expectedSuccessorAuthoritySha256 = sha256(
        invocation.expectedSuccessorAuthoritySha256,
        "invalid_configuration",
      );
      const expectedPublicationProofSha256 = sha256(
        invocation.expectedPublicationProofSha256,
        "invalid_configuration",
      );

      await assertCurrentMain({
        guard: input.mainGuard,
        expectedHeadSha: exactCodeHeadSha,
      });

      let candidate: DnaPopulationEntrantAuthoritySuccessorReadinessCandidate;
      try {
        candidate = await input.readinessSource.inspect({
          ownerId,
          exactCodeHeadSha,
        });
      } catch {
        commissioningError("readiness_unavailable");
      }
      const readiness = validateReadiness({
        candidate,
        exactCodeHeadSha,
        expectedSuccessorAuthoritySha256,
        expectedPublicationProofSha256,
      });

      let capacityApproval: DnaPopulationEntrantAuthoritySuccessorCapacityApproval;
      try {
        capacityApproval = await input.capacityGate.assertFreshCurrentCapacity(
          candidate.authority,
        );
      } catch {
        commissioningError("capacity_unavailable");
      }
      const capacityObservedAt = validateCapacity({
        authority: candidate.authority,
        approval: capacityApproval,
      });
      const preparedAt = checkedAt(now);
      assertFresh({
        observedAt: readiness.observedAt,
        checkedAt: preparedAt,
        diagnostic: "stale_readiness",
      });
      assertFresh({
        observedAt: capacityObservedAt,
        checkedAt: preparedAt,
        diagnostic: "stale_capacity",
      });
      if (Date.parse(capacityObservedAt) < Date.parse(readiness.observedAt)) {
        commissioningError("capacity_binding_mismatch");
      }

      const authority = candidate.authority;
      const prepared = Object.freeze({
        status: "prepared_uncommitted" as const,
        exactCodeHeadSha,
        successorAuthoritySha256: readiness.successorAuthoritySha256,
        publicationProofSha256: readiness.publicationProofSha256,
        successorGenerationId: authority.successorGenerationId,
        successorRecordSetSha256: authority.successorRecordSetSha256,
        unresolvedRaceCount: authority.unresolvedRaceCount,
        replacementRaceCount: authority.replacementRaceCount,
        quarantinedRaceCountBefore: authority.quarantinedRaceCountBefore,
        quarantinedRaceCountAfter: authority.quarantinedRaceCountAfter,
        chunkCount: candidate.successorChunks.length,
        readinessObservedAt: readiness.observedAt,
        capacityObservedAt,
        persistentWriteArmed: true as const,
        previewOnly: true as const,
        providerRequestPerformed: false as const,
        persistentWritePerformed: false as const,
        providerWritePerformed: false as const,
        publicationActivated: false as const,
        lastGoodBasePreserved: true as const,
        paidUsageAllowed: false as const,
      });

      return Object.freeze({
        prepared,
        async commit() {
          const committedAt = checkedAt(now);
          validateReadiness({
            candidate,
            exactCodeHeadSha,
            expectedSuccessorAuthoritySha256,
            expectedPublicationProofSha256,
          });
          const commitCapacityObservedAt = validateCapacity({
            authority: candidate.authority,
            approval: capacityApproval,
          });
          if (commitCapacityObservedAt !== capacityObservedAt) {
            commissioningError("capacity_binding_mismatch");
          }
          assertFresh({
            observedAt: readiness.observedAt,
            checkedAt: committedAt,
            diagnostic: "stale_readiness",
          });
          assertFresh({
            observedAt: capacityObservedAt,
            checkedAt: committedAt,
            diagnostic: "stale_capacity",
          });
          await assertCurrentMain({
            guard: input.mainGuard,
            expectedHeadSha: exactCodeHeadSha,
          });

          let committed: DnaPopulationEntrantAuthoritySuccessorCommitResult;
          try {
            committed = await successorCommit({
              ownerId,
              authority,
              publicationProof: candidate.publicationProof,
              successorChunks: candidate.successorChunks,
              capacityGate: Object.freeze({
                assertFreshCurrentCapacity: async () => capacityApproval,
              }),
              checkpointRepository: input.checkpointRepository,
              r2Store: input.r2Store,
              startedAt: readiness.observedAt,
              registeredAt: committedAt,
            });
          } catch {
            commissioningError("successor_commit_unavailable");
          }
          if (
            committed.providerRequestPerformed !== false ||
            committed.persistentWritePerformed !== true ||
            committed.providerWritePerformed !== false ||
            committed.publicationActivated !== false ||
            committed.lastGoodBasePreserved !== true ||
            committed.paidUsageAllowed !== false ||
            committed.capacityObservedAt !== capacityObservedAt ||
            committed.receipts.length !== candidate.successorChunks.length ||
            committed.checkpointAfter.chunkCount !==
              committed.receipts.length ||
            committed.checkpointAfter.persistedRaceCount !==
              authority.unresolvedRaceCount
          ) {
            commissioningError("successor_commit_unavailable");
          }

          return Object.freeze({
            status: "committed_unpublished" as const,
            exactCodeHeadSha,
            successorAuthoritySha256: readiness.successorAuthoritySha256,
            publicationProofSha256: readiness.publicationProofSha256,
            successorGenerationId: authority.successorGenerationId,
            successorRecordSetSha256: authority.successorRecordSetSha256,
            unresolvedRaceCount: authority.unresolvedRaceCount,
            replacementRaceCount: authority.replacementRaceCount,
            quarantinedRaceCountAfter: authority.quarantinedRaceCountAfter,
            chunkCount: committed.receipts.length,
            resumedRegisteredChunkCount: committed.resumedRegisteredChunkCount,
            registeredChunkCount: committed.checkpointAfter.chunkCount,
            persistedRaceCount: committed.checkpointAfter.persistedRaceCount,
            readinessObservedAt: readiness.observedAt,
            capacityObservedAt,
            committedAt,
            persistentWriteArmed: true as const,
            previewOnly: true as const,
            providerRequestPerformed: false as const,
            persistentWritePerformed: true as const,
            providerWritePerformed: false as const,
            publicationActivated: false as const,
            lastGoodBasePreserved: true as const,
            paidUsageAllowed: false as const,
          });
        },
      });
    },
  });
}
