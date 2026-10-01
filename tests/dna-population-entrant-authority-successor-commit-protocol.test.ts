import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { buildDnaPopulationEntrantAuthorityChunk } from "@/lib/dna-population-entrant-authority-archive";
import {
  commitDnaPopulationEntrantAuthoritySuccessor,
  type DnaPopulationEntrantAuthoritySuccessorCapacityGate,
  type DnaPopulationEntrantAuthoritySuccessorR2CommitPort,
} from "@/lib/dna-population-entrant-authority-successor-commit-protocol";
import {
  createDnaPopulationEntrantAuthoritySuccessorCheckpointAuthority,
  type DnaPopulationEntrantAuthoritySuccessorCheckpoint,
  type DnaPopulationEntrantAuthoritySuccessorCheckpointRepository,
  type DnaPopulationEntrantAuthoritySuccessorChunkManifest,
} from "@/lib/dna-population-entrant-authority-successor-checkpoint";
import { dnaPopulationEntrantAuthorityRaceSetSha256 } from "@/lib/dna-population-entrant-authority-cohort";
import {
  dnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityRecord,
  type DnaPopulationEntrantAuthorityResolvedRecord,
} from "@/lib/dna-population-entrant-authority-record";
import { replayDnaPopulationEntrantAuthority } from "@/lib/dna-population-entrant-authority-replay";
import { planDnaPopulationEntrantAuthoritySuccessor } from "@/lib/dna-population-entrant-authority-successor-plan";
import { verifyDnaPopulationEntrantAuthoritySuccessorPublication } from "@/lib/dna-population-entrant-authority-successor-publication";

const BASE_AT = "2026-10-01T00:00:00.000Z";
const REPLACED_AT = "2026-10-01T01:00:00.000Z";
const STARTED_AT = "2026-10-01T02:00:00.000Z";
const REGISTERED_AT = "2026-10-01T02:01:00.000Z";

function resolved(
  raceId: string,
  observedAt = BASE_AT,
  entrants: readonly string[] = ["1", "2"],
): DnaPopulationEntrantAuthorityResolvedRecord {
  return Object.freeze({
    sourceRaceId: raceId,
    observedAt,
    rawEvidenceSha256: createHash("sha256").update(raceId).digest("hex"),
    mode: "bike" as const,
    entrantCoreIds: Object.freeze([...entrants]),
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
        sourceEvidenceSha256: "a".repeat(64),
      }),
      dnaPopulationEntrantAuthorityQuarantineRecord({
        sourceRaceId: "race-3",
        observedAt: BASE_AT,
        quarantineReason: "provider_document_unusable",
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
  const replacements = Object.freeze([
    resolved("race-2", REPLACED_AT, ["7", "8"]),
  ]);
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
      records: plan.records.slice(0, 2),
    }),
    buildDnaPopulationEntrantAuthorityChunk({
      generationId: plan.successorGenerationId,
      chunkOrdinal: 2,
      records: plan.records.slice(2),
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

function harness(options?: { failRegistrationOrdinalOnce?: number }) {
  const { authority, publicationProof, successorChunks } = fixture();
  const events: string[] = [];
  const manifests: DnaPopulationEntrantAuthoritySuccessorChunkManifest[] = [];
  let failed = false;
  let writePass = 0;

  function checkpoint(): DnaPopulationEntrantAuthoritySuccessorCheckpoint {
    return Object.freeze({
      ...authority,
      chunkCount: manifests.length,
      persistedRaceCount: manifests.reduce(
        (total, manifest) => total + manifest.rowCount,
        0,
      ),
      lastSourceRaceId: manifests.at(-1)?.lastSourceRaceId ?? null,
      startedAt: STARTED_AT,
      updatedAt: manifests.length > 0 ? REGISTERED_AT : STARTED_AT,
    });
  }

  const capacityGate: DnaPopulationEntrantAuthoritySuccessorCapacityGate =
    Object.freeze({
      assertFreshCurrentCapacity: vi.fn(async () => {
        events.push("capacity");
        return Object.freeze({
          version: 1 as const,
          successorGenerationId: authority.successorGenerationId,
          successorRecordSetSha256: authority.successorRecordSetSha256,
          unresolvedRaceCount: authority.unresolvedRaceCount,
          observedAt: "2026-10-01T01:59:00.000Z",
          capacityAllowed: true as const,
          paidUsageAllowed: false as const,
        });
      }),
    });

  const r2Store: DnaPopulationEntrantAuthoritySuccessorR2CommitPort =
    Object.freeze({
      write: vi.fn(async (request) => {
        events.push(`r2-write-${request.chunkOrdinal}`);
        const expected = successorChunks[request.chunkOrdinal - 1]!;
        return Object.freeze({
          receipt: Object.freeze({
            ...expected.receipt,
            objectKey: `private/successors/${expected.receipt.chunkOrdinal}.json`,
          }),
          storageStatus:
            writePass === 0 ? ("created" as const) : ("existing" as const),
        });
      }),
      verify: vi.fn(async (receipt) => {
        events.push(`r2-verify-${receipt.chunkOrdinal}`);
      }),
    });

  const checkpointRepository: DnaPopulationEntrantAuthoritySuccessorCheckpointRepository =
    Object.freeze({
      begin: vi.fn(async () => {
        events.push("checkpoint-begin");
        writePass += 1;
        return checkpoint();
      }),
      registerChunk: vi.fn(async (_ownerId, request) => {
        events.push(`manifest-register-${request.receipt.chunkOrdinal}`);
        if (
          options?.failRegistrationOrdinalOnce ===
            request.receipt.chunkOrdinal &&
          !failed
        ) {
          failed = true;
          throw new Error("synthetic Neon interruption");
        }
        manifests.push(
          Object.freeze({
            ...request.receipt,
            registeredAt: request.registeredAt,
          }),
        );
        return checkpoint();
      }),
      read: vi.fn(async () => checkpoint()),
      listChunkManifests: vi.fn(async (_ownerId, request) => {
        events.push("manifest-list");
        return Object.freeze(
          manifests
            .filter(
              (manifest) => manifest.chunkOrdinal > request.afterChunkOrdinal,
            )
            .slice(0, request.limit),
        );
      }),
    });

  return {
    authority,
    capacityGate,
    checkpointRepository,
    events,
    manifests,
    publicationProof,
    r2Store,
    successorChunks,
  };
}

function request(test: ReturnType<typeof harness>) {
  return {
    ownerId: "private-owner",
    authority: test.authority,
    publicationProof: test.publicationProof,
    successorChunks: test.successorChunks,
    capacityGate: test.capacityGate,
    checkpointRepository: test.checkpointRepository,
    r2Store: test.r2Store,
    startedAt: STARTED_AT,
    registeredAt: REGISTERED_AT,
  };
}

describe("population entrant authority successor commit protocol", () => {
  it("writes and verifies every R2 chunk before beginning the Neon checkpoint", async () => {
    const test = harness();

    const result = await commitDnaPopulationEntrantAuthoritySuccessor(
      request(test),
    );

    expect(test.events).toEqual([
      "capacity",
      "r2-write-1",
      "r2-verify-1",
      "r2-write-2",
      "r2-verify-2",
      "checkpoint-begin",
      "manifest-register-1",
      "manifest-register-2",
      "manifest-list",
    ]);
    expect(result.checkpointAfter).toMatchObject({
      chunkCount: 2,
      persistedRaceCount: 3,
      lastSourceRaceId: "race-3",
    });
    expect(result).toMatchObject({
      storageStatuses: ["created", "created"],
      resumedRegisteredChunkCount: 0,
      providerRequestPerformed: false,
      persistentWritePerformed: true,
      providerWritePerformed: false,
      publicationActivated: false,
      lastGoodBasePreserved: true,
      paidUsageAllowed: false,
    });
  });

  it("resumes an interrupted Neon suffix without duplicate registration", async () => {
    const test = harness({ failRegistrationOrdinalOnce: 2 });

    await expect(
      commitDnaPopulationEntrantAuthoritySuccessor(request(test)),
    ).rejects.toThrow("synthetic Neon interruption");
    expect(test.manifests.map((manifest) => manifest.chunkOrdinal)).toEqual([
      1,
    ]);

    const replay = await commitDnaPopulationEntrantAuthoritySuccessor(
      request(test),
    );

    expect(replay.storageStatuses).toEqual(["existing", "existing"]);
    expect(replay.resumedRegisteredChunkCount).toBe(1);
    expect(test.manifests.map((manifest) => manifest.chunkOrdinal)).toEqual([
      1, 2,
    ]);
    expect(
      test.events.filter((event) => event === "manifest-register-1"),
    ).toHaveLength(1);
    expect(
      test.events.filter((event) => event === "manifest-register-2"),
    ).toHaveLength(2);
  });

  it("fails before R2 and Neon when zero-cost capacity authority drifts", async () => {
    const test = harness();
    vi.mocked(
      test.capacityGate.assertFreshCurrentCapacity,
    ).mockResolvedValueOnce(
      Object.freeze({
        version: 1,
        successorGenerationId: test.authority.successorGenerationId,
        successorRecordSetSha256: "f".repeat(64),
        unresolvedRaceCount: test.authority.unresolvedRaceCount,
        observedAt: "2026-10-01T01:59:00.000Z",
        capacityAllowed: true,
        paidUsageAllowed: false,
      }),
    );

    await expect(
      commitDnaPopulationEntrantAuthoritySuccessor(request(test)),
    ).rejects.toThrow("capacity approval disagrees with successor");
    expect(test.r2Store.write).not.toHaveBeenCalled();
    expect(test.checkpointRepository.begin).not.toHaveBeenCalled();
  });

  it("fails before capacity when the proof does not bind the archive", async () => {
    const test = harness();

    await expect(
      commitDnaPopulationEntrantAuthoritySuccessor({
        ...request(test),
        publicationProof: Object.freeze({
          ...test.publicationProof,
          archiveRecordSetSha256: "f".repeat(64),
        }),
      }),
    ).rejects.toThrow("publication proof disagrees with successor authority");
    expect(test.capacityGate.assertFreshCurrentCapacity).not.toHaveBeenCalled();
    expect(test.r2Store.write).not.toHaveBeenCalled();
  });

  it("fails before Neon when an R2 receipt drifts", async () => {
    const test = harness();
    vi.mocked(test.r2Store.write).mockResolvedValueOnce(
      Object.freeze({
        receipt: Object.freeze({
          ...test.successorChunks[0]!.receipt,
          objectKey: "private/successors/1.json",
          bodySha256: "f".repeat(64),
        }),
        storageStatus: "created",
      }),
    );

    await expect(
      commitDnaPopulationEntrantAuthoritySuccessor(request(test)),
    ).rejects.toThrow("R2 receipt disagrees with successor archive");
    expect(test.checkpointRepository.begin).not.toHaveBeenCalled();
  });

  it("fails closed when the durable manifest prefix drifts", async () => {
    const test = harness();
    test.manifests.push(
      Object.freeze({
        ...test.successorChunks[0]!.receipt,
        objectKey: "private/successors/drifted.json",
        registeredAt: REGISTERED_AT,
      }),
    );

    await expect(
      commitDnaPopulationEntrantAuthoritySuccessor(request(test)),
    ).rejects.toThrow("manifest prefix disagrees with R2");
    expect(test.checkpointRepository.registerChunk).not.toHaveBeenCalled();
  });
});
