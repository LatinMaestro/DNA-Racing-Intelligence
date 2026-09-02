import { describe, expect, it, vi } from "vitest";

import { createDnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import { measureDnaOpenLabP5SpliceContinuation } from "@/lib/dna-open-lab-p5-splice-continuation-measurement";
import {
  DnaOpenLabApiError,
  type DnaOpenLabClient,
  type DnaOpenLabResponse,
  type DnaSpliceArenaResult,
} from "@/lib/dna-open-lab-v1-client";

const cutoff = "2026-09-02T00:11:55.961Z";
const measuredAt = "2026-09-03T00:00:00.000Z";

function response(
  mode: "bike" | "car" | "horse",
  page: number,
): DnaOpenLabResponse<DnaSpliceArenaResult> {
  const hasMore = mode === "bike" && page === 1;
  return Object.freeze({
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 150,
      remaining: 149,
      resetSeconds: 60,
      retryAfterSeconds: null,
      rateClass: "api_key" as const,
    }),
    result: Object.freeze({
      page,
      limit: 100,
      has_more: hasMore,
      cores: Object.freeze([
        Object.freeze({
          hid: mode === "bike" ? page : mode === "car" ? 101 : 201,
        }),
      ]),
    }) as DnaSpliceArenaResult,
  });
}

function pool(client: DnaOpenLabClient, rpm = 30) {
  return createDnaOpenLabClientPool({
    lanes: [{ id: "key-1", client, scopes: ["splice"] }],
    aggregateRequestsPerMinute: rpm,
    maximumLaneRequestsPerMinute: rpm,
    allowIndependentRateBuckets: false,
  });
}

describe("P5 splice continuation measurement", () => {
  it("measures every mode and page without retaining payloads", async () => {
    const spliceArena = vi.fn(
      async (input: {
        filter: Readonly<{ rvmode: "bike" | "car" | "horse" }>;
        page?: number;
      }) => response(input.filter.rvmode, input.page ?? 1),
    );
    const client = { spliceArena } as unknown as DnaOpenLabClient;

    const result = await measureDnaOpenLabP5SpliceContinuation({
      clientPool: pool(client),
      authorityCutoffAt: cutoff,
      now: () => measuredAt,
    });

    expect(spliceArena).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({
      schemaVersion: 1,
      evidenceKind: "dna_open_lab_p5_splice_continuation_measurement",
      providerScope: "private_preview",
      authorityCutoffAt: cutoff,
      measuredAt,
      terminalInventoryObserved: true,
      modeCount: 3,
      sourceRecordCount: 4,
      logicalRequestCount: 4,
      apiRequestAttemptCount: 4,
      effectiveAggregateRequestsPerMinute: 30,
      rateLimitedResponseCount: 0,
      independentRateBucketsEnabled: false,
      persistentOwnerDataWriteCount: 0,
      rawPayloadIncluded: false,
      secretMaterialIncluded: false,
      productionChangesAllowed: false,
    });
    expect(result.projectedUpperBounds.apiRequestUpperBound).toBe(8);
    expect(result.projectedUpperBounds.classBOperationsUpperBound).toBe(24);
    expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("retries a malformed envelope without widening the logical count", async () => {
    let first = true;
    const client = {
      spliceArena: vi.fn(
        async (input: {
          filter: Readonly<{ rvmode: "bike" | "car" | "horse" }>;
          page?: number;
        }) => {
          if (first) {
            first = false;
            throw new DnaOpenLabApiError({
              kind: "malformed_response",
              message: "private provider detail",
            });
          }
          return response(input.filter.rvmode, input.page ?? 1);
        },
      ),
    } as unknown as DnaOpenLabClient;

    const result = await measureDnaOpenLabP5SpliceContinuation({
      clientPool: pool(client),
      authorityCutoffAt: cutoff,
      now: () => measuredAt,
    });

    expect(result.logicalRequestCount).toBe(4);
    expect(result.apiRequestAttemptCount).toBe(5);
  });

  it("rejects a pool above the standing 30 aggregate-rpm ceiling", async () => {
    const client = {
      spliceArena: vi.fn(async () => response("bike", 1)),
    } as unknown as DnaOpenLabClient;

    await expect(
      measureDnaOpenLabP5SpliceContinuation({
        clientPool: pool(client, 31),
        authorityCutoffAt: cutoff,
        now: () => measuredAt,
      }),
    ).rejects.toThrow(
      "DNA Open Lab P5 splice continuation measurement: client pool exceeds standing aggregate authority",
    );
  });
});
