import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collect: vi.fn(),
  materialize: vi.fn(),
}));

vi.mock("@/lib/dna-core-race-history-private-collector", async () => ({
  ...(await vi.importActual("@/lib/dna-core-race-history-private-collector")),
  runDnaCoreRaceHistoryPrivateCollectorStep: mocks.collect,
}));

vi.mock("@/lib/dna-core-race-history-generation-materializer", async () => ({
  ...(await vi.importActual(
    "@/lib/dna-core-race-history-generation-materializer",
  )),
  materializeAndPublishLatestDnaCoreRaceHistory: mocks.materialize,
}));

import {
  createDnaCoreRaceHistoryPrivateGenerationOperator,
  type DnaCoreRaceHistoryPrivateGenerationInvocation,
  type DnaCoreRaceHistoryPrivateGenerationRepositories,
  type DnaCoreRaceHistoryPrivateGenerationSources,
} from "@/lib/dna-core-race-history-private-generation-operator";

const ownerId = "private-owner";
const windowId = "window-authority";
const cycleId = "a".repeat(64);

const invocation: DnaCoreRaceHistoryPrivateGenerationInvocation = {
  operatorVersion: "dna-core-race-history-private-generation/v1",
  intent: "advance_private_core_result_generation",
  allowPersistentWrite: true,
  authenticatedOwnerId: ownerId,
  budgetWindowId: windowId,
  evaluatedAt: "2026-09-15T00:00:00.000Z",
  attemptedAt: "2026-09-15T00:00:01.000Z",
  workerId: "private-preview-worker",
  materializedAt: "2026-09-15T00:00:02.000Z",
  publishedAt: "2026-09-15T00:00:03.000Z",
  maximumRetainedEvidenceClassBOperations: 2_000,
  maximumAggregateRequestsPerMinute: 30,
};

function sources(): DnaCoreRaceHistoryPrivateGenerationSources {
  return {
    loadServingCores: vi.fn(),
    client: {},
    requestBudget: {
      execute: vi.fn(async (request) => request()),
      snapshot: () => ({ effectiveRequestsPerMinute: 30 }),
    },
    evidenceStore: {},
    raceDocumentClient: {},
  } as unknown as DnaCoreRaceHistoryPrivateGenerationSources;
}

function repositories(
  input: {
    window?: null | { windowId: string };
    allowed?: boolean;
    unsafeDecision?: boolean;
    driftedAccounting?: boolean;
  } = {},
): DnaCoreRaceHistoryPrivateGenerationRepositories & {
  budget: DnaCoreRaceHistoryPrivateGenerationRepositories["budget"] & {
    readWindow: ReturnType<typeof vi.fn>;
    reserve: ReturnType<typeof vi.fn>;
    account: ReturnType<typeof vi.fn>;
  };
} {
  const allowed = input.allowed ?? true;
  return {
    acquisition: {},
    generation: {},
    budget: {
      status: "ready",
      readWindow: vi
        .fn()
        .mockResolvedValue(
          input.window === undefined ? { windowId } : input.window,
        ),
      reserve: vi.fn().mockResolvedValue({
        allowed,
        blockerIds: allowed ? [] : ["class_b_budget_exhausted"],
        reservationStatus: allowed ? "reserved" : null,
        paidUsageAllowed: input.unsafeDecision ? true : false,
        preserveLastGood: input.unsafeDecision ? false : true,
      }),
      account: vi.fn().mockImplementation(async (request) => ({
        windowId,
        refreshCycleId: request.refreshCycleId,
        requestSha256: input.driftedAccounting
          ? "drifted-request"
          : request.requestSha256,
        status: "accounted",
        plannedUsage: request.actualUsage,
        actualUsage: request.actualUsage,
        reservedAt: "2026-09-15T00:00:01.000Z",
        accountedAt: "2026-09-15T00:00:02.000Z",
      })),
    },
  } as unknown as ReturnType<typeof repositories>;
}

function completeStep(
  previousCompletedCycleId: string | null = null,
  acceptedResultCount = 0,
) {
  return {
    kind: "collection_complete",
    stored: {
      cycle: {
        cycleId,
        attemptNumber: 1,
        previousCompletedCycleId,
        completion: { pageReceiptCount: 500, acceptedResultCount },
      },
    },
  };
}

describe("DNA Core race history private generation operator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.collect.mockResolvedValue({ kind: "page_recorded" });
    mocks.materialize.mockResolvedValue({
      kind: "published",
      generation: { generationId: "generation-1" },
    });
  });

  it("refuses unarmed, cross-owner and elevated-rate invocations before work", async () => {
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: repositories(),
    });
    await expect(
      operator.execute({ ...invocation, allowPersistentWrite: false } as never),
    ).rejects.toThrow("not explicitly armed");
    await expect(
      operator.execute({ ...invocation, authenticatedOwnerId: "other-owner" }),
    ).rejects.toThrow("owner scope denied");
    await expect(
      operator.execute({
        ...invocation,
        maximumAggregateRequestsPerMinute: 31,
      }),
    ).rejects.toThrow("conservative aggregate limit");
    expect(mocks.collect).not.toHaveBeenCalled();
  });

  it("holds before collection when durable free-budget authority is absent", async () => {
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: repositories({ window: null }),
    });
    await expect(operator.execute(invocation)).resolves.toEqual({
      kind: "budget_unavailable",
      reason: "window_missing",
    });
    expect(mocks.collect).not.toHaveBeenCalled();
  });

  it("advances one collection step without materializing partial evidence", async () => {
    const sourcePorts = sources();
    const persistence = repositories();
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sourcePorts,
      repositories: persistence,
    });
    await expect(operator.execute(invocation)).resolves.toEqual({
      kind: "collection",
      step: { kind: "page_recorded" },
    });
    expect(mocks.collect).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        budgetWindowId: windowId,
        acquisitionRepository: persistence.acquisition,
        budgetRepository: persistence.budget,
        evidenceStore: sourcePorts.evidenceStore,
      }),
    );
    expect(persistence.budget.reserve).not.toHaveBeenCalled();
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("reserves and accounts retained reads before complete publication", async () => {
    mocks.collect.mockResolvedValue(completeStep());
    const sourcePorts = sources();
    const persistence = repositories();
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sourcePorts,
      repositories: persistence,
    });
    await expect(operator.execute(invocation)).resolves.toMatchObject({
      kind: "generation",
      result: { kind: "published" },
    });
    expect(persistence.budget.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        windowId,
        plannedUsage: {
          storageBytes: 0,
          classAOperations: 0,
          classBOperations: 2_000,
        },
      }),
    );
    expect(persistence.budget.account).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        windowId,
        actualUsage: {
          storageBytes: 0,
          classAOperations: 0,
          classBOperations: 2_000,
        },
      }),
    );
    expect(persistence.budget.account.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.materialize.mock.invocationCallOrder[0]!,
    );
    expect(mocks.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        workerId: invocation.workerId,
        acquisitionRepository: persistence.acquisition,
        generationRepository: persistence.generation,
        retainedEvidenceReadBudget: {
          maximumClassBOperations: 2_000,
          paidUsageAllowed: false,
        },
      }),
    );
  });

  it("preaccounts bounded resumable race-document cache evidence", async () => {
    mocks.collect.mockResolvedValue(completeStep(null, 2_001));
    const persistence = repositories();
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence,
    });

    await expect(operator.execute(invocation)).resolves.toMatchObject({
      kind: "generation",
    });
    expect(persistence.budget.reserve).toHaveBeenCalledTimes(2);
    expect(persistence.budget.reserve).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ownerId,
        windowId,
        plannedUsage: {
          storageBytes: 101 * 128 * 1_024,
          classAOperations: 101,
          classBOperations: 202,
        },
      }),
    );
    expect(persistence.budget.account).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actualUsage: {
          storageBytes: 101 * 128 * 1_024,
          classAOperations: 101,
          classBOperations: 202,
        },
      }),
    );
  });

  it("chunks a larger exact retained-read requirement before publication", async () => {
    mocks.collect.mockResolvedValue({
      ...completeStep(),
      stored: {
        cycle: {
          ...completeStep().stored.cycle,
          completion: { pageReceiptCount: 501 },
        },
      },
    });
    const persistence = repositories();
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence,
    });

    await expect(
      operator.execute({
        ...invocation,
        maximumRetainedEvidenceClassBOperations: 4_000,
      }),
    ).resolves.toMatchObject({
      kind: "generation",
      result: { kind: "published" },
    });
    expect(persistence.budget.reserve).toHaveBeenCalledTimes(2);
    expect(persistence.budget.reserve).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        plannedUsage: {
          storageBytes: 0,
          classAOperations: 0,
          classBOperations: 2_000,
        },
      }),
    );
    expect(persistence.budget.reserve).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        plannedUsage: {
          storageBytes: 0,
          classAOperations: 0,
          classBOperations: 4,
        },
      }),
    );
    expect(persistence.budget.account).toHaveBeenCalledTimes(2);
    expect(mocks.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        retainedEvidenceReadBudget: {
          maximumClassBOperations: 2_004,
          paidUsageAllowed: false,
        },
      }),
    );
  });

  it("holds before reservation when exact retained reads exceed the commissioning ceiling", async () => {
    mocks.collect.mockResolvedValue(completeStep());
    const persistence = repositories();
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence,
    });

    await expect(
      operator.execute({
        ...invocation,
        maximumRetainedEvidenceClassBOperations: 1_999,
      }),
    ).rejects.toThrow(
      "retained-evidence Class B requirement exceeds its ceiling",
    );
    expect(persistence.budget.reserve).not.toHaveBeenCalled();
    expect(persistence.budget.account).not.toHaveBeenCalled();
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("does not read or publish when the materialization reservation is blocked", async () => {
    mocks.collect.mockResolvedValue(completeStep());
    const persistence = repositories({ allowed: false });
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence,
    });
    await expect(operator.execute(invocation)).resolves.toEqual({
      kind: "materialization_budget_blocked",
      blockerIds: ["class_b_budget_exhausted"],
    });
    expect(persistence.budget.account).not.toHaveBeenCalled();
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("accepts an exact already-accounted reservation replay", async () => {
    mocks.collect.mockResolvedValue(completeStep());
    const persistence = repositories();
    persistence.budget.reserve.mockResolvedValueOnce({
      allowed: true,
      blockerIds: [],
      reservationStatus: "accounted",
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence,
    });

    await expect(operator.execute(invocation)).resolves.toMatchObject({
      kind: "generation",
      result: { kind: "published" },
    });
    expect(persistence.budget.account).toHaveBeenCalledTimes(1);
    expect(mocks.materialize).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe reservation authority before accounting or reads", async () => {
    mocks.collect.mockResolvedValue(completeStep());
    const persistence = repositories({ unsafeDecision: true });
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence,
    });
    await expect(operator.execute(invocation)).rejects.toThrow(
      "materialization budget safety authority drifted",
    );
    expect(persistence.budget.account).not.toHaveBeenCalled();
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("rejects contradictory reservation decisions before accounting or reads", async () => {
    mocks.collect.mockResolvedValue(completeStep());
    const persistence = repositories();
    persistence.budget.reserve.mockResolvedValueOnce({
      allowed: true,
      blockerIds: ["class_b_budget_exhausted"],
      reservationStatus: "reserved",
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence,
    });

    await expect(operator.execute(invocation)).rejects.toThrow(
      "materialization budget decision drifted",
    );
    expect(persistence.budget.account).not.toHaveBeenCalled();
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("requires a durable blocker reason for a denied reservation", async () => {
    mocks.collect.mockResolvedValue(completeStep());
    const persistence = repositories();
    persistence.budget.reserve.mockResolvedValueOnce({
      allowed: false,
      blockerIds: [],
      reservationStatus: null,
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence,
    });

    await expect(operator.execute(invocation)).rejects.toThrow(
      "materialization budget decision drifted",
    );
    expect(persistence.budget.account).not.toHaveBeenCalled();
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("rejects a drifted accounting receipt before retained reads", async () => {
    mocks.collect.mockResolvedValue(completeStep());
    const persistence = repositories({ driftedAccounting: true });
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence,
    });
    await expect(operator.execute(invocation)).rejects.toThrow(
      "materialization budget accounting drifted",
    );
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("holds a successor cycle before reserving reads until lineage is supported", async () => {
    mocks.collect.mockResolvedValue(completeStep("b".repeat(64)));
    const persistence = repositories();
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence,
    });
    await expect(operator.execute(invocation)).resolves.toEqual({
      kind: "generation",
      result: {
        kind: "authority_unavailable",
        reason: "historical_lineage_required",
      },
    });
    expect(persistence.budget.reserve).not.toHaveBeenCalled();
    expect(persistence.budget.account).not.toHaveBeenCalled();
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("hydrates more than twenty race documents in safe batches on the same aggregate budget", async () => {
    mocks.collect.mockResolvedValue(completeStep());
    const raceDocs = vi
      .fn()
      .mockImplementation(async (raceIds: readonly string[]) => ({
        result: raceIds.map((rid: string) => ({ rid })),
        httpStatus: 200,
        rateLimit: {
          limit: 150,
          remaining: 149,
          resetSeconds: 1,
          rateClass: "api_key",
          retryAfterSeconds: null,
        },
      }));
    const sourcePorts = {
      ...sources(),
      raceDocumentClient: { raceDocs },
    } as DnaCoreRaceHistoryPrivateGenerationSources;
    mocks.materialize.mockImplementationOnce(async (input) => {
      const raceIds = Array.from({ length: 25 }, (_, index) =>
        String(index + 1),
      );
      const evidence = await input.loadRaceDocuments(raceIds);
      expect(evidence).toHaveLength(25);
      expect(
        evidence.map(
          (entry: { canonical: { sourceRaceId: string } }) =>
            entry.canonical.sourceRaceId,
        ),
      ).toEqual(raceIds);
      return {
        kind: "published",
        generation: { generationId: "generation-1" },
      };
    });
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sourcePorts,
      repositories: repositories(),
    });

    await expect(operator.execute(invocation)).resolves.toMatchObject({
      kind: "generation",
    });
    expect(sourcePorts.requestBudget.execute).toHaveBeenCalledTimes(2);
    expect(raceDocs).toHaveBeenNthCalledWith(
      1,
      Array.from({ length: 20 }, (_, index) => String(index + 1)),
    );
    expect(raceDocs).toHaveBeenNthCalledWith(
      2,
      Array.from({ length: 5 }, (_, index) => String(index + 21)),
    );
  });

  it("keeps the full read ceiling charged if materialization is interrupted", async () => {
    mocks.collect.mockResolvedValue(completeStep());
    mocks.materialize.mockRejectedValue(new Error("synthetic interruption"));
    const persistence = repositories();
    const operator = createDnaCoreRaceHistoryPrivateGenerationOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence,
    });
    await expect(operator.execute(invocation)).rejects.toThrow(
      "synthetic interruption",
    );
    expect(persistence.budget.account).toHaveBeenCalledTimes(1);
  });
});
