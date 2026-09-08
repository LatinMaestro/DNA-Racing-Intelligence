import { describe, expect, it, vi } from "vitest";

import type { DnaLastGoodSyncState } from "@/lib/dna-open-lab-last-good-publication";
import type { DnaCurrentStateEvidenceIndex } from "@/lib/dna-open-lab-current-state-evidence-index";
import { loadProLeagueSyncHealthState } from "@/lib/pro-league-sync-health-service";

const ownerId = "private_owner";
const generationId = "91000000-0000-4000-8000-000000000001";
const cycleId = "92000000-0000-4000-8000-000000000001";

const state: DnaLastGoodSyncState = {
  acceptedGenerationId: generationId,
  acceptedObservedAt: "2026-09-08T00:05:00.000Z",
  acceptedAt: "2026-09-08T00:07:00.000Z",
  servingGenerationId: generationId,
  syncStatus: "current",
  catchUpRequired: false,
  lastAttemptAt: "2026-09-08T00:07:00.000Z",
  lastInterruption: null,
  lastCatchUpCompletedAt: null,
};

function receipt(
  group: DnaCurrentStateEvidenceIndex["receipts"][number]["group"],
  ordinal: number,
  observedAt: string,
  receiptCycleId = cycleId,
): DnaCurrentStateEvidenceIndex["receipts"][number] {
  return {
    group,
    requestKey: ordinal.toString(16).padStart(64, "0"),
    cycleId: receiptCycleId,
    observedAt,
    contentSha256: (ordinal + 100).toString(16).padStart(64, "0"),
    evidenceObjectKey: `private/evidence/${String(ordinal)}`,
  };
}

const index: DnaCurrentStateEvidenceIndex = {
  version: 1,
  generationId,
  planSha256: "a".repeat(64),
  indexedAt: "2026-09-08T00:06:00.000Z",
  receipts: [
    receipt("race_activity", 1, "2026-09-08T00:04:00.000Z"),
    receipt("token_prices", 2, "2026-09-08T00:02:00.000Z"),
    receipt("vault_identity", 3, "2026-09-08T00:01:00.000Z"),
    receipt("core_current_state", 4, "2026-09-08T00:02:30.000Z"),
    receipt("core_current_state", 5, "2026-09-08T00:03:30.000Z"),
    receipt("splice_arena", 6, "2026-09-08T00:03:00.000Z"),
  ],
};

function repository(
  value: Readonly<{
    state: DnaLastGoodSyncState;
    evidenceIndex: DnaCurrentStateEvidenceIndex | null;
  }> = { state, evidenceIndex: index },
) {
  return {
    readServingSyncHealth: vi.fn(async () => value),
  };
}

describe("Pro League sync health service", () => {
  it("derives one conservative, owner-only family view from the active last-good index", async () => {
    const source = repository();
    const result = await loadProLeagueSyncHealthState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: source,
      now: new Date("2026-09-08T01:00:00.000Z"),
    });

    expect(source.readServingSyncHealth).toHaveBeenCalledWith({
      ownerId,
      validatedAt: "2026-09-08T01:00:00.000Z",
    });
    expect(result).toMatchObject({
      connectionStatus: "connected",
      syncStatus: "current",
      catchUpRequired: false,
      lastGood: {
        dataCurrentThrough: "2026-09-08T00:05:00.000Z",
        publishedAt: "2026-09-08T00:07:00.000Z",
        receiptCount: 6,
      },
      readOnly: true,
      refreshTriggered: false,
    });
    expect(result.lastGood?.versionFingerprint).toMatch(/^[a-f0-9]{12}$/u);
    expect(result.lastGood?.versionFingerprint).not.toContain(generationId);
    expect(result.families).toHaveLength(5);
    expect(result.families).toContainEqual({
      family: "core_current_state",
      dataCurrentThrough: "2026-09-08T00:02:30.000Z",
      lastCompletedAt: "2026-09-08T00:03:30.000Z",
      receiptCount: 2,
    });
  });

  it("keeps the complete last-good version visible while sync is paused", async () => {
    const result = await loadProLeagueSyncHealthState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: repository({
        state: {
          ...state,
          syncStatus: "paused",
          catchUpRequired: true,
          lastAttemptAt: "2026-09-08T00:30:00.000Z",
          lastInterruption: {
            reason: "rate_limited",
            at: "2026-09-08T00:30:00.000Z",
            retryAfterSeconds: 60,
          },
        },
        evidenceIndex: index,
      }),
      now: new Date("2026-09-08T01:00:00.000Z"),
    });

    expect(result).toMatchObject({
      syncStatus: "paused",
      catchUpRequired: true,
      lastInterruption: { reason: "rate_limited", retryAfterSeconds: 60 },
      lastGood: { receiptCount: 6 },
    });
  });

  it("reports an unconfigured read without touching persistence", async () => {
    await expect(
      loadProLeagueSyncHealthState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: null,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "persistence_not_configured",
      syncStatus: null,
      lastGood: null,
      readOnly: true,
      refreshTriggered: false,
    });
  });

  it("denies a different owner before reading persistence", async () => {
    const source = repository();
    await expect(
      loadProLeagueSyncHealthState({
        authenticatedOwnerId: "different_owner",
        configuredOwnerId: ownerId,
        repository: source,
      }),
    ).rejects.toThrow("access denied");
    expect(source.readServingSyncHealth).not.toHaveBeenCalled();
  });

  it("rejects partial or mixed-cycle family authority", async () => {
    const partial = { ...index, receipts: index.receipts.slice(0, -1) };
    await expect(
      loadProLeagueSyncHealthState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: repository({ state, evidenceIndex: partial }),
        now: new Date("2026-09-08T01:00:00.000Z"),
      }),
    ).rejects.toThrow("splice_arena");

    const mixed = {
      ...index,
      receipts: index.receipts.map((value, ordinal) =>
        ordinal === 4
          ? {
              ...value,
              cycleId: "92000000-0000-4000-8000-000000000002",
            }
          : value,
      ),
    };
    await expect(
      loadProLeagueSyncHealthState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: repository({ state, evidenceIndex: mixed }),
        now: new Date("2026-09-08T01:00:00.000Z"),
      }),
    ).rejects.toThrow("one complete cycle");
  });
});
