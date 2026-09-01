import { describe, expect, it, vi } from "vitest";

import { createDnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import {
  createDnaOpenLabP5FirstBackfillFamilyAdapter,
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_ENDPOINT_LIMITS,
  type DnaOpenLabP5FirstBackfillFamilyObservation,
} from "@/lib/dna-open-lab-p5-first-backfill-family-adapter";
import { runDnaOpenLabP5FirstBackfillInventory } from "@/lib/dna-open-lab-p5-first-backfill-inventory-runner";
import { projectDnaOpenLabP5FirstBackfillFamilyUpperBounds } from "@/lib/dna-open-lab-p5-first-backfill-projection-policy";
import type {
  DnaActiveRace,
  DnaOpenLabClient,
  DnaOpenLabRateLimit,
  DnaOpenLabResponse,
  DnaOpenLabScope,
  DnaRaceDocument,
  DnaSpliceArenaResult,
} from "@/lib/dna-open-lab-v1-client";

const exactMainCommit = "a".repeat(40);
const historyStartAt = "1970-01-01T00:00:00.000Z";
const authorityCutoffAt = "2026-09-01T07:00:00.000Z";

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

function race(rid: number): DnaRaceDocument {
  return Object.freeze({ rid });
}

function activeRace(rid: number): DnaActiveRace {
  return Object.freeze({
    rid,
    status: "open",
    race_name: `Race ${rid}`,
    format: null,
    class: null,
    cb: null,
    rgate: 12,
    hs_in: 6,
    fee_fixed: Object.freeze({}),
    feeusd: 0,
    paytoken: "DEZ",
    start_time: null,
    version: 1,
    rvmode: "bike",
  });
}

function arenaResult(input: {
  page: number;
  hasMore: boolean;
  hids: readonly number[];
}): DnaSpliceArenaResult {
  return Object.freeze({
    page: input.page,
    has_more: input.hasMore,
    limit: 20,
    cores: Object.freeze(
      input.hids.map((hid) =>
        Object.freeze({
          hid,
          name: `Core ${hid}`,
          type: "Genesis",
          gender: "Female",
          element: "Fire",
          color: "Red",
          hex_code: "#ff0000",
          fno: 12,
          price_usd: 1,
        }),
      ),
    ),
  });
}

function fakeClient(
  input: {
    arenaPageOverride?: number;
    omitFill?: boolean;
  } = {},
): Readonly<{
  client: DnaOpenLabClient;
  coreBatchSizes: number[];
  raceBatchSizes: number[];
}> {
  const ownedCoreIds = Array.from({ length: 21 }, (_, index) => index + 1);
  const activeRaceIds = Array.from({ length: 21 }, (_, index) => index + 101);
  const coreBatchSizes: number[] = [];
  const raceBatchSizes: number[] = [];
  let finishedCall = 0;

  const coreBulk = (hids: readonly number[]) => {
    coreBatchSizes.push(hids.length);
    return response(Object.freeze(hids.map((hid) => Object.freeze({ hid }))));
  };

  const client = {
    racesFinished: vi.fn(async () => {
      finishedCall += 1;
      if (finishedCall === 1) {
        return response(
          Object.freeze(
            Array.from(
              {
                length:
                  DNA_OPEN_LAB_P5_FIRST_BACKFILL_ENDPOINT_LIMITS.finishedRaceWindow,
              },
              (_, index) => race(index + 1),
            ),
          ),
        );
      }
      return response(Object.freeze([race(finishedCall - 1)]));
    }),
    racesActive: vi.fn(async () =>
      response(Object.freeze(activeRaceIds.map(activeRace))),
    ),
    raceFills: vi.fn(async (rids: readonly (string | number)[]) => {
      raceBatchSizes.push(rids.length);
      return response(
        Object.freeze(
          (input.omitFill ? rids.slice(0, -1) : rids).map((rid) =>
            Object.freeze({
              rid,
              status: "open",
              rgate: 12,
              hs_in: 6,
              hids: Object.freeze([]),
              entry_txns_confirmed: Object.freeze({}),
            }),
          ),
        ),
      );
    }),
    tokenPrices: vi.fn(async () =>
      response(
        Object.freeze({
          ethusd: 1,
          btcusd: 1,
          dezusd: 1,
          hlxusd: 1,
          bgcusd: 1,
          tpusd: 1,
          methusd: 1,
          mbtcusd: 1,
        }),
      ),
    ),
    vaultInfo: vi.fn(async () =>
      response(
        Object.freeze({
          vault: "owner-vault",
          name: "Owner",
          profile_url: null,
          banner_url: null,
        }),
      ),
    ),
    vaultCoresFull: vi.fn(async () =>
      response(
        Object.freeze(
          ownedCoreIds.map((hid) =>
            Object.freeze({
              hid,
              name: `Core ${hid}`,
              type: "Genesis",
              element: "Fire",
              gender: "Female",
              fno: 12,
            }),
          ),
        ),
      ),
    ),
    vaultTierBadge: vi.fn(async () =>
      response(Object.freeze({ vault: "owner-vault", tot_score: 1 })),
    ),
    vaultRecentRaces: vi.fn(async () =>
      response(Object.freeze([race(901), race(902)])),
    ),
    coreInfoBulk: vi.fn(async (hids: readonly number[]) => coreBulk(hids)),
    coreRacingStatsBulk: vi.fn(async (hids: readonly number[]) =>
      coreBulk(hids),
    ),
    corePowerBulk: vi.fn(async (hids: readonly number[]) => coreBulk(hids)),
    coreListingPriceBulk: vi.fn(async (hids: readonly number[]) =>
      coreBulk(hids),
    ),
    coreAttachedAssetsBulk: vi.fn(async (hids: readonly number[]) =>
      coreBulk(hids),
    ),
    coreOwnerBulk: vi.fn(async (hids: readonly number[]) => coreBulk(hids)),
    coreStaminaBulk: vi.fn(async (hids: readonly number[]) => coreBulk(hids)),
    coreSplicingInfoBulk: vi.fn(async (hids: readonly number[]) =>
      coreBulk(hids),
    ),
    spliceArena: vi.fn(
      async (arenaInput: {
        filter: Readonly<{ rvmode: "bike" | "car" | "horse" }>;
        page?: number;
      }) => {
        const page = arenaInput.page ?? 1;
        if (arenaInput.filter.rvmode === "bike" && page === 1) {
          return response(
            arenaResult({
              page: input.arenaPageOverride ?? 1,
              hasMore: true,
              hids: [701],
            }),
          );
        }
        return response(
          arenaResult({
            page,
            hasMore: false,
            hids: [
              arenaInput.filter.rvmode === "bike"
                ? 702
                : arenaInput.filter.rvmode === "car"
                  ? 703
                  : 704,
            ],
          }),
        );
      },
    ),
  } as unknown as DnaOpenLabClient;

  return Object.freeze({ client, coreBatchSizes, raceBatchSizes });
}

function measurement() {
  return {
    exactMainCommit,
    acquisitionPlanChecksum: "b".repeat(64),
    measuredAt: "2026-09-01T07:01:00.000Z",
    authorityCutoffAt,
    repositoryRef: "refs/heads/main" as const,
    worktreeClean: true,
    executionMode: "non_persistent_complete_inventory" as const,
    connectedRecoverySuite: {
      status: "passed" as const,
      exactMainCommit,
      runRef: "private-recovery-ref",
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

describe("DNA Open Lab P5 first-backfill family adapter", () => {
  it("exhausts every endpoint family with adaptive history, bulk limits and terminal Arena pages", async () => {
    const fake = fakeClient();
    const scopes: readonly DnaOpenLabScope[] = [
      "vault",
      "races",
      "cores",
      "tokens",
      "splice",
    ];
    let nowMilliseconds = Date.parse("2026-09-01T07:00:00.000Z");
    const pool = createDnaOpenLabClientPool({
      lanes: [
        { id: "key-1", client: fake.client, scopes },
        { id: "key-2", client: fake.client, scopes },
        { id: "key-3", client: fake.client, scopes },
      ],
      aggregateRequestsPerMinute: 30,
      allowIndependentRateBuckets: false,
      nowMilliseconds: () => nowMilliseconds,
      sleep: async (milliseconds) => {
        nowMilliseconds += milliseconds;
      },
    });
    const observations: DnaOpenLabP5FirstBackfillFamilyObservation[] = [];
    const adapter = createDnaOpenLabP5FirstBackfillFamilyAdapter({
      vault: "owner-vault",
      finishedRaceHistoryStartAt: historyStartAt,
      authorityCutoffAt,
      projectUpperBounds: (observation) => {
        observations.push(observation);
        return projectDnaOpenLabP5FirstBackfillFamilyUpperBounds(observation);
      },
    });

    const evidence = await runDnaOpenLabP5FirstBackfillInventory({
      clientPool: pool,
      measurement: measurement(),
      measureFamily: adapter.measureFamily,
      cleanupMeasurement: async () => ({
        persistentOwnerDataWriteCount: 0,
        temporaryProviderResidueCount: 0,
        rawPayloadIncludedInEvidence: false,
        secretMaterialIncludedInEvidence: false,
      }),
      emitEvidence: async () => undefined,
    });

    expect(observations.map((entry) => entry.family)).toEqual([
      "finished_races",
      "race_activity",
      "token_prices",
      "vault_identity",
      "core_current_state",
      "splice_arena",
    ]);
    expect(observations[0]).toMatchObject({
      observedSourceRecordCount: 2,
      observedApiRequestCount: 3,
      terminalUnitCount: 2,
      splitCount: 1,
    });
    expect(observations[1]).toMatchObject({
      observedSourceRecordCount: 42,
      observedApiRequestCount: 3,
    });
    expect(observations[3]).toMatchObject({
      observedSourceRecordCount: 25,
      observedApiRequestCount: 4,
    });
    expect(observations[4]).toMatchObject({
      observedSourceRecordCount: 168,
      observedApiRequestCount: 16,
    });
    expect(observations[5]).toMatchObject({
      observedSourceRecordCount: 4,
      observedApiRequestCount: 4,
      terminalUnitCount: 4,
    });
    expect(fake.raceBatchSizes).toEqual([20, 1]);
    expect(fake.coreBatchSizes).toEqual([
      20, 20, 20, 20, 20, 20, 20, 20, 1, 1, 1, 1, 1, 1, 1, 1,
    ]);
    expect(pool.snapshot()).toMatchObject({
      independentRateBucketsEnabled: false,
      aggregateBudget: { effectiveRequestsPerMinute: 30 },
    });
    expect(evidence).toMatchObject({
      firstPersistentPrivatePreviewBackfillAllowed: false,
      productionChangesAllowed: false,
    });
  });

  it("fails closed on out-of-order families and Arena response-page drift", async () => {
    const wrongOrder = createDnaOpenLabP5FirstBackfillFamilyAdapter({
      vault: "owner-vault",
      finishedRaceHistoryStartAt: historyStartAt,
      authorityCutoffAt,
      projectUpperBounds: () => {
        throw new Error("must not project");
      },
    });
    await expect(
      wrongOrder.measureFamily({
        family: "token_prices",
        request: async () => ({}) as never,
      }),
    ).rejects.toThrow("family adapter failed");

    const fake = fakeClient({ arenaPageOverride: 2 });
    const request = async <T>(input: {
      scope: DnaOpenLabScope;
      request: (
        client: DnaOpenLabClient,
        laneId: string,
      ) => Promise<DnaOpenLabResponse<T>>;
    }): Promise<T> => (await input.request(fake.client, "key-1")).result;
    const adapter = createDnaOpenLabP5FirstBackfillFamilyAdapter({
      vault: "owner-vault",
      finishedRaceHistoryStartAt: historyStartAt,
      authorityCutoffAt,
      projectUpperBounds: (observation) => ({
        sourceRecordUpperBound: observation.observedSourceRecordCount,
        apiRequestUpperBound: observation.observedApiRequestCount,
        retainedR2BytesUpperBound: observation.observedResponseBytes,
        classAOperationsUpperBound: observation.observedApiRequestCount,
        classBOperationsUpperBound: observation.observedApiRequestCount,
        neonIncrementalBytesUpperBound: observation.observedResponseBytes,
      }),
    });
    for (const family of [
      "finished_races",
      "race_activity",
      "token_prices",
      "vault_identity",
      "core_current_state",
    ] as const) {
      await adapter.measureFamily({ family, request });
    }
    await expect(
      adapter.measureFamily({ family: "splice_arena", request }),
    ).rejects.toThrow("family adapter failed");
  });

  it("rejects incomplete batched responses and an understated projection", async () => {
    const directRequest =
      (client: DnaOpenLabClient) =>
      async <T>(input: {
        scope: DnaOpenLabScope;
        request: (
          client: DnaOpenLabClient,
          laneId: string,
        ) => Promise<DnaOpenLabResponse<T>>;
      }): Promise<T> =>
        (await input.request(client, "key-1")).result;

    const understatedFake = fakeClient();
    const understated = createDnaOpenLabP5FirstBackfillFamilyAdapter({
      vault: "owner-vault",
      finishedRaceHistoryStartAt: historyStartAt,
      authorityCutoffAt,
      projectUpperBounds: (observation) => ({
        sourceRecordUpperBound: observation.observedSourceRecordCount,
        apiRequestUpperBound: observation.observedApiRequestCount,
        retainedR2BytesUpperBound: observation.observedResponseBytes - 1,
        classAOperationsUpperBound: observation.observedApiRequestCount,
        classBOperationsUpperBound: observation.observedApiRequestCount,
        neonIncrementalBytesUpperBound: observation.observedResponseBytes,
      }),
    });
    await expect(
      understated.measureFamily({
        family: "finished_races",
        request: directRequest(understatedFake.client),
      }),
    ).rejects.toThrow("family adapter failed");

    const incompleteFake = fakeClient({ omitFill: true });
    const incomplete = createDnaOpenLabP5FirstBackfillFamilyAdapter({
      vault: "owner-vault",
      finishedRaceHistoryStartAt: historyStartAt,
      authorityCutoffAt,
      projectUpperBounds: (observation) => ({
        sourceRecordUpperBound: observation.observedSourceRecordCount,
        apiRequestUpperBound: observation.observedApiRequestCount,
        retainedR2BytesUpperBound: observation.observedResponseBytes,
        classAOperationsUpperBound: observation.observedApiRequestCount,
        classBOperationsUpperBound: observation.observedApiRequestCount,
        neonIncrementalBytesUpperBound: observation.observedResponseBytes,
      }),
    });
    const request = directRequest(incompleteFake.client);
    await incomplete.measureFamily({ family: "finished_races", request });
    await expect(
      incomplete.measureFamily({ family: "race_activity", request }),
    ).rejects.toThrow("family adapter failed");
  });
});
