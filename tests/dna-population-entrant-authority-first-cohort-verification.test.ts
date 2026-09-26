import { describe, expect, it, vi } from "vitest";

import type {
  DnaPopulationEntrantAuthorityCheckpoint,
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityChunkManifest,
} from "@/lib/dna-population-entrant-authority-checkpoint";
import {
  verifyDnaPopulationEntrantAuthorityFirstCohort,
  type DnaPopulationEntrantAuthorityFirstCohortEvidence,
} from "@/lib/dna-population-entrant-authority-first-cohort-verification";

const HEAD = "a".repeat(40);
const GENERATION = "b".repeat(64);
const authority: DnaPopulationEntrantAuthorityCheckpointAuthority =
  Object.freeze({
    version: 1,
    generationId: GENERATION,
    unresolvedRaceCount: 2,
    unresolvedRaceSetSha256: GENERATION,
  });

const manifest: DnaPopulationEntrantAuthorityChunkManifest = Object.freeze({
  version: 1,
  generationId: GENERATION,
  chunkOrdinal: 1,
  objectKey: "dna-open-lab/v1/private/population-entrant-authority/1.json",
  bodySha256: "c".repeat(64),
  byteLength: 512,
  rowCount: 1,
  firstSourceRaceId: "race-1",
  lastSourceRaceId: "race-1",
  raceSetSha256: "d".repeat(64),
  recordSetSha256: "e".repeat(64),
  registeredAt: "2026-09-26T16:00:00.000Z",
});

const checkpoint: DnaPopulationEntrantAuthorityCheckpoint = Object.freeze({
  ...authority,
  chunkCount: 1,
  persistedRaceCount: 1,
  lastSourceRaceId: "race-1",
  startedAt: "2026-09-26T15:59:00.000Z",
  updatedAt: "2026-09-26T16:00:00.000Z",
});

const expected: DnaPopulationEntrantAuthorityFirstCohortEvidence =
  Object.freeze({
    exactCodeHeadSha: HEAD,
    rowCount: 1,
    bodySha256: manifest.bodySha256,
    raceSetSha256: manifest.raceSetSha256,
    recordSetSha256: manifest.recordSetSha256,
    authorityComplete: false,
  });

function harness() {
  return {
    checkpointRepository: {
      read: vi.fn(async () => checkpoint),
      listChunkManifests: vi.fn(async () => Object.freeze([manifest])),
    },
    r2Store: {
      read: vi.fn(async () => {
        const {
          objectKey: _objectKey,
          registeredAt: _registeredAt,
          ...receipt
        } = manifest;
        return Object.freeze({
          receipt,
          body: new Uint8Array(manifest.byteLength),
          records: Object.freeze([]),
        });
      }),
    },
  };
}

describe("population entrant first-cohort durability verification", () => {
  it("reopens the single durable chunk and binds it to the commit evidence", async () => {
    const target = harness();
    const result =
      await verifyDnaPopulationEntrantAuthorityFirstCohort({
        ownerId: "private-owner",
        exactCodeHeadSha: HEAD,
        authority,
        expected,
        checkpointRepository: target.checkpointRepository,
        r2Store: target.r2Store,
      });

    expect(result).toMatchObject({
      status: "verified",
      exactCodeHeadSha: HEAD,
      generationId: GENERATION,
      unresolvedRaceCount: 2,
      chunkCount: 1,
      persistedRaceCount: 1,
      bodySha256: manifest.bodySha256,
      raceSetSha256: manifest.raceSetSha256,
      recordSetSha256: manifest.recordSetSha256,
      authorityComplete: false,
      nextChunkOrdinal: 2,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(target.checkpointRepository.read).toHaveBeenCalledTimes(1);
    expect(target.r2Store.read).toHaveBeenCalledTimes(1);
  });

  it("fails closed when durable evidence disagrees with the accepted commit", async () => {
    const target = harness();
    await expect(
      verifyDnaPopulationEntrantAuthorityFirstCohort({
        ownerId: "private-owner",
        exactCodeHeadSha: HEAD,
        authority,
        expected: {
          ...expected,
          recordSetSha256: "f".repeat(64),
        },
        checkpointRepository: target.checkpointRepository,
        r2Store: target.r2Store,
      }),
    ).rejects.toThrow(
      "Population entrant first-cohort durability verification failed",
    );
  });
});
