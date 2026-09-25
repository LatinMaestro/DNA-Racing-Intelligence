import { describe, expect, it } from "vitest";

import { planDnaPopulationHistoryAcquisition } from "@/lib/dna-population-history-acquisition-plan";
import { measureDnaPopulationEntrantHydrationReadOnly } from "@/lib/dna-population-entrant-hydration-read-only-measurement";
import type { DnaOpenLabProviderCapacityMeasurement } from "@/lib/dna-open-lab-provider-capacity-preflight";
import { createDnaOpenLabRequestBudget } from "@/lib/dna-open-lab-request-budget";
import type {
  DnaOpenLabClient,
  DnaOpenLabResponse,
  DnaRaceDocument,
} from "@/lib/dna-open-lab-v1-client";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";

function unresolvedRace(sourceRaceId: string): CanonicalRaceDocumentMetadata {
  return Object.freeze({
    sourceType: "race_document" as const,
    sourceRaceId,
    mode: "bike" as const,
  });
}

function capacity(): DnaOpenLabProviderCapacityMeasurement {
  return Object.freeze({
    evidenceSource: "provider_api" as const,
    r2StorageClass: "Standard",
    measuredAt: "2026-09-25T04:00:00.000Z",
    billingWindowStartAt: "2026-09-01T00:00:00.000Z",
    billingWindowEndAt: "2026-10-01T00:00:00.000Z",
    currentR2Usage: Object.freeze({
      storageBytes: 1_000_000,
      classAOperations: 10,
      classBOperations: 20,
    }),
    neonMeasuredAt: "2026-09-25T04:00:00.000Z",
    neonBillingWindowStartAt: "2026-09-01T00:00:00.000Z",
    neonBillingWindowEndAt: "2026-10-01T00:00:00.000Z",
    currentNeonUsage: Object.freeze({
      storageBytes: 100_000_000,
      computeMilliCuHours: 1_000,
    }),
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

describe("population entrant hydration read-only measurement", () => {
  it("binds one endpoint-sized sample to the exact unresolved Race authority", async () => {
    const plan = planDnaPopulationHistoryAcquisition({
      raceDocuments: [
        unresolvedRace("20"),
        unresolvedRace("3"),
        unresolvedRace("10"),
      ],
    });
    const calls: readonly (readonly (string | number)[])[] = [];
    const mutableCalls = calls as (readonly (string | number)[])[];
    const client: Pick<DnaOpenLabClient, "raceDocs"> = {
      raceDocs: async (raceIds) => {
        mutableCalls.push([...raceIds]);
        return response(
          raceIds.map((rid, index) => ({
            rid,
            rvmode: "bike",
            hids: [index + 1, index + 101],
          })),
        );
      },
    };

    const measurement = await measureDnaPopulationEntrantHydrationReadOnly({
      plan,
      expectedUnresolvedRaceCount: plan.unresolvedRaceCount,
      expectedUnresolvedRaceSetSha256: plan.unresolvedRaceSetSha256!,
      providerCapacity: capacity(),
      client,
      requestBudget: createDnaOpenLabRequestBudget(),
      observedAt: "2026-09-25T04:00:00.000Z",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["10", "20", "3"]);
    expect(measurement).toMatchObject({
      authority: {
        unresolvedRaceCount: 3,
        selectedRaceCount: 3,
      },
      providerRequestCount: 1,
      returnedRowCount: 3,
      aggregateRequestsPerMinute: 30,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
      persistentCollectionAllowed: false,
    });
    expect(measurement.canonicalResponseBytes).toBeGreaterThan(0);
    expect(measurement.maximumCanonicalRaceBytes).toBeGreaterThan(0);
    expect(measurement.maximumCompactEntrantAuthorityBytes).toBeGreaterThan(0);
    expect(measurement.maximumCompactEntrantAuthorityBytes).toBeLessThan(
      measurement.maximumCanonicalRaceBytes,
    );
    expect(measurement.projectedR2PayloadBytesCeiling).toBeGreaterThan(0);
    expect(
      measurement.projectedCompactEntrantAuthorityBytesCeiling,
    ).toBeGreaterThan(0);
  });

  it("holds before provider access when the audit binding disagrees", async () => {
    const plan = planDnaPopulationHistoryAcquisition({
      raceDocuments: [unresolvedRace("1")],
    });
    let calls = 0;

    await expect(
      measureDnaPopulationEntrantHydrationReadOnly({
        plan,
        expectedUnresolvedRaceCount: plan.unresolvedRaceCount + 1,
        expectedUnresolvedRaceSetSha256: plan.unresolvedRaceSetSha256!,
        providerCapacity: capacity(),
        client: {
          raceDocs: async () => {
            calls += 1;
            return response([]);
          },
        },
        requestBudget: createDnaOpenLabRequestBudget(),
        observedAt: "2026-09-25T04:00:00.000Z",
      }),
    ).rejects.toThrow("audited unresolved Race authority does not match");

    expect(calls).toBe(0);
  });

  it("holds before provider access when current zero-cost capacity is exhausted", async () => {
    const plan = planDnaPopulationHistoryAcquisition({
      raceDocuments: [unresolvedRace("1")],
    });
    let calls = 0;

    await expect(
      measureDnaPopulationEntrantHydrationReadOnly({
        plan,
        expectedUnresolvedRaceCount: plan.unresolvedRaceCount,
        expectedUnresolvedRaceSetSha256: plan.unresolvedRaceSetSha256!,
        providerCapacity: {
          ...capacity(),
          currentNeonUsage: {
            storageBytes: 500_000_000,
            computeMilliCuHours: 1_000,
          },
        },
        client: {
          raceDocs: async () => {
            calls += 1;
            return response([]);
          },
        },
        requestBudget: createDnaOpenLabRequestBudget(),
        observedAt: "2026-09-25T04:00:00.000Z",
      }),
    ).rejects.toThrow("current zero-cost provider capacity is unavailable");

    expect(calls).toBe(0);
  });
});
