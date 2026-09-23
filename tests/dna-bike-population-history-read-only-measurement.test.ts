import { describe, expect, it, vi } from "vitest";

import { planDnaBikePopulationHistoryAcquisition } from "@/lib/dna-bike-population-history-acquisition-plan";
import {
  measureDnaBikePopulationHistoryReadOnly,
  type DnaBikePopulationHistoryReadOnlyMeasurement,
} from "@/lib/dna-bike-population-history-read-only-measurement";
import type {
  DnaCoreRaceHistoryClient,
  DnaCoreRaceHistoryRow,
} from "@/lib/dna-core-race-history-client";
import { DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE } from "@/lib/dna-core-race-history-acquisition-runner";
import { createDnaOpenLabRequestBudget } from "@/lib/dna-open-lab-request-budget";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";
import {
  DnaOpenLabApiError,
  type DnaOpenLabResponse,
} from "@/lib/dna-open-lab-v1-client";

function race(
  sourceRaceId: string,
  entrantCoreIds: readonly string[] | undefined,
): CanonicalRaceDocumentMetadata {
  return Object.freeze({
    sourceType: "race_document" as const,
    sourceRaceId,
    mode: "bike" as const,
    ...(entrantCoreIds === undefined ? {} : { entrantCoreIds }),
  });
}

function response(
  rows: readonly DnaCoreRaceHistoryRow[],
): DnaOpenLabResponse<readonly DnaCoreRaceHistoryRow[]> {
  return Object.freeze({
    result: Object.freeze(rows),
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 150,
      remaining: 149,
      resetSeconds: 1,
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
    nowMilliseconds: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
  });
}

function run(input: {
  plan?: ReturnType<typeof planDnaBikePopulationHistoryAcquisition>;
  client: DnaCoreRaceHistoryClient;
  maximumCoreCount?: number;
  maximumPagesPerCore?: number;
}): Promise<DnaBikePopulationHistoryReadOnlyMeasurement> {
  return measureDnaBikePopulationHistoryReadOnly({
    plan:
      input.plan ??
      planDnaBikePopulationHistoryAcquisition({
        raceDocuments: [race("race-1", ["1", "2", "3"])],
        ownedCoreIds: [1],
      }),
    cohortOrdinal: 0,
    maximumCoreCount: input.maximumCoreCount ?? 2,
    maximumPagesPerCore: input.maximumPagesPerCore ?? 3,
    client: input.client,
    requestBudget: requestBudget(),
  });
}

describe("Bike population history read-only measurement", () => {
  it("scans a deterministic unowned slice to terminal pages without persisting raw evidence", async () => {
    const page = vi.fn(async ({ coreId, page: pageNumber }) =>
      response(
        pageNumber === 1
          ? [
              Object.freeze({
                hid: coreId,
                rid: `race-${coreId}`,
                rvmode: "bike",
                time: 60,
                pos: 1,
              }),
            ]
          : [],
      ),
    );

    const result = await run({ client: client(page) });

    expect(result).toMatchObject({
      status: "complete",
      reason: null,
      selectedCoreCount: 2,
      completeCoreCount: 2,
      providerRequestCount: 2,
      sourceRowCount: 2,
      fullAcquisitionMeasured: true,
      providerReadPerformed: true,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(result.measurementSliceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.canonicalResultBytes).toBeGreaterThan(0);
    expect(result.acquisitionR2Ceiling).toEqual({
      storageBytes:
        2 * DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.storageBytes,
      classAOperations:
        2 * DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.classAOperations,
      classBOperations:
        2 * DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.classBOperations,
    });
    expect(page.mock.calls.map(([value]) => value)).toEqual([
      { coreId: 2, page: 1 },
      { coreId: 3, page: 1 },
    ]);
    expect(JSON.stringify(result)).not.toContain("race-2");
  });

  it("holds before provider access when canonical race authority is incomplete", async () => {
    const page = vi.fn();
    const plan = planDnaBikePopulationHistoryAcquisition({
      raceDocuments: [race("race-1", undefined)],
    });

    await expect(run({ plan, client: client(page) })).resolves.toMatchObject({
      status: "held",
      reason: "acquisition_plan_not_ready",
      providerRequestCount: 0,
      providerReadPerformed: false,
      persistentWritePerformed: false,
    });
    expect(page).not.toHaveBeenCalled();
  });

  it("does not call a full bounded page terminal or understate the collection ceiling", async () => {
    const fullPage = Object.freeze(
      Array.from({ length: 50 }, (_, index) =>
        Object.freeze({ hid: 2, rid: `race-${index + 1}` }),
      ),
    );
    const page = vi.fn(async () => response(fullPage));

    const result = await run({
      client: client(page),
      maximumCoreCount: 1,
      maximumPagesPerCore: 2,
    });

    expect(result).toMatchObject({
      status: "held",
      reason: "page_bound_reached",
      selectedCoreCount: 1,
      completeCoreCount: 0,
      providerRequestCount: 2,
      sourceRowCount: 100,
      fullAcquisitionMeasured: false,
      persistentWritePerformed: false,
    });
    expect(result.acquisitionR2Ceiling.storageBytes).toBe(
      2 * DNA_CORE_RACE_HISTORY_STEP_PLANNED_R2_USAGE.storageBytes,
    );
  });

  it("stops on rate limits and returns only a sanitized hold summary", async () => {
    const page = vi.fn(async () => {
      throw new DnaOpenLabApiError({
        kind: "rate_limited",
        message: "private provider detail",
        httpStatus: 429,
        rateLimit: {
          limit: 150,
          remaining: 0,
          resetSeconds: 60,
          retryAfterSeconds: 60,
          rateClass: "public",
        },
      });
    });

    const result = await run({ client: client(page) });

    expect(result).toMatchObject({
      status: "held",
      reason: "rate_limited",
      providerRequestCount: 1,
      providerReadPerformed: true,
      persistentWritePerformed: false,
    });
    expect(JSON.stringify(result)).not.toContain("private provider detail");
  });

  it("rejects a request budget above the conservative aggregate limit", async () => {
    const plan = planDnaBikePopulationHistoryAcquisition({
      raceDocuments: [race("race-1", ["1", "2"])],
      ownedCoreIds: [1],
    });
    await expect(
      measureDnaBikePopulationHistoryReadOnly({
        plan,
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
