import { describe, expect, it, vi } from "vitest";

import type { DnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import {
  DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
  type DnaOpenLabP5FirstBackfillApprovalPacket,
} from "@/lib/dna-open-lab-p5-first-backfill-approval";
import type {
  DnaOpenLabP5FirstBackfillFamilyInventoryResult,
  DnaOpenLabP5FirstBackfillInventoryRequest,
} from "@/lib/dna-open-lab-p5-first-backfill-inventory-runner";
import {
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES,
  type DnaOpenLabP5FirstBackfillSourceFamily,
} from "@/lib/dna-open-lab-p5-first-backfill-measurement";
import {
  DNA_OPEN_LAB_P5_PERSISTENT_COMMISSIONING_REQUESTS_PER_MINUTE,
  runDnaOpenLabP5FirstBackfillPersistentAcquisition,
  type DnaOpenLabP5PersistentCommissioningRateAuthorization,
} from "@/lib/dna-open-lab-p5-first-backfill-persistent-acquisition";
import type {
  DnaOpenLabP5FirstBackfillPersistenceCoordinator,
  DnaOpenLabP5FirstBackfillPersistenceSnapshot,
  DnaOpenLabP5FirstBackfillReplay,
} from "@/lib/dna-open-lab-p5-first-backfill-persistence-coordinator";
import type {
  DnaOpenLabResponse,
  DnaOpenLabScope,
} from "@/lib/dna-open-lab-v1-client";

const observedAt = "2026-09-02T06:00:00.000Z";

function approval(): DnaOpenLabP5FirstBackfillApprovalPacket {
  const current = DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET;
  if (current.measuredUpperBound === null) throw new Error("missing fixture");
  return Object.freeze({
    ...current,
    measuredUpperBound: Object.freeze({
      ...current.measuredUpperBound,
      apiRequestUpperBound: 12,
      classBOperationsUpperBound: 36,
    }),
  });
}

function response(result: unknown): DnaOpenLabResponse<unknown> {
  return Object.freeze({
    result,
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 150,
      remaining: 149,
      resetSeconds: 60,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
  });
}

function scope(family: DnaOpenLabP5FirstBackfillSourceFamily): DnaOpenLabScope {
  if (family === "finished_races" || family === "race_activity") return "races";
  if (family === "token_prices") return "tokens";
  if (family === "vault_identity") return "vault";
  if (family === "core_current_state") return "cores";
  return "splice";
}

function familyResult(
  family: DnaOpenLabP5FirstBackfillSourceFamily,
): DnaOpenLabP5FirstBackfillFamilyInventoryResult {
  return Object.freeze({
    family,
    authorityClass:
      family === "finished_races"
        ? "available_paginated_history_at_cutoff"
        : family === "vault_identity"
          ? "bounded_recent_state_only"
          : "current_state_only",
    observedAt,
    terminalInventoryObserved: true,
    observedSourceRecordCount: 1,
    unresolvedIdentityObservationUpperBound:
      family === "finished_races" ? 1 : 0,
    sourceRecordUpperBound: 2,
    apiRequestUpperBound: 2,
    retainedR2BytesUpperBound: 1_000,
    classAOperationsUpperBound: 2,
    classBOperationsUpperBound: 6,
    neonIncrementalBytesUpperBound: 1_000,
    evidenceRef: `aggregate-sha256:${"a".repeat(64)}`,
  });
}

function pool(requestsPerMinute = 30): {
  pool: DnaOpenLabClientPool;
  execute: ReturnType<typeof vi.fn>;
} {
  let requestCount = 0;
  const execute = vi.fn(
    async (input: Parameters<DnaOpenLabClientPool["execute"]>[0]) => {
      requestCount += 1;
      return input.request({} as never, "key-1");
    },
  );
  return {
    pool: {
      execute: execute as DnaOpenLabClientPool["execute"],
      snapshot: () => ({
        independentRateBucketsEnabled: false,
        aggregateBudget: {
          effectiveRequestsPerMinute: requestsPerMinute,
          requestsInCurrentWindow: requestCount,
          blockedUntilMilliseconds: null,
        },
        lanes: [
          {
            id: "key-1",
            scopes: ["vault", "races", "cores", "tokens", "splice"],
            requestCount,
            successCount: requestCount,
            rateLimitedCount: 0,
            budget: {
              effectiveRequestsPerMinute: requestsPerMinute,
              requestsInCurrentWindow: requestCount,
              blockedUntilMilliseconds: null,
            },
          },
        ],
      }),
    },
    execute,
  };
}

function persistenceState(
  overrides: Partial<DnaOpenLabP5FirstBackfillPersistenceSnapshot> = {},
): DnaOpenLabP5FirstBackfillPersistenceSnapshot {
  return Object.freeze({
    status: "running",
    revision: "0",
    nextRequestOrdinal: 1,
    logicalRequestCount: 0,
    retainedR2Bytes: 0,
    omittedIdentityObservationCount: 0,
    completionSha256: null,
    ...overrides,
  });
}

function coordinator(
  input: {
    replay?: (
      ordinal: number,
    ) => Promise<DnaOpenLabP5FirstBackfillReplay | null>;
    initial?: DnaOpenLabP5FirstBackfillPersistenceSnapshot;
  } = {},
): {
  coordinator: DnaOpenLabP5FirstBackfillPersistenceCoordinator;
  record: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
} {
  let state = input.initial ?? persistenceState();
  const record = vi.fn(
    async (value: { omittedIdentityObservationCount?: 0 | 1 }) => {
      state = persistenceState({
        revision: String(Number(state.revision) + 1),
        nextRequestOrdinal: state.nextRequestOrdinal + 1,
        logicalRequestCount: state.logicalRequestCount + 1,
        retainedR2Bytes: state.retainedR2Bytes + 100,
        omittedIdentityObservationCount:
          state.omittedIdentityObservationCount +
          (value.omittedIdentityObservationCount ?? 0),
      });
      return state;
    },
  );
  const complete = vi.fn(async () => {
    state = persistenceState({
      ...state,
      status: "complete",
      completionSha256: "c".repeat(64),
    });
    return state;
  });
  return {
    coordinator: {
      initialize: vi.fn(async () => state),
      record,
      replay: vi.fn(input.replay ?? (async () => null)),
      complete,
      snapshot: () => state,
    },
    record,
    complete,
  };
}

function measurer(): (input: {
  family: DnaOpenLabP5FirstBackfillSourceFamily;
  request: DnaOpenLabP5FirstBackfillInventoryRequest;
}) => Promise<DnaOpenLabP5FirstBackfillFamilyInventoryResult> {
  return async ({ family, request }) => {
    const result =
      family === "finished_races" ? [{ rid: null }] : [{ ok: true }];
    await request({
      scope: scope(family),
      endpoint: `${family}.endpoint`,
      evidenceRequest: Object.freeze({ family }),
      ...(family === "finished_races"
        ? {
            classifyOmittedIdentityObservationCount: () => 1,
          }
        : {}),
      request: async () => response(result),
    });
    return familyResult(family);
  };
}

function rateAuthorization(
  packet: DnaOpenLabP5FirstBackfillApprovalPacket,
): DnaOpenLabP5PersistentCommissioningRateAuthorization {
  if (
    packet.identityOmissionAuthority === null ||
    packet.ownerAuthorization === null
  ) {
    throw new Error("missing fixture");
  }
  return Object.freeze({
    kind: "owner_approved_one_run_persistent_private_preview_backfill",
    maximumAggregateRequestsPerMinute:
      DNA_OPEN_LAB_P5_PERSISTENT_COMMISSIONING_REQUESTS_PER_MINUTE,
    maximumAuthorizedMicroUsd:
      packet.ownerAuthorization.maximumAuthorizedMicroUsd,
    measurementEvidenceSha256:
      packet.identityOmissionAuthority.measurementEvidenceSha256,
  });
}

describe("DNA Open Lab P5 persistent first-backfill acquisition", () => {
  it("persists the exact six-family sequence and completes at measured bounds", async () => {
    const clientPool = pool();
    const persisted = coordinator();
    const result = await runDnaOpenLabP5FirstBackfillPersistentAcquisition({
      clientPool: clientPool.pool,
      approvalPacket: approval(),
      coordinator: persisted.coordinator,
      measureFamily: measurer(),
      now: () => observedAt,
    });

    expect(result).toMatchObject({
      status: "complete",
      apiRequestAttemptCount: 6,
      replayedLogicalRequestCount: 0,
      newlyPersistedLogicalRequestCount: 6,
      persistence: {
        logicalRequestCount: 6,
        omittedIdentityObservationCount: 1,
      },
    });
    expect(persisted.record.mock.calls.map(([value]) => value.family)).toEqual(
      DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES,
    );
    expect(persisted.complete).toHaveBeenCalledOnce();
  });

  it("replays committed and R2-first responses without another API call", async () => {
    const clientPool = pool();
    const persisted = coordinator({
      initial: persistenceState({
        revision: "1",
        nextRequestOrdinal: 2,
        logicalRequestCount: 1,
        retainedR2Bytes: 100,
        omittedIdentityObservationCount: 1,
      }),
      replay: async (ordinal) => {
        if (ordinal > 2) return null;
        const family =
          DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES[ordinal - 1];
        if (family === undefined) return null;
        const document = Object.freeze({
          family,
          requestOrdinal: ordinal,
          endpoint: `${family}.endpoint`,
          request: Object.freeze({ family }),
          response: response(
            family === "finished_races" ? [{ rid: null }] : [{ ok: true }],
          ),
          observedAt,
        });
        return ordinal === 1
          ? Object.freeze({
              status: "committed" as const,
              document,
              omittedIdentityObservationCount: 1 as const,
            })
          : Object.freeze({
              status: "pending_neon_receipt" as const,
              document,
            });
      },
    });
    const result = await runDnaOpenLabP5FirstBackfillPersistentAcquisition({
      clientPool: clientPool.pool,
      approvalPacket: approval(),
      coordinator: persisted.coordinator,
      measureFamily: measurer(),
      now: () => observedAt,
    });

    expect(result.apiRequestAttemptCount).toBe(4);
    expect(result.replayedLogicalRequestCount).toBe(2);
    expect(result.newlyPersistedLogicalRequestCount).toBe(4);
    expect(persisted.record).toHaveBeenCalledTimes(5);
  });

  it("fails before transport when durable request identity drifted", async () => {
    const clientPool = pool();
    const persisted = coordinator({
      replay: async () => ({
        status: "committed",
        omittedIdentityObservationCount: 1,
        document: {
          family: "finished_races",
          requestOrdinal: 1,
          endpoint: "races.finished",
          request: { changed: true },
          response: response([{ rid: null }]),
          observedAt,
        },
      }),
    });
    await expect(
      runDnaOpenLabP5FirstBackfillPersistentAcquisition({
        clientPool: clientPool.pool,
        approvalPacket: approval(),
        coordinator: persisted.coordinator,
        measureFamily: measurer(),
      }),
    ).rejects.toThrow("durable replay disagrees with the acquisition plan");
    expect(clientPool.execute).not.toHaveBeenCalled();
    expect(persisted.record).not.toHaveBeenCalled();
  });

  it("requires the exact one-run authority above the 30 rpm default", async () => {
    const packet = approval();
    const clientPool = pool(150);
    const persisted = coordinator();
    await expect(
      runDnaOpenLabP5FirstBackfillPersistentAcquisition({
        clientPool: clientPool.pool,
        approvalPacket: packet,
        coordinator: persisted.coordinator,
        measureFamily: measurer(),
      }),
    ).rejects.toThrow("client pool exceeds its aggregate authority");
    await expect(
      runDnaOpenLabP5FirstBackfillPersistentAcquisition({
        clientPool: clientPool.pool,
        approvalPacket: packet,
        coordinator: persisted.coordinator,
        measureFamily: measurer(),
        rateAuthorization: rateAuthorization(packet),
        now: () => observedAt,
      }),
    ).resolves.toMatchObject({ status: "complete" });
  });

  it("returns an already-complete ledger without API or R2 mutation", async () => {
    const clientPool = pool();
    const persisted = coordinator({
      initial: persistenceState({
        status: "complete",
        revision: "7",
        nextRequestOrdinal: 7,
        logicalRequestCount: 6,
        omittedIdentityObservationCount: 1,
        completionSha256: "c".repeat(64),
      }),
    });
    await expect(
      runDnaOpenLabP5FirstBackfillPersistentAcquisition({
        clientPool: clientPool.pool,
        approvalPacket: approval(),
        coordinator: persisted.coordinator,
        measureFamily: measurer(),
      }),
    ).resolves.toMatchObject({ status: "already_complete" });
    expect(clientPool.execute).not.toHaveBeenCalled();
    expect(persisted.record).not.toHaveBeenCalled();
    expect(persisted.complete).not.toHaveBeenCalled();
  });
});
