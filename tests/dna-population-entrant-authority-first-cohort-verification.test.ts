import { describe, expect, it, vi } from "vitest";

import type {
  DnaPopulationEntrantAuthorityCheckpoint,
  DnaPopulationEntrantAuthorityChunkManifest,
} from "@/lib/dna-population-entrant-authority-checkpoint";
import {
  createDnaPopulationEntrantAuthorityFirstCohortVerifier,
  DnaPopulationEntrantAuthorityFirstCohortVerificationError,
} from "@/lib/dna-population-entrant-authority-first-cohort-verification";
import {
  dnaPopulationEntrantAuthorityRaceSetSha256,
  type DnaPopulationEntrantAuthorityR2CommitPort,
} from "@/lib/dna-population-entrant-authority-cohort";
import type { DnaPopulationEntrantAuthorityR2RecoveryPort } from "@/lib/dna-population-entrant-authority-recovery";
import type { DnaPopulationEntrantAuthorityRecord } from "@/lib/dna-population-entrant-authority-record";
import {
  planDnaPopulationHistoryAcquisition,
  type DnaPopulationHistoryAcquisitionPlan,
} from "@/lib/dna-population-history-acquisition-plan";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

const HEAD = "a".repeat(40);
const OWNER = "private-owner";
const RACE_IDS = Object.freeze(["race-1", "race-2"]);
const GENERATION = dnaPopulationEntrantAuthorityRaceSetSha256(RACE_IDS);
const BODY = "b".repeat(64);
const RECORD_SET = "c".repeat(64);
const REGISTERED_AT = "2026-09-26T16:00:00.000Z";
const UPDATED_AT = "2026-09-26T16:00:01.000Z";

function raceDocuments(): readonly CanonicalRaceDocumentMetadata[] {
  return Object.freeze(
    RACE_IDS.map((sourceRaceId) =>
      Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId,
        mode: "bike" as const,
      }),
    ),
  );
}

function plan(): DnaPopulationHistoryAcquisitionPlan {
  return planDnaPopulationHistoryAcquisition({
    raceDocuments: raceDocuments(),
  });
}

function checkpoint(
  overrides: Partial<DnaPopulationEntrantAuthorityCheckpoint> = {},
): DnaPopulationEntrantAuthorityCheckpoint {
  return Object.freeze({
    version: 1,
    generationId: GENERATION,
    unresolvedRaceCount: RACE_IDS.length,
    unresolvedRaceSetSha256: GENERATION,
    chunkCount: 1,
    persistedRaceCount: 2,
    lastSourceRaceId: "race-2",
    startedAt: "2026-09-26T15:59:00.000Z",
    updatedAt: UPDATED_AT,
    ...overrides,
  });
}

function manifest(
  overrides: Partial<DnaPopulationEntrantAuthorityChunkManifest> = {},
): DnaPopulationEntrantAuthorityChunkManifest {
  return Object.freeze({
    version: 1,
    generationId: GENERATION,
    chunkOrdinal: 1,
    objectKey: "private/chunk-1.json",
    bodySha256: BODY,
    byteLength: 500,
    rowCount: 2,
    firstSourceRaceId: "race-1",
    lastSourceRaceId: "race-2",
    raceSetSha256: GENERATION,
    recordSetSha256: RECORD_SET,
    registeredAt: REGISTERED_AT,
    ...overrides,
  });
}

function records(): readonly DnaPopulationEntrantAuthorityRecord[] {
  return Object.freeze([
    Object.freeze({
      sourceRaceId: "race-1",
      observedAt: "2026-09-26T15:58:00.000Z",
      rawEvidenceSha256: "d".repeat(64),
      mode: "bike" as const,
      entrantCoreIds: Object.freeze(["1", "2"]),
    }),
    Object.freeze({
      sourceRaceId: "race-2",
      observedAt: "2026-09-26T15:58:00.000Z",
      quarantineReason: "provider_document_missing" as const,
    }),
  ]);
}

function harness(input?: {
  checkpoint?: DnaPopulationEntrantAuthorityCheckpoint;
  manifests?: readonly DnaPopulationEntrantAuthorityChunkManifest[];
  storedRecords?: readonly DnaPopulationEntrantAuthorityRecord[];
}) {
  const cp = input?.checkpoint ?? checkpoint();
  const manifests = input?.manifests ?? Object.freeze([manifest()]);
  const read = vi.fn(async () => cp);
  const listChunkManifests = vi.fn(
    async (
      _ownerId: string,
      request: Readonly<{ afterChunkOrdinal: number; limit: number }>,
    ) =>
      manifests
        .filter((value) => value.chunkOrdinal > request.afterChunkOrdinal)
        .slice(0, request.limit),
  );
  const r2Store: DnaPopulationEntrantAuthorityR2RecoveryPort = Object.freeze({
    read: vi.fn(async (requested) => {
      const match = manifests.find(
        (value) => value.chunkOrdinal === requested.chunkOrdinal,
      );
      if (match === undefined) throw new Error("private-r2-missing");
      const {
        objectKey: _objectKey,
        registeredAt: _registeredAt,
        ...receipt
      } = match;
      return Object.freeze({
        receipt: Object.freeze(receipt),
        body: new Uint8Array(receipt.byteLength),
        records: input?.storedRecords ?? records(),
      });
    }),
  });

  return {
    source: Object.freeze({
      load: vi.fn(async () =>
        Object.freeze({
          exactCodeHeadSha: HEAD,
          plan: plan(),
          raceDocuments: raceDocuments(),
          authority: Object.freeze({
            version: 1 as const,
            generationId: GENERATION,
            unresolvedRaceCount: RACE_IDS.length,
            unresolvedRaceSetSha256: GENERATION,
          }),
        }),
      ),
    }),
    checkpointRepository: { read, listChunkManifests },
    r2Store,
  };
}

describe("population entrant first-cohort verification", () => {
  it("independently reopens the exact first durable cohort and exposes only sanitized proof", async () => {
    const test = harness();
    const verifier = createDnaPopulationEntrantAuthorityFirstCohortVerifier({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
      authoritySource: test.source,
      checkpointRepository: test.checkpointRepository,
      r2Store: test.r2Store,
    });

    await expect(verifier.inspect()).resolves.toEqual({
      status: "verified_first_cohort",
      exactCodeHeadSha: HEAD,
      unresolvedRaceCount: 2,
      unresolvedRaceSetSha256: GENERATION,
      chunkOrdinal: 1,
      rowCount: 2,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 1,
      bodySha256: BODY,
      raceSetSha256: GENERATION,
      recordSetSha256: RECORD_SET,
      registeredAt: REGISTERED_AT,
      checkpointUpdatedAt: UPDATED_AT,
      nextChunkOrdinal: 2,
      authorityComplete: true,
      previewOnly: true,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(test.r2Store.read).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(await verifier.inspect())).not.toContain(OWNER);
  });

  it("fails closed when no first cohort has been registered yet", async () => {
    const test = harness({
      checkpoint: checkpoint({
        chunkCount: 0,
        persistedRaceCount: 0,
        lastSourceRaceId: null,
      }),
      manifests: Object.freeze([]),
    });
    const verifier = createDnaPopulationEntrantAuthorityFirstCohortVerifier({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
      authoritySource: test.source,
      checkpointRepository: test.checkpointRepository,
      r2Store: test.r2Store,
    });

    await expect(verifier.inspect()).rejects.toBeInstanceOf(
      DnaPopulationEntrantAuthorityFirstCohortVerificationError,
    );
  });

  it("rejects durable state that does not represent the first canonical unresolved Race slice", async () => {
    const secondOnly = manifest({
      rowCount: 1,
      firstSourceRaceId: "race-2",
      lastSourceRaceId: "race-2",
      raceSetSha256: dnaPopulationEntrantAuthorityRaceSetSha256(["race-2"]),
    });
    const test = harness({
      checkpoint: checkpoint({
        persistedRaceCount: 1,
        lastSourceRaceId: "race-2",
      }),
      manifests: Object.freeze([secondOnly]),
      storedRecords: Object.freeze([records()[1]!]),
    });
    const verifier = createDnaPopulationEntrantAuthorityFirstCohortVerifier({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
      authoritySource: test.source,
      checkpointRepository: test.checkpointRepository,
      r2Store: test.r2Store,
    });

    await expect(verifier.inspect()).rejects.toBeInstanceOf(
      DnaPopulationEntrantAuthorityFirstCohortVerificationError,
    );
  });

  it("sanitizes underlying authority failures", async () => {
    const test = harness();
    const verifier = createDnaPopulationEntrantAuthorityFirstCohortVerifier({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
      authoritySource: Object.freeze({
        load: vi.fn(async () => {
          throw new Error("postgres://private-secret");
        }),
      }),
      checkpointRepository: test.checkpointRepository,
      r2Store: test.r2Store,
    });

    const error = await verifier.inspect().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(
      DnaPopulationEntrantAuthorityFirstCohortVerificationError,
    );
    expect(String(error)).not.toContain("private-secret");
  });
});
