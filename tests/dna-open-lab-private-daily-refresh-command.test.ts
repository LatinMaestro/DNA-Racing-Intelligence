import { describe, expect, it, vi } from "vitest";

import {
  DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_COMMAND_INTENT,
  DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_COMMAND_VERSION,
  dnaOpenLabPrivateDailyRefreshCommandFromEnvironment,
  type DnaOpenLabPrivateDailyRefreshCommandInvocation,
} from "@/lib/dna-open-lab-private-daily-refresh-command";
import type { DnaOpenLabPrivateDailyRefreshSources } from "@/lib/dna-open-lab-private-daily-refresh-operator";
import type { DnaOpenLabProviderCapacityMeasurement } from "@/lib/dna-open-lab-provider-capacity-preflight";
import type { DnaOpenLabR2BudgetRepository } from "@/lib/dna-open-lab-r2-budget-repository";

const head = "a".repeat(40);
const sha = "b".repeat(64);
const upperBoundAt = "2026-09-09T13:00:00.000Z";
const now = () => new Date("2026-09-09T13:05:00.000Z");

const invocation: DnaOpenLabPrivateDailyRefreshCommandInvocation =
  Object.freeze({
    commandVersion: DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_COMMAND_VERSION,
    intent: DNA_OPEN_LAB_PRIVATE_DAILY_REFRESH_COMMAND_INTENT,
    allowPersistentWrite: true,
    exactCodeHeadSha: head,
    finishedHistoryUpperBoundAt: upperBoundAt,
    maximumSteps: 2,
  });

function environment() {
  return {
    authorizedOwnerId: "owner",
    ownerId: "owner",
    databaseUrl: "postgres://preview",
    databaseOwnerId: "11111111-1111-4111-8111-111111111111",
    runtimeRole: "dna_app_runtime",
    vault: "vault",
  };
}

function measurement(): DnaOpenLabProviderCapacityMeasurement {
  return Object.freeze({
    evidenceSource: "provider_api",
    r2StorageClass: "Standard",
    measuredAt: "2026-09-09T13:04:59.000Z",
    billingWindowStartAt: "2026-09-01T00:00:00.000Z",
    billingWindowEndAt: "2026-10-01T00:00:00.000Z",
    currentR2Usage: {
      storageBytes: 900_000_000,
      classAOperations: 10_000,
      classBOperations: 20_000,
    },
    neonMeasuredAt: "2026-09-09T13:04:59.000Z",
    neonBillingWindowStartAt: "2026-09-01T00:00:00.000Z",
    neonBillingWindowEndAt: "2026-10-01T00:00:00.000Z",
    currentNeonUsage: {
      storageBytes: 55_000_000,
      computeMilliCuHours: 5_000,
    },
  });
}

function sources(input?: { held?: boolean; order?: string[] }) {
  const inspect = vi.fn(async () => {
    input?.order?.push("preflight");
    return input?.held
      ? {
          status: "held" as const,
          readyForRefresh: false as const,
          reason: "capacity_blocked" as const,
          blockerIds: ["storage_budget_exhausted" as const],
          persistentWritePerformed: false as const,
          providerWritePerformed: false as const,
          paidUsageAllowed: false as const,
          preserveLastGood: true as const,
        }
      : {
          status: "ready" as const,
          readyForRefresh: true as const,
          exactCodeHeadSha: head,
          ownerScopeSha256: sha,
          refreshCycleId: sha,
          budgetWindowId: sha,
          measurementSha256: sha,
          planSha256: sha,
          preflightSha256: sha,
          checkedAt: "2026-09-09T13:05:00.000Z",
          validUntil: "2026-09-09T13:09:59.000Z",
          projection: {
            allowed: true,
            action: "commission_refresh" as const,
            blockerIds: [],
            measuredAt: "2026-09-09T13:04:59.000Z",
            billingWindowStartAt: "2026-09-01T00:00:00.000Z",
            billingWindowEndAt: "2026-10-01T00:00:00.000Z",
            neonMeasuredAt: "2026-09-09T13:04:59.000Z",
            neonBillingWindowStartAt: "2026-09-01T00:00:00.000Z",
            neonBillingWindowEndAt: "2026-10-01T00:00:00.000Z",
            r2RemainingRefreshes: 22,
            neonRemainingRefreshes: 22,
            maximumSafeR2RemainingRefreshes: 22,
            maximumSafeNeonRemainingRefreshes: 22,
            projectedR2Usage: measurement().currentR2Usage,
            projectedNeonUsage: measurement().currentNeonUsage,
            r2Headroom: {
              storageBytes: 1,
              classAOperations: 1,
              classBOperations: 1,
            },
            neonHeadroom: { storageBytes: 1, computeMilliCuHours: 1 },
            requiredR2StorageClass: "Standard" as const,
            r2FreeAllowances: {
              storageBytes: 10_000_000_000,
              classAOperations: 1_000_000,
              classBOperations: 10_000_000,
            },
            r2Budgets: {
              storageBytes: 8_000_000_000,
              classAOperations: 800_000,
              classBOperations: 8_000_000,
            },
            neonFreeAllowances: {
              storageBytes: 536_870_912,
              computeMilliCuHours: 100_000,
            },
            neonBudgets: {
              storageBytes: 500_000_000,
              computeMilliCuHours: 80_000,
            },
            paidUsageAllowed: false as const,
            preserveLastGood: true as const,
          },
          persistentWritePerformed: false as const,
          providerWritePerformed: false as const,
          paidUsageAllowed: false as const,
          preserveLastGood: true as const,
        };
  });
  return {
    inspect,
    value: {
      providerCapacityPreflight: { inspect },
    } as unknown as DnaOpenLabPrivateDailyRefreshSources,
  };
}

function budget(order: string[], existing = false) {
  const readWindow = vi.fn(async () => {
    order.push("read_window");
    return existing ? ({ windowId: sha } as never) : null;
  });
  const openWindow = vi.fn(async (request) => {
    order.push("open_window");
    return { ...request, windowId: request.windowId } as never;
  });
  return {
    readWindow,
    openWindow,
    value: {
      status: "ready" as const,
      readWindow,
      openWindow,
      reserve: vi.fn(),
      account: vi.fn(),
    } as unknown as DnaOpenLabR2BudgetRepository,
  };
}

describe("DNA Open Lab private daily refresh command", () => {
  it("is unavailable until the Preview write boundary is configured", () => {
    expect(dnaOpenLabPrivateDailyRefreshCommandFromEnvironment({})).toEqual({
      status: "not_configured",
    });
  });

  it("requires an explicit bounded write-armed invocation", async () => {
    const order: string[] = [];
    const command = dnaOpenLabPrivateDailyRefreshCommandFromEnvironment(
      environment(),
      {
        now,
        measurementSource: {
          status: "ready",
          measure: vi.fn(async () => measurement()),
        },
        budgetRepository: budget(order).value,
      },
    );
    if (command.status !== "ready") throw new Error("command unavailable");
    await expect(
      command.execute({
        ...invocation,
        allowPersistentWrite: false,
      } as unknown as DnaOpenLabPrivateDailyRefreshCommandInvocation),
    ).rejects.toThrow("not explicitly armed");
    expect(order).toEqual([]);
  });

  it("holds before the first durable write when fresh capacity is blocked", async () => {
    const order: string[] = [];
    const source = sources({ held: true, order });
    const repository = budget(order);
    const command = dnaOpenLabPrivateDailyRefreshCommandFromEnvironment(
      environment(),
      {
        now,
        measurementSource: {
          status: "ready",
          measure: vi.fn(async () => {
            order.push("measure");
            return measurement();
          }),
        },
        budgetRepository: repository.value,
        sourcesFromMeasurement: () => ({
          status: "ready",
          sources: source.value,
        }),
      },
    );
    if (command.status !== "ready") throw new Error("command unavailable");
    await expect(command.execute(invocation)).resolves.toMatchObject({
      status: "held",
      stepCount: 0,
      terminalKind: "provider_capacity_held:capacity_blocked",
      previewOnly: true,
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
    expect(order).toEqual(["measure", "preflight"]);
    expect(repository.openWindow).not.toHaveBeenCalled();
  });

  it("opens the measured billing window then advances only the bounded steps", async () => {
    const order: string[] = [];
    const source = sources({ order });
    const repository = budget(order);
    const execute = vi.fn(async () => {
      order.push("operator");
      return { kind: "finished_history", step: { kind: "advanced" } } as never;
    });
    let operatorSources: DnaOpenLabPrivateDailyRefreshSources | undefined;
    const command = dnaOpenLabPrivateDailyRefreshCommandFromEnvironment(
      environment(),
      {
        now,
        measurementSource: {
          status: "ready",
          measure: vi.fn(async () => {
            order.push("measure");
            return measurement();
          }),
        },
        budgetRepository: repository.value,
        sourcesFromMeasurement: () => ({
          status: "ready",
          sources: source.value,
        }),
        operatorFromSources: (value) => {
          operatorSources = value;
          return { status: "ready", execute };
        },
      },
    );
    if (command.status !== "ready") throw new Error("command unavailable");
    const receipt = await command.execute(invocation);
    expect(receipt).toMatchObject({
      status: "advanced",
      stepCount: 2,
      terminalKind: "finished_history:advanced",
      exactCodeHeadSha: head,
      finishedHistoryUpperBoundAt: upperBoundAt,
      persistentWriteArmed: true,
      previewOnly: true,
      paidUsageAllowed: false,
      preserveLastGood: true,
      r2AccountingBasis: "reserved_upper_bound",
    });
    expect(receipt.refreshCycleId).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.budgetWindowId).toMatch(/^[a-f0-9]{64}$/u);
    expect(order).toEqual([
      "measure",
      "preflight",
      "read_window",
      "open_window",
      "operator",
      "operator",
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
    await expect(operatorSources?.measureActualR2Usage()).resolves.toEqual({
      storageBytes: 100_000_000,
      classAOperations: 1_000,
      classBOperations: 2_000,
    });
  });
});
