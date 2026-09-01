import { describe, expect, it, vi } from "vitest";

import {
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_FAILURE_CODES,
  DNA_OPEN_LAB_P5_TEMPORARY_COMMISSIONING_REQUESTS_PER_MINUTE,
  runDnaOpenLabP5FirstBackfillInventory,
  type DnaOpenLabP5FirstBackfillFamilyInventoryResult,
} from "@/lib/dna-open-lab-p5-first-backfill-inventory-runner";
import { createDnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import type {
  DnaOpenLabClient,
  DnaOpenLabRateLimit,
  DnaOpenLabResponse,
  DnaOpenLabScope,
} from "@/lib/dna-open-lab-v1-client";

const exactMainCommit = "a".repeat(40);
const privatePayload = "private-owner-payload-must-not-emit";

function rateLimit(): DnaOpenLabRateLimit {
  return Object.freeze({
    limit: 150,
    remaining: 149,
    resetSeconds: 60,
    rateClass: "api_key",
    retryAfterSeconds: null,
  });
}

function response<T>(result: T): DnaOpenLabResponse<T> {
  return Object.freeze({ result, httpStatus: 200, rateLimit: rateLimit() });
}

function pool(input: { independent?: boolean; aggregate?: number } = {}) {
  const client = Object.freeze({}) as DnaOpenLabClient;
  const scopes: readonly DnaOpenLabScope[] = [
    "vault",
    "races",
    "cores",
    "tokens",
    "splice",
  ];
  return createDnaOpenLabClientPool({
    lanes: [
      { id: "key-1", client, scopes },
      { id: "key-2", client, scopes },
      { id: "key-3", client, scopes },
    ],
    aggregateRequestsPerMinute: input.aggregate ?? 30,
    maximumLaneRequestsPerMinute: input.aggregate ?? 30,
    allowIndependentRateBuckets: input.independent ?? false,
  });
}

const familyScopes = {
  finished_races: "races",
  race_activity: "races",
  token_prices: "tokens",
  vault_identity: "vault",
  core_current_state: "cores",
  splice_arena: "splice",
} as const;

const familyAuthority = {
  finished_races: "available_paginated_history_at_cutoff",
  race_activity: "current_state_only",
  token_prices: "current_state_only",
  vault_identity: "bounded_recent_state_only",
  core_current_state: "current_state_only",
  splice_arena: "current_state_only",
} as const;

function measurement() {
  return {
    exactMainCommit,
    acquisitionPlanChecksum: "b".repeat(64),
    measuredAt: "2026-09-01T06:00:00.000Z",
    authorityCutoffAt: "2026-09-01T05:59:59.999Z",
    repositoryRef: "refs/heads/main" as const,
    worktreeClean: true,
    executionMode: "non_persistent_complete_inventory" as const,
    connectedRecoverySuite: {
      status: "passed" as const,
      exactMainCommit,
      runRef: "private-connected-recovery-ref",
    },
    neon: { limitBytes: 536_870_912, baselineBytes: 10_000_000 },
    pricing: {
      authorityRef: "private-pricing-ref",
      effectiveAt: "2026-08-07T00:00:00.000Z",
      bytesPerBillableGb: 1_000_000_000,
      storageMicroUsdPerGbMonth: 15_000,
      classAMicroUsdPerMillion: 4_500_000,
      classBMicroUsdPerMillion: 360_000,
      dnaApiCostMicroUsdUpperBound: 0,
      neonCostMicroUsdUpperBound: 0,
    },
  };
}

function result(
  family: keyof typeof familyScopes,
  overrides: Partial<DnaOpenLabP5FirstBackfillFamilyInventoryResult> = {},
): DnaOpenLabP5FirstBackfillFamilyInventoryResult {
  return {
    family,
    authorityClass: familyAuthority[family],
    observedAt: "2026-09-01T05:59:59.999Z",
    terminalInventoryObserved: true,
    observedSourceRecordCount: 1,
    sourceRecordUpperBound: 1,
    apiRequestUpperBound: 1,
    retainedR2BytesUpperBound: 10_000,
    classAOperationsUpperBound: 1,
    classBOperationsUpperBound: 1,
    neonIncrementalBytesUpperBound: 1_000,
    evidenceRef: `private-${family}-evidence-ref`,
    ...overrides,
  };
}

describe("DNA Open Lab P5 first-backfill inventory runner", () => {
  it("keeps connected acquisition diagnostics aggregate-only and allowlisted", async () => {
    const diagnostics: unknown[] = [];
    const activePool = pool();
    await expect(
      runDnaOpenLabP5FirstBackfillInventory({
        clientPool: activePool,
        measurement: measurement(),
        measureFamily: async ({ request }) => {
          for (let requestIndex = 0; requestIndex < 2; requestIndex += 1) {
            await request({
              scope: "races",
              request: async () => response({ ok: true }),
            });
          }
          throw new Error("private payload or credential material");
        },
        cleanupMeasurement: async () => ({
          persistentOwnerDataWriteCount: 0,
          temporaryProviderResidueCount: 0,
          rawPayloadIncludedInEvidence: false,
          secretMaterialIncludedInEvidence: false,
        }),
        emitEvidence: async () => undefined,
        recordDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        requestDiagnosticInterval: 2,
      }),
    ).rejects.toThrow("inventory runner failed");

    expect(diagnostics).toEqual([
      {
        kind: "request_milestone",
        family: "finished_races",
        completedFamilyCount: 0,
        familyApiRequestCount: 2,
        totalApiRequestCount: 2,
      },
      {
        kind: "acquisition_failed",
        family: "finished_races",
        failureCode: "unexpected_error",
        completedFamilyCount: 0,
        familyApiRequestCount: 2,
        totalApiRequestCount: 2,
        rateLimitedRequestCount: 0,
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("private payload");
    expect(DNA_OPEN_LAB_P5_FIRST_BACKFILL_FAILURE_CODES).toContain(
      "finished_race_unprovable_saturation",
    );
  });

  it("routes all six families through one conservative pool and emits aggregate-only evidence", async () => {
    const clientPool = pool();
    const familyOrder: string[] = [];
    const progress: string[] = [];
    const emitted: string[] = [];
    const cleanupMeasurement = vi.fn(async () => ({
      persistentOwnerDataWriteCount: 0,
      temporaryProviderResidueCount: 0,
      rawPayloadIncludedInEvidence: false,
      secretMaterialIncludedInEvidence: false,
    }));

    const evidence = await runDnaOpenLabP5FirstBackfillInventory({
      clientPool,
      measurement: measurement(),
      measurementCompletedAt: () => "2026-09-01T06:01:00.000Z",
      measureFamily: async ({ family, request }) => {
        familyOrder.push(family);
        const observed = await request({
          scope: familyScopes[family],
          request: async (_client, laneId) =>
            response({ family, laneId, privatePayload }),
        });
        expect(observed.privatePayload).toBe(privatePayload);
        return result(family);
      },
      cleanupMeasurement,
      emitEvidence: async (canonicalJson) => {
        emitted.push(canonicalJson);
      },
      recordProgress: (stage) => progress.push(stage),
    });

    expect(familyOrder).toEqual([
      "finished_races",
      "race_activity",
      "token_prices",
      "vault_identity",
      "core_current_state",
      "splice_arena",
    ]);
    expect(clientPool.snapshot()).toMatchObject({
      independentRateBucketsEnabled: false,
      aggregateBudget: { effectiveRequestsPerMinute: 30 },
    });
    expect(
      clientPool.snapshot().lanes.map((lane) => lane.requestCount),
    ).toEqual([2, 2, 2]);
    expect(cleanupMeasurement).toHaveBeenCalledOnce();
    expect(progress).toEqual([
      "finished_races_complete",
      "race_activity_complete",
      "token_prices_complete",
      "vault_identity_complete",
      "core_current_state_complete",
      "splice_arena_complete",
      "cleanup_verified",
      "aggregate_evidence_emitted",
    ]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).not.toContain(privatePayload);
    expect(emitted[0]).not.toContain("private-connected-recovery-ref");
    expect(evidence).toMatchObject({
      exactMainCommit,
      measuredAt: "2026-09-01T06:01:00.000Z",
      persistentOwnerDataWriteCount: 0,
      temporaryProviderResidueCount: 0,
      firstPersistentPrivatePreviewBackfillAllowed: false,
      productionChangesAllowed: false,
    });
  });

  it("fails closed when response bytes or request counts exceed a family bound", async () => {
    const cleanupMeasurement = vi.fn(async () => ({
      persistentOwnerDataWriteCount: 0,
      temporaryProviderResidueCount: 0,
      rawPayloadIncludedInEvidence: false,
      secretMaterialIncludedInEvidence: false,
    }));
    const emitEvidence = vi.fn(async () => undefined);

    await expect(
      runDnaOpenLabP5FirstBackfillInventory({
        clientPool: pool(),
        measurement: measurement(),
        measureFamily: async ({ family, request }) => {
          await request({
            scope: familyScopes[family],
            request: async () => response({ payload: "x".repeat(500) }),
          });
          return result(family, { retainedR2BytesUpperBound: 1 });
        },
        cleanupMeasurement,
        emitEvidence,
      }),
    ).rejects.toThrow("inventory runner failed");
    expect(cleanupMeasurement).toHaveBeenCalledOnce();
    expect(emitEvidence).not.toHaveBeenCalled();
  });

  it("always verifies cleanup after acquisition failure and rejects residue", async () => {
    const cleanupMeasurement = vi.fn(async () => ({
      persistentOwnerDataWriteCount: 0,
      temporaryProviderResidueCount: 1,
      rawPayloadIncludedInEvidence: false,
      secretMaterialIncludedInEvidence: false,
    }));

    await expect(
      runDnaOpenLabP5FirstBackfillInventory({
        clientPool: pool(),
        measurement: measurement(),
        measureFamily: async () => {
          throw new Error(privatePayload);
        },
        cleanupMeasurement,
        emitEvidence: async () => undefined,
      }),
    ).rejects.toThrow(
      "DNA Open Lab P5 first backfill inventory runner failed.",
    );
    expect(cleanupMeasurement).toHaveBeenCalledOnce();
  });

  it("rejects an independent-bucket pool before any family acquisition", async () => {
    const measureFamily = vi.fn();
    const cleanupMeasurement = vi.fn();
    await expect(
      runDnaOpenLabP5FirstBackfillInventory({
        clientPool: pool({ independent: true }),
        measurement: measurement(),
        measureFamily,
        cleanupMeasurement,
        emitEvidence: async () => undefined,
      }),
    ).rejects.toThrow("inventory runner failed");
    expect(measureFamily).not.toHaveBeenCalled();
    expect(cleanupMeasurement).not.toHaveBeenCalled();
  });

  it("requires an explicit one-run authorization above the standing 30 rpm ceiling", async () => {
    const measureFamily = vi.fn();
    const cleanupMeasurement = vi.fn();
    await expect(
      runDnaOpenLabP5FirstBackfillInventory({
        clientPool: pool({
          aggregate:
            DNA_OPEN_LAB_P5_TEMPORARY_COMMISSIONING_REQUESTS_PER_MINUTE,
        }),
        measurement: measurement(),
        measureFamily,
        cleanupMeasurement,
        emitEvidence: async () => undefined,
      }),
    ).rejects.toThrow("inventory runner failed");
    expect(measureFamily).not.toHaveBeenCalled();
    expect(cleanupMeasurement).not.toHaveBeenCalled();

    const authorizedPool = pool({
      aggregate: DNA_OPEN_LAB_P5_TEMPORARY_COMMISSIONING_REQUESTS_PER_MINUTE,
    });
    const cleanup = vi.fn(async () => ({
      persistentOwnerDataWriteCount: 0,
      temporaryProviderResidueCount: 0,
      rawPayloadIncludedInEvidence: false,
      secretMaterialIncludedInEvidence: false,
    }));
    const emitted: string[] = [];
    await runDnaOpenLabP5FirstBackfillInventory({
      clientPool: authorizedPool,
      temporaryCommissioningRateAuthorization: {
        kind: "owner_approved_one_run_non_persistent_measurement",
        maximumAggregateRequestsPerMinute:
          DNA_OPEN_LAB_P5_TEMPORARY_COMMISSIONING_REQUESTS_PER_MINUTE,
      },
      measurement: measurement(),
      measureFamily: async ({ family, request }) => {
        await request({
          scope: familyScopes[family],
          request: async () => response({ ok: true }),
        });
        return result(family);
      },
      cleanupMeasurement: cleanup,
      emitEvidence: async (canonicalJson) => {
        emitted.push(canonicalJson);
      },
    });
    expect(authorizedPool.snapshot()).toMatchObject({
      independentRateBucketsEnabled: false,
      aggregateBudget: {
        effectiveRequestsPerMinute:
          DNA_OPEN_LAB_P5_TEMPORARY_COMMISSIONING_REQUESTS_PER_MINUTE,
      },
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(emitted).toHaveLength(1);
  });

  it("rejects a family request routed through an unauthorized scope", async () => {
    const cleanupMeasurement = vi.fn(async () => ({
      persistentOwnerDataWriteCount: 0,
      temporaryProviderResidueCount: 0,
      rawPayloadIncludedInEvidence: false,
      secretMaterialIncludedInEvidence: false,
    }));
    await expect(
      runDnaOpenLabP5FirstBackfillInventory({
        clientPool: pool(),
        measurement: measurement(),
        measureFamily: async ({ family, request }) => {
          await request({
            scope: family === "finished_races" ? "vault" : familyScopes[family],
            request: async () => response({ ok: true }),
          });
          return result(family);
        },
        cleanupMeasurement,
        emitEvidence: async () => undefined,
      }),
    ).rejects.toThrow("inventory runner failed");
    expect(cleanupMeasurement).toHaveBeenCalledOnce();
  });
});
