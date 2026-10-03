import { describe, expect, it, vi } from "vitest";

import {
  DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_AUTHORITY_VERSION,
  type DnaPopulationCoreHistoryFirstCohortAuthority,
} from "@/lib/dna-population-core-history-first-cohort-authority";
import {
  DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_INTENT,
  DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_VERSION,
} from "@/lib/dna-population-core-history-first-cohort-command";
import {
  dnaPopulationCoreHistoryFirstCohortCommandFromEnvironment,
  dnaPopulationCoreHistoryFirstCohortGenerationId,
} from "@/lib/dna-population-core-history-first-cohort-environment";
import type { DnaOpenLabProviderCapacityMeasurement } from "@/lib/dna-open-lab-provider-capacity-preflight";
import type { DnaOpenLabR2BudgetRepository } from "@/lib/dna-open-lab-r2-budget-repository";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";

const HEAD = "a".repeat(40);
const EVALUATED_AT = "2026-10-03T00:00:00.000Z";
const NOW = "2026-10-03T00:01:00.000Z";

function authority(): DnaPopulationCoreHistoryFirstCohortAuthority {
  return Object.freeze({
    authorityVersion:
      DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_AUTHORITY_VERSION,
    exactCodeHeadSha: HEAD,
    cohortOrdinal: 0,
    cohortOffset: 0,
    coreIds: Object.freeze([12]) as readonly [number],
    populationCoreCount: 3,
    persistedPerformanceCoreCount: 2,
    populationCoreSetSha256: "1".repeat(64),
    persistedPerformanceCoreSetSha256: "2".repeat(64),
    acquisitionCoreSetSha256: "3".repeat(64),
    selectedCoreSetSha256: "4".repeat(64),
    measurementSliceSha256: "5".repeat(64),
    providerRequestCount: 2,
    projectedPersistentR2Usage: Object.freeze({
      storageBytes: 50_000,
      classAOperations: 2,
      classBOperations: 7,
    }),
    populationUniverseCompleteness: "partial_due_to_unresolved_races",
    unresolvedRaceCount: 4,
    capacityPreflightRequired: true,
    providerReadAllowed: false,
    persistentWriteAllowed: false,
    paidUsageAllowed: false,
    previewOnly: true,
  });
}

function environment() {
  return Object.freeze({
    authorizedOwnerId: "owner",
    ownerId: "owner",
    databaseUrl: "postgres://preview",
    databaseOwnerId: "11111111-1111-4111-8111-111111111111",
    runtimeRole: "dna_app_runtime",
    cloudflareAccountId: "cloudflare-account",
    cloudflareApiToken: "cloudflare-api-token",
    r2BucketName: "private-preview-bucket",
    r2AccessKeyId: "r2-access-key",
    r2SecretAccessKey: "r2-secret-key",
  });
}

function measurement(
  overrides: Partial<DnaOpenLabProviderCapacityMeasurement> = {},
): DnaOpenLabProviderCapacityMeasurement {
  return Object.freeze({
    evidenceSource: "provider_api",
    r2StorageClass: "Standard",
    measuredAt: "2026-10-03T00:00:59.000Z",
    billingWindowStartAt: "2026-10-01T00:00:00.000Z",
    billingWindowEndAt: "2026-11-01T00:00:00.000Z",
    currentR2Usage: Object.freeze({
      storageBytes: 900_000_000,
      classAOperations: 10_000,
      classBOperations: 20_000,
    }),
    neonMeasuredAt: "2026-10-03T00:00:59.000Z",
    neonBillingWindowStartAt: "2026-10-01T00:00:00.000Z",
    neonBillingWindowEndAt: "2026-11-01T00:00:00.000Z",
    currentNeonUsage: Object.freeze({
      storageBytes: 55_000_000,
      computeMilliCuHours: 5_000,
    }),
    ...overrides,
  });
}

function invocation(source = authority()) {
  return Object.freeze({
    commandVersion: DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_VERSION,
    intent: DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_INTENT,
    allowPersistentWrite: true as const,
    exactCodeHeadSha: source.exactCodeHeadSha,
    evaluatedAt: EVALUATED_AT,
    maximumSteps: 1,
    populationCoreSetSha256: source.populationCoreSetSha256,
    persistedPerformanceCoreSetSha256: source.persistedPerformanceCoreSetSha256,
    acquisitionCoreSetSha256: source.acquisitionCoreSetSha256,
    selectedCoreSetSha256: source.selectedCoreSetSha256,
    measurementSliceSha256: source.measurementSliceSha256,
  });
}

function budget(existingWindowId?: string) {
  const readWindow = vi.fn(async () =>
    existingWindowId === undefined
      ? null
      : ({ windowId: existingWindowId } as never),
  );
  const openWindow = vi.fn(async (request) => request as never);
  return Object.freeze({
    readWindow,
    openWindow,
    value: Object.freeze({
      status: "ready" as const,
      readWindow,
      openWindow,
      reserve: vi.fn(),
      account: vi.fn(),
    }) as unknown as DnaOpenLabR2BudgetRepository,
  });
}

describe("DNA population Core-history first-cohort environment", () => {
  it("derives a stable acquisition UUID from the selected measurement slice", () => {
    const generationId = dnaPopulationCoreHistoryFirstCohortGenerationId(
      "5".repeat(64),
    );
    expect(generationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(
      dnaPopulationCoreHistoryFirstCohortGenerationId("5".repeat(64)),
    ).toBe(generationId);
    expect(
      dnaPopulationCoreHistoryFirstCohortGenerationId("6".repeat(64)),
    ).not.toBe(generationId);
  });

  it("stays unavailable until every private persistence boundary is configured", () => {
    expect(
      dnaPopulationCoreHistoryFirstCohortCommandFromEnvironment(
        {},
        authority(),
      ),
    ).toEqual({ status: "not_configured" });
  });

  it("holds before opening a budget window or collecting when A$0 capacity fails", async () => {
    const repository = budget();
    const runCollectionStep = vi.fn();
    const adapter = dnaPopulationCoreHistoryFirstCohortCommandFromEnvironment(
      environment(),
      authority(),
      {
        now: () => new Date(NOW),
        measurementSource: {
          status: "ready",
          measure: vi.fn(async () =>
            measurement({ r2StorageClass: "Infrequent Access" }),
          ),
        },
        budgetRepository: repository.value,
        runCollectionStep,
      },
    );
    if (adapter.status !== "ready") throw new Error("adapter unavailable");

    await expect(adapter.command.execute(invocation())).resolves.toMatchObject({
      status: "held",
      stepCount: 0,
      terminalKind: "provider_capacity_held:capacity_blocked",
      collectionOnly: true,
      publicationPerformed: false,
      paidUsageAllowed: false,
      previewOnly: true,
    });
    expect(repository.readWindow).not.toHaveBeenCalled();
    expect(repository.openWindow).not.toHaveBeenCalled();
    expect(runCollectionStep).not.toHaveBeenCalled();
  });

  it("opens only the freshly measured budget window and collects the singleton authority", async () => {
    const repository = budget();
    const runCollectionStep = vi.fn(async (request) => {
      expect(request.authority.coreIds).toEqual([12]);
      expect(request.maximumAggregateRequestsPerMinute).toBe(30);
      expect(request.allowPublication).toBe(false);
      return { kind: "collection_complete", stored: {} } as never;
    });
    const measure = vi.fn(async () => measurement());
    const adapter = dnaPopulationCoreHistoryFirstCohortCommandFromEnvironment(
      environment(),
      authority(),
      {
        now: () => new Date(NOW),
        measurementSource: { status: "ready", measure },
        budgetRepository: repository.value,
        runCollectionStep,
      },
    );
    if (adapter.status !== "ready") throw new Error("adapter unavailable");

    await expect(adapter.command.execute(invocation())).resolves.toMatchObject({
      status: "complete",
      stepCount: 1,
      terminalKind: "collection:collection_complete",
      collectionOnly: true,
      publicationPerformed: false,
      providerWritePerformed: false,
      paidUsageAllowed: false,
      preserveLastGood: true,
      previewOnly: true,
    });
    expect(measure).toHaveBeenCalledTimes(2);
    expect(repository.readWindow).toHaveBeenCalledWith("owner");
    expect(repository.openWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner",
        windowStartAt: "2026-10-01T00:00:00.000Z",
        windowEndAt: "2026-11-01T00:00:00.000Z",
        measuredAt: "2026-10-03T00:00:59.000Z",
        baselineUsage: measurement().currentR2Usage,
      }),
    );
    expect(runCollectionStep).toHaveBeenCalledTimes(1);
  });

  it("reuses the measured billing window when another conservative reservation is still open", async () => {
    const expectedBudgetWindowId = dnaOpenLabRawEvidenceSha256({
      domain: "dna-open-lab-r2-budget-window/v1",
      value: {
        ownerId: "owner",
        startAt: "2026-10-01T00:00:00.000Z",
        endAt: "2026-11-01T00:00:00.000Z",
      },
    });
    const repository = budget(expectedBudgetWindowId);
    const runCollectionStep = vi.fn(async (request) => {
      expect(request.budgetWindowId).toBe(expectedBudgetWindowId);
      return { kind: "collection_complete", stored: {} } as never;
    });
    const adapter = dnaPopulationCoreHistoryFirstCohortCommandFromEnvironment(
      environment(),
      authority(),
      {
        now: () => new Date(NOW),
        measurementSource: {
          status: "ready",
          measure: vi.fn(async () => measurement()),
        },
        budgetRepository: repository.value,
        runCollectionStep,
      },
    );
    if (adapter.status !== "ready") throw new Error("adapter unavailable");

    await expect(adapter.command.execute(invocation())).resolves.toMatchObject({
      status: "complete",
      budgetWindowId: expectedBudgetWindowId,
    });
    expect(repository.readWindow).toHaveBeenCalledWith("owner");
    expect(repository.openWindow).not.toHaveBeenCalled();
    expect(runCollectionStep).toHaveBeenCalledTimes(1);
  });
});
