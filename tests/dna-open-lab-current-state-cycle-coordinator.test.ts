import { describe, expect, it, vi } from "vitest";

import { DNA_CURRENT_STATE_ACQUISITION_GROUPS } from "@/lib/dna-open-lab-current-state-acquisition-cadence";
import {
  createDnaCurrentStateScheduledCycleAuthority,
  dnaCurrentStatePublicationMode,
  runDnaCurrentStateScheduledCycleStep,
} from "@/lib/dna-open-lab-current-state-cycle-coordinator";
import { createDnaCurrentStateEvidenceIndex } from "@/lib/dna-open-lab-current-state-evidence-index";
import type {
  DnaCurrentStateAcquisitionCycleCheckpoint,
  DnaCurrentStateAcquisitionCycleCheckpointRepository,
  StoredDnaCurrentStateAcquisitionCycleCheckpoint,
} from "@/lib/dna-open-lab-current-state-acquisition-runner";
import { createDnaCurrentStateAcquisitionSchedule } from "@/lib/dna-open-lab-current-state-acquisition-cadence";
import type { DnaOpenLabClientPool } from "@/lib/dna-open-lab-client-pool";
import { createDnaCurrentStateSyncPlan } from "@/lib/dna-open-lab-current-state-sync-plan";
import type { DnaLastGoodSyncState } from "@/lib/dna-open-lab-last-good-publication";
import type { NeonDnaOpenLabSyncPublicationRepository } from "@/lib/neon-dna-open-lab-sync-publication";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";

const cycleId = "11111111-1111-4111-8111-111111111111";
const firstAt = "2026-08-28T12:00:00.000Z";

class MemoryCheckpointRepository implements DnaCurrentStateAcquisitionCycleCheckpointRepository {
  stored: StoredDnaCurrentStateAcquisitionCycleCheckpoint | null = null;

  async load() {
    return this.stored;
  }

  async save(input: {
    expectedRevision: string | null;
    checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  }) {
    const revision = String(Number(this.stored?.revision ?? "0") + 1);
    this.stored = Object.freeze({ revision, checkpoint: input.checkpoint });
    return this.stored;
  }
}

function fixture() {
  const plan = createDnaCurrentStateSyncPlan({
    vault: "synthetic-vault",
    ownedCoreIds: [101],
    activeRaceIds: ["race-1"],
    spliceModes: ["bike"],
    spliceArenaPagesByMode: { bike: [1] },
  });
  const schedule = createDnaCurrentStateAcquisitionSchedule({
    evaluatedAt: firstAt,
    plan,
  });
  const entries = schedule.requestBatches.flat();
  const key = (entry: (typeof entries)[number]) =>
    dnaOpenLabRawEvidenceSha256({
      group: entry.group,
      request: entry.request,
    });
  const checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint = Object.freeze({
    version: 1,
    cycleId,
    evaluatedAt: firstAt,
    scheduleSha256: dnaOpenLabRawEvidenceSha256({
      evaluatedAt: firstAt,
      completionScope: schedule.completionScope,
      dueGroups: schedule.dueGroups,
      requests: entries,
    }),
    status: "ready_to_publish",
    scheduledRequestKeys: Object.freeze(entries.map(key)),
    receipts: Object.freeze(
      entries.map((entry) => ({
        requestKey: key(entry),
        observedAt: firstAt,
        contentSha256: "a".repeat(64),
        evidenceObjectKey: `private/${cycleId}/${key(entry)}.json`,
      })),
    ),
    completedGroups: DNA_CURRENT_STATE_ACQUISITION_GROUPS,
    pauseReason: null,
    retryNotBefore: null,
  });
  const priorIndex = createDnaCurrentStateEvidenceIndex({
    plan,
    schedule,
    checkpoint,
    prior: null,
    indexedAt: firstAt,
  });
  return { plan, priorIndex };
}

describe("DNA Open Lab current-state cycle coordinator", () => {
  it("requires a full cycle without serving receipt authority", () => {
    const { plan } = fixture();
    const authority = createDnaCurrentStateScheduledCycleAuthority({
      evaluatedAt: "2026-08-28T12:02:00.000Z",
      plan,
      priorIndex: null,
    });

    expect(authority.schedule.dueGroups).toEqual(
      DNA_CURRENT_STATE_ACQUISITION_GROUPS,
    );
    expect(dnaCurrentStatePublicationMode(authority.schedule)).toBe("full");
  });

  it("keeps validated last-good receipt authority idle before the daily boundary", () => {
    const { plan, priorIndex } = fixture();
    const authority = createDnaCurrentStateScheduledCycleAuthority({
      evaluatedAt: "2026-08-28T12:02:00.000Z",
      plan,
      priorIndex,
    });

    expect(authority.schedule).toMatchObject({ status: "idle", dueGroups: [] });
    expect(authority.cachedEvidenceObservedAt).toEqual({
      race_activity: firstAt,
      token_prices: firstAt,
      vault_identity: firstAt,
      core_current_state: firstAt,
      splice_arena: firstAt,
    });
  });

  it("refreshes every recurring group together at the daily boundary", () => {
    const { plan, priorIndex } = fixture();
    const authority = createDnaCurrentStateScheduledCycleAuthority({
      evaluatedAt: "2026-08-29T12:00:00.000Z",
      plan,
      priorIndex,
    });

    expect(authority.schedule.dueGroups).toEqual(
      DNA_CURRENT_STATE_ACQUISITION_GROUPS,
    );
    expect(dnaCurrentStatePublicationMode(authority.schedule)).toBe("full");
  });

  it("forces a full cycle when dynamic plan authority changes", () => {
    const { plan, priorIndex } = fixture();
    const changed = createDnaCurrentStateSyncPlan({
      vault: "synthetic-vault",
      ownedCoreIds: [101, 202],
      activeRaceIds: ["race-1"],
      spliceModes: ["bike"],
      spliceArenaPagesByMode: { bike: [1] },
    });
    expect(changed).not.toEqual(plan);
    const authority = createDnaCurrentStateScheduledCycleAuthority({
      evaluatedAt: "2026-08-28T12:02:00.000Z",
      plan: changed,
      priorIndex,
    });

    expect(authority.schedule.dueGroups).toEqual(
      DNA_CURRENT_STATE_ACQUISITION_GROUPS,
    );
    expect(authority.cachedEvidenceObservedAt).toEqual({});
  });

  it("records an API interruption in the durable cycle and last-good state", async () => {
    const { plan } = fixture();
    const checkpoints = new MemoryCheckpointRepository();
    const execute = vi.fn(async () => {
      throw new Error("synthetic API outage");
    });
    const pause = vi.fn(async () => ({}) as DnaLastGoodSyncState);
    const publicationRepository = {
      publishCandidate: vi.fn(),
      pause,
      read: vi.fn(),
      readServingOwnedCores: vi.fn(),
      readServingCurrentRaces: vi.fn(),
      readServingCurrentStateEvidenceIndex: vi.fn(async () => null),
    } as unknown as NeonDnaOpenLabSyncPublicationRepository;

    const result = await runDnaCurrentStateScheduledCycleStep({
      ownerId: "private-owner",
      cycleId,
      evaluatedAt: firstAt,
      attemptedAt: firstAt,
      recordedAt: firstAt,
      acceptedAt: firstAt,
      plan,
      checkpointRepository: checkpoints,
      publicationRepository,
      pool: { execute } as unknown as DnaOpenLabClientPool,
      persistEvidence: vi.fn(),
      readEvidence: vi.fn(),
    });

    expect(result).toMatchObject({
      kind: "acquiring",
      publicationMode: "full",
      step: { kind: "paused", reason: "api_unavailable" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(checkpoints.stored?.checkpoint).toMatchObject({
      status: "paused",
      pauseReason: "api_unavailable",
    });
    expect(pause).toHaveBeenCalledWith({
      ownerId: "private-owner",
      reason: "api_unavailable",
      attemptedAt: firstAt,
      retryAfterSeconds: null,
    });
  });
});
