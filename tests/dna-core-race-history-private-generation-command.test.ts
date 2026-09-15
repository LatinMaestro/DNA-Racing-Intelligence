import { describe, expect, it, vi } from "vitest";

import {
  DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_INTENT,
  DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_VERSION,
  dnaCoreRaceHistoryPrivateGenerationCommandFromEnvironment,
  type DnaCoreRaceHistoryPrivateGenerationCommandInvocation,
} from "@/lib/dna-core-race-history-private-generation-command";
import type {
  DnaCoreRaceHistoryPrivateGenerationInvocation,
  DnaCoreRaceHistoryPrivateGenerationResult,
} from "@/lib/dna-core-race-history-private-generation-operator";
import type { DnaOpenLabProviderCapacityMeasurement } from "@/lib/dna-open-lab-provider-capacity-preflight";
import type { DnaOpenLabR2BudgetRepository } from "@/lib/dna-open-lab-r2-budget-repository";

const head = "a".repeat(40);
const evaluatedAt = "2026-09-09T13:00:00.000Z";
const now = () => new Date("2026-09-09T13:05:00.000Z");

const invocation: DnaCoreRaceHistoryPrivateGenerationCommandInvocation =
  Object.freeze({
    commandVersion: DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_VERSION,
    intent: DNA_CORE_RACE_HISTORY_PRIVATE_GENERATION_COMMAND_INTENT,
    allowPersistentWrite: true,
    exactCodeHeadSha: head,
    evaluatedAt,
    maximumSteps: 3,
  });

function environment() {
  return {
    authorizedOwnerId: "owner",
    ownerId: "owner",
    databaseUrl: "postgres://preview",
    databaseOwnerId: "11111111-1111-4111-8111-111111111111",
    runtimeRole: "dna_app_runtime",
    cloudflareAccountId: "cloudflare-account",
    cloudflareApiToken: "cloudflare-token",
    r2AccessKeyId: "r2-access",
    r2BucketName: "private-bucket",
    r2SecretAccessKey: "r2-secret",
    dnaOpenLabApiKey1: "key-1",
    dnaOpenLabApiKey2: "key-2",
    dnaOpenLabApiKey3: "key-3",
  };
}

function measurement(
  overrides: Partial<DnaOpenLabProviderCapacityMeasurement> = {},
): DnaOpenLabProviderCapacityMeasurement {
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
    ...overrides,
  });
}

function budget(order: string[], existingWindowId?: string) {
  const readWindow = vi.fn(async () => {
    order.push("read_window");
    return existingWindowId === undefined
      ? null
      : ({ windowId: existingWindowId } as never);
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

function result(value: unknown): DnaCoreRaceHistoryPrivateGenerationResult {
  return value as DnaCoreRaceHistoryPrivateGenerationResult;
}

describe("DNA Core race-history private generation command", () => {
  it("is unavailable until every hosted write boundary is configured", () => {
    expect(
      dnaCoreRaceHistoryPrivateGenerationCommandFromEnvironment({}),
    ).toEqual({ status: "not_configured" });
  });

  it("requires an explicit bounded write-armed invocation", async () => {
    const order: string[] = [];
    const repository = budget(order);
    const execute = vi.fn();
    const command = dnaCoreRaceHistoryPrivateGenerationCommandFromEnvironment(
      environment(),
      {
        now,
        measurementSource: {
          status: "ready",
          measure: vi.fn(async () => measurement()),
        },
        budgetRepository: repository.value,
        operatorForEvaluation: () => ({ status: "ready", execute }),
      },
    );
    if (command.status !== "ready") throw new Error("command unavailable");
    await expect(
      command.execute({
        ...invocation,
        allowPersistentWrite: false,
      } as unknown as DnaCoreRaceHistoryPrivateGenerationCommandInvocation),
    ).rejects.toThrow("not explicitly armed");
    expect(order).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("holds before a durable write when fresh zero-cost capacity is blocked", async () => {
    const order: string[] = [];
    const repository = budget(order);
    const execute = vi.fn();
    const command = dnaCoreRaceHistoryPrivateGenerationCommandFromEnvironment(
      environment(),
      {
        now,
        measurementSource: {
          status: "ready",
          measure: vi.fn(async () => {
            order.push("measure");
            return measurement({ r2StorageClass: "Infrequent Access" });
          }),
        },
        budgetRepository: repository.value,
        operatorForEvaluation: () => ({ status: "ready", execute }),
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
    expect(order).toEqual(["measure"]);
    expect(repository.openWindow).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("opens the measured budget window and publishes after bounded page progress", async () => {
    const order: string[] = [];
    const repository = budget(order);
    const invocations: DnaCoreRaceHistoryPrivateGenerationInvocation[] = [];
    const responses = [
      result({
        kind: "collection",
        step: { kind: "page_advanced", source: "provider", stored: {} },
      }),
      result({
        kind: "collection",
        step: { kind: "collection_complete", stored: {} },
      }),
      result({
        kind: "generation",
        result: { kind: "published", generation: {} },
      }),
    ];
    const execute = vi.fn(
      async (request: DnaCoreRaceHistoryPrivateGenerationInvocation) => {
        order.push("operator");
        invocations.push(request);
        const response = responses.shift();
        if (response === undefined) throw new Error("unexpected extra step");
        return response;
      },
    );
    const command = dnaCoreRaceHistoryPrivateGenerationCommandFromEnvironment(
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
        operatorForEvaluation: () => ({ status: "ready", execute }),
      },
    );
    if (command.status !== "ready") throw new Error("command unavailable");
    const receipt = await command.execute(invocation);
    expect(receipt).toMatchObject({
      status: "complete",
      stepCount: 3,
      terminalKind: "generation:published",
      exactCodeHeadSha: head,
      evaluatedAt,
      persistentWriteArmed: true,
      previewOnly: true,
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
    expect(receipt.budgetWindowId).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.preflightSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(order).toEqual([
      "measure",
      "read_window",
      "open_window",
      "operator",
      "operator",
      "operator",
    ]);
    expect(invocations).toHaveLength(3);
    expect(new Set(invocations.map((item) => item.evaluatedAt))).toHaveLength(
      1,
    );
    expect(
      new Set(invocations.map((item) => item.budgetWindowId)),
    ).toHaveLength(1);
    expect(
      invocations.every(
        (item) =>
          item.maximumAggregateRequestsPerMinute === 30 &&
          item.authenticatedOwnerId === "owner",
      ),
    ).toBe(true);
  });

  it("stops safely at the step bound or a provider pause", async () => {
    const order: string[] = [];
    const repository = budget(order);
    const page = result({
      kind: "collection",
      step: { kind: "page_advanced", source: "provider", stored: {} },
    });
    const execute = vi
      .fn()
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(page);
    const command = dnaCoreRaceHistoryPrivateGenerationCommandFromEnvironment(
      environment(),
      {
        now,
        measurementSource: {
          status: "ready",
          measure: vi.fn(async () => measurement()),
        },
        budgetRepository: repository.value,
        operatorForEvaluation: () => ({ status: "ready", execute }),
      },
    );
    if (command.status !== "ready") throw new Error("command unavailable");
    await expect(
      command.execute({ ...invocation, maximumSteps: 2 }),
    ).resolves.toMatchObject({
      status: "advanced",
      stepCount: 2,
      terminalKind: "collection:page_advanced",
    });

    execute.mockReset();
    execute.mockResolvedValueOnce(
      result({
        kind: "collection",
        step: { kind: "paused", reason: "rate_limited", stored: {} },
      }),
    );
    await expect(command.execute(invocation)).resolves.toMatchObject({
      status: "held",
      stepCount: 1,
      terminalKind: "collection:paused:rate_limited",
      preserveLastGood: true,
    });
  });
});
