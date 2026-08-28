import { describe, expect, it, vi } from "vitest";

import {
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  createDnaCurrentStateAcquisitionSchedule,
  type DnaCurrentStateAcquisitionGroup,
  type DnaScheduledCurrentStateRequest,
} from "@/lib/dna-open-lab-current-state-acquisition-cadence";
import type {
  DnaCurrentStateAcquisitionCycleCheckpoint,
  DnaCurrentStateAcquisitionEvidenceReceipt,
} from "@/lib/dna-open-lab-current-state-acquisition-runner";
import {
  assembleDnaCurrentStatePublication,
  publishDnaCurrentStateAcquisitionCycle,
} from "@/lib/dna-open-lab-current-state-publication-runner";
import type { DnaOpenLabStoredCurrentStateEvidence } from "@/lib/dna-open-lab-r2-current-state-evidence";
import { createDnaCurrentStateSyncPlan } from "@/lib/dna-open-lab-current-state-sync-plan";
import type { DnaLastGoodSyncState } from "@/lib/dna-open-lab-last-good-publication";
import type { NeonDnaOpenLabSyncPublicationRepository } from "@/lib/neon-dna-open-lab-sync-publication";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";

const cycleId = "11111111-1111-4111-8111-111111111111";
const evaluatedAt = "2026-08-28T12:00:00.000Z";
const observedAt = "2026-08-28T12:00:30.000Z";

function fixture() {
  const plan = createDnaCurrentStateSyncPlan({
    vault: "synthetic-vault",
    ownedCoreIds: [101],
    activeRaceIds: ["race-1"],
    spliceModes: ["bike"],
    spliceArenaPagesByMode: { bike: [1] },
  });
  const schedule = createDnaCurrentStateAcquisitionSchedule({
    evaluatedAt,
    plan,
  });
  const entries = schedule.requestBatches.flat();
  const requestKey = (entry: DnaScheduledCurrentStateRequest) =>
    dnaOpenLabRawEvidenceSha256({
      group: entry.group,
      request: entry.request,
    });
  const receipts: readonly DnaCurrentStateAcquisitionEvidenceReceipt[] =
    entries.map((entry) => {
      const key = requestKey(entry);
      return Object.freeze({
        requestKey: key,
        observedAt,
        contentSha256: "a".repeat(64),
        evidenceObjectKey: `private/${key}.json`,
      });
    });
  const checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint = Object.freeze({
    version: 1,
    cycleId,
    evaluatedAt,
    scheduleSha256: dnaOpenLabRawEvidenceSha256({
      evaluatedAt,
      completionScope: schedule.completionScope,
      dueGroups: schedule.dueGroups,
      requests: entries,
    }),
    status: "ready_to_publish",
    scheduledRequestKeys: Object.freeze(entries.map(requestKey)),
    receipts,
    completedGroups: DNA_CURRENT_STATE_ACQUISITION_GROUPS,
    pauseReason: null,
    retryNotBefore: null,
  });
  const entryByKey = new Map(
    entries.map((entry) => [requestKey(entry), entry]),
  );
  const readEvidence = vi.fn(
    async (input: {
      cycleId: string;
      receipt: DnaCurrentStateAcquisitionEvidenceReceipt;
    }): Promise<DnaOpenLabStoredCurrentStateEvidence> => {
      const entry = entryByKey.get(input.receipt.requestKey)!;
      return Object.freeze({
        cycleId: input.cycleId,
        group: entry.group,
        requestKey: input.receipt.requestKey,
        observedAt: input.receipt.observedAt,
        request: entry.request,
        response: Object.freeze({
          result: result(entry.request.endpoint),
          httpStatus: 200,
          rateLimit: Object.freeze({
            limit: 150,
            remaining: 149,
            resetSeconds: 60,
            rateClass: null,
            retryAfterSeconds: null,
          }),
        }),
      });
    },
  );
  return { schedule, checkpoint, readEvidence };
}

function result(endpoint: string): unknown {
  switch (endpoint) {
    case "vault.info":
      return {
        vault: "synthetic-vault",
        name: "Synthetic",
        profile_url: null,
        banner_url: null,
      };
    case "vault.cores_full":
      return [
        {
          hid: 101,
          name: "Synthetic Core",
          type: "Genesis",
          element: "Metal",
          gender: "female",
          fno: 1,
        },
      ];
    case "vault.tier_badge":
      return { vault: "synthetic-vault", tot_score: 1 };
    case "vault.recent_races":
      return [];
    case "races.active":
      return [
        {
          rid: "race-1",
          status: "filling",
          race_name: "Synthetic Race",
          format: "normal",
          class: 1,
          cb: null,
          rgate: 4,
          hs_in: 1,
          fee_fixed: { DEZ: 1 },
          feeusd: 1,
          paytoken: "DEZ",
          start_time: null,
          version: 1,
          rvmode: "bike",
        },
      ];
    case "races.fills":
      return [
        {
          rid: "race-1",
          status: "filling",
          rgate: 4,
          hs_in: 1,
          hids: [101],
          entry_txns_confirmed: { "101": true },
        },
      ];
    case "cores.info_bulk":
      return [
        {
          hid: 101,
          name: "Synthetic Core",
          type: "Genesis",
          element: "Metal",
          color: "Silver",
          hex_code: "#cccccc",
          fno: 1,
          gender: "female",
          vault: "synthetic-vault",
        },
      ];
    case "cores.racing_stats_bulk":
      return [
        {
          hid: 101,
          hstats_bike: {},
          hstats_car: null,
          hstats_horse: null,
          ageing: null,
          is_maiden: true,
          tourney_profits: null,
        },
      ];
    case "cores.power_bulk":
      return [
        {
          hid: 101,
          power: {
            bike: { power: 1, adjodds: 2, variance: 3, races_n: 4 },
            car: { power: null, adjodds: null, variance: null, races_n: 0 },
            horse: { power: null, adjodds: null, variance: null, races_n: 0 },
          },
          m_stats: null,
        },
      ];
    case "cores.listing_price_bulk":
      return [{ hid: 101 }];
    case "cores.attached_assets_bulk":
      return [
        {
          hid: 101,
          skino: { bike: null, car: null, horse: null },
          trailsmap: null,
        },
      ];
    case "cores.owner_bulk":
      return [{ hid: 101, vault: "synthetic-vault" }];
    case "cores.stamina_bulk":
      return [
        {
          hid: 101,
          stamina: {
            stamina: 10,
            max_stamina: 10,
            next_refill: null,
            last_event: null,
          },
          spstamina: null,
        },
      ];
    case "cores.splicing_info_bulk":
      return [
        {
          hid: 101,
          parents: null,
          grand_parents: null,
          challenge_credit: 0,
          splice_core: null,
        },
      ];
    case "tokens.prices":
      return {
        ethusd: 1,
        btcusd: 2,
        dezusd: 3,
        hlxusd: 4,
        bgcusd: 5,
        tpusd: 6,
        methusd: 7,
        mbtcusd: 8,
      };
    case "splice.arena":
      return {
        page: 1,
        limit: 20,
        has_more: false,
        cores: [
          {
            hid: 202,
            name: "Arena Core",
            type: "Morphed",
            gender: "male",
            element: "Fire",
            color: "Red",
            hex_code: "#ff0000",
            fno: 8,
            price_usd: 12,
          },
        ],
      };
    default:
      throw new Error(`unexpected endpoint ${endpoint}`);
  }
}

function publicationState(): DnaLastGoodSyncState {
  return {
    acceptedGenerationId: cycleId,
    acceptedObservedAt: observedAt,
    acceptedAt: observedAt,
    servingGenerationId: cycleId,
    syncStatus: "current",
    catchUpRequired: false,
    lastAttemptAt: observedAt,
    lastInterruption: null,
    lastCatchUpCompletedAt: null,
  };
}

describe("DNA Open Lab current-state publication runner", () => {
  it("reconstructs every canonical family from the exact ready cycle", async () => {
    const { schedule, checkpoint, readEvidence } = fixture();
    const assembled = await assembleDnaCurrentStatePublication({
      cycleId,
      schedule,
      checkpoint,
      validatedAt: observedAt,
      readEvidence,
    });

    expect(readEvidence).toHaveBeenCalledTimes(schedule.scheduledRequestCount);
    expect(assembled.candidate).toMatchObject({
      generationId: cycleId,
      observedAt,
      families: {
        vault: { status: "complete", itemCount: 1 },
        cores: { status: "complete", itemCount: 1 },
        active_races: { status: "complete", itemCount: 1 },
        race_fills: { status: "complete", itemCount: 1 },
        tokens: { status: "complete", itemCount: 1 },
        splice_arena: { status: "complete", itemCount: 1 },
      },
    });
    expect(assembled.supplementalCore.power[0]?.canonical.sourceCoreId).toBe(
      "101",
    );
    expect(assembled.tokenSplice.arenaPages[0]?.canonical).toMatchObject({
      mode: "bike",
      page: 1,
      hasMore: false,
    });
  });

  it("calls the atomic repository once only after reconstruction", async () => {
    const { schedule, checkpoint, readEvidence } = fixture();
    const publishCandidate = vi.fn(
      async (
        input: Parameters<
          NeonDnaOpenLabSyncPublicationRepository["publishCandidate"]
        >[0],
      ) => {
        void input;
        return publicationState();
      },
    );
    const repository = {
      publishCandidate,
      pause: vi.fn(),
      read: vi.fn(),
      readServingOwnedCores: vi.fn(),
      readServingCurrentRaces: vi.fn(),
    } as unknown as NeonDnaOpenLabSyncPublicationRepository;

    const state = await publishDnaCurrentStateAcquisitionCycle({
      ownerId: "private-owner",
      cycleId,
      schedule,
      checkpoint,
      validatedAt: observedAt,
      recordedAt: observedAt,
      acceptedAt: observedAt,
      readEvidence,
      publicationRepository: repository,
    });

    expect(state.servingGenerationId).toBe(cycleId);
    expect(publishCandidate).toHaveBeenCalledTimes(1);
    expect(publishCandidate.mock.calls[0]?.[0]).toMatchObject({
      ownerId: "private-owner",
      candidate: { generationId: cycleId },
      evidenceIndex: {
        version: 1,
        generationId: cycleId,
        indexedAt: observedAt,
      },
    });
    expect(
      publishCandidate.mock.calls[0]?.[0].evidenceIndex.receipts,
    ).toHaveLength(schedule.scheduledRequestCount);
  });

  it("rejects evidence identity drift before publication", async () => {
    const { schedule, checkpoint, readEvidence } = fixture();
    readEvidence.mockImplementationOnce(async ({ receipt }) => {
      const value = await fixture().readEvidence({ cycleId, receipt });
      return {
        ...value,
        group: "token_prices" as DnaCurrentStateAcquisitionGroup,
      };
    });

    await expect(
      assembleDnaCurrentStatePublication({
        cycleId,
        schedule,
        checkpoint,
        validatedAt: observedAt,
        readEvidence,
      }),
    ).rejects.toThrow("stored evidence does not match its schedule receipt");
  });

  it("rejects incomplete race-fill coverage", async () => {
    const { schedule, checkpoint, readEvidence } = fixture();
    const originalRead = readEvidence.getMockImplementation()!;
    readEvidence.mockImplementation(async (input) => {
      const value = await originalRead(input);
      if (value.request.endpoint !== "races.fills") return value;
      return {
        ...value,
        response: { ...value.response, result: [] },
      };
    });

    await expect(
      assembleDnaCurrentStatePublication({
        cycleId,
        schedule,
        checkpoint,
        validatedAt: observedAt,
        readEvidence,
      }),
    ).rejects.toThrow("race-fill coverage does not match active races");
  });

  it("rejects a checkpoint that has not reached ready-to-publish", async () => {
    const { schedule, checkpoint, readEvidence } = fixture();
    await expect(
      assembleDnaCurrentStatePublication({
        cycleId,
        schedule,
        checkpoint: { ...checkpoint, status: "awaiting_evidence" },
        validatedAt: observedAt,
        readEvidence,
      }),
    ).rejects.toThrow("checkpoint is not ready to publish");
    expect(readEvidence).not.toHaveBeenCalled();
  });

  it("rejects staggered cadence until durable cached-family receipts exist", async () => {
    const { schedule, checkpoint, readEvidence } = fixture();
    const staggered = {
      ...schedule,
      dueGroups: ["race_activity"] as const,
    };
    await expect(
      assembleDnaCurrentStatePublication({
        cycleId,
        schedule: staggered,
        checkpoint,
        validatedAt: observedAt,
        readEvidence,
      }),
    ).rejects.toThrow(
      "only a complete all-current-state acquisition may publish",
    );
  });
});
