import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { buildDnaPopulationEntrantAuthorityChunk } from "@/lib/dna-population-entrant-authority-archive";
import {
  createDnaPopulationEntrantAuthoritySuccessorCheckpointAuthority,
  type DnaPopulationEntrantAuthoritySuccessorCheckpoint,
  type DnaPopulationEntrantAuthoritySuccessorCheckpointRepository,
} from "@/lib/dna-population-entrant-authority-successor-checkpoint";
import {
  createDnaPopulationEntrantAuthoritySuccessorCommissioning,
  dnaPopulationEntrantAuthoritySuccessorAuthoritySha256,
  dnaPopulationEntrantAuthoritySuccessorPublicationProofSha256,
  DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_VERSION,
  DnaPopulationEntrantAuthoritySuccessorCommissioningError,
  type DnaPopulationEntrantAuthoritySuccessorCommissioningInvocation,
} from "@/lib/dna-population-entrant-authority-successor-commissioning";
import type {
  DnaPopulationEntrantAuthoritySuccessorCapacityApproval,
  DnaPopulationEntrantAuthoritySuccessorR2CommitPort,
} from "@/lib/dna-population-entrant-authority-successor-commit-protocol";
import { dnaPopulationEntrantAuthorityRaceSetSha256 } from "@/lib/dna-population-entrant-authority-cohort";
import {
  dnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityRecord,
  type DnaPopulationEntrantAuthorityResolvedRecord,
} from "@/lib/dna-population-entrant-authority-record";
import { replayDnaPopulationEntrantAuthority } from "@/lib/dna-population-entrant-authority-replay";
import { planDnaPopulationEntrantAuthoritySuccessor } from "@/lib/dna-population-entrant-authority-successor-plan";
import { verifyDnaPopulationEntrantAuthoritySuccessorPublication } from "@/lib/dna-population-entrant-authority-successor-publication";

const HEAD = "a".repeat(40);
const OWNER = "private-owner";
const BASE_AT = "2026-10-01T00:00:00.000Z";
const REPLACED_AT = "2026-10-01T00:01:00.000Z";
const READINESS_AT = "2026-10-01T00:02:00.000Z";
const CAPACITY_AT = "2026-10-01T00:03:00.000Z";
const COMMITTED_AT = "2026-10-01T00:04:00.000Z";

function resolved(
  sourceRaceId: string,
  observedAt = BASE_AT,
): DnaPopulationEntrantAuthorityResolvedRecord {
  return Object.freeze({
    sourceRaceId,
    observedAt,
    rawEvidenceSha256: createHash("sha256").update(sourceRaceId).digest("hex"),
    mode: "bike" as const,
    entrantCoreIds: Object.freeze(["1", "2"]),
  });
}

function fixture() {
  const baseRecords: readonly DnaPopulationEntrantAuthorityRecord[] =
    Object.freeze([
      resolved("race-1"),
      dnaPopulationEntrantAuthorityQuarantineRecord({
        sourceRaceId: "race-2",
        observedAt: BASE_AT,
        quarantineReason: "entrant_authority_unresolved",
        sourceEvidenceSha256: "b".repeat(64),
      }),
    ]);
  const unresolvedRaceSetSha256 = dnaPopulationEntrantAuthorityRaceSetSha256(
    baseRecords.map((record) => record.sourceRaceId),
  );
  const base = replayDnaPopulationEntrantAuthority({
    records: baseRecords,
    expectedUnresolvedRaceCount: baseRecords.length,
    expectedUnresolvedRaceSetSha256: unresolvedRaceSetSha256,
  });
  const replacements = Object.freeze([resolved("race-2", REPLACED_AT)]);
  const plan = planDnaPopulationEntrantAuthoritySuccessor({
    baseGenerationId: unresolvedRaceSetSha256,
    baseRecords,
    expectedUnresolvedRaceCount: baseRecords.length,
    expectedUnresolvedRaceSetSha256: unresolvedRaceSetSha256,
    expectedBaseRecordSetSha256: base.recordSetSha256,
    replacements,
  });
  const successorChunks = Object.freeze([
    buildDnaPopulationEntrantAuthorityChunk({
      generationId: plan.successorGenerationId,
      chunkOrdinal: 1,
      records: plan.records,
    }),
  ]);
  const publicationProof =
    verifyDnaPopulationEntrantAuthoritySuccessorPublication({
      baseGenerationId: unresolvedRaceSetSha256,
      baseRecords,
      expectedUnresolvedRaceCount: baseRecords.length,
      expectedUnresolvedRaceSetSha256: unresolvedRaceSetSha256,
      expectedBaseRecordSetSha256: base.recordSetSha256,
      replacements,
      successorChunks,
    });
  const authority =
    createDnaPopulationEntrantAuthoritySuccessorCheckpointAuthority(plan);
  return { authority, publicationProof, successorChunks };
}

const FIXTURE = fixture();

const INVOCATION: DnaPopulationEntrantAuthoritySuccessorCommissioningInvocation =
  Object.freeze({
    commandVersion:
      DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_VERSION,
    intent: DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_INTENT,
    allowPersistentWrite: true,
    exactCodeHeadSha: HEAD,
    expectedSuccessorAuthoritySha256:
      dnaPopulationEntrantAuthoritySuccessorAuthoritySha256(FIXTURE.authority),
    expectedPublicationProofSha256:
      dnaPopulationEntrantAuthoritySuccessorPublicationProofSha256(
        FIXTURE.publicationProof,
      ),
  });

function checkpoint(
  chunkCount: number,
): DnaPopulationEntrantAuthoritySuccessorCheckpoint {
  return Object.freeze({
    ...FIXTURE.authority,
    chunkCount,
    persistedRaceCount: chunkCount === 0 ? 0 : 2,
    lastSourceRaceId: chunkCount === 0 ? null : "race-2",
    startedAt: READINESS_AT,
    updatedAt: chunkCount === 0 ? READINESS_AT : COMMITTED_AT,
  });
}

function harness() {
  const events: string[] = [];
  let currentMainSha = HEAD;
  let nowAt = COMMITTED_AT;
  const capacityApproval: DnaPopulationEntrantAuthoritySuccessorCapacityApproval =
    Object.freeze({
      version: 1 as const,
      successorGenerationId: FIXTURE.authority.successorGenerationId,
      successorRecordSetSha256: FIXTURE.authority.successorRecordSetSha256,
      unresolvedRaceCount: FIXTURE.authority.unresolvedRaceCount,
      observedAt: CAPACITY_AT,
      capacityAllowed: true as const,
      paidUsageAllowed: false as const,
    });
  const successorCommit = vi.fn(async (input) => {
    events.push("commit");
    const memoizedCapacity =
      await input.capacityGate.assertFreshCurrentCapacity(input.authority);
    expect(memoizedCapacity).toBe(capacityApproval);
    const receipt = Object.freeze({
      ...FIXTURE.successorChunks[0]!.receipt,
      objectKey: "private/successor/chunk-1.json",
    });
    return Object.freeze({
      checkpointBefore: checkpoint(0),
      checkpointAfter: checkpoint(1),
      receipts: Object.freeze([receipt]),
      storageStatuses: Object.freeze(["created" as const]),
      capacityObservedAt: CAPACITY_AT,
      resumedRegisteredChunkCount: 0,
      providerRequestPerformed: false as const,
      persistentWritePerformed: true as const,
      providerWritePerformed: false as const,
      publicationActivated: false as const,
      lastGoodBasePreserved: true as const,
      paidUsageAllowed: false as const,
    });
  });
  const checkpointRepository: DnaPopulationEntrantAuthoritySuccessorCheckpointRepository =
    Object.freeze({
      begin: vi.fn(),
      read: vi.fn(),
      listChunkManifests: vi.fn(),
      registerChunk: vi.fn(),
    });
  const r2Store: DnaPopulationEntrantAuthoritySuccessorR2CommitPort =
    Object.freeze({ write: vi.fn(), verify: vi.fn() });
  const mainGuard = Object.freeze({
    assertCurrentMain: vi.fn(async () => {
      events.push("main");
      return Object.freeze({ currentMainSha });
    }),
  });
  const inspect = vi.fn(async () => {
    events.push("readiness");
    return Object.freeze({
      version: 1 as const,
      status: "ready" as const,
      exactCodeHeadSha: HEAD,
      observedAt: READINESS_AT,
      authority: FIXTURE.authority,
      publicationProof: FIXTURE.publicationProof,
      successorChunks: FIXTURE.successorChunks,
      previewOnly: true as const,
      providerRequestPerformed: false as const,
      persistentWritePerformed: false as const,
      providerWritePerformed: false as const,
      publicationActivated: false as const,
      lastGoodBasePreserved: true as const,
      paidUsageAllowed: false as const,
    });
  });
  const assertFreshCurrentCapacity = vi.fn(async () => {
    events.push("capacity");
    return capacityApproval;
  });
  const command = createDnaPopulationEntrantAuthoritySuccessorCommissioning({
    configuredOwnerId: OWNER,
    runtimeCodeHeadSha: HEAD,
    mainGuard,
    readinessSource: { inspect },
    capacityGate: { assertFreshCurrentCapacity },
    checkpointRepository,
    r2Store,
    now: () => new Date(nowAt),
    successorCommit,
  });
  return {
    assertFreshCurrentCapacity,
    command,
    events,
    inspect,
    mainGuard,
    setCurrentMainSha(value: string) {
      currentMainSha = value;
    },
    setNowAt(value: string) {
      nowAt = value;
    },
    successorCommit,
  };
}

describe("population entrant authority successor commissioning", () => {
  it("prepares read-only, rechecks exact main and delegates one R2-first/Neon-second commit", async () => {
    const test = harness();
    const session = await test.command.prepare(INVOCATION);

    expect(test.events).toEqual(["main", "readiness", "capacity"]);
    expect(session.prepared).toMatchObject({
      status: "prepared_uncommitted",
      exactCodeHeadSha: HEAD,
      unresolvedRaceCount: 2,
      replacementRaceCount: 1,
      quarantinedRaceCountBefore: 1,
      quarantinedRaceCountAfter: 0,
      chunkCount: 1,
      persistentWritePerformed: false,
      publicationActivated: false,
      paidUsageAllowed: false,
    });

    const receipt = await session.commit();

    expect(test.events).toEqual([
      "main",
      "readiness",
      "capacity",
      "main",
      "commit",
    ]);
    expect(test.assertFreshCurrentCapacity).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({
      status: "committed_unpublished",
      registeredChunkCount: 1,
      persistedRaceCount: 2,
      persistentWritePerformed: true,
      providerRequestPerformed: false,
      providerWritePerformed: false,
      publicationActivated: false,
      lastGoodBasePreserved: true,
      paidUsageAllowed: false,
    });
    expect(receipt).not.toHaveProperty("receipts");
    expect(receipt).not.toHaveProperty("successorChunks");
  });

  it("fails before readiness when the dispatch head is not the runtime head", async () => {
    const test = harness();

    await expect(
      test.command.prepare({
        ...INVOCATION,
        exactCodeHeadSha: "b".repeat(40),
      }),
    ).rejects.toMatchObject({ diagnostic: "exact_head_mismatch" });
    expect(test.mainGuard.assertCurrentMain).not.toHaveBeenCalled();
    expect(test.inspect).not.toHaveBeenCalled();
  });

  it("binds the complete successor authority and publication proof digests", async () => {
    const test = harness();

    await expect(
      test.command.prepare({
        ...INVOCATION,
        expectedSuccessorAuthoritySha256: "f".repeat(64),
      }),
    ).rejects.toMatchObject({ diagnostic: "readiness_binding_mismatch" });
    expect(test.assertFreshCurrentCapacity).not.toHaveBeenCalled();
    expect(test.successorCommit).not.toHaveBeenCalled();
  });

  it("rechecks current main immediately before the persistent phase", async () => {
    const test = harness();
    const session = await test.command.prepare(INVOCATION);
    test.setCurrentMainSha("c".repeat(40));

    await expect(session.commit()).rejects.toMatchObject({
      diagnostic: "exact_head_mismatch",
    });
    expect(test.successorCommit).not.toHaveBeenCalled();
  });

  it("refuses a commit after its A$0 capacity proof becomes stale", async () => {
    const test = harness();
    const session = await test.command.prepare(INVOCATION);
    test.setNowAt("2026-10-01T00:20:00.000Z");

    await expect(session.commit()).rejects.toMatchObject({
      diagnostic: "stale_readiness",
    });
    expect(test.mainGuard.assertCurrentMain).toHaveBeenCalledTimes(1);
    expect(test.successorCommit).not.toHaveBeenCalled();
  });

  it("sanitizes commit failures without exposing private storage evidence", async () => {
    const test = harness();
    test.successorCommit.mockRejectedValueOnce(
      new Error("private/object/key and provider response"),
    );
    const session = await test.command.prepare(INVOCATION);

    const error = await session.commit().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(
      DnaPopulationEntrantAuthoritySuccessorCommissioningError,
    );
    expect(error).toMatchObject({
      diagnostic: "successor_commit_unavailable",
      message: "Population entrant successor commissioning is unavailable",
    });
    expect(String(error)).not.toContain("private/object/key");
  });
});
