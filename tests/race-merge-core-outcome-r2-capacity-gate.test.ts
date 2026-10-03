import { describe, expect, it, vi } from "vitest";

import type { DnaOpenLabProviderCapacityPreflight } from "@/lib/dna-open-lab-provider-capacity-preflight";
import type {
  DnaOpenLabProviderCapacityMeasurement,
  DnaOpenLabProviderCapacityMeasurementSource,
} from "@/lib/dna-open-lab-provider-capacity-preflight";
import {
  createRaceMergeCoreOutcomeR2CapacityGate,
  raceMergeCoreOutcomeR2CapacityGateFromEnvironment,
  RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_CLASS_A_PER_CORE,
  RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_CLASS_B_PER_CORE,
  RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_FIXED_NEON_BYTES,
  RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_NEON_BYTES_PER_CORE,
  RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_NEON_COMPUTE_MILLI_CU_HOURS,
} from "@/lib/race-merge-core-outcome-r2-capacity-gate";
import type { RaceMergeCoreOutcomeR2GenerationAuthority } from "@/lib/race-merge-core-outcome-r2-generation";

const HEAD = "a".repeat(40);
const CHECKED_AT = "2026-10-03T14:00:00.000Z";
const VALID_UNTIL = "2026-10-03T14:05:00.000Z";
const providerMeasurement: DnaOpenLabProviderCapacityMeasurement =
  Object.freeze({
    evidenceSource: "provider_api",
    r2StorageClass: "Standard",
    measuredAt: CHECKED_AT,
    billingWindowStartAt: "2026-10-01T00:00:00.000Z",
    billingWindowEndAt: "2026-11-01T00:00:00.000Z",
    currentR2Usage: {
      storageBytes: 100_000_000,
      classAOperations: 1_000,
      classBOperations: 2_000,
    },
    neonMeasuredAt: CHECKED_AT,
    neonBillingWindowStartAt: "2026-10-01T00:00:00.000Z",
    neonBillingWindowEndAt: "2026-11-01T00:00:00.000Z",
    currentNeonUsage: {
      storageBytes: 10_000_000,
      computeMilliCuHours: 1_000,
    },
  });
const authority: RaceMergeCoreOutcomeR2GenerationAuthority = Object.freeze({
  version: 1,
  generationId: "race-merge-r2-generation",
  cohortOrdinal: 4,
  firstSourceCoreId: 101,
  lastSourceCoreId: 202,
  coreCount: 2,
  uniqueOutcomeCount: 30,
  sourceObservationCount: 32,
  retainedR2Bytes: 8_192,
  receiptSetSha256: "b".repeat(64),
});

function harness(
  input: {
    held?: boolean;
    projectedR2Bytes?: number;
    projectedNeonBytes?: number;
    exactHead?: string;
  } = {},
) {
  let invocation: unknown;
  const inspect = vi.fn(async (value) => {
    invocation = value;
    if (input.held) {
      return {
        status: "held",
        reason: "capacity_blocked",
        blockerIds: ["storage_budget_exhausted"],
        persistentWritePerformed: false,
        providerWritePerformed: false,
        paidUsageAllowed: false,
        preserveLastGood: true,
      } as never;
    }
    return {
      status: "ready",
      readyForRefresh: true,
      exactCodeHeadSha: input.exactHead ?? HEAD,
      refreshCycleId: (value as { refreshCycleId: string }).refreshCycleId,
      budgetWindowId: (value as { budgetWindowId: string }).budgetWindowId,
      checkedAt: CHECKED_AT,
      validUntil: VALID_UNTIL,
      persistentWritePerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
      preserveLastGood: true,
      projection: {
        projectedR2Usage: {
          storageBytes: input.projectedR2Bytes ?? 8_000_000_000,
        },
        projectedNeonUsage: {
          storageBytes: input.projectedNeonBytes ?? 800_000_000,
        },
      },
    } as never;
  });
  const preflight: DnaOpenLabProviderCapacityPreflight = { inspect };
  return {
    inspect,
    invocation: () => invocation,
    gate: createRaceMergeCoreOutcomeR2CapacityGate({
      configuredOwnerId: "owner-1",
      exactCodeHeadSha: HEAD,
      preflight,
    }),
  };
}

describe("Race Merge Core outcome R2 capacity gate", () => {
  it("binds exact cohort bytes and conservative operations to fresh provider proof", async () => {
    const test = harness();
    await expect(
      test.gate.assertFreshCurrentCapacity(authority),
    ).resolves.toEqual({
      version: 1,
      generationId: authority.generationId,
      cohortOrdinal: authority.cohortOrdinal,
      receiptSetSha256: authority.receiptSetSha256,
      retainedR2Bytes: authority.retainedR2Bytes,
      measuredAt: CHECKED_AT,
      validUntil: VALID_UNTIL,
      capacityAllowed: true,
      projectedPaidCostAud: 0,
    });
    expect(test.invocation()).toMatchObject({
      authenticatedOwnerId: "owner-1",
      exactCodeHeadSha: HEAD,
      projectionHorizon: "single_refresh",
      plannedR2UsagePerRefresh: {
        storageBytes: authority.retainedR2Bytes,
        classAOperations:
          authority.coreCount *
          RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_CLASS_A_PER_CORE,
        classBOperations:
          authority.coreCount *
          RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_CLASS_B_PER_CORE,
      },
      plannedNeonUsagePerRefresh: {
        storageBytes:
          RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_FIXED_NEON_BYTES +
          authority.coreCount *
            RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_NEON_BYTES_PER_CORE,
        computeMilliCuHours:
          RACE_MERGE_CORE_OUTCOME_R2_CAPACITY_NEON_COMPUTE_MILLI_CU_HOURS,
      },
    });
  });

  it("fails closed when live provider capacity is held", async () => {
    const test = harness({ held: true });
    await expect(
      test.gate.assertFreshCurrentCapacity(authority),
    ).rejects.toThrow("capacity held: capacity_blocked");
  });

  it("rejects an oversized cohort before provider measurement", async () => {
    const test = harness();
    await expect(
      test.gate.assertFreshCurrentCapacity({ ...authority, coreCount: 101 }),
    ).rejects.toThrow("coreCount is outside its bound");
    expect(test.inspect).not.toHaveBeenCalled();
  });

  it("rejects projected R2 or Neon operating-cap drift", async () => {
    await expect(
      harness({
        projectedR2Bytes: 9_500_000_001,
      }).gate.assertFreshCurrentCapacity(authority),
    ).rejects.toThrow("provider capacity authority drifted");
    await expect(
      harness({
        projectedNeonBytes: 950_000_001,
      }).gate.assertFreshCurrentCapacity(authority),
    ).rejects.toThrow("provider capacity authority drifted");
  });

  it("rejects exact-main receipt drift", async () => {
    const test = harness({ exactHead: "c".repeat(40) });
    await expect(
      test.gate.assertFreshCurrentCapacity(authority),
    ).rejects.toThrow("provider capacity authority drifted");
  });

  it("connects exact-main authority to a live provider measurement", async () => {
    const measure = vi.fn().mockResolvedValue(providerMeasurement);
    const source: DnaOpenLabProviderCapacityMeasurementSource = {
      status: "ready",
      measure,
    };
    const connected = raceMergeCoreOutcomeR2CapacityGateFromEnvironment(
      { authorizedOwnerId: "owner-1", exactCodeHeadSha: HEAD },
      {
        measurementSource: source,
        now: () => new Date(CHECKED_AT),
      },
    );
    expect(connected.status).toBe("ready");
    if (connected.status !== "ready") throw new Error("expected ready gate");
    await expect(
      connected.gate.assertFreshCurrentCapacity(authority),
    ).resolves.toMatchObject({
      capacityAllowed: true,
      measuredAt: CHECKED_AT,
      projectedPaidCostAud: 0,
    });
    expect(measure).toHaveBeenCalledWith({ ownerId: "owner-1" });
  });

  it("stays unavailable without complete connected provider authority", () => {
    expect(
      raceMergeCoreOutcomeR2CapacityGateFromEnvironment({
        authorizedOwnerId: "owner-1",
        exactCodeHeadSha: HEAD,
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      raceMergeCoreOutcomeR2CapacityGateFromEnvironment(
        { authorizedOwnerId: "owner-1" },
        {
          measurementSource: {
            status: "ready",
            measure: vi.fn().mockResolvedValue(providerMeasurement),
          },
        },
      ),
    ).toEqual({ status: "not_configured" });
  });
});
