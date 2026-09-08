import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDailyRefresh: vi.fn(),
  runFinishedHistory: vi.fn(),
  publishFinishedHistory: vi.fn(),
  runCurrentState: vi.fn(),
}));

vi.mock("@/lib/dna-open-lab-daily-refresh-coordinator", async () => ({
  ...(await vi.importActual("@/lib/dna-open-lab-daily-refresh-coordinator")),
  runDnaOpenLabDailyRefreshStep: mocks.runDailyRefresh,
}));

vi.mock("@/lib/dna-open-lab-finished-race-incremental-runner", async () => ({
  ...(await vi.importActual(
    "@/lib/dna-open-lab-finished-race-incremental-runner",
  )),
  runDnaFinishedRaceIncrementalStep: mocks.runFinishedHistory,
}));

vi.mock(
  "@/lib/dna-open-lab-finished-race-incremental-publication",
  async () => ({
    ...(await vi.importActual(
      "@/lib/dna-open-lab-finished-race-incremental-publication",
    )),
    publishDnaFinishedRaceIncrementalCycle: mocks.publishFinishedHistory,
  }),
);

vi.mock("@/lib/dna-open-lab-current-state-operator", async () => ({
  ...(await vi.importActual("@/lib/dna-open-lab-current-state-operator")),
  runDnaCurrentStateOperatorStep: mocks.runCurrentState,
}));

import {
  createDnaOpenLabPrivateDailyRefreshOperator,
  dnaOpenLabPrivateDailyRefreshOperatorFromEnvironment,
  type DnaOpenLabPrivateDailyRefreshInvocation,
  type DnaOpenLabPrivateDailyRefreshRepositories,
  type DnaOpenLabPrivateDailyRefreshSources,
} from "@/lib/dna-open-lab-private-daily-refresh-operator";

const ownerId = "private-owner";
const cycleId = "2".repeat(64);
const historyCycleId = "3".repeat(64);
const windowId = "1".repeat(64);

const invocation: DnaOpenLabPrivateDailyRefreshInvocation = Object.freeze({
  operatorVersion: "dna-open-lab-private-daily-refresh/v1",
  intent: "advance_private_daily_refresh",
  allowPersistentWrite: true,
  authenticatedOwnerId: ownerId,
  refreshCycleId: cycleId,
  budgetWindowId: windowId,
  plannedR2Usage: {
    storageBytes: 10_000,
    classAOperations: 20,
    classBOperations: 30,
  },
  currentR2Usage: {
    storageBytes: 1_000,
    classAOperations: 100,
    classBOperations: 200,
  },
  finishedHistoryUpperBoundAt: "2026-09-09T00:00:00.000Z",
  currentStateCycleId: "97000000-0000-4000-8000-000000000001",
  evaluatedAt: "2026-09-09T00:01:00.000Z",
  attemptedAt: "2026-09-09T00:01:00.000Z",
  recordedAt: "2026-09-09T00:02:00.000Z",
  acceptedAt: "2026-09-09T00:03:00.000Z",
  publishedAt: "2026-09-09T00:04:00.000Z",
  vault: "private-vault",
});

function sources(): DnaOpenLabPrivateDailyRefreshSources {
  return {
    finishedHistoryClient: {},
    requestBudget: {
      snapshot: () => ({ effectiveRequestsPerMinute: 30 }),
    },
    finishedHistoryPublisher: vi.fn(),
    identityConflictQuarantine: vi.fn(),
    currentStatePool: {
      snapshot: () => ({
        independentRateBucketsEnabled: false,
        aggregateBudget: { effectiveRequestsPerMinute: 30 },
      }),
    },
    persistCurrentStateEvidence: vi.fn(),
    readCurrentStateEvidence: vi.fn(),
    measureActualR2Usage: vi.fn(),
  } as unknown as DnaOpenLabPrivateDailyRefreshSources;
}

function repositories() {
  const pause = vi.fn();
  return {
    pause,
    value: {
      budget: { status: "ready" },
      finishedHistoryCycle: {},
      finishedHistoryPublication: {},
      currentStateCycle: {},
      currentStatePublication: { pause },
      generation: {},
    } as unknown as DnaOpenLabPrivateDailyRefreshRepositories,
  };
}

describe("DNA Open Lab private daily refresh operator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runFinishedHistory.mockResolvedValue({
      kind: "collection_complete",
      stored: { cycle: { cycleId: historyCycleId } },
    });
    mocks.publishFinishedHistory.mockResolvedValue({ cycleId: historyCycleId });
    mocks.runCurrentState.mockResolvedValue({ kind: "discovering" });
    mocks.runDailyRefresh.mockImplementation(async (input) => {
      await input.advanceFinishedHistory();
      await input.advanceCurrentState();
      return { kind: "budget_unavailable", reason: "window_missing" };
    });
  });

  it("stays unavailable until every server-only database setting exists", () => {
    expect(
      dnaOpenLabPrivateDailyRefreshOperatorFromEnvironment(
        { ownerId },
        sources(),
      ),
    ).toEqual({ status: "not_configured" });
  });

  it("composes every persistence authority without opening a database session", () => {
    const sessionFactory = vi.fn();
    expect(
      dnaOpenLabPrivateDailyRefreshOperatorFromEnvironment(
        {
          databaseUrl: "postgresql://private.example/test",
          databaseOwnerId: "97000000-0000-4000-8000-000000000002",
          ownerId,
          runtimeRole: "dna_app_runtime",
        },
        sources(),
        sessionFactory,
      ).status,
    ).toBe("ready");
    expect(sessionFactory).not.toHaveBeenCalled();
  });

  it("refuses unarmed and cross-owner invocations before persistence or provider work", async () => {
    const persistence = repositories();
    const operator = createDnaOpenLabPrivateDailyRefreshOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence.value,
    });

    await expect(
      operator.execute({
        ...invocation,
        allowPersistentWrite: false,
      } as unknown as DnaOpenLabPrivateDailyRefreshInvocation),
    ).rejects.toThrow("not explicitly armed");
    await expect(
      operator.execute({ ...invocation, authenticatedOwnerId: "other-owner" }),
    ).rejects.toThrow("owner scope denied");
    expect(mocks.runDailyRefresh).not.toHaveBeenCalled();
    expect(mocks.runFinishedHistory).not.toHaveBeenCalled();
    expect(mocks.runCurrentState).not.toHaveBeenCalled();
  });

  it("refuses an elevated or independent-bucket runtime before persistence or provider work", async () => {
    const persistence = repositories();
    const elevated = createDnaOpenLabPrivateDailyRefreshOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence.value,
    });
    await expect(
      elevated.execute({
        ...invocation,
        maximumAggregateRequestsPerMinute: 31,
      }),
    ).rejects.toThrow("between 1 and 30");

    const unsafeSources = sources();
    const independent = createDnaOpenLabPrivateDailyRefreshOperator({
      configuredOwnerId: ownerId,
      sources: {
        ...unsafeSources,
        currentStatePool: {
          snapshot: () => ({
            independentRateBucketsEnabled: true,
            aggregateBudget: null,
            lanes: [],
          }),
        } as unknown as DnaOpenLabPrivateDailyRefreshSources["currentStatePool"],
      },
      repositories: persistence.value,
    });
    await expect(independent.execute(invocation)).rejects.toThrow(
      "requires one conservative aggregate client-pool budget",
    );
    expect(mocks.runDailyRefresh).not.toHaveBeenCalled();
  });

  it("publishes completed history before advancing current state under one coordinator", async () => {
    const sourcePorts = sources();
    const persistence = repositories();
    const operator = createDnaOpenLabPrivateDailyRefreshOperator({
      configuredOwnerId: ownerId,
      sources: sourcePorts,
      repositories: persistence.value,
    });

    await expect(operator.execute(invocation)).resolves.toEqual({
      kind: "budget_unavailable",
      reason: "window_missing",
    });

    expect(mocks.runDailyRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        refreshCycleId: cycleId,
        budgetWindowId: windowId,
        budgetRepository: persistence.value.budget,
        generationRepository: persistence.value.generation,
      }),
    );
    expect(mocks.runFinishedHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: persistence.value.finishedHistoryCycle,
        client: sourcePorts.finishedHistoryClient,
      }),
    );
    expect(mocks.publishFinishedHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        cycle: { cycleId: historyCycleId },
        repository: persistence.value.finishedHistoryPublication,
      }),
    );
    expect(mocks.runCurrentState).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        cycleId: invocation.currentStateCycleId,
        checkpointRepository: persistence.value.currentStateCycle,
        publicationRepository: persistence.value.currentStatePublication,
      }),
    );
    expect(
      mocks.publishFinishedHistory.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.runCurrentState.mock.invocationCallOrder[0]!);
  });

  it("maps a history eligibility pause into the shared last-good state", async () => {
    const persistence = repositories();
    mocks.runFinishedHistory.mockImplementationOnce(async (input) => {
      await input.pauseLastGood({
        reason: "tier_ineligible",
        attemptedAt: invocation.attemptedAt,
        retryAfterSeconds: null,
      });
      return {
        kind: "paused",
        reason: "tier_ineligible",
        retryAt: null,
        stored: { cycle: { cycleId: historyCycleId } },
      };
    });
    mocks.runDailyRefresh.mockImplementationOnce(async (input) => {
      await input.advanceFinishedHistory();
      return { kind: "finished_history", step: { kind: "paused" } };
    });
    const operator = createDnaOpenLabPrivateDailyRefreshOperator({
      configuredOwnerId: ownerId,
      sources: sources(),
      repositories: persistence.value,
    });

    await operator.execute(invocation);

    expect(persistence.pause).toHaveBeenCalledWith({
      ownerId,
      reason: "api_ineligible",
      attemptedAt: invocation.attemptedAt,
      retryAfterSeconds: null,
    });
    expect(mocks.publishFinishedHistory).not.toHaveBeenCalled();
    expect(mocks.runCurrentState).not.toHaveBeenCalled();
  });
});
