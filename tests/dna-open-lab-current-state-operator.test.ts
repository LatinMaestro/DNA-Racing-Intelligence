import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DnaCurrentStateAcquisitionCycleCheckpointRepository } from "@/lib/dna-open-lab-current-state-acquisition-runner";
import type { DnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import { runDnaCurrentStateOperatorStep } from "@/lib/dna-open-lab-current-state-operator";
import type { DnaCurrentStateSyncPlan } from "@/lib/dna-open-lab-current-state-sync-plan";
import type { NeonDnaOpenLabSyncPublicationRepository } from "@/lib/neon-dna-open-lab-sync-publication";

const runners = vi.hoisted(() => ({
  discovery: vi.fn(),
  scheduled: vi.fn(),
}));

vi.mock("@/lib/dna-open-lab-current-state-discovery-runner", () => ({
  runDnaCurrentStateDiscoveryStep: runners.discovery,
}));

vi.mock("@/lib/dna-open-lab-current-state-cycle-coordinator", () => ({
  runDnaCurrentStateScheduledCycleStep: runners.scheduled,
}));

const checkpointRepository =
  {} as DnaCurrentStateAcquisitionCycleCheckpointRepository;
const pool = {} as DnaOpenLabClientPool;
const pause = vi.fn();
const publicationRepository = {
  pause,
} as unknown as NeonDnaOpenLabSyncPublicationRepository;
const persistEvidence = vi.fn();
const readEvidence = vi.fn();
const baseInput = {
  ownerId: "private-owner",
  cycleId: "11111111-1111-4111-8111-111111111111",
  evaluatedAt: "2026-08-28T12:00:00.000Z",
  attemptedAt: "2026-08-28T12:00:30.000Z",
  recordedAt: "2026-08-28T12:00:30.000Z",
  acceptedAt: "2026-08-28T12:00:30.000Z",
  vault: "synthetic-vault",
  checkpointRepository,
  publicationRepository,
  pool,
  persistEvidence,
  readEvidence,
} as const;

describe("DNA Open Lab current-state operator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops after one in-progress discovery step", async () => {
    runners.discovery.mockResolvedValue(
      Object.freeze({
        kind: "discovering",
        round: 0,
        discoveryCycleId: "22222222-2222-4222-8222-222222222222",
        step: Object.freeze({
          kind: "request_completed",
          requestKey: "a".repeat(64),
          group: "vault_identity",
          remainingRequestCount: 1,
          stored: {},
        }),
      }),
    );

    const result = await runDnaCurrentStateOperatorStep(baseInput);

    expect(result.kind).toBe("discovering");
    expect(runners.discovery).toHaveBeenCalledTimes(1);
    expect(runners.scheduled).not.toHaveBeenCalled();
  });

  it("hands an authoritative completed discovery plan to scheduling", async () => {
    const plan = Object.freeze({
      marker: "plan",
    }) as unknown as DnaCurrentStateSyncPlan;
    runners.discovery.mockResolvedValue(
      Object.freeze({
        kind: "final_plan_ready",
        discoveryRoundCount: 2,
        evidenceReceiptCount: 5,
        ownedCoreIds: Object.freeze([101]),
        activeRaceIds: Object.freeze(["race-1"]),
        plan,
      }),
    );
    runners.scheduled.mockResolvedValue(
      Object.freeze({
        kind: "idle",
        nextEvaluationAt: "2026-08-28T12:01:00.000Z",
      }),
    );

    const result = await runDnaCurrentStateOperatorStep(baseInput);

    expect(result).toMatchObject({
      kind: "scheduled",
      discovery: { kind: "final_plan_ready", plan },
      scheduled: { kind: "idle" },
    });
    expect(runners.scheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "private-owner",
        cycleId: baseInput.cycleId,
        plan,
        checkpointRepository,
        publicationRepository,
        pool,
        persistEvidence,
        readEvidence,
      }),
    );
  });

  it("routes discovery interruption recording through owner last-good state", async () => {
    runners.discovery.mockImplementation(async (input) => {
      await input.pauseLastGood({
        reason: "rate_limited",
        attemptedAt: baseInput.attemptedAt,
        retryAfterSeconds: 60,
      });
      return Object.freeze({
        kind: "discovering",
        round: 0,
        discoveryCycleId: "22222222-2222-4222-8222-222222222222",
        step: Object.freeze({ kind: "paused" }),
      });
    });
    pause.mockResolvedValue({});

    await runDnaCurrentStateOperatorStep(baseInput);

    expect(pause).toHaveBeenCalledWith({
      ownerId: "private-owner",
      reason: "rate_limited",
      attemptedAt: baseInput.attemptedAt,
      retryAfterSeconds: 60,
    });
  });
});
