import { describe, expect, it } from "vitest";

import {
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  createDnaCurrentStateAcquisitionSchedule,
  type DnaCurrentStateAcquisitionSchedule,
  type DnaScheduledCurrentStateRequest,
} from "@/lib/dna-open-lab-current-state-acquisition-cadence";
import type {
  DnaCurrentStateAcquisitionCycleCheckpoint,
  DnaCurrentStateAcquisitionEvidenceReceipt,
} from "@/lib/dna-open-lab-current-state-acquisition-runner";
import {
  createDnaCurrentStateEvidenceIndex,
  validateDnaCurrentStateEvidenceIndex,
} from "@/lib/dna-open-lab-current-state-evidence-index";
import { createDnaCurrentStateSyncPlan } from "@/lib/dna-open-lab-current-state-sync-plan";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";

const firstCycleId = "11111111-1111-4111-8111-111111111111";
const nextCycleId = "22222222-2222-4222-8222-222222222222";
const firstAt = "2026-08-28T12:00:00.000Z";
const nextAt = "2026-08-28T12:10:00.000Z";

function plan() {
  return createDnaCurrentStateSyncPlan({
    vault: "synthetic-vault",
    ownedCoreIds: [101],
    activeRaceIds: ["race-1"],
    spliceModes: ["bike"],
    spliceArenaPagesByMode: { bike: [1] },
  });
}

function key(entry: DnaScheduledCurrentStateRequest): string {
  return dnaOpenLabRawEvidenceSha256({
    group: entry.group,
    request: entry.request,
  });
}

function checkpoint(input: {
  cycleId: string;
  schedule: DnaCurrentStateAcquisitionSchedule;
  observedAt: string;
}): DnaCurrentStateAcquisitionCycleCheckpoint {
  const entries = input.schedule.requestBatches.flat();
  const receipts: readonly DnaCurrentStateAcquisitionEvidenceReceipt[] =
    entries.map((entry) => {
      const requestKey = key(entry);
      return Object.freeze({
        requestKey,
        observedAt: input.observedAt,
        contentSha256: dnaOpenLabRawEvidenceSha256({
          cycleId: input.cycleId,
          requestKey,
        }),
        evidenceObjectKey: `private/${input.cycleId}/${requestKey}.json`,
      });
    });
  return Object.freeze({
    version: 1,
    cycleId: input.cycleId,
    evaluatedAt: input.schedule.evaluatedAt,
    scheduleSha256: dnaOpenLabRawEvidenceSha256({
      evaluatedAt: input.schedule.evaluatedAt,
      completionScope: input.schedule.completionScope,
      dueGroups: input.schedule.dueGroups,
      requests: entries,
    }),
    status: "ready_to_publish",
    scheduledRequestKeys: Object.freeze(entries.map(key)),
    receipts,
    completedGroups: input.schedule.dueGroups,
    pauseReason: null,
    retryNotBefore: null,
  });
}

function firstIndex() {
  const currentPlan = plan();
  const schedule = createDnaCurrentStateAcquisitionSchedule({
    evaluatedAt: firstAt,
    plan: currentPlan,
  });
  return createDnaCurrentStateEvidenceIndex({
    plan: currentPlan,
    schedule,
    checkpoint: checkpoint({
      cycleId: firstCycleId,
      schedule,
      observedAt: firstAt,
    }),
    prior: null,
    indexedAt: firstAt,
  });
}

function staggeredSchedule() {
  const full = createDnaCurrentStateAcquisitionSchedule({
    evaluatedAt: nextAt,
    plan: plan(),
  });
  const requests = full.requestBatches
    .flat()
    .filter((entry) => entry.group === "race_activity");
  return Object.freeze({
    ...full,
    dueGroups: Object.freeze(["race_activity"] as const),
    requestBatches: Object.freeze([Object.freeze(requests)]),
    scheduledRequestCount: requests.length,
  });
}

describe("DNA Open Lab current-state evidence index", () => {
  it("builds a complete first-cycle receipt authority", () => {
    const index = firstIndex();
    expect(index).toMatchObject({
      version: 1,
      generationId: firstCycleId,
      indexedAt: firstAt,
    });
    expect(index.receipts).toHaveLength(16);
    expect(
      new Set(index.receipts.map((value) => value.requestKey)),
    ).toHaveLength(16);
    expect(
      validateDnaCurrentStateEvidenceIndex({
        index,
        plan: plan(),
        validatedAt: nextAt,
      }),
    ).toEqual(index);
  });

  it("replaces due receipts and carries exact non-due last-good receipts", () => {
    const prior = firstIndex();
    const schedule = staggeredSchedule();
    const index = createDnaCurrentStateEvidenceIndex({
      plan: plan(),
      schedule,
      checkpoint: checkpoint({
        cycleId: nextCycleId,
        schedule,
        observedAt: nextAt,
      }),
      prior,
      indexedAt: nextAt,
    });

    expect(schedule.dueGroups).toEqual(["race_activity"]);
    expect(index.generationId).toBe(nextCycleId);
    expect(
      new Set(
        index.receipts
          .filter((value) => value.group === "race_activity")
          .map((value) => value.cycleId),
      ),
    ).toEqual(new Set([nextCycleId]));
    expect(
      new Set(
        index.receipts
          .filter((value) => value.group !== "race_activity")
          .map((value) => value.cycleId),
      ),
    ).toEqual(new Set([firstCycleId]));
  });

  it("rejects staggered publication without a prior receipt index", () => {
    const schedule = staggeredSchedule();
    expect(() =>
      createDnaCurrentStateEvidenceIndex({
        plan: plan(),
        schedule,
        checkpoint: checkpoint({
          cycleId: nextCycleId,
          schedule,
          observedAt: nextAt,
        }),
        prior: null,
        indexedAt: nextAt,
      }),
    ).toThrow("staggered cycle requires a prior last-good receipt index");
  });

  it("rejects a cached receipt whose request identity drifted", () => {
    const prior = firstIndex();
    const schedule = staggeredSchedule();
    const offset = prior.receipts.findIndex(
      (value) => value.group === "token_prices",
    );
    const receipts = [...prior.receipts];
    receipts[offset] = { ...receipts[offset]!, requestKey: "f".repeat(64) };

    expect(() =>
      createDnaCurrentStateEvidenceIndex({
        plan: plan(),
        schedule,
        checkpoint: checkpoint({
          cycleId: nextCycleId,
          schedule,
          observedAt: nextAt,
        }),
        prior: { ...prior, receipts },
        indexedAt: nextAt,
      }),
    ).toThrow("indexed receipt does not match plan authority");
  });

  it("rejects a schedule that does not match the plan's due requests", () => {
    const schedule = staggeredSchedule();
    const drifted = {
      ...schedule,
      requestBatches: Object.freeze([]),
      scheduledRequestCount: 0,
    };
    expect(() =>
      createDnaCurrentStateEvidenceIndex({
        plan: plan(),
        schedule: drifted,
        checkpoint: checkpoint({
          cycleId: nextCycleId,
          schedule: drifted,
          observedAt: nextAt,
        }),
        prior: firstIndex(),
        indexedAt: nextAt,
      }),
    ).toThrow("schedule does not match the plan's due-group requests");
  });

  it("keeps the acquisition group order authoritative", () => {
    expect(DNA_CURRENT_STATE_ACQUISITION_GROUPS).toEqual([
      "race_activity",
      "token_prices",
      "vault_identity",
      "core_current_state",
      "splice_arena",
    ]);
  });
});
