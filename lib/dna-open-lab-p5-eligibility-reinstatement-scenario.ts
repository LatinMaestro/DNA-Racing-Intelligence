import { createHash } from "node:crypto";

import { createDnaCurrentStateAcquisitionSchedule } from "./dna-open-lab-current-state-acquisition-cadence";
import {
  runDnaCurrentStateAcquisitionStep,
  type DnaCurrentStateAcquisitionCycleCheckpoint,
  type DnaCurrentStateAcquisitionCycleCheckpointRepository,
  type StoredDnaCurrentStateAcquisitionCycleCheckpoint,
} from "./dna-open-lab-current-state-acquisition-runner";
import type { DnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import { publishDnaCurrentStateAcquisitionCycle } from "./dna-open-lab-current-state-publication-runner";
import { createDnaCurrentStateSyncPlan } from "./dna-open-lab-current-state-sync-plan";
import {
  acceptDnaCurrentStateCandidate,
  beginDnaCurrentStateCatchUp,
  createInitialDnaLastGoodSyncState,
  pauseDnaCurrentStateSync,
  type DnaCurrentStateCandidate,
  type DnaLastGoodSyncState,
} from "./dna-open-lab-last-good-publication";
import type { DnaOpenLabP5ComponentRecoveryEvidence } from "./dna-open-lab-p5-component-recovery-executor";
import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "./dna-open-lab-p5-private-preview-recovery";
import {
  createDnaOpenLabP5RecoveryTemporaryEvidenceReader,
  createDnaOpenLabP5RecoveryTemporaryEvidenceSink,
  DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
  type DnaOpenLabR2CurrentStateEvidenceReaderConfiguration,
  type DnaOpenLabR2CurrentStateEvidenceStoragePort,
} from "./dna-open-lab-r2-current-state-evidence";
import type {
  DnaOpenLabClient,
  DnaOpenLabResponse,
} from "./dna-open-lab-v1-client";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import type { NeonDnaOpenLabSyncPublicationRepository } from "./neon-dna-open-lab-sync-publication";

type EligibilityReinstatementEvidence = Extract<
  DnaOpenLabP5ComponentRecoveryEvidence,
  { caseId: "eligibility_reinstatement" }
>;

export type DnaOpenLabP5EligibilityReinstatementScenarioConfiguration =
  Readonly<{
    ownerId: string;
    bucketName: string;
    cycleId: string;
    eligibilityReinstatedAt: string;
    storage: DnaOpenLabR2CurrentStateEvidenceStoragePort &
      DnaOpenLabR2CurrentStateEvidenceReaderConfiguration["storage"];
    inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
    cleanupSyntheticCase: () => Promise<void>;
  }>;

function scenarioError(): never {
  throw new Error("DNA Open Lab P5 eligibility-reinstatement scenario failed.");
}

function timestamp(value: string): string {
  const normalized = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    ) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    scenarioError();
  }
  return new Date(normalized).toISOString();
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

class DurableCheckpointRepository implements DnaCurrentStateAcquisitionCycleCheckpointRepository {
  stored: StoredDnaCurrentStateAcquisitionCycleCheckpoint;
  checkpointSha256UsedForResume: string | null = null;

  constructor(checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint) {
    this.stored = Object.freeze({ revision: "1", checkpoint });
  }

  async load(cycleId: string) {
    if (this.stored.checkpoint.cycleId !== cycleId) return null;
    if (this.checkpointSha256UsedForResume === null) {
      this.checkpointSha256UsedForResume = sha256(this.stored);
    }
    return this.stored;
  }

  async save(input: {
    expectedRevision: string | null;
    checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  }) {
    if (input.expectedRevision !== this.stored.revision) scenarioError();
    this.stored = Object.freeze({
      revision: String(Number(this.stored.revision) + 1),
      checkpoint: input.checkpoint,
    });
    return this.stored;
  }
}

function result(endpoint: string): unknown {
  switch (endpoint) {
    case "vault.info":
      return {
        vault: "p5-recovery-synthetic-vault",
        name: "P5 Recovery",
        profile_url: null,
        banner_url: null,
      };
    case "vault.cores_full":
      return [
        {
          hid: 101,
          name: "P5 Recovery Core",
          type: "Genesis",
          element: "Metal",
          gender: "female",
          fno: 1,
        },
      ];
    case "vault.tier_badge":
      return { vault: "p5-recovery-synthetic-vault", tot_score: 1 };
    case "vault.recent_races":
      return [];
    case "races.active":
      return [
        {
          rid: "p5-recovery-race",
          status: "filling",
          race_name: "P5 Recovery Race",
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
          rid: "p5-recovery-race",
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
          name: "P5 Recovery Core",
          type: "Genesis",
          element: "Metal",
          color: "Silver",
          hex_code: "#cccccc",
          fno: 1,
          gender: "female",
          vault: "p5-recovery-synthetic-vault",
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
      return [{ hid: 101, vault: "p5-recovery-synthetic-vault" }];
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
            name: "P5 Recovery Arena Core",
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
      return scenarioError();
  }
}

function response(endpoint: string): DnaOpenLabResponse<unknown> {
  return Object.freeze({
    result: result(endpoint),
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 30,
      remaining: 29,
      resetSeconds: 60,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
  });
}

function successfulPool(calls: { count: number }): DnaOpenLabClientPool {
  const endpointByMethod: Readonly<Record<string, string>> = Object.freeze({
    vaultInfo: "vault.info",
    vaultCoresFull: "vault.cores_full",
    vaultTierBadge: "vault.tier_badge",
    vaultRecentRaces: "vault.recent_races",
    racesActive: "races.active",
    raceFills: "races.fills",
    coreInfoBulk: "cores.info_bulk",
    coreRacingStatsBulk: "cores.racing_stats_bulk",
    corePowerBulk: "cores.power_bulk",
    coreListingPriceBulk: "cores.listing_price_bulk",
    coreAttachedAssetsBulk: "cores.attached_assets_bulk",
    coreOwnerBulk: "cores.owner_bulk",
    coreStaminaBulk: "cores.stamina_bulk",
    coreSplicingInfoBulk: "cores.splicing_info_bulk",
    tokenPrices: "tokens.prices",
    spliceArena: "splice.arena",
  });
  const client = new Proxy(
    {},
    {
      get: (_target, property) => async () => {
        const endpoint = endpointByMethod[String(property)];
        if (endpoint === undefined) scenarioError();
        return response(endpoint);
      },
    },
  ) as DnaOpenLabClient;
  return Object.freeze({
    execute: async <T>(input: {
      request: (
        client: DnaOpenLabClient,
        laneId: string,
      ) => Promise<DnaOpenLabResponse<T>>;
    }) => {
      calls.count += 1;
      return input.request(client, "key-1");
    },
    snapshot: () =>
      Object.freeze({
        independentRateBucketsEnabled: false,
        aggregateBudget: null,
        lanes: Object.freeze([]),
      }),
  }) as DnaOpenLabClientPool;
}

function completeCandidate(input: {
  generationId: string;
  observedAt: string;
}): DnaCurrentStateCandidate {
  return Object.freeze({
    generationId: input.generationId,
    observedAt: input.observedAt,
    families: Object.freeze({
      vault: Object.freeze({ status: "complete" as const, itemCount: 1 }),
      cores: Object.freeze({ status: "complete" as const, itemCount: 1 }),
      active_races: Object.freeze({
        status: "complete" as const,
        itemCount: 1,
      }),
      race_fills: Object.freeze({ status: "complete" as const, itemCount: 1 }),
      tokens: Object.freeze({ status: "complete" as const, itemCount: 1 }),
      splice_arena: Object.freeze({
        status: "complete" as const,
        itemCount: 1,
      }),
    }),
  });
}

function assertUnchangedProviderState(
  before: DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot,
  after: DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot,
): void {
  if (
    after.syntheticResidueObjectCount !== 0 ||
    before.ownerDataSha256 !== after.ownerDataSha256 ||
    before.checkpointStateSha256 !== after.checkpointStateSha256 ||
    before.servingStateSha256 !== after.servingStateSha256 ||
    before.retainedEvidenceSha256 !== after.retainedEvidenceSha256 ||
    before.persistentOwnerDataRowCount !== after.persistentOwnerDataRowCount
  ) {
    scenarioError();
  }
}

/**
 * Starts from a durable API-ineligible checkpoint, resumes the production
 * bounded runner after reinstatement, revalidates every temporary immutable
 * receipt and crosses the indexed atomic publication boundary exactly once.
 * Last-good remains available throughout catch-up and the pause clears only
 * after that complete publication succeeds.
 */
export function createDnaOpenLabP5EligibilityReinstatementScenario(
  configuration: DnaOpenLabP5EligibilityReinstatementScenarioConfiguration,
): () => Promise<EligibilityReinstatementEvidence> {
  return async () => {
    const reinstatedAt = timestamp(configuration.eligibilityReinstatedAt);
    const priorObservedAt = new Date(
      Date.parse(reinstatedAt) - 1_000,
    ).toISOString();
    const before = await configuration.inspectProviderSafety();
    if (before.syntheticResidueObjectCount !== 0) scenarioError();

    const plan = createDnaCurrentStateSyncPlan({
      vault: "p5-recovery-synthetic-vault",
      ownedCoreIds: [101],
      activeRaceIds: ["p5-recovery-race"],
      spliceModes: ["bike"],
      spliceArenaPagesByMode: { bike: [1] },
    });
    const schedule = createDnaCurrentStateAcquisitionSchedule({
      evaluatedAt: reinstatedAt,
      plan,
    });
    const entries = schedule.requestBatches.flat();
    const scheduledRequestKeys = Object.freeze(
      entries.map((entry) =>
        dnaOpenLabRawEvidenceSha256({
          group: entry.group,
          request: entry.request,
        }),
      ),
    );
    const pausedCheckpoint: DnaCurrentStateAcquisitionCycleCheckpoint =
      Object.freeze({
        version: 1,
        cycleId: configuration.cycleId,
        evaluatedAt: reinstatedAt,
        scheduleSha256: dnaOpenLabRawEvidenceSha256({
          evaluatedAt: reinstatedAt,
          completionScope: schedule.completionScope,
          dueGroups: schedule.dueGroups,
          requests: entries,
        }),
        status: "paused",
        scheduledRequestKeys,
        receipts: Object.freeze([]),
        completedGroups: Object.freeze([]),
        pauseReason: "api_ineligible",
        retryNotBefore: null,
      });
    const repository = new DurableCheckpointRepository(pausedCheckpoint);
    const checkpointSha256BeforeResume = sha256(repository.stored);

    let syncState: DnaLastGoodSyncState = acceptDnaCurrentStateCandidate({
      previous: createInitialDnaLastGoodSyncState(),
      candidate: completeCandidate({
        generationId: before.servingStateSha256,
        observedAt: priorObservedAt,
      }),
      acceptedAt: priorObservedAt,
    });
    syncState = pauseDnaCurrentStateSync({
      previous: syncState,
      reason: "api_ineligible",
      attemptedAt: priorObservedAt,
    });
    const servingDuringPause = syncState.servingGenerationId;
    syncState = beginDnaCurrentStateCatchUp({
      previous: syncState,
      attemptedAt: reinstatedAt,
    });
    if (
      syncState.syncStatus !== "catching_up" ||
      syncState.servingGenerationId !== servingDuringPause
    ) {
      scenarioError();
    }

    const sink = createDnaOpenLabP5RecoveryTemporaryEvidenceSink({
      authority: DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
      ownerId: configuration.ownerId,
      bucketName: configuration.bucketName,
      storage: configuration.storage,
    });
    const reader = createDnaOpenLabP5RecoveryTemporaryEvidenceReader({
      authority: DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
      ownerId: configuration.ownerId,
      bucketName: configuration.bucketName,
      storage: configuration.storage,
    });
    const calls = { count: 0 };
    const pool = successfulPool(calls);

    for (let index = 0; index < schedule.scheduledRequestCount; index += 1) {
      const step = await runDnaCurrentStateAcquisitionStep({
        cycleId: configuration.cycleId,
        attemptedAt: reinstatedAt,
        schedule,
        checkpointRepository: repository,
        pool,
        persistEvidence: sink,
        pauseLastGood: async () => scenarioError(),
      });
      if (
        step.kind !== "request_completed" ||
        syncState.syncStatus !== "catching_up" ||
        syncState.servingGenerationId !== servingDuringPause
      ) {
        scenarioError();
      }
    }
    const ready = await runDnaCurrentStateAcquisitionStep({
      cycleId: configuration.cycleId,
      attemptedAt: reinstatedAt,
      schedule,
      checkpointRepository: repository,
      pool,
      persistEvidence: sink,
      pauseLastGood: async () => scenarioError(),
    });
    if (ready.kind !== "ready_to_publish") scenarioError();

    const receiptAggregate = sha256(
      ready.stored.checkpoint.receipts.map((receipt) => ({
        requestKey: receipt.requestKey,
        contentSha256: receipt.contentSha256,
      })),
    );
    let indexedPublicationCount = 0;
    const publicationRepository = {
      publishCandidate: async (input: {
        candidate: DnaCurrentStateCandidate;
        evidenceIndex: {
          generationId: string;
          receipts: readonly unknown[];
        };
        acceptedAt: string;
      }) => {
        if (
          syncState.syncStatus !== "catching_up" ||
          input.evidenceIndex.generationId !== configuration.cycleId ||
          input.evidenceIndex.receipts.length !== schedule.scheduledRequestCount
        ) {
          scenarioError();
        }
        indexedPublicationCount += 1;
        syncState = acceptDnaCurrentStateCandidate({
          previous: syncState,
          candidate: input.candidate,
          acceptedAt: input.acceptedAt,
        });
        return syncState;
      },
    } as unknown as NeonDnaOpenLabSyncPublicationRepository;
    syncState = await publishDnaCurrentStateAcquisitionCycle({
      ownerId: configuration.ownerId,
      cycleId: configuration.cycleId,
      schedule,
      checkpoint: ready.stored.checkpoint,
      validatedAt: reinstatedAt,
      recordedAt: reinstatedAt,
      acceptedAt: reinstatedAt,
      readEvidence: reader,
      publicationRepository,
    });
    if (
      indexedPublicationCount !== 1 ||
      syncState.syncStatus !== "current" ||
      syncState.catchUpRequired ||
      syncState.servingGenerationId !== configuration.cycleId ||
      syncState.lastCatchUpCompletedAt !== reinstatedAt ||
      (await configuration.inspectProviderSafety())
        .syntheticResidueObjectCount !== schedule.scheduledRequestCount
    ) {
      scenarioError();
    }

    const checkpointSha256UsedForResume =
      repository.checkpointSha256UsedForResume ?? scenarioError();
    if (checkpointSha256UsedForResume !== checkpointSha256BeforeResume) {
      scenarioError();
    }
    await configuration.cleanupSyntheticCase();
    const cleaned = await configuration.inspectProviderSafety();
    assertUnchangedProviderState(before, cleaned);

    return Object.freeze({
      caseId: "eligibility_reinstatement",
      apiRequestCount: 0,
      syntheticProviderWriteCount: schedule.scheduledRequestCount,
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      rawPayloadIncluded: false,
      secretMaterialIncluded: false,
      lastGoodGenerationBefore: before.servingStateSha256,
      lastGoodGenerationAfter: cleaned.servingStateSha256,
      expectedCheckpointSha256: checkpointSha256BeforeResume,
      recoveredCheckpointSha256: checkpointSha256UsedForResume,
      expectedEvidenceSha256: receiptAggregate,
      readBackEvidenceSha256: receiptAggregate,
      retryBoundaryAt: reinstatedAt,
      firstRetryAt: reinstatedAt,
      catchUpStarted: true,
      catchUpCompleted: true,
      summary:
        "Eligibility reinstatement resumed the exact durable checkpoint, kept last-good serving during catch-up, and cleared the pause only after one complete indexed publication.",
      checkpointSha256BeforeResume,
      checkpointSha256UsedForResume,
      indexedPublicationCount,
      syncStateAfter: syncState.syncStatus,
    });
  };
}
