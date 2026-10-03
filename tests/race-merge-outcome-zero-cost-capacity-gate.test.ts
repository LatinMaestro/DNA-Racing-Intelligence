import { describe, expect, it, vi } from "vitest";

import type {
  DnaOpenLabProviderCapacityPreflight,
} from "@/lib/dna-open-lab-provider-capacity-preflight";
import {
  createRaceMergeOutcomeZeroCostCapacityGate,
  RACE_MERGE_OUTCOME_FIXED_NEON_BYTES,
  RACE_MERGE_OUTCOME_MAXIMUM_COMPUTE_MILLI_CU_HOURS,
  RACE_MERGE_OUTCOME_MAXIMUM_NEON_BYTES_PER_SOURCE_ROW,
} from "@/lib/race-merge-outcome-zero-cost-capacity-gate";

const HEAD = "a".repeat(40);
const DIGEST = "b".repeat(64);
const CHECKED_AT = "2026-10-03T10:00:00.000Z";
const VALID_UNTIL = "2026-10-03T10:05:00.000Z";

function gate(input: { held?: boolean } = {}) {
  let invocation: unknown;
  const inspect = vi.fn(async (value) => {
    invocation = value;
    if (input.held) {
      return {
        status: "held",
        readyForRefresh: false,
        reason: "capacity_blocked",
        blockerIds: ["neon_storage_budget_exhausted"],
        persistentWritePerformed: false,
        providerWritePerformed: false,
        paidUsageAllowed: false,
        preserveLastGood: true,
      } as never;
    }
    return {
      status: "ready",
      checkedAt: CHECKED_AT,
      validUntil: VALID_UNTIL,
      projection: {
        projectedR2Usage: { storageBytes: 1_200_000_000 },
        projectedNeonUsage: { storageBytes: 900_000_000 },
      },
    } as never;
  });
  const preflight: DnaOpenLabProviderCapacityPreflight = { inspect };
  return {
    invocation: () => invocation,
    inspect,
    value: createRaceMergeOutcomeZeroCostCapacityGate({
      configuredOwnerId: "owner-1",
      exactCodeHeadSha: HEAD,
      preflight,
    }),
  };
}

describe("Race Merge outcome zero-cost capacity gate", () => {
  it("reserves exact R2 reads and conservative Neon growth before ingestion", async () => {
    const test = gate();
    const result = await test.value.authorize({
      ownerId: "owner-1",
      generationId: "race-merge-2026-10",
      manifestDigestSha256: DIGEST,
      sourceObjectCount: 8,
      sourceByteLength: 564_361_704,
      maximumRowsPerGeneration: 3_945_562,
    });

    expect(test.invocation()).toMatchObject({
      authenticatedOwnerId: "owner-1",
      exactCodeHeadSha: HEAD,
      projectionHorizon: "single_refresh",
      plannedR2UsagePerRefresh: {
        storageBytes: 0,
        classAOperations: 0,
        classBOperations: 8,
      },
      plannedNeonUsagePerRefresh: {
        storageBytes:
          3_945_562 *
            RACE_MERGE_OUTCOME_MAXIMUM_NEON_BYTES_PER_SOURCE_ROW +
          RACE_MERGE_OUTCOME_FIXED_NEON_BYTES,
        computeMilliCuHours:
          RACE_MERGE_OUTCOME_MAXIMUM_COMPUTE_MILLI_CU_HOURS,
      },
    });
    expect(result).toEqual({
      ownerId: "owner-1",
      generationId: "race-merge-2026-10",
      manifestDigestSha256: DIGEST,
      measuredAt: CHECKED_AT,
      validUntil: VALID_UNTIL,
      projectedR2RetainedBytes: 1_200_000_000,
      projectedNeonStorageBytes: 900_000_000,
      projectedPaidCostAud: 0,
    });
  });

  it("fails closed on owner drift before capacity measurement", async () => {
    const test = gate();
    await expect(
      test.value.authorize({
        ownerId: "another-owner",
        generationId: "race-merge-2026-10",
        manifestDigestSha256: DIGEST,
        sourceObjectCount: 8,
        sourceByteLength: 564_361_704,
        maximumRowsPerGeneration: 3_945_562,
      }),
    ).rejects.toThrow("owner access denied");
    expect(test.inspect).not.toHaveBeenCalled();
  });

  it("fails closed when fresh provider capacity is held", async () => {
    const test = gate({ held: true });
    await expect(
      test.value.authorize({
        ownerId: "owner-1",
        generationId: "race-merge-2026-10",
        manifestDigestSha256: DIGEST,
        sourceObjectCount: 8,
        sourceByteLength: 564_361_704,
        maximumRowsPerGeneration: 3_945_562,
      }),
    ).rejects.toThrow("capacity held: capacity_blocked");
  });

  it("rejects unbounded manifests before provider measurement", async () => {
    const test = gate();
    await expect(
      test.value.authorize({
        ownerId: "owner-1",
        generationId: "race-merge-2026-10",
        manifestDigestSha256: DIGEST,
        sourceObjectCount: 25,
        sourceByteLength: 564_361_704,
        maximumRowsPerGeneration: 3_945_562,
      }),
    ).rejects.toThrow("source object count is outside its bound");
    expect(test.inspect).not.toHaveBeenCalled();
  });
});
