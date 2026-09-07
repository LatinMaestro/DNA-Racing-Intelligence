import { describe, expect, it, vi } from "vitest";

import { createDnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import {
  buildDnaOpenLabP5CoreRequestPlan,
  measureDnaOpenLabP5TerminalResidual,
} from "@/lib/dna-open-lab-p5-terminal-residual-measurement";
import type {
  DnaOpenLabClient,
  DnaOpenLabResponse,
  DnaSpliceArenaResult,
} from "@/lib/dna-open-lab-v1-client";

const cutoff = "2026-09-02T00:11:55.961Z";
const measuredAt = "2026-09-07T00:00:00.000Z";

function response<T>(result: T): DnaOpenLabResponse<T> {
  return Object.freeze({
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 150,
      remaining: 149,
      resetSeconds: 60,
      retryAfterSeconds: null,
      rateClass: "api_key" as const,
    }),
    result,
  });
}

function vaultCores(count: number): readonly { hid: number }[] {
  return Object.freeze(
    Array.from({ length: count }, (_, index) =>
      Object.freeze({ hid: index + 1 }),
    ),
  );
}

function pool(client: DnaOpenLabClient, rpm = 30) {
  return createDnaOpenLabClientPool({
    lanes: [{ id: "key-1", client, scopes: ["cores", "splice"] }],
    aggregateRequestsPerMinute: rpm,
    maximumLaneRequestsPerMinute: rpm,
    allowIndependentRateBuckets: false,
  });
}

function client(): DnaOpenLabClient {
  const core = vi.fn(async (hids: readonly number[]) =>
    response(Object.freeze(hids.map((hid) => Object.freeze({ hid })))),
  );
  return {
    coreInfoBulk: core,
    coreRacingStatsBulk: core,
    corePowerBulk: core,
    coreListingPriceBulk: core,
    coreAttachedAssetsBulk: core,
    coreOwnerBulk: core,
    coreStaminaBulk: core,
    coreSplicingInfoBulk: core,
    spliceArena: vi.fn(
      async (input: {
        filter: Readonly<{ rvmode: "bike" | "car" | "horse" }>;
        page?: number;
      }) =>
        response(
          Object.freeze({
            page: input.page ?? 1,
            limit: 100,
            has_more: false,
            cores: Object.freeze([
              Object.freeze({
                hid:
                  input.filter.rvmode === "bike"
                    ? 1
                    : input.filter.rvmode === "car"
                      ? 2
                      : 3,
              }),
            ]),
          }) as DnaSpliceArenaResult,
        ),
    ),
  } as unknown as DnaOpenLabClient;
}

describe("P5 terminal residual measurement", () => {
  it("derives the incomplete Core tail before measuring Splice", async () => {
    const cores = vaultCores(181);
    const plan = buildDnaOpenLabP5CoreRequestPlan(cores);
    expect(plan).toHaveLength(80);
    expect(plan[72]).toMatchObject({
      familyRequestIndex: 73,
      endpoint: "cores.info_bulk",
      hids: [181],
    });

    const result = await measureDnaOpenLabP5TerminalResidual({
      clientPool: pool(client()),
      vaultCores: cores,
      completedCoreRequestCount: 75,
      authorityCutoffAt: cutoff,
      now: () => measuredAt,
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      evidenceKind: "dna_open_lab_p5_terminal_residual_measurement",
      terminalInventoryObserved: true,
      ownedCoreCount: 181,
      completedCoreRequestCount: 75,
      expectedCoreRequestCount: 80,
      residualCoreRequestCount: 5,
      spliceRequestCount: 3,
      logicalRequestCount: 8,
      apiRequestAttemptCount: 8,
      sourceRecordCount: 8,
      effectiveAggregateRequestsPerMinute: 30,
      persistentOwnerDataWriteCount: 0,
      r2WriteCount: 0,
      rawPayloadIncluded: false,
      secretMaterialIncluded: false,
      productionChangesAllowed: false,
    });
    expect(result.projectedUpperBounds.apiRequestUpperBound).toBe(16);
    expect(result.projectedUpperBounds.classBOperationsUpperBound).toBe(48);
    expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("fails closed when the Core prefix is already terminal", async () => {
    await expect(
      measureDnaOpenLabP5TerminalResidual({
        clientPool: pool(client()),
        vaultCores: vaultCores(180),
        completedCoreRequestCount: 72,
        authorityCutoffAt: cutoff,
        now: () => measuredAt,
      }),
    ).rejects.toThrow("Core request prefix is not incomplete");
  });

  it("rejects a pool above the standing aggregate ceiling", async () => {
    await expect(
      measureDnaOpenLabP5TerminalResidual({
        clientPool: pool(client(), 31),
        vaultCores: vaultCores(181),
        completedCoreRequestCount: 75,
        authorityCutoffAt: cutoff,
        now: () => measuredAt,
      }),
    ).rejects.toThrow("client pool exceeds standing aggregate authority");
  });
});
