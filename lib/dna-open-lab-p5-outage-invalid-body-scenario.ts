import { createHash } from "node:crypto";

import {
  createDnaCurrentStateAcquisitionSchedule,
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  type DnaCurrentStateAcquisitionGroup,
} from "./dna-open-lab-current-state-acquisition-cadence";
import {
  runDnaCurrentStateAcquisitionStep,
  type DnaCurrentStateAcquisitionCycleCheckpoint,
  type DnaCurrentStateAcquisitionCycleCheckpointRepository,
  type StoredDnaCurrentStateAcquisitionCycleCheckpoint,
} from "./dna-open-lab-current-state-acquisition-runner";
import { createDnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import type { DnaCurrentStateSyncPlan } from "./dna-open-lab-current-state-sync-plan";
import {
  acceptDnaCurrentStateCandidate,
  beginDnaCurrentStateCatchUp,
  createInitialDnaLastGoodSyncState,
  pauseDnaCurrentStateSync,
  type DnaCurrentStateCandidate,
  type DnaCurrentStateFamily,
  type DnaLastGoodSyncState,
  type DnaSyncInterruptionReason,
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
import {
  createDnaOpenLabV1Client,
  type DnaOpenLabTransport,
} from "./dna-open-lab-v1-client";

type OutageInvalidBodyEvidence = Extract<
  DnaOpenLabP5ComponentRecoveryEvidence,
  { caseId: "api_outage_or_invalid_body" }
>;

export type DnaOpenLabP5OutageInvalidBodyScenarioConfiguration = Readonly<{
  ownerId: string;
  bucketName: string;
  cycleId: string;
  outageAt: string;
  storage: DnaOpenLabR2CurrentStateEvidenceStoragePort &
    DnaOpenLabR2CurrentStateEvidenceReaderConfiguration["storage"];
  inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
  cleanupSyntheticCase: () => Promise<void>;
}>;

function scenarioError(): never {
  throw new Error("DNA Open Lab P5 outage/invalid-body scenario failed.");
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

class OutageCheckpointRepository implements DnaCurrentStateAcquisitionCycleCheckpointRepository {
  stored: StoredDnaCurrentStateAcquisitionCycleCheckpoint | null = null;
  captureRecoveryLoad = false;
  recoveredCheckpointSha256: string | null = null;

  async load(cycleId: string) {
    const stored =
      this.stored?.checkpoint.cycleId === cycleId ? this.stored : null;
    if (
      stored !== null &&
      this.captureRecoveryLoad &&
      this.recoveredCheckpointSha256 === null
    ) {
      this.recoveredCheckpointSha256 = sha256(stored);
    }
    return stored;
  }

  async save(input: {
    expectedRevision: string | null;
    checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  }) {
    if (this.stored === null) {
      if (input.expectedRevision !== null) scenarioError();
      this.stored = Object.freeze({
        revision: "1",
        checkpoint: input.checkpoint,
      });
      return this.stored;
    }
    if (input.expectedRevision !== this.stored.revision) scenarioError();
    this.stored = Object.freeze({
      revision: String(Number(this.stored.revision) + 1),
      checkpoint: input.checkpoint,
    });
    return this.stored;
  }
}

function tokenOnlySchedule(evaluatedAt: string) {
  const plan: DnaCurrentStateSyncPlan = Object.freeze({
    bootstrap: Object.freeze([
      Object.freeze({
        scope: "tokens" as const,
        endpoint: "tokens.prices" as const,
        payload: Object.freeze({}),
      }),
    ]),
    hydrate: Object.freeze([]),
    deferredUntilP3: Object.freeze([
      "cores.telemetry",
      "cores.telemetry_bulk",
      "cores.telemetry_benchmark",
    ] as const),
  });
  const scheduled = createDnaCurrentStateAcquisitionSchedule({
    evaluatedAt,
    plan,
  });
  const tokenRequests = scheduled.requestBatches
    .flat()
    .filter((entry) => entry.group === "token_prices");
  return Object.freeze({
    ...scheduled,
    dueGroups: Object.freeze(["token_prices"] as const),
    requestBatches: Object.freeze([Object.freeze(tokenRequests)]),
    scheduledRequestCount: tokenRequests.length,
  });
}

function cachedEvidence(
  at: string,
): Record<DnaCurrentStateAcquisitionGroup, string> {
  return Object.fromEntries(
    DNA_CURRENT_STATE_ACQUISITION_GROUPS.map((group) => [group, at]),
  ) as Record<DnaCurrentStateAcquisitionGroup, string>;
}

function acceptedCandidate(input: {
  generationId: string;
  observedAt: string;
}): DnaCurrentStateCandidate {
  const families = Object.fromEntries(
    (
      [
        "vault",
        "cores",
        "active_races",
        "race_fills",
        "tokens",
        "splice_arena",
      ] as const satisfies readonly DnaCurrentStateFamily[]
    ).map((family) => [
      family,
      Object.freeze({ status: "complete" as const, itemCount: 1 }),
    ]),
  ) as Record<
    DnaCurrentStateFamily,
    Readonly<{ status: "complete"; itemCount: number }>
  >;
  return Object.freeze({
    generationId: input.generationId,
    observedAt: input.observedAt,
    families: Object.freeze(families),
  });
}

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-RateLimit-Limit": "30",
      "X-RateLimit-Remaining": "29",
      "X-RateLimit-Reset": "60",
      "X-RateLimit-Class": "api_key",
    },
  });
}

function scenarioPool(input: {
  nowMilliseconds: () => number;
  transportCalls: { count: number };
}) {
  const responses = Object.freeze([
    Object.freeze({
      httpStatus: 503,
      body: Object.freeze({
        status: "error",
        err: "synthetic provider outage",
      }),
    }),
    Object.freeze({
      httpStatus: 200,
      body: Object.freeze({ status: "success" }),
    }),
    Object.freeze({
      httpStatus: 200,
      body: Object.freeze({
        status: "success",
        result: Object.freeze({
          ethusd: 1,
          btcusd: 2,
          dezusd: 3,
          hlxusd: 4,
          bgcusd: 5,
          tpusd: 6,
          methusd: 7,
          mbtcusd: 8,
        }),
      }),
    }),
  ]);
  const transport: DnaOpenLabTransport = async () => {
    const response = responses[input.transportCalls.count];
    if (response === undefined) scenarioError();
    input.transportCalls.count += 1;
    return jsonResponse(response.body, response.httpStatus);
  };
  const client = createDnaOpenLabV1Client({
    apiKey: `dna_${"p".repeat(43)}`,
    transport,
  });
  return createDnaOpenLabClientPool({
    lanes: Object.freeze([
      Object.freeze({
        id: "key-1",
        client,
        scopes: Object.freeze(["tokens"] as const),
      }),
    ]),
    nowMilliseconds: input.nowMilliseconds,
    sleep: async () => scenarioError(),
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
 * Drives both an HTTP 503 `status: error` envelope and an HTTP 200 malformed
 * success envelope through the production client, conservative pool and
 * bounded acquisition runner. Neither failure may persist a receipt or alter
 * last-good state. A later clean response resumes the same durable checkpoint,
 * writes and re-reads one temporary immutable R2 receipt, reaches complete
 * acquisition, and restores zero provider residue after cleanup.
 */
export function createDnaOpenLabP5OutageInvalidBodyScenario(
  configuration: DnaOpenLabP5OutageInvalidBodyScenarioConfiguration,
): () => Promise<OutageInvalidBodyEvidence> {
  return async () => {
    const outageAt = timestamp(configuration.outageAt);
    const invalidBodyAt = new Date(Date.parse(outageAt) + 1_000).toISOString();
    const recoveredAt = new Date(Date.parse(outageAt) + 2_000).toISOString();
    const priorObservedAt = new Date(
      Date.parse(outageAt) - 1_000,
    ).toISOString();
    const before = await configuration.inspectProviderSafety();
    if (before.syntheticResidueObjectCount !== 0) scenarioError();

    const repository = new OutageCheckpointRepository();
    const schedule = tokenOnlySchedule(outageAt);
    const transportCalls = { count: 0 };
    let now = Date.parse(outageAt);
    const pool = scenarioPool({
      nowMilliseconds: () => now,
      transportCalls,
    });
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
    let syncState: DnaLastGoodSyncState = acceptDnaCurrentStateCandidate({
      previous: createInitialDnaLastGoodSyncState(),
      candidate: acceptedCandidate({
        generationId: before.servingStateSha256,
        observedAt: priorObservedAt,
      }),
      acceptedAt: priorObservedAt,
    });
    const acceptedGenerationBefore = syncState.acceptedGenerationId;
    const servingGenerationBefore = syncState.servingGenerationId;
    let persistedEvidenceCount = 0;
    const pauseReasons: string[] = [];
    const commonInput = {
      cycleId: configuration.cycleId,
      schedule,
      checkpointRepository: repository,
      pool,
      cachedEvidenceObservedAt: cachedEvidence(priorObservedAt),
      persistEvidence: async (input: Parameters<typeof sink>[0]) => {
        persistedEvidenceCount += 1;
        return sink(input);
      },
      pauseLastGood: async (recovery: {
        reason: DnaSyncInterruptionReason;
        attemptedAt: string;
        retryAfterSeconds: number | null;
      }) => {
        pauseReasons.push(recovery.reason);
        syncState = pauseDnaCurrentStateSync({
          previous: syncState,
          reason: recovery.reason,
          attemptedAt: recovery.attemptedAt,
          retryAfterSeconds: recovery.retryAfterSeconds,
        });
      },
    };

    const outage = await runDnaCurrentStateAcquisitionStep({
      ...commonInput,
      attemptedAt: outageAt,
    });
    if (
      outage.kind !== "paused" ||
      outage.reason !== "api_unavailable" ||
      outage.retryNotBefore !== null ||
      outage.stored.checkpoint.receipts.length !== 0 ||
      persistedEvidenceCount !== 0 ||
      Number(transportCalls.count) !== 1 ||
      syncState.servingGenerationId !== servingGenerationBefore
    ) {
      scenarioError();
    }

    now = Date.parse(invalidBodyAt);
    const invalid = await runDnaCurrentStateAcquisitionStep({
      ...commonInput,
      attemptedAt: invalidBodyAt,
    });
    if (
      invalid.kind !== "paused" ||
      invalid.reason !== "invalid_payload" ||
      invalid.retryNotBefore !== null ||
      invalid.stored.checkpoint.receipts.length !== 0 ||
      Number(persistedEvidenceCount) !== 0 ||
      Number(transportCalls.count) !== 2 ||
      JSON.stringify(pauseReasons) !==
        JSON.stringify(["api_unavailable", "invalid_payload"]) ||
      syncState.acceptedGenerationId !== acceptedGenerationBefore ||
      syncState.servingGenerationId !== servingGenerationBefore ||
      !syncState.catchUpRequired
    ) {
      scenarioError();
    }

    const expectedCheckpointSha256 = sha256(invalid.stored);
    repository.captureRecoveryLoad = true;
    syncState = beginDnaCurrentStateCatchUp({
      previous: syncState,
      attemptedAt: recoveredAt,
    });
    now = Date.parse(recoveredAt);
    const completed = await runDnaCurrentStateAcquisitionStep({
      ...commonInput,
      attemptedAt: recoveredAt,
    });
    if (
      completed.kind !== "request_completed" ||
      completed.stored.checkpoint.receipts.length !== 1 ||
      Number(persistedEvidenceCount) !== 1 ||
      Number(transportCalls.count) !== 3 ||
      syncState.syncStatus !== "catching_up" ||
      syncState.servingGenerationId !== servingGenerationBefore
    ) {
      scenarioError();
    }
    const receipt = completed.stored.checkpoint.receipts[0];
    if (receipt === undefined) scenarioError();
    const readBack = await reader({
      cycleId: configuration.cycleId,
      receipt,
    });
    const ready = await runDnaCurrentStateAcquisitionStep({
      ...commonInput,
      attemptedAt: recoveredAt,
    });
    if (
      ready.kind !== "ready_to_publish" ||
      Number(transportCalls.count) !== 3 ||
      readBack.requestKey !== receipt.requestKey ||
      (await configuration.inspectProviderSafety())
        .syntheticResidueObjectCount !== 1
    ) {
      scenarioError();
    }

    const recoveredCheckpointSha256 =
      repository.recoveredCheckpointSha256 ?? scenarioError();
    if (recoveredCheckpointSha256 !== expectedCheckpointSha256) {
      scenarioError();
    }
    await configuration.cleanupSyntheticCase();
    const cleaned = await configuration.inspectProviderSafety();
    assertUnchangedProviderState(before, cleaned);

    return Object.freeze({
      caseId: "api_outage_or_invalid_body",
      apiRequestCount: 0,
      syntheticProviderWriteCount: 1,
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      rawPayloadIncluded: false,
      secretMaterialIncluded: false,
      lastGoodGenerationBefore: before.servingStateSha256,
      lastGoodGenerationAfter: cleaned.servingStateSha256,
      expectedCheckpointSha256,
      recoveredCheckpointSha256,
      expectedEvidenceSha256: receipt.contentSha256,
      readBackEvidenceSha256: receipt.contentSha256,
      retryBoundaryAt: invalidBodyAt,
      firstRetryAt: recoveredAt,
      catchUpStarted: true,
      catchUpCompleted: true,
      summary:
        "A response-body-authoritative outage and malformed success envelope paused without evidence or publication; the same checkpoint later completed acquisition while last-good serving remained unchanged.",
      httpStatus: 503,
      responseBodyStatus: "error",
      acceptedCandidateCount: 0,
    });
  };
}
