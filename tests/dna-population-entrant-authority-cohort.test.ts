import { describe, expect, it, vi } from "vitest";

import {
  buildDnaPopulationEntrantAuthorityChunk,
  type DnaPopulationEntrantAuthorityChunk,
} from "@/lib/dna-population-entrant-authority-archive";
import {
  DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES,
  prepareDnaPopulationEntrantAuthorityCohort,
  type DnaPopulationEntrantAuthorityCohortR2Port,
  type DnaPopulationEntrantAuthorityPreparedCohort,
} from "@/lib/dna-population-entrant-authority-cohort";
import type {
  DnaPopulationEntrantAuthorityCheckpoint,
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityChunkManifest,
} from "@/lib/dna-population-entrant-authority-checkpoint";
import type { DnaPopulationEntrantAuthorityCapacityGate } from "@/lib/dna-population-entrant-authority-commit-protocol";
import {
  dnaPopulationEntrantAuthorityQuarantineRecord,
  type DnaPopulationEntrantAuthorityRecord,
} from "@/lib/dna-population-entrant-authority-record";
import type { DnaPopulationEntrantAuthorityR2ChunkReceipt } from "@/lib/dna-population-entrant-authority-r2-store";
import {
  planDnaPopulationHistoryAcquisition,
  type DnaPopulationHistoryAcquisitionPlan,
} from "@/lib/dna-population-history-acquisition-plan";
import {
  createDnaOpenLabRequestBudget,
  type DnaOpenLabRequestBudget,
} from "@/lib/dna-open-lab-request-budget";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";
import type {
  DnaOpenLabClient,
  DnaOpenLabResponse,
  DnaRaceDocument,
  DnaRaceIdentifier,
} from "@/lib/dna-open-lab-v1-client";

const STARTED_AT = "2026-09-26T01:00:00.000Z";
const OBSERVED_AT = "2026-09-26T01:01:00.000Z";
const REGISTERED_AT = "2026-09-26T01:02:00.000Z";

function raceId(index: number): string {
  return `race-${String(index).padStart(4, "0")}`;
}

function unresolvedRaceDocuments(
  count: number,
): readonly CanonicalRaceDocumentMetadata[] {
  return Object.freeze(
    Array.from({ length: count }, (_, index) =>
      Object.freeze({
        sourceType: "race_document" as const,
        sourceRaceId: raceId(index + 1),
        mode: "bike" as const,
      }),
    ),
  );
}

function planFor(
  raceDocuments: readonly CanonicalRaceDocumentMetadata[],
): DnaPopulationHistoryAcquisitionPlan {
  return planDnaPopulationHistoryAcquisition({ raceDocuments });
}

function authorityFor(
  plan: DnaPopulationHistoryAcquisitionPlan,
): DnaPopulationEntrantAuthorityCheckpointAuthority {
  if (plan.unresolvedRaceSetSha256 === null) {
    throw new Error("synthetic plan is unexpectedly complete");
  }
  return Object.freeze({
    version: 1 as const,
    generationId: plan.unresolvedRaceSetSha256,
    unresolvedRaceCount: plan.unresolvedRaceCount,
    unresolvedRaceSetSha256: plan.unresolvedRaceSetSha256,
  });
}

function emptyCheckpoint(
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority,
): DnaPopulationEntrantAuthorityCheckpoint {
  return Object.freeze({
    ...authority,
    chunkCount: 0,
    persistedRaceCount: 0,
    lastSourceRaceId: null,
    startedAt: STARTED_AT,
    updatedAt: STARTED_AT,
  });
}

function compactRecord(
  sourceRaceId: string,
  observedAt = STARTED_AT,
): DnaPopulationEntrantAuthorityRecord {
  return Object.freeze({
    sourceRaceId,
    observedAt,
    rawEvidenceSha256: "a".repeat(64),
    mode: "bike" as const,
    entrantCoreIds: Object.freeze(["1"]),
  });
}

function response(
  documents: readonly DnaRaceDocument[],
): DnaOpenLabResponse<readonly DnaRaceDocument[]> {
  return Object.freeze({
    result: documents,
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 30,
      remaining: 29,
      resetSeconds: 60,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
  });
}

function rawHydratedDocument(sourceRaceId: DnaRaceIdentifier): DnaRaceDocument {
  const numeric = Number(String(sourceRaceId).replace(/\D/gu, "")) || 1;
  return Object.freeze({
    rid: sourceRaceId,
    rvmode: "bike",
    hids: [numeric],
  }) as DnaRaceDocument;
}

function immediateRequestBudget(): DnaOpenLabRequestBudget {
  return Object.freeze({
    async execute<T>(
      request: () => Promise<DnaOpenLabResponse<T>>,
    ): Promise<DnaOpenLabResponse<T>> {
      return request();
    },
    observeRateLimit: () => undefined,
    reduceEffectiveRequestsPerMinute: () => undefined,
    snapshot: () =>
      Object.freeze({
        effectiveRequestsPerMinute: 30,
        requestsInCurrentWindow: 0,
        blockedUntilMilliseconds: null,
      }),
  });
}

type PriorChunk = Readonly<{
  chunk: DnaPopulationEntrantAuthorityChunk;
  receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt;
  manifest: DnaPopulationEntrantAuthorityChunkManifest;
}>;

function priorChunk(input: {
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  chunkOrdinal: number;
  records: readonly DnaPopulationEntrantAuthorityRecord[];
}): PriorChunk {
  const chunk = buildDnaPopulationEntrantAuthorityChunk({
    generationId: input.authority.generationId,
    chunkOrdinal: input.chunkOrdinal,
    records: input.records,
  });
  const receipt = Object.freeze({
    ...chunk.receipt,
    objectKey: `synthetic/${String(input.chunkOrdinal)}/${chunk.receipt.bodySha256}.json`,
  });
  return Object.freeze({
    chunk,
    receipt,
    manifest: Object.freeze({
      ...receipt,
      registeredAt: STARTED_AT,
    }),
  });
}

function harness(input: {
  authority: DnaPopulationEntrantAuthorityCheckpointAuthority;
  checkpoint?: DnaPopulationEntrantAuthorityCheckpoint;
  priorChunks?: readonly PriorChunk[];
  pendingChunk?: PriorChunk;
  pendingFailure?: boolean;
  failFirstRegistration?: boolean;
  capacityFailure?: boolean;
  provider?: (
    raceIds: readonly DnaRaceIdentifier[],
  ) => readonly DnaRaceDocument[];
}) {
  const events: string[] = [];
  const providerCalls: DnaRaceIdentifier[][] = [];
  const storedByOrdinal = new Map<number, PriorChunk>();
  for (const entry of input.priorChunks ?? []) {
    storedByOrdinal.set(entry.receipt.chunkOrdinal, entry);
  }
  if (input.pendingChunk !== undefined) {
    storedByOrdinal.set(
      input.pendingChunk.receipt.chunkOrdinal,
      input.pendingChunk,
    );
  }
  const manifests: DnaPopulationEntrantAuthorityChunkManifest[] = (
    input.priorChunks ?? []
  ).map((entry) => entry.manifest);
  let checkpoint = input.checkpoint ?? emptyCheckpoint(input.authority);
  let registrationCalls = 0;
  let writeCalls = 0;

  const checkpointRepository = Object.freeze({
    read: vi.fn(async () => {
      events.push("checkpoint-read");
      return checkpoint;
    }),
    listChunkManifests: vi.fn(
      async (
        _ownerId: string,
        request: { afterChunkOrdinal: number; limit: number },
      ) => {
        events.push("manifest-list");
        return Object.freeze(
          manifests
            .filter(
              (manifest) => manifest.chunkOrdinal > request.afterChunkOrdinal,
            )
            .slice(0, request.limit),
        );
      },
    ),
    registerChunk: vi.fn(
      async (
        _ownerId: string,
        request: {
          receipt: DnaPopulationEntrantAuthorityR2ChunkReceipt;
          registeredAt: string;
        },
      ) => {
        events.push("manifest-register");
        registrationCalls += 1;
        if (input.failFirstRegistration && registrationCalls === 1) {
          throw new Error("private synthetic registration detail");
        }
        manifests.push(
          Object.freeze({
            ...request.receipt,
            registeredAt: request.registeredAt,
          }),
        );
        checkpoint = Object.freeze({
          ...checkpoint,
          chunkCount: checkpoint.chunkCount + 1,
          persistedRaceCount:
            checkpoint.persistedRaceCount + request.receipt.rowCount,
          lastSourceRaceId: request.receipt.lastSourceRaceId,
          updatedAt: request.registeredAt,
        });
        return checkpoint;
      },
    ),
  });

  const r2Store: DnaPopulationEntrantAuthorityCohortR2Port = Object.freeze({
    read: vi.fn(async (receipt) => {
      events.push("r2-read");
      const stored = storedByOrdinal.get(receipt.chunkOrdinal);
      if (
        stored === undefined ||
        stored.receipt.bodySha256 !== receipt.bodySha256
      ) {
        throw new Error("private synthetic R2 read detail");
      }
      return stored.chunk;
    }),
    findPending: vi.fn(async (request) => {
      events.push("pending-find");
      if (input.pendingFailure) {
        throw new Error("private pending discovery detail");
      }
      const stored = storedByOrdinal.get(request.chunkOrdinal);
      return stored === undefined
        ? null
        : Object.freeze({
            receipt: stored.receipt,
            chunk: stored.chunk,
          });
    }),
    write: vi.fn(async (request) => {
      events.push("r2-write");
      writeCalls += 1;
      const chunk = buildDnaPopulationEntrantAuthorityChunk(request);
      const existing = storedByOrdinal.get(request.chunkOrdinal);
      if (existing !== undefined) {
        if (existing.receipt.bodySha256 !== chunk.receipt.bodySha256) {
          throw new Error("private synthetic R2 conflict detail");
        }
        return Object.freeze({
          receipt: existing.receipt,
          storageStatus: "existing" as const,
        });
      }
      const created = priorChunk({
        authority: input.authority,
        chunkOrdinal: request.chunkOrdinal,
        records: request.records,
      });
      storedByOrdinal.set(request.chunkOrdinal, created);
      return Object.freeze({
        receipt: created.receipt,
        storageStatus: "created" as const,
      });
    }),
  });

  const capacityGate: DnaPopulationEntrantAuthorityCapacityGate = Object.freeze(
    {
      assertFreshCurrentCapacity: vi.fn(async () => {
        events.push("capacity");
        if (input.capacityFailure) {
          throw new Error("private capacity detail");
        }
        return Object.freeze({
          version: 1 as const,
          generationId: input.authority.generationId,
          unresolvedRaceCount: input.authority.unresolvedRaceCount,
          unresolvedRaceSetSha256: input.authority.unresolvedRaceSetSha256,
          observedAt: "2026-09-26T01:01:30.000Z",
          capacityAllowed: true as const,
          paidUsageAllowed: false as const,
        });
      }),
    },
  );

  const client: Pick<DnaOpenLabClient, "raceDocs"> = Object.freeze({
    raceDocs: vi.fn(async (raceIds) => {
      events.push("dna");
      providerCalls.push([...raceIds]);
      return response(
        input.provider?.(raceIds) ??
          [...raceIds]
            .reverse()
            .map((sourceRaceId) => rawHydratedDocument(sourceRaceId)),
      );
    }),
  });

  return {
    capacityGate,
    checkpointRepository,
    client,
    events,
    getCheckpoint: () => checkpoint,
    getStoredChunkCount: () => storedByOrdinal.size,
    getWriteCalls: () => writeCalls,
    providerCalls,
    r2Store,
  };
}

async function prepare(input: {
  raceDocuments: readonly CanonicalRaceDocumentMetadata[];
  test: ReturnType<typeof harness>;
  plan?: DnaPopulationHistoryAcquisitionPlan;
  authority?: DnaPopulationEntrantAuthorityCheckpointAuthority;
  requestBudget?: DnaOpenLabRequestBudget;
}): Promise<DnaPopulationEntrantAuthorityPreparedCohort> {
  const plan = input.plan ?? planFor(input.raceDocuments);
  const authority = input.authority ?? authorityFor(plan);
  return prepareDnaPopulationEntrantAuthorityCohort({
    ownerId: "private-owner",
    plan,
    raceDocuments: input.raceDocuments,
    authority,
    client: input.test.client,
    requestBudget: input.requestBudget ?? immediateRequestBudget(),
    capacityGate: input.test.capacityGate,
    checkpointRepository: input.test.checkpointRepository,
    r2Store: input.test.r2Store,
    cohortObservedAt: OBSERVED_AT,
  });
}

describe("DNA population entrant authority cohort bridge", () => {
  it("prepares exact strict hydration then commits through capacity, R2 and Neon", async () => {
    const raceDocuments = unresolvedRaceDocuments(45);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const test = harness({ authority });

    const prepared = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    });

    expect(test.providerCalls.map((batch) => batch.length)).toEqual([
      20, 20, 5,
    ]);
    expect(prepared.summary).toMatchObject({
      status: "prepared_uncommitted",
      selectedRaceCount: 45,
      resolvedRaceCount: 45,
      quarantinedRaceCount: 0,
      providerRequestCount: 3,
      preparationSource: "provider_hydration",
      recoveredRaceCount: 0,
      chunkOrdinal: 1,
      aggregateRequestsPerMinute: 30,
      providerRequestPerformed: true,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(test.capacityGate.assertFreshCurrentCapacity).not.toHaveBeenCalled();
    expect(test.r2Store.write).not.toHaveBeenCalled();
    expect(JSON.stringify(prepared.summary)).not.toContain(raceId(1));

    const committed = await prepared.commit({
      registeredAt: REGISTERED_AT,
    });

    expect(committed).toMatchObject({
      status: "committed",
      chunkOrdinal: 1,
      rowCount: 45,
      resolvedRaceCount: 45,
      quarantinedRaceCount: 0,
      storageStatus: "created",
      checkpointRaceCountBefore: 0,
      checkpointRaceCountAfter: 45,
      authorityComplete: true,
      providerRequestPerformed: false,
      persistentWritePerformed: true,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(test.events.slice(-4)).toEqual([
      "checkpoint-read",
      "capacity",
      "r2-write",
      "manifest-register",
    ]);
  });

  it("selects the 5,000-row capacity-projected chunk while the shared budget remains 30/min", async () => {
    const raceDocuments = unresolvedRaceDocuments(
      DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES + 1,
    );
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const test = harness({ authority });

    const prepared = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    });

    expect(DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES).toBe(5_000);
    expect(prepared.summary.selectedRaceCount).toBe(5_000);
    expect(prepared.summary.resolvedRaceCount).toBe(5_000);
    expect(prepared.summary.quarantinedRaceCount).toBe(0);
    expect(prepared.summary.providerRequestCount).toBe(250);
    expect(prepared.summary.aggregateRequestsPerMinute).toBe(30);
    expect(test.providerCalls).toHaveLength(250);
    expect(test.providerCalls.every((batch) => batch.length === 20)).toBe(true);
    expect(test.r2Store.write).not.toHaveBeenCalled();
  });

  it("resumes exactly after a recovered audited prefix", async () => {
    const raceDocuments = unresolvedRaceDocuments(5);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const previous = priorChunk({
      authority,
      chunkOrdinal: 1,
      records: [compactRecord(raceId(1)), compactRecord(raceId(2))],
    });
    const checkpoint = Object.freeze({
      ...authority,
      chunkCount: 1,
      persistedRaceCount: 2,
      lastSourceRaceId: raceId(2),
      startedAt: STARTED_AT,
      updatedAt: STARTED_AT,
    });
    const test = harness({
      authority,
      checkpoint,
      priorChunks: [previous],
    });

    const prepared = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    });

    expect(test.providerCalls).toEqual([[raceId(3), raceId(4), raceId(5)]]);
    expect(prepared.summary).toMatchObject({
      recoveredRaceCount: 2,
      chunkOrdinal: 2,
      selectedRaceCount: 3,
    });
  });

  it("recovers the exact pending R2 cohort after process loss without DNA hydration", async () => {
    const raceDocuments = unresolvedRaceDocuments(3);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const pending = priorChunk({
      authority,
      chunkOrdinal: 1,
      records: [
        compactRecord(raceId(1), OBSERVED_AT),
        compactRecord(raceId(2), OBSERVED_AT),
        compactRecord(raceId(3), OBSERVED_AT),
      ],
    });
    const test = harness({ authority, pendingChunk: pending });

    const prepared = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    });

    expect(prepared.summary).toMatchObject({
      preparationSource: "pending_r2_recovery",
      providerRequestCount: 0,
      providerRequestPerformed: false,
      selectedRaceCount: 3,
      resolvedRaceCount: 3,
      quarantinedRaceCount: 0,
      chunkOrdinal: 1,
      cohortObservedAt: OBSERVED_AT,
    });
    expect(test.providerCalls).toHaveLength(0);
    expect(test.events).toEqual(["checkpoint-read", "pending-find"]);

    const committed = await prepared.commit({
      registeredAt: REGISTERED_AT,
    });

    expect(committed).toMatchObject({
      storageStatus: "existing",
      checkpointRaceCountBefore: 0,
      checkpointRaceCountAfter: 3,
      resolvedRaceCount: 3,
      quarantinedRaceCount: 0,
      authorityComplete: true,
    });
    expect(test.providerCalls).toHaveLength(0);
  });

  it("recovers quarantined pending R2 outcomes without a second DNA hydration", async () => {
    const raceDocuments = unresolvedRaceDocuments(2);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const pending = priorChunk({
      authority,
      chunkOrdinal: 1,
      records: [
        compactRecord(raceId(1), OBSERVED_AT),
        dnaPopulationEntrantAuthorityQuarantineRecord({
          sourceRaceId: raceId(2),
          observedAt: OBSERVED_AT,
          quarantineReason: "provider_document_missing",
        }),
      ],
    });
    const test = harness({ authority, pendingChunk: pending });

    const prepared = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    });

    expect(prepared.summary).toMatchObject({
      preparationSource: "pending_r2_recovery",
      selectedRaceCount: 2,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 1,
      providerRequestCount: 0,
      providerRequestPerformed: false,
    });
    expect(test.providerCalls).toHaveLength(0);

    const committed = await prepared.commit({
      registeredAt: REGISTERED_AT,
    });
    expect(committed).toMatchObject({
      rowCount: 2,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 1,
      checkpointRaceCountAfter: 2,
      authorityComplete: true,
      storageStatus: "existing",
    });
    expect(test.providerCalls).toHaveLength(0);
  });

  it("rejects a short pending prefix when the deterministic next cohort should be larger", async () => {
    const raceDocuments = unresolvedRaceDocuments(
      DNA_POPULATION_ENTRANT_AUTHORITY_COHORT_MAXIMUM_RACES + 1,
    );
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const pending = priorChunk({
      authority,
      chunkOrdinal: 1,
      records: [compactRecord(raceId(1), OBSERVED_AT)],
    });
    const test = harness({ authority, pendingChunk: pending });

    const error = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "pending_recovery_mismatch",
    });
    expect(test.providerCalls).toHaveLength(0);
    expect(test.r2Store.write).not.toHaveBeenCalled();
  });

  it("fails closed when a pending R2 cohort does not match the audited next Race slice", async () => {
    const raceDocuments = unresolvedRaceDocuments(3);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const pending = priorChunk({
      authority,
      chunkOrdinal: 1,
      records: [
        compactRecord(raceId(1), OBSERVED_AT),
        compactRecord(raceId(3), OBSERVED_AT),
      ],
    });
    const test = harness({ authority, pendingChunk: pending });

    const error = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "pending_recovery_mismatch",
      message: "Population entrant cohort processing is unavailable",
    });
    expect(test.providerCalls).toHaveLength(0);
    expect(test.capacityGate.assertFreshCurrentCapacity).not.toHaveBeenCalled();
    expect(test.r2Store.write).not.toHaveBeenCalled();
  });

  it("sanitizes pending discovery failure before DNA hydration", async () => {
    const raceDocuments = unresolvedRaceDocuments(2);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const test = harness({ authority, pendingFailure: true });

    const error = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "pending_recovery_unavailable",
      message: "Population entrant cohort processing is unavailable",
    });
    expect(String(error)).not.toContain("private pending discovery detail");
    expect(test.providerCalls).toHaveLength(0);
  });

  it("rejects recovered content with the right boundary but the wrong Race set", async () => {
    const raceDocuments = unresolvedRaceDocuments(5);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const previous = priorChunk({
      authority,
      chunkOrdinal: 1,
      records: [
        compactRecord(raceId(1)),
        compactRecord("race-0002x"),
        compactRecord(raceId(3)),
      ],
    });
    const checkpoint = Object.freeze({
      ...authority,
      chunkCount: 1,
      persistedRaceCount: 3,
      lastSourceRaceId: raceId(3),
      startedAt: STARTED_AT,
      updatedAt: STARTED_AT,
    });
    const test = harness({
      authority,
      checkpoint,
      priorChunks: [previous],
    });

    const error = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "recovered_boundary_mismatch",
      message: "Population entrant cohort processing is unavailable",
    });
    expect(test.providerCalls).toHaveLength(0);
    expect(test.r2Store.write).not.toHaveBeenCalled();
  });

  it("fails closed before provider access when audited authority drifts", async () => {
    const raceDocuments = unresolvedRaceDocuments(3);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const driftedPlan = Object.freeze({
      ...plan,
      unresolvedRaceCount: plan.unresolvedRaceCount + 1,
    });
    const test = harness({ authority });

    const error = await prepare({
      raceDocuments,
      plan: driftedPlan,
      authority,
      test,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "audited_authority_mismatch",
    });
    expect(test.providerCalls).toHaveLength(0);
    expect(test.capacityGate.assertFreshCurrentCapacity).not.toHaveBeenCalled();
    expect(test.r2Store.write).not.toHaveBeenCalled();
  });

  it("quarantines one isolated missing Race and advances the full audited checkpoint", async () => {
    const raceDocuments = unresolvedRaceDocuments(2);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const test = harness({
      authority,
      provider: (raceIds) => [rawHydratedDocument(raceIds[0]!)],
    });

    const prepared = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    });

    expect(prepared.summary).toMatchObject({
      selectedRaceCount: 2,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 1,
      providerRequestCount: 1,
      preparationSource: "provider_hydration",
    });
    expect(test.r2Store.write).not.toHaveBeenCalled();

    const committed = await prepared.commit({
      registeredAt: REGISTERED_AT,
    });

    expect(committed).toMatchObject({
      rowCount: 2,
      resolvedRaceCount: 1,
      quarantinedRaceCount: 1,
      checkpointRaceCountBefore: 0,
      checkpointRaceCountAfter: 2,
      authorityComplete: true,
    });
  });

  it("fails closed instead of mass-quarantining an empty multi-Race provider batch", async () => {
    const raceDocuments = unresolvedRaceDocuments(2);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const test = harness({
      authority,
      provider: () => [],
    });

    const error = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "hydration_unavailable",
      message: "Population entrant cohort processing is unavailable",
    });
    expect(test.capacityGate.assertFreshCurrentCapacity).not.toHaveBeenCalled();
    expect(test.r2Store.write).not.toHaveBeenCalled();
    expect(test.checkpointRepository.registerChunk).not.toHaveBeenCalled();
  });

  it("rejects an aggregate request budget above 30/min before transport", async () => {
    const raceDocuments = unresolvedRaceDocuments(2);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const test = harness({ authority });
    const requestBudget = createDnaOpenLabRequestBudget({
      initialRequestsPerMinute: 31,
      maximumRequestsPerMinute: 31,
    });

    const error = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
      requestBudget,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "request_budget_invalid",
    });
    expect(test.providerCalls).toHaveLength(0);
    expect(test.r2Store.write).not.toHaveBeenCalled();
  });

  it("replays an interrupted commit from the same prepared cohort without rehydrating DNA", async () => {
    const raceDocuments = unresolvedRaceDocuments(3);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const test = harness({
      authority,
      failFirstRegistration: true,
    });
    const prepared = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    });
    expect(test.providerCalls).toHaveLength(1);

    const firstError = await prepared
      .commit({ registeredAt: REGISTERED_AT })
      .catch((caught: unknown) => caught);

    expect(firstError).toMatchObject({
      diagnostic: "commit_unavailable",
      message: "Population entrant cohort processing is unavailable",
    });
    expect(String(firstError)).not.toContain(
      "private synthetic registration detail",
    );
    expect(test.getCheckpoint().persistedRaceCount).toBe(0);
    expect(test.getStoredChunkCount()).toBe(1);

    const replay = await prepared.commit({
      registeredAt: REGISTERED_AT,
    });

    expect(replay.storageStatus).toBe("existing");
    expect(replay.checkpointRaceCountBefore).toBe(0);
    expect(replay.checkpointRaceCountAfter).toBe(3);
    expect(test.getWriteCalls()).toBe(2);
    expect(test.getStoredChunkCount()).toBe(1);
    expect(test.providerCalls).toHaveLength(1);
    expect(test.capacityGate.assertFreshCurrentCapacity).toHaveBeenCalledTimes(
      2,
    );
  });

  it("sanitizes fresh-capacity failure before any persistent write", async () => {
    const raceDocuments = unresolvedRaceDocuments(2);
    const plan = planFor(raceDocuments);
    const authority = authorityFor(plan);
    const test = harness({ authority, capacityFailure: true });
    const prepared = await prepare({
      raceDocuments,
      plan,
      authority,
      test,
    });

    const error = await prepared
      .commit({ registeredAt: REGISTERED_AT })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      diagnostic: "commit_unavailable",
      message: "Population entrant cohort processing is unavailable",
    });
    expect(String(error)).not.toContain("private capacity detail");
    expect(test.r2Store.write).not.toHaveBeenCalled();
    expect(test.checkpointRepository.registerChunk).not.toHaveBeenCalled();
  });
});
