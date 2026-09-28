import { describe, expect, it, vi } from "vitest";

import type {
  DnaPopulationEntrantAuthorityCheckpoint,
  DnaPopulationEntrantAuthorityChunkManifest,
} from "@/lib/dna-population-entrant-authority-checkpoint";
import type { DnaPopulationEntrantAuthorityCapacityGate } from "@/lib/dna-population-entrant-authority-commit-protocol";
import {
  createDnaPopulationEntrantAuthorityAutonomousBoundaryInspector,
  createDnaPopulationEntrantAuthorityContinuationReadinessInspector,
  DnaPopulationEntrantAuthorityContinuationReadinessError,
  DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION,
} from "@/lib/dna-population-entrant-authority-continuation-readiness";
import type { DnaPopulationEntrantAuthorityR2RecoveryPort } from "@/lib/dna-population-entrant-authority-recovery";
import {
  planDnaPopulationHistoryAcquisition,
  type DnaPopulationHistoryAcquisitionPlan,
} from "@/lib/dna-population-history-acquisition-plan";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

const HEAD = "a".repeat(40);
const OWNER = "private-owner";
const OBSERVED_AT = "2026-09-27T00:00:00.000Z";

function audit() {
  const raceDocuments: readonly CanonicalRaceDocumentMetadata[] = Object.freeze(
    [
      Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId: "race-1",
        mode: "bike" as const,
      }),
      Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId: "race-2",
        mode: "bike" as const,
      }),
      Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId: "race-3",
        mode: "bike" as const,
      }),
    ],
  );
  const plan: DnaPopulationHistoryAcquisitionPlan =
    planDnaPopulationHistoryAcquisition({ raceDocuments });
  if (plan.unresolvedRaceSetSha256 === null) {
    throw new Error("synthetic authority unavailable");
  }
  return Object.freeze({
    exactCodeHeadSha: HEAD,
    plan,
    raceDocuments,
    authority: Object.freeze({
      version: 1 as const,
      generationId: plan.unresolvedRaceSetSha256,
      unresolvedRaceCount: plan.unresolvedRaceCount,
      unresolvedRaceSetSha256: plan.unresolvedRaceSetSha256,
    }),
  });
}

const AUTHORITY = audit().authority;

function checkpoint(
  overrides: Partial<DnaPopulationEntrantAuthorityCheckpoint> = {},
): DnaPopulationEntrantAuthorityCheckpoint {
  return Object.freeze({
    ...AUTHORITY,
    chunkCount: 1,
    persistedRaceCount: 2,
    lastSourceRaceId: "race-2",
    startedAt: "2026-09-26T23:58:00.000Z",
    updatedAt: "2026-09-26T23:59:00.000Z",
    ...overrides,
  });
}

function manifest(
  overrides: Partial<DnaPopulationEntrantAuthorityChunkManifest> = {},
): DnaPopulationEntrantAuthorityChunkManifest {
  return Object.freeze({
    version: 1,
    generationId: AUTHORITY.generationId,
    chunkOrdinal: 1,
    objectKey: "private/chunk-1.json",
    bodySha256: "b".repeat(64),
    byteLength: 512,
    rowCount: 2,
    firstSourceRaceId: "race-1",
    lastSourceRaceId: "race-2",
    raceSetSha256: "c".repeat(64),
    recordSetSha256: "d".repeat(64),
    registeredAt: "2026-09-26T23:58:30.000Z",
    ...overrides,
  });
}

function harness(input?: {
  checkpoint?: DnaPopulationEntrantAuthorityCheckpoint;
  manifests?: readonly DnaPopulationEntrantAuthorityChunkManifest[];
  capacityGate?: DnaPopulationEntrantAuthorityCapacityGate;
  r2Store?: DnaPopulationEntrantAuthorityR2RecoveryPort;
}) {
  const cp = input?.checkpoint ?? checkpoint();
  const manifests = input?.manifests ?? Object.freeze([manifest()]);
  const checkpointRepository = Object.freeze({
    read: vi.fn(async () => cp),
    listChunkManifests: vi.fn(
      async (
        _ownerId: string,
        request: Readonly<{ afterChunkOrdinal: number; limit: number }>,
      ) =>
        manifests
          .filter((entry) => entry.chunkOrdinal > request.afterChunkOrdinal)
          .slice(0, request.limit),
    ),
  });
  const r2Store: DnaPopulationEntrantAuthorityR2RecoveryPort =
    input?.r2Store ??
    Object.freeze({
      read: vi.fn(async (requested) => {
        const match = manifests.find(
          (entry) => entry.chunkOrdinal === requested.chunkOrdinal,
        );
        if (match === undefined) throw new Error("private-r2-missing");
        const {
          objectKey: _objectKey,
          registeredAt: _registeredAt,
          ...receipt
        } = match;
        void _objectKey;
        void _registeredAt;
        return Object.freeze({
          receipt: Object.freeze(receipt),
          body: new Uint8Array(receipt.byteLength),
          records: Object.freeze([]),
        });
      }),
    });
  const capacityGate =
    input?.capacityGate ??
    Object.freeze({
      assertFreshCurrentCapacity: vi.fn(async () =>
        Object.freeze({
          version: 1 as const,
          generationId: AUTHORITY.generationId,
          unresolvedRaceCount: AUTHORITY.unresolvedRaceCount,
          unresolvedRaceSetSha256: AUTHORITY.unresolvedRaceSetSha256,
          observedAt: OBSERVED_AT,
          capacityAllowed: true as const,
          paidUsageAllowed: false as const,
        }),
      ),
    });

  return {
    authoritySource: Object.freeze({
      load: vi.fn(async () => audit()),
    }),
    capacityGate,
    checkpointRepository,
    r2Store,
  };
}

function inspector(test: ReturnType<typeof harness>) {
  return createDnaPopulationEntrantAuthorityContinuationReadinessInspector({
    ownerId: OWNER,
    exactCodeHeadSha: HEAD,
    authoritySource: test.authoritySource,
    capacityGate: test.capacityGate,
    checkpointRepository: test.checkpointRepository,
    r2Store: test.r2Store,
  });
}

function autonomousBoundaryInspector(test: ReturnType<typeof harness>) {
  return createDnaPopulationEntrantAuthorityAutonomousBoundaryInspector({
    ownerId: OWNER,
    exactCodeHeadSha: HEAD,
    authoritySource: test.authoritySource,
    capacityGate: test.capacityGate,
    checkpointRepository: test.checkpointRepository,
    r2Store: test.r2Store,
  });
}

describe("population entrant continuation readiness", () => {
  it("proves an incomplete durable continuation boundary without any write", async () => {
    const test = harness();
    const receipt = await inspector(test).inspect();

    expect(receipt).toMatchObject({
      version: DNA_POPULATION_ENTRANT_AUTHORITY_CONTINUATION_READINESS_VERSION,
      status: "ready_for_continuation",
      exactCodeHeadSha: HEAD,
      unresolvedRaceCount: 3,
      unresolvedRaceSetSha256: AUTHORITY.unresolvedRaceSetSha256,
      recoveredChunkCount: 1,
      recoveredRaceCount: 2,
      nextChunkOrdinal: 2,
      checkpointUpdatedAt: "2026-09-26T23:59:00.000Z",
      capacityObservedAt: OBSERVED_AT,
      previewOnly: true,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(receipt.durableBoundarySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(test.capacityGate.assertFreshCurrentCapacity).toHaveBeenCalledWith(
      AUTHORITY,
    );
    expect(test.r2Store.read).toHaveBeenCalledOnce();
    expect(JSON.stringify(receipt)).not.toContain("race-2");
    expect(JSON.stringify(receipt)).not.toContain("private/chunk-1.json");
  });

  it("fails closed before continuation when no cohort has been durably registered", async () => {
    const test = harness({
      checkpoint: checkpoint({
        chunkCount: 0,
        persistedRaceCount: 0,
        lastSourceRaceId: null,
      }),
      manifests: Object.freeze([]),
    });

    await expect(inspector(test).inspect()).rejects.toBeInstanceOf(
      DnaPopulationEntrantAuthorityContinuationReadinessError,
    );
  });

  it("fails closed when the entrant authority is already complete", async () => {
    const completeManifest = manifest({ rowCount: 3 });
    const test = harness({
      checkpoint: checkpoint({
        persistedRaceCount: 3,
        lastSourceRaceId: completeManifest.lastSourceRaceId,
      }),
      manifests: Object.freeze([completeManifest]),
    });

    await expect(inspector(test).inspect()).rejects.toBeInstanceOf(
      DnaPopulationEntrantAuthorityContinuationReadinessError,
    );
  });

  it("fails closed and sanitizes current-capacity failures", async () => {
    const test = harness({
      capacityGate: Object.freeze({
        assertFreshCurrentCapacity: vi.fn(async () => {
          throw new Error("private-provider-capacity-secret");
        }),
      }),
    });

    const error = await inspector(test)
      .inspect()
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "capacity_unavailable",
    });
    expect(error).toBeInstanceOf(
      DnaPopulationEntrantAuthorityContinuationReadinessError,
    );
    expect(String(error)).not.toContain("private-provider-capacity-secret");
    expect(test.checkpointRepository.read).not.toHaveBeenCalled();
    expect(test.r2Store.read).not.toHaveBeenCalled();
  });

  it("binds the sanitized boundary digest to exact durable manifest evidence", async () => {
    const first = await inspector(harness()).inspect();
    const second = await inspector(
      harness({
        manifests: Object.freeze([
          manifest({
            bodySha256: "e".repeat(64),
            recordSetSha256: "f".repeat(64),
          }),
        ]),
      }),
    ).inspect();

    expect(second.durableBoundarySha256).not.toBe(first.durableBoundarySha256);
  });
});

describe("population entrant autonomous durable boundary", () => {
  it("adapts the accepted incomplete proof without changing its boundary digest", async () => {
    const continuation = await inspector(harness()).inspect();
    const autonomous = await autonomousBoundaryInspector(harness()).inspect();

    expect(autonomous).toMatchObject({
      version: 1,
      status: "ready_for_continuation",
      exactCodeHeadSha: HEAD,
      recoveredChunkCount: 1,
      recoveredRaceCount: 2,
      nextChunkOrdinal: 2,
      durableBoundarySha256: continuation.durableBoundarySha256,
      previewOnly: true,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
  });

  it("reports exact completion only after reopening the complete R2-backed boundary", async () => {
    const completeManifest = manifest({
      rowCount: 3,
      lastSourceRaceId: "race-3",
    });
    const test = harness({
      checkpoint: checkpoint({
        persistedRaceCount: 3,
        lastSourceRaceId: "race-3",
      }),
      manifests: Object.freeze([completeManifest]),
    });

    await expect(
      autonomousBoundaryInspector(test).inspect(),
    ).resolves.toMatchObject({
      version: 1,
      status: "authority_complete",
      unresolvedRaceCount: 3,
      recoveredChunkCount: 1,
      recoveredRaceCount: 3,
      nextChunkOrdinal: 2,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(test.r2Store.read).toHaveBeenCalledOnce();
  });

  it("fails closed with sanitized diagnostics when immutable R2 evidence conflicts", async () => {
    const test = harness({
      r2Store: Object.freeze({
        read: vi.fn(async () => {
          throw new Error("private-r2-object-key-and-payload");
        }),
      }),
    });

    const error = await autonomousBoundaryInspector(test)
      .inspect()
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "recovery_unavailable",
    });
    expect(error).toBeInstanceOf(
      DnaPopulationEntrantAuthorityContinuationReadinessError,
    );
    expect(String(error)).not.toContain("private-r2-object-key-and-payload");
  });
});
