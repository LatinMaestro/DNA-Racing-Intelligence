import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { buildDnaPopulationEntrantAuthorityChunk } from "@/lib/dna-population-entrant-authority-archive";
import { dnaPopulationEntrantAuthorityRaceSetSha256 } from "@/lib/dna-population-entrant-authority-cohort";
import type { DnaPopulationEntrantAuthorityLiveAudit } from "@/lib/dna-population-entrant-authority-cohort-command";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_INTENT,
  DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_VERSION,
} from "@/lib/dna-population-entrant-authority-successor-commissioning";
import {
  createDnaPopulationEntrantAuthoritySuccessorHostedComposition,
  DnaPopulationEntrantAuthoritySuccessorHostedCompositionError,
} from "@/lib/dna-population-entrant-authority-successor-hosted-composition";
import type { DnaPopulationEntrantAuthoritySuccessorCapacityGate } from "@/lib/dna-population-entrant-authority-successor-commit-protocol";
import {
  createDnaPopulationEntrantAuthoritySuccessorReadinessSource,
  DnaPopulationEntrantAuthoritySuccessorReadinessError,
  type DnaPopulationEntrantAuthoritySuccessorReplacementCandidate,
} from "@/lib/dna-population-entrant-authority-successor-readiness-source";
import {
  dnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityRecord,
  type DnaPopulationEntrantAuthorityResolvedRecord,
} from "@/lib/dna-population-entrant-authority-record";
import { replayDnaPopulationEntrantAuthority } from "@/lib/dna-population-entrant-authority-replay";
import { planDnaPopulationHistoryAcquisition } from "@/lib/dna-population-history-acquisition-plan";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

const OWNER_ID = "owner-test";
const HEAD = "a".repeat(40);
const BASE_AT = "2026-10-01T00:00:00.000Z";
const REPLACEMENT_AT = "2026-10-01T00:10:00.000Z";
const INSPECTED_AT = "2026-10-01T00:11:00.000Z";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolved(
  sourceRaceId: string,
  observedAt = BASE_AT,
): DnaPopulationEntrantAuthorityResolvedRecord {
  return Object.freeze({
    sourceRaceId,
    observedAt,
    rawEvidenceSha256: hash(sourceRaceId + observedAt),
    mode: "bike" as const,
    entrantCoreIds: Object.freeze(["1", "2"]),
  });
}

function fixture() {
  const records: readonly DnaPopulationEntrantAuthorityRecord[] = [
    resolved("race-1"),
    dnaPopulationEntrantAuthorityQuarantineRecord({
      sourceRaceId: "race-2",
      observedAt: BASE_AT,
      quarantineReason: "entrant_authority_unresolved",
      sourceEvidenceSha256: hash("race-2-base"),
    }),
  ];
  const unresolvedRaceSetSha256 = dnaPopulationEntrantAuthorityRaceSetSha256([
    "race-1",
    "race-2",
  ]);
  const replay = replayDnaPopulationEntrantAuthority({
    records,
    expectedUnresolvedRaceCount: records.length,
    expectedUnresolvedRaceSetSha256: unresolvedRaceSetSha256,
  });
  const baseChunk = buildDnaPopulationEntrantAuthorityChunk({
    generationId: unresolvedRaceSetSha256,
    chunkOrdinal: 1,
    records,
  });
  const manifest = Object.freeze({
    ...baseChunk.receipt,
    objectKey: "private/content-addressed/base.json",
    registeredAt: BASE_AT,
  });
  const authority = Object.freeze({
    version: 1 as const,
    generationId: unresolvedRaceSetSha256,
    unresolvedRaceCount: records.length,
    unresolvedRaceSetSha256,
  });
  const checkpoint = Object.freeze({
    ...authority,
    chunkCount: 1,
    persistedRaceCount: records.length,
    lastSourceRaceId: "race-2",
    startedAt: BASE_AT,
    updatedAt: BASE_AT,
  });
  const raceDocuments: readonly CanonicalRaceDocumentMetadata[] = Object.freeze(
    [
      Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId: "race-1",
      }),
      Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId: "race-2",
      }),
    ],
  );
  const plan = planDnaPopulationHistoryAcquisition({ raceDocuments });
  const audit: DnaPopulationEntrantAuthorityLiveAudit = Object.freeze({
    exactCodeHeadSha: HEAD,
    plan,
    raceDocuments,
    authority,
  });
  const replacement = resolved("race-2", REPLACEMENT_AT);
  const replacementCandidate: DnaPopulationEntrantAuthoritySuccessorReplacementCandidate =
    Object.freeze({
      version: 1 as const,
      status: "ready" as const,
      observedAt: REPLACEMENT_AT,
      baseGenerationId: authority.generationId,
      baseRecordSetSha256: replay.recordSetSha256,
      unresolvedRaceCount: authority.unresolvedRaceCount,
      unresolvedRaceSetSha256: authority.unresolvedRaceSetSha256,
      replacements: Object.freeze([replacement]),
      providerRequestPerformed: false as const,
      persistentWritePerformed: false as const,
      providerWritePerformed: false as const,
      paidUsageAllowed: false as const,
    });

  const authorityLoad = vi.fn(async () => audit);
  const replacementInspect = vi.fn(async () => replacementCandidate);
  const checkpointRead = vi.fn(async () => checkpoint);
  const manifestList = vi.fn(async () => [manifest]);
  const baseRead = vi.fn(async () => baseChunk);
  const sourceInput = {
    configuredOwnerId: OWNER_ID,
    exactCodeHeadSha: HEAD,
    authoritySource: Object.freeze({ load: authorityLoad }),
    baseCheckpointRepository: Object.freeze({
      read: checkpointRead,
      listChunkManifests: manifestList,
    }),
    baseR2Store: Object.freeze({ read: baseRead }),
    replacementSource: Object.freeze({ inspect: replacementInspect }),
    now: () => new Date(INSPECTED_AT),
  };
  return {
    authority,
    replacementCandidate,
    authorityLoad,
    replacementInspect,
    checkpointRead,
    manifestList,
    baseRead,
    sourceInput,
  };
}

describe("population entrant successor readiness source", () => {
  it("reopens v1 and proves a deterministic read-only successor candidate", async () => {
    const state = fixture();
    const source = createDnaPopulationEntrantAuthoritySuccessorReadinessSource(
      state.sourceInput,
    );

    const candidate = await source.inspect({
      ownerId: OWNER_ID,
      exactCodeHeadSha: HEAD,
    });

    expect(candidate).toMatchObject({
      status: "ready",
      exactCodeHeadSha: HEAD,
      observedAt: INSPECTED_AT,
      previewOnly: true,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      publicationActivated: false,
      lastGoodBasePreserved: true,
      paidUsageAllowed: false,
    });
    expect(candidate.authority).toMatchObject({
      baseGenerationId: state.authority.generationId,
      unresolvedRaceCount: 2,
      replacementRaceCount: 1,
      quarantinedRaceCountBefore: 1,
      quarantinedRaceCountAfter: 0,
    });
    expect(candidate.successorChunks).toHaveLength(1);
    expect(candidate.publicationProof).toMatchObject({
      successorGenerationId: candidate.authority.successorGenerationId,
      successorRecordSetSha256: candidate.authority.successorRecordSetSha256,
      publicationIntegrityStatus: "proven_immutable_successor_archive",
      publicationAllowed: false,
    });
    expect(state.replacementInspect).toHaveBeenCalledWith(
      expect.objectContaining({
        baseGenerationId: state.authority.generationId,
        quarantinedRaceIds: ["race-2"],
      }),
    );
  });

  it("fails closed on request, base, or replacement authority drift", async () => {
    const requestState = fixture();
    const requestSource =
      createDnaPopulationEntrantAuthoritySuccessorReadinessSource(
        requestState.sourceInput,
      );
    await expect(
      requestSource.inspect({ ownerId: "other", exactCodeHeadSha: HEAD }),
    ).rejects.toMatchObject({ diagnostic: "request_binding_mismatch" });

    const baseState = fixture();
    baseState.checkpointRead.mockRejectedValueOnce(new Error("unavailable"));
    const baseSource =
      createDnaPopulationEntrantAuthoritySuccessorReadinessSource(
        baseState.sourceInput,
      );
    await expect(
      baseSource.inspect({ ownerId: OWNER_ID, exactCodeHeadSha: HEAD }),
    ).rejects.toMatchObject({ diagnostic: "base_authority_unavailable" });

    const replacementState = fixture();
    replacementState.replacementInspect.mockResolvedValueOnce(
      Object.freeze({
        ...replacementState.replacementCandidate,
        baseRecordSetSha256: "f".repeat(64),
      }),
    );
    const replacementSource =
      createDnaPopulationEntrantAuthoritySuccessorReadinessSource(
        replacementState.sourceInput,
      );
    await expect(
      replacementSource.inspect({
        ownerId: OWNER_ID,
        exactCodeHeadSha: HEAD,
      }),
    ).rejects.toBeInstanceOf(
      DnaPopulationEntrantAuthoritySuccessorReadinessError,
    );
    await expect(
      replacementSource.inspect({
        ownerId: OWNER_ID,
        exactCodeHeadSha: HEAD,
      }),
    ).resolves.toMatchObject({ status: "ready" });
  });

  it("rejects empty or non-newer retained replacements", async () => {
    const emptyState = fixture();
    emptyState.replacementInspect.mockResolvedValueOnce(
      Object.freeze({
        ...emptyState.replacementCandidate,
        replacements: Object.freeze([]),
      }),
    );
    const emptySource =
      createDnaPopulationEntrantAuthoritySuccessorReadinessSource(
        emptyState.sourceInput,
      );
    await expect(
      emptySource.inspect({ ownerId: OWNER_ID, exactCodeHeadSha: HEAD }),
    ).rejects.toMatchObject({ diagnostic: "replacement_authority_empty" });

    const staleState = fixture();
    staleState.replacementInspect.mockResolvedValueOnce(
      Object.freeze({
        ...staleState.replacementCandidate,
        replacements: Object.freeze([resolved("race-2", BASE_AT)]),
      }),
    );
    const staleSource =
      createDnaPopulationEntrantAuthoritySuccessorReadinessSource(
        staleState.sourceInput,
      );
    await expect(
      staleSource.inspect({ ownerId: OWNER_ID, exactCodeHeadSha: HEAD }),
    ).rejects.toMatchObject({ diagnostic: "successor_candidate_unavailable" });
  });
});

describe("population entrant successor hosted composition", () => {
  it("does no construction I/O and exposes only a sanitized A$0 receipt", async () => {
    const state = fixture();
    const mainGuard = Object.freeze({
      assertCurrentMain: vi.fn(async () => ({ currentMainSha: HEAD })),
    });
    const capacityInspection = vi.fn<
      DnaPopulationEntrantAuthoritySuccessorCapacityGate["assertFreshCurrentCapacity"]
    >(async (authority) =>
      Object.freeze({
        version: 1 as const,
        successorGenerationId: authority.successorGenerationId,
        successorRecordSetSha256: authority.successorRecordSetSha256,
        unresolvedRaceCount: authority.unresolvedRaceCount,
        observedAt: INSPECTED_AT,
        capacityAllowed: true as const,
        paidUsageAllowed: false as const,
      }),
    );
    const capacityGate = Object.freeze({
      assertFreshCurrentCapacity: capacityInspection,
    });
    const successorCheckpointRepository = Object.freeze({
      begin: vi.fn(),
      registerChunk: vi.fn(),
      read: vi.fn(),
      listChunkManifests: vi.fn(),
    });
    const successorR2Store = Object.freeze({
      write: vi.fn(),
      verify: vi.fn(),
    });
    const composition =
      createDnaPopulationEntrantAuthoritySuccessorHostedComposition({
        ...state.sourceInput,
        mainGuard,
        capacityGate,
        successorCheckpointRepository,
        successorR2Store,
      });

    expect(state.authorityLoad).not.toHaveBeenCalled();
    expect(mainGuard.assertCurrentMain).not.toHaveBeenCalled();
    expect(capacityGate.assertFreshCurrentCapacity).not.toHaveBeenCalled();

    const receipt = await composition.inspectReadiness();

    expect(receipt).toMatchObject({
      status: "ready_uncommitted",
      exactCodeHeadSha: HEAD,
      unresolvedRaceCount: 2,
      replacementRaceCount: 1,
      quarantinedRaceCountBefore: 1,
      quarantinedRaceCountAfter: 0,
      chunkCount: 1,
      capacityAllowed: true,
      previewOnly: true,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      publicationActivated: false,
      paidUsageAllowed: false,
    });
    expect(receipt.successorAuthoritySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.publicationProofSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt).not.toHaveProperty("successorChunks");
    expect(receipt).not.toHaveProperty("records");
    expect(receipt).not.toHaveProperty("objectKey");
    expect(successorCheckpointRepository.begin).not.toHaveBeenCalled();
    expect(successorR2Store.write).not.toHaveBeenCalled();

    const session = await composition.prepare({
      commandVersion:
        DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_VERSION,
      intent: DNA_POPULATION_ENTRANT_AUTHORITY_SUCCESSOR_COMMISSIONING_INTENT,
      allowPersistentWrite: true,
      exactCodeHeadSha: HEAD,
      expectedSuccessorAuthoritySha256: receipt.successorAuthoritySha256,
      expectedPublicationProofSha256: receipt.publicationProofSha256,
    });
    expect(session.prepared).toMatchObject({
      status: "prepared_uncommitted",
      persistentWritePerformed: false,
      publicationActivated: false,
      lastGoodBasePreserved: true,
    });
    expect(successorCheckpointRepository.begin).not.toHaveBeenCalled();
    expect(successorR2Store.write).not.toHaveBeenCalled();
  });

  it("fails closed before readiness when current main drifts", async () => {
    const state = fixture();
    const composition =
      createDnaPopulationEntrantAuthoritySuccessorHostedComposition({
        ...state.sourceInput,
        mainGuard: Object.freeze({
          assertCurrentMain: async () => ({ currentMainSha: "b".repeat(40) }),
        }),
        capacityGate: Object.freeze({
          assertFreshCurrentCapacity: vi.fn(),
        }),
        successorCheckpointRepository: Object.freeze({
          begin: vi.fn(),
          registerChunk: vi.fn(),
          read: vi.fn(),
          listChunkManifests: vi.fn(),
        }),
        successorR2Store: Object.freeze({
          write: vi.fn(),
          verify: vi.fn(),
        }),
      });

    await expect(composition.inspectReadiness()).rejects.toBeInstanceOf(
      DnaPopulationEntrantAuthoritySuccessorHostedCompositionError,
    );
    expect(state.authorityLoad).not.toHaveBeenCalled();
  });
});
