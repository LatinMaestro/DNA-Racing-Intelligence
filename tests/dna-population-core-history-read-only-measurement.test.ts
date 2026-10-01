import { describe, expect, it, vi } from "vitest";

import { DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE } from "@/lib/dna-core-race-history-acquisition-runner";
import type {
  DnaCoreRaceHistoryClient,
  DnaCoreRaceHistoryRow,
} from "@/lib/dna-core-race-history-client";
import {
  measureDnaPopulationCoreHistoryReadOnly,
  type DnaPopulationCoreHistoryReadOnlyMeasurement,
} from "@/lib/dna-population-core-history-read-only-measurement";
import { planDnaPopulationHistoryAcquisition } from "@/lib/dna-population-history-acquisition-plan";
import { createDnaOpenLabRequestBudget } from "@/lib/dna-open-lab-request-budget";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";
import {
  DnaOpenLabApiError,
  type DnaOpenLabResponse,
} from "@/lib/dna-open-lab-v1-client";

function race(
  sourceRaceId: string,
  mode: "bike" | "car" | "horse",
  entrantCoreIds: readonly string[],
): CanonicalRaceDocumentMetadata {
  return Object.freeze({
    sourceType: "race_document",
    sourceRaceId,
    mode,
    entrantCoreIds,
  });
}

function row(
  coreId: number,
  raceId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): DnaCoreRaceHistoryRow {
  return Object.freeze({
    hid: coreId,
    rid: raceId,
    rvmode: "bike",
    cb: 12,
    time: 60.125,
    pos: 1,
    ...overrides,
  });
}

function response(
  rows: readonly DnaCoreRaceHistoryRow[],
): DnaOpenLabResponse<readonly DnaCoreRaceHistoryRow[]> {
  return Object.freeze({
    result: Object.freeze(rows),
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 30,
      remaining: 29,
      resetSeconds: 60,
      retryAfterSeconds: null,
      rateClass: "public" as const,
    }),
  });
}

function client(
  page: DnaCoreRaceHistoryClient["page"],
): DnaCoreRaceHistoryClient {
  return Object.freeze({ page });
}

function requestBudget() {
  let now = 0;
  return createDnaOpenLabRequestBudget({
    initialRequestsPerMinute: 30,
    maximumRequestsPerMinute: 30,
    nowMilliseconds: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
  });
}

function plan() {
  return planDnaPopulationHistoryAcquisition({
    raceDocuments: [
      race("bike-1", "bike", ["101", "202"]),
      race("car-1", "car", ["202", "303"]),
      race("horse-1", "horse", ["303", "404"]),
    ],
  });
}

function run(input: {
  client: DnaCoreRaceHistoryClient;
  maximumCoreCount?: number;
  maximumPagesPerCore?: number;
  plan?: ReturnType<typeof planDnaPopulationHistoryAcquisition>;
}): Promise<DnaPopulationCoreHistoryReadOnlyMeasurement> {
  return measureDnaPopulationCoreHistoryReadOnly({
    plan: input.plan ?? plan(),
    cohortOrdinal: 0,
    maximumCoreCount: input.maximumCoreCount ?? 2,
    maximumPagesPerCore: input.maximumPagesPerCore ?? 3,
    client: input.client,
    requestBudget: requestBudget(),
  });
}

describe("population Core history read-only readiness measurement", () => {
  it("measures one all-mode Core only through an explicit empty terminal page", async () => {
    const page = vi.fn(async ({ coreId, page: pageNumber }) =>
      response(pageNumber === 1 ? [row(coreId, `race-${coreId}`)] : []),
    );

    const result = await run({
      client: client(page),
      maximumCoreCount: 1,
    });

    expect(result).toMatchObject({
      status: "complete",
      reason: null,
      selectedCoreCount: 1,
      completeCoreCount: 1,
      providerRequestCount: 2,
      sourceRowCount: 1,
      acceptedResultCount: 1,
      quarantineCount: 0,
      selectedCohortFullyMeasured: true,
      providerReadPerformed: true,
      aggregateRequestsPerMinute: 30,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(result.acquisitionCoreSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.selectedCoreSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.measurementSliceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.projectedPersistentR2Usage).toEqual({
      storageBytes:
        2 * DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.storageBytes,
      classAOperations:
        2 * DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.classAOperations,
      classBOperations:
        2 * DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.classBOperations,
    });
    expect(page.mock.calls.map(([value]) => value)).toEqual([
      { coreId: 101, page: 1 },
      { coreId: 101, page: 2 },
    ]);
    expect(JSON.stringify(result)).not.toContain("race-101");
  });

  it("does not mistake a short non-empty page for terminal history", async () => {
    const page = vi.fn(async ({ coreId, page: pageNumber }) =>
      response([row(coreId, `race-${pageNumber}`)]),
    );

    const result = await run({
      client: client(page),
      maximumCoreCount: 1,
      maximumPagesPerCore: 2,
    });

    expect(result).toMatchObject({
      status: "held",
      reason: "page_bound_reached",
      providerRequestCount: 2,
      sourceRowCount: 2,
      completeCoreCount: 0,
      selectedCohortFullyMeasured: false,
    });
  });

  it("counts quarantined source rows without leaking their private identity", async () => {
    const page = vi.fn(async ({ coreId, page: pageNumber }) =>
      response(
        pageNumber === 1 ? [row(coreId, "private-race", { pos: null })] : [],
      ),
    );

    const result = await run({
      client: client(page),
      maximumCoreCount: 1,
    });

    expect(result).toMatchObject({
      status: "complete",
      sourceRowCount: 1,
      acceptedResultCount: 0,
      quarantineCount: 1,
      providerRequestCount: 2,
    });
    expect(JSON.stringify(result)).not.toContain("private-race");
  });

  it("holds on conflicting repeated Core/Race evidence", async () => {
    const page = vi.fn(async ({ coreId }) =>
      response([
        row(coreId, "race-conflict", { time: 60 }),
        row(coreId, "race-conflict", { time: 61 }),
      ]),
    );

    await expect(
      run({
        client: client(page),
        maximumCoreCount: 1,
      }),
    ).resolves.toMatchObject({
      status: "held",
      reason: "evidence_conflict",
      providerRequestCount: 1,
      persistentWritePerformed: false,
    });
  });

  it("stops on rate limits and never exposes provider detail", async () => {
    const page = vi.fn(async () => {
      throw new DnaOpenLabApiError({
        kind: "rate_limited",
        message: "private provider detail",
        httpStatus: 429,
        rateLimit: {
          limit: 30,
          remaining: 0,
          resetSeconds: 60,
          retryAfterSeconds: 60,
          rateClass: "public",
        },
      });
    });
    const result = await run({
      client: client(page),
      maximumCoreCount: 1,
    });

    expect(result).toMatchObject({
      status: "held",
      reason: "rate_limited",
      providerRequestCount: 1,
      providerReadPerformed: true,
      persistentWritePerformed: false,
    });
    expect(JSON.stringify(result)).not.toContain("private provider detail");
  });

  it("holds before provider access when population Race authority is incomplete", async () => {
    const page = vi.fn();
    const incomplete = planDnaPopulationHistoryAcquisition({
      raceDocuments: [
        Object.freeze({
          sourceType: "race_document" as const,
          sourceRaceId: "missing-entrants",
          mode: "bike" as const,
          entrantCoreIdsEvidenceStatus: "unsupported_source_value" as const,
        }),
      ],
    });

    await expect(
      run({
        plan: incomplete,
        client: client(page),
        maximumCoreCount: 1,
      }),
    ).resolves.toMatchObject({
      status: "held",
      reason: "acquisition_plan_not_ready",
      providerRequestCount: 0,
      providerReadPerformed: false,
    });
    expect(page).not.toHaveBeenCalled();
  });

  it("rejects a request budget above 30 aggregate requests per minute", async () => {
    await expect(
      measureDnaPopulationCoreHistoryReadOnly({
        plan: plan(),
        cohortOrdinal: 0,
        maximumCoreCount: 1,
        maximumPagesPerCore: 1,
        client: client(vi.fn()),
        requestBudget: createDnaOpenLabRequestBudget({
          initialRequestsPerMinute: 31,
          maximumRequestsPerMinute: 31,
        }),
      }),
    ).rejects.toThrow("request budget exceeds the conservative aggregate rate");
  });
});
