import {
  classifyDnaCurrentStateAcquisitionFailure,
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  inspectDnaCurrentStateAcquisitionCompletion,
  type DnaCurrentStateAcquisitionGroup,
  type DnaCurrentStateAcquisitionSchedule,
  type DnaScheduledCurrentStateRequest,
} from "./dna-open-lab-current-state-acquisition-cadence";
import type { DnaOpenLabClientPool } from "./dna-open-lab-client-pool";
import type {
  DnaCurrentStateRequest,
  DnaCurrentStateEndpoint,
} from "./dna-open-lab-current-state-sync-plan";
import type {
  DnaOpenLabResponse,
  DnaOpenLabScope,
  DnaRaceIdentifier,
  DnaRaceMode,
} from "./dna-open-lab-v1-client";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import type { DnaSyncInterruptionReason } from "./dna-open-lab-last-good-publication";

export const DNA_CURRENT_STATE_ACQUISITION_CYCLE_VERSION = 1 as const;

export type DnaCurrentStateAcquisitionEvidenceReceipt = Readonly<{
  requestKey: string;
  observedAt: string;
  contentSha256: string;
  evidenceObjectKey: string;
}>;

export type DnaCurrentStateAcquisitionCycleCheckpoint = Readonly<{
  version: typeof DNA_CURRENT_STATE_ACQUISITION_CYCLE_VERSION;
  cycleId: string;
  evaluatedAt: string;
  scheduleSha256: string;
  status: "running" | "paused" | "awaiting_evidence" | "ready_to_publish";
  scheduledRequestKeys: readonly string[];
  receipts: readonly DnaCurrentStateAcquisitionEvidenceReceipt[];
  completedGroups: readonly DnaCurrentStateAcquisitionGroup[];
  pauseReason: DnaSyncInterruptionReason | null;
  retryNotBefore: string | null;
}>;

export type StoredDnaCurrentStateAcquisitionCycleCheckpoint = Readonly<{
  revision: string;
  checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
}>;

/**
 * The repository instance is owner-scoped. Implementations must use
 * compare-and-swap semantics so two workers cannot advance the same cycle.
 */
export type DnaCurrentStateAcquisitionCycleCheckpointRepository = Readonly<{
  load: (
    cycleId: string,
  ) => Promise<StoredDnaCurrentStateAcquisitionCycleCheckpoint | null>;
  save: (input: {
    expectedRevision: string | null;
    checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  }) => Promise<StoredDnaCurrentStateAcquisitionCycleCheckpoint>;
}>;

export type DnaCurrentStateAcquisitionStepResult =
  | Readonly<{
      kind: "idle" | "retry_blocked";
      nextEvaluationAt: string;
      stored: StoredDnaCurrentStateAcquisitionCycleCheckpoint | null;
    }>
  | Readonly<{
      kind: "request_completed";
      requestKey: string;
      group: DnaCurrentStateAcquisitionGroup;
      remainingRequestCount: number;
      stored: StoredDnaCurrentStateAcquisitionCycleCheckpoint;
    }>
  | Readonly<{
      kind: "paused";
      reason: DnaSyncInterruptionReason;
      retryNotBefore: string | null;
      stored: StoredDnaCurrentStateAcquisitionCycleCheckpoint;
    }>
  | Readonly<{
      kind: "awaiting_evidence" | "ready_to_publish";
      incompleteGroups: readonly DnaCurrentStateAcquisitionGroup[];
      stored: StoredDnaCurrentStateAcquisitionCycleCheckpoint;
    }>;

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const CYCLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const interruptionReasons = new Set<DnaSyncInterruptionReason>([
  "api_unavailable",
  "api_ineligible",
  "rate_limited",
  "invalid_payload",
]);
const cycleStatuses = new Set<
  DnaCurrentStateAcquisitionCycleCheckpoint["status"]
>(["running", "paused", "awaiting_evidence", "ready_to_publish"]);

const endpointScopes: Readonly<
  Record<DnaCurrentStateEndpoint, DnaOpenLabScope>
> = Object.freeze({
  "vault.info": "vault",
  "vault.cores_full": "vault",
  "vault.tier_badge": "vault",
  "vault.recent_races": "vault",
  "races.active": "races",
  "races.fills": "races",
  "cores.info_bulk": "cores",
  "cores.racing_stats_bulk": "cores",
  "cores.power_bulk": "cores",
  "cores.listing_price_bulk": "cores",
  "cores.attached_assets_bulk": "cores",
  "cores.owner_bulk": "cores",
  "cores.stamina_bulk": "cores",
  "cores.splicing_info_bulk": "cores",
  "tokens.prices": "tokens",
  "splice.arena": "splice",
  "splice.pair_info": "splice",
  "splice.pair_validate": "splice",
});

function runnerError(message: string): never {
  throw new Error(`DNA Open Lab current-state acquisition runner: ${message}`);
}

function timestamp(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    ) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    runnerError(`${field} must be a timezone-qualified ISO timestamp`);
  }
  return new Date(normalized).toISOString();
}

function cycleId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!CYCLE_ID_PATTERN.test(normalized)) runnerError("cycleId is invalid");
  return normalized;
}

function requestKey(entry: DnaScheduledCurrentStateRequest): string {
  return dnaOpenLabRawEvidenceSha256({
    group: entry.group,
    request: entry.request,
  });
}

function scheduledEntries(
  schedule: DnaCurrentStateAcquisitionSchedule,
): readonly DnaScheduledCurrentStateRequest[] {
  return Object.freeze(schedule.requestBatches.flat());
}

function scheduleSha256(schedule: DnaCurrentStateAcquisitionSchedule): string {
  return dnaOpenLabRawEvidenceSha256({
    evaluatedAt: schedule.evaluatedAt,
    dueGroups: schedule.dueGroups,
    requests: scheduledEntries(schedule),
  });
}

function receipt(
  value: DnaCurrentStateAcquisitionEvidenceReceipt,
  expectedRequestKey: string,
  minimumObservedAt: string,
  maximumObservedAt: string,
): DnaCurrentStateAcquisitionEvidenceReceipt {
  const evidenceObjectKey = value.evidenceObjectKey.trim();
  const observedAt = timestamp(value.observedAt, "receipt.observedAt");
  if (
    value.requestKey !== expectedRequestKey ||
    !SHA_256_PATTERN.test(value.contentSha256) ||
    evidenceObjectKey.length < 1 ||
    evidenceObjectKey.length > 4096 ||
    CONTROL_PATTERN.test(evidenceObjectKey) ||
    Date.parse(observedAt) < Date.parse(minimumObservedAt) ||
    Date.parse(observedAt) > Date.parse(maximumObservedAt)
  ) {
    runnerError("evidence receipt is invalid or does not match the request");
  }
  return Object.freeze({ ...value, observedAt, evidenceObjectKey });
}

function completedGroups(input: {
  schedule: DnaCurrentStateAcquisitionSchedule;
  completedRequestKeys: ReadonlySet<string>;
}): readonly DnaCurrentStateAcquisitionGroup[] {
  const entries = scheduledEntries(input.schedule);
  return Object.freeze(
    input.schedule.dueGroups.filter((group) =>
      entries
        .filter((entry) => entry.group === group)
        .every((entry) => input.completedRequestKeys.has(requestKey(entry))),
    ),
  );
}

export function validateDnaCurrentStateAcquisitionCycleCheckpoint(input: {
  checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  cycleId: string;
  schedule: DnaCurrentStateAcquisitionSchedule;
  validatedAt: string;
}): DnaCurrentStateAcquisitionCycleCheckpoint {
  const validatedAt = timestamp(input.validatedAt, "validatedAt");
  const checkpoint = validateDnaCurrentStateAcquisitionCycleCheckpointDocument({
    checkpoint: input.checkpoint,
    validatedAt,
  });
  const expectedScheduleSha256 = scheduleSha256(input.schedule);
  const expectedKeys = scheduledEntries(input.schedule).map(requestKey);
  if (
    checkpoint.cycleId !== input.cycleId ||
    checkpoint.evaluatedAt !== input.schedule.evaluatedAt ||
    checkpoint.scheduleSha256 !== expectedScheduleSha256 ||
    JSON.stringify(checkpoint.scheduledRequestKeys) !==
      JSON.stringify(expectedKeys)
  ) {
    runnerError("stored cycle authority does not match the requested schedule");
  }

  const seen = new Set<string>();
  const receipts = checkpoint.receipts.map((item) => {
    if (seen.has(item.requestKey)) runnerError("checkpoint repeats a receipt");
    seen.add(item.requestKey);
    if (!expectedKeys.includes(item.requestKey)) {
      runnerError("checkpoint contains an unscheduled receipt");
    }
    return receipt(
      item,
      item.requestKey,
      input.schedule.evaluatedAt,
      validatedAt,
    );
  });
  const expectedCompletedGroups = completedGroups({
    schedule: input.schedule,
    completedRequestKeys: seen,
  });
  if (
    JSON.stringify(checkpoint.completedGroups) !==
    JSON.stringify(expectedCompletedGroups)
  ) {
    runnerError("checkpoint completed-group evidence has drifted");
  }
  return Object.freeze({
    ...checkpoint,
    receipts: Object.freeze(receipts),
    completedGroups: expectedCompletedGroups,
  });
}

/**
 * Validates the self-contained durable document before schedule-specific
 * authority is available. Repository adapters use this at the trust boundary;
 * the runner performs the stricter schedule comparison above before acting.
 */
export function validateDnaCurrentStateAcquisitionCycleCheckpointDocument(input: {
  checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  validatedAt: string;
}): DnaCurrentStateAcquisitionCycleCheckpoint {
  const validatedAt = timestamp(input.validatedAt, "validatedAt");
  const value = input.checkpoint;
  if (
    value.version !== DNA_CURRENT_STATE_ACQUISITION_CYCLE_VERSION ||
    !cycleStatuses.has(value.status)
  ) {
    runnerError("stored cycle document version or status is invalid");
  }
  const normalizedCycleId = cycleId(value.cycleId);
  const evaluatedAt = timestamp(value.evaluatedAt, "evaluatedAt");
  if (
    typeof value.scheduleSha256 !== "string" ||
    !SHA_256_PATTERN.test(value.scheduleSha256) ||
    !Array.isArray(value.scheduledRequestKeys) ||
    value.scheduledRequestKeys.length > 512 ||
    value.scheduledRequestKeys.some(
      (key) => typeof key !== "string" || !SHA_256_PATTERN.test(key),
    ) ||
    new Set(value.scheduledRequestKeys).size !==
      value.scheduledRequestKeys.length
  ) {
    runnerError("stored cycle schedule evidence is invalid");
  }
  const scheduledKeys = new Set(value.scheduledRequestKeys);
  if (
    !Array.isArray(value.receipts) ||
    value.receipts.length > scheduledKeys.size
  ) {
    runnerError("stored cycle receipt count is invalid");
  }
  const seen = new Set<string>();
  const receipts = value.receipts.map((item) => {
    if (!scheduledKeys.has(item.requestKey) || seen.has(item.requestKey)) {
      runnerError("stored cycle receipt coverage is invalid");
    }
    seen.add(item.requestKey);
    return receipt(item, item.requestKey, evaluatedAt, validatedAt);
  });
  if (!Array.isArray(value.completedGroups)) {
    runnerError("stored cycle completed groups are invalid");
  }
  const expectedGroupOrder = DNA_CURRENT_STATE_ACQUISITION_GROUPS.filter(
    (group) => value.completedGroups.includes(group),
  );
  if (
    JSON.stringify(value.completedGroups) !== JSON.stringify(expectedGroupOrder)
  ) {
    runnerError("stored cycle completed groups are invalid");
  }
  const retryNotBefore =
    value.retryNotBefore === null
      ? null
      : timestamp(value.retryNotBefore, "retryNotBefore");
  if (value.status !== "paused" && retryNotBefore !== null) {
    runnerError("only a paused checkpoint may carry retryNotBefore");
  }
  if (
    (value.status === "paused") !== (value.pauseReason !== null) ||
    (value.pauseReason !== null && !interruptionReasons.has(value.pauseReason))
  ) {
    runnerError("pauseReason must match paused checkpoint status");
  }
  if (
    (value.status === "awaiting_evidence" ||
      value.status === "ready_to_publish") &&
    receipts.length !== value.scheduledRequestKeys.length
  ) {
    runnerError("terminal acquisition state requires every request receipt");
  }
  return Object.freeze({
    ...value,
    cycleId: normalizedCycleId,
    evaluatedAt,
    scheduledRequestKeys: Object.freeze([...value.scheduledRequestKeys]),
    receipts: Object.freeze(receipts),
    completedGroups: Object.freeze([...value.completedGroups]),
    retryNotBefore,
  });
}

function initialCheckpoint(input: {
  cycleId: string;
  schedule: DnaCurrentStateAcquisitionSchedule;
}): DnaCurrentStateAcquisitionCycleCheckpoint {
  const entries = scheduledEntries(input.schedule);
  const keys = Object.freeze(entries.map(requestKey));
  if (new Set(keys).size !== keys.length) {
    runnerError("schedule contains duplicate logical requests");
  }
  return Object.freeze({
    version: DNA_CURRENT_STATE_ACQUISITION_CYCLE_VERSION,
    cycleId: input.cycleId,
    evaluatedAt: input.schedule.evaluatedAt,
    scheduleSha256: scheduleSha256(input.schedule),
    status: "running",
    scheduledRequestKeys: keys,
    receipts: Object.freeze([]),
    completedGroups: completedGroups({
      schedule: input.schedule,
      completedRequestKeys: new Set(),
    }),
    pauseReason: null,
    retryNotBefore: null,
  });
}

function requiredTextPayload(
  request: DnaCurrentStateRequest,
  field: string,
): string {
  const value = request.payload[field];
  if (typeof value !== "string" || value.trim().length < 1) {
    runnerError(`${request.endpoint}.${field} is invalid`);
  }
  return value.trim();
}

function numberListPayload(
  request: DnaCurrentStateRequest,
  field: string,
): readonly number[] {
  const value = request.payload[field];
  if (
    !Array.isArray(value) ||
    value.some((item) => !Number.isSafeInteger(item) || Number(item) < 1)
  ) {
    runnerError(`${request.endpoint}.${field} is invalid`);
  }
  return value as readonly number[];
}

function raceListPayload(
  request: DnaCurrentStateRequest,
): readonly DnaRaceIdentifier[] {
  const value = request.payload.rids;
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !(
          (typeof item === "number" &&
            Number.isSafeInteger(item) &&
            item > 0) ||
          (typeof item === "string" && item.trim().length > 0)
        ),
    )
  ) {
    runnerError(`${request.endpoint}.rids is invalid`);
  }
  return value as readonly DnaRaceIdentifier[];
}

function spliceArenaPayload(request: DnaCurrentStateRequest): {
  mode: DnaRaceMode;
  page: number;
} {
  const filter = request.payload.filter;
  if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
    return runnerError("splice.arena.filter is invalid");
  }
  const value = (filter as Record<string, unknown>).rvmode;
  if (value !== "bike" && value !== "car" && value !== "horse") {
    return runnerError("splice.arena.filter.rvmode is invalid");
  }
  const page = request.payload.page ?? 1;
  if (!Number.isSafeInteger(page) || Number(page) < 1) {
    return runnerError("splice.arena.page is invalid");
  }
  return { mode: value, page: Number(page) };
}

/** Dispatches one already-scheduled request through the conservative pool. */
export function dispatchDnaCurrentStateRequest(input: {
  pool: DnaOpenLabClientPool;
  request: DnaCurrentStateRequest;
}): Promise<DnaOpenLabResponse<unknown>> {
  const { request } = input;
  if (endpointScopes[request.endpoint] !== request.scope) {
    return Promise.reject(
      new Error(
        `DNA Open Lab current-state acquisition runner: ${request.endpoint} scope is invalid`,
      ),
    );
  }
  if (
    request.endpoint === "splice.pair_info" ||
    request.endpoint === "splice.pair_validate"
  ) {
    return Promise.reject(
      new Error(
        "DNA Open Lab current-state acquisition runner: on-demand pair reads cannot enter the recurring runner",
      ),
    );
  }

  return input.pool.execute<unknown>({
    scope: request.scope,
    request: (client) => {
      switch (request.endpoint) {
        case "vault.info":
          return client.vaultInfo(requiredTextPayload(request, "vault"));
        case "vault.cores_full":
          return client.vaultCoresFull(requiredTextPayload(request, "vault"));
        case "vault.tier_badge":
          return client.vaultTierBadge(requiredTextPayload(request, "vault"));
        case "vault.recent_races":
          return client.vaultRecentRaces(requiredTextPayload(request, "vault"));
        case "races.active":
          return client.racesActive();
        case "races.fills":
          return client.raceFills(raceListPayload(request));
        case "cores.info_bulk":
          return client.coreInfoBulk(numberListPayload(request, "hids"));
        case "cores.racing_stats_bulk":
          return client.coreRacingStatsBulk(numberListPayload(request, "hids"));
        case "cores.power_bulk":
          return client.corePowerBulk(numberListPayload(request, "hids"));
        case "cores.listing_price_bulk":
          return client.coreListingPriceBulk(
            numberListPayload(request, "hids"),
          );
        case "cores.attached_assets_bulk":
          return client.coreAttachedAssetsBulk(
            numberListPayload(request, "hids"),
          );
        case "cores.owner_bulk":
          return client.coreOwnerBulk(numberListPayload(request, "hids"));
        case "cores.stamina_bulk":
          return client.coreStaminaBulk(numberListPayload(request, "hids"));
        case "cores.splicing_info_bulk":
          return client.coreSplicingInfoBulk(
            numberListPayload(request, "hids"),
          );
        case "tokens.prices":
          return client.tokenPrices();
        case "splice.arena":
          const arena = spliceArenaPayload(request);
          return client.spliceArena({
            filter: { rvmode: arena.mode },
            page: arena.page,
          });
        default:
          return runnerError(
            `endpoint ${request.endpoint} is not dispatchable`,
          );
      }
    },
  });
}

/**
 * Advances at most one network request and one durable compare-and-swap. The
 * evidence callback must durably and idempotently retain validated evidence by
 * request key before returning its receipt. If checkpoint persistence then
 * fails, replaying the same request/evidence key is safe on restart.
 */
export async function runDnaCurrentStateAcquisitionStep(input: {
  cycleId: string;
  attemptedAt: string;
  schedule: DnaCurrentStateAcquisitionSchedule;
  checkpointRepository: DnaCurrentStateAcquisitionCycleCheckpointRepository;
  pool: DnaOpenLabClientPool;
  persistEvidence: (input: {
    cycleId: string;
    group: DnaCurrentStateAcquisitionGroup;
    requestKey: string;
    request: DnaCurrentStateRequest;
    response: DnaOpenLabResponse<unknown>;
    observedAt: string;
  }) => Promise<DnaCurrentStateAcquisitionEvidenceReceipt>;
  cachedEvidenceObservedAt?: Partial<
    Record<DnaCurrentStateAcquisitionGroup, string>
  >;
  pauseLastGood: (input: {
    reason: DnaSyncInterruptionReason;
    attemptedAt: string;
    retryAfterSeconds: number | null;
  }) => Promise<void>;
}): Promise<DnaCurrentStateAcquisitionStepResult> {
  const normalizedCycleId = cycleId(input.cycleId);
  const attemptedAt = timestamp(input.attemptedAt, "attemptedAt");
  if (Date.parse(attemptedAt) < Date.parse(input.schedule.evaluatedAt)) {
    runnerError("attemptedAt cannot precede the schedule evaluation");
  }
  if (input.schedule.status !== "ready") {
    return Object.freeze({
      kind: input.schedule.status,
      nextEvaluationAt: input.schedule.nextEvaluationAt,
      stored: null,
    });
  }

  let stored = await input.checkpointRepository.load(normalizedCycleId);
  if (stored === null) {
    stored = await input.checkpointRepository.save({
      expectedRevision: null,
      checkpoint: initialCheckpoint({
        cycleId: normalizedCycleId,
        schedule: input.schedule,
      }),
    });
  }
  let checkpoint = validateDnaCurrentStateAcquisitionCycleCheckpoint({
    checkpoint: stored.checkpoint,
    cycleId: normalizedCycleId,
    schedule: input.schedule,
    validatedAt: attemptedAt,
  });

  if (
    checkpoint.status === "paused" &&
    checkpoint.retryNotBefore !== null &&
    Date.parse(checkpoint.retryNotBefore) > Date.parse(attemptedAt)
  ) {
    return Object.freeze({
      kind: "paused",
      reason: checkpoint.pauseReason ?? "api_unavailable",
      retryNotBefore: checkpoint.retryNotBefore,
      stored,
    });
  }
  if (checkpoint.status === "paused") {
    stored = await input.checkpointRepository.save({
      expectedRevision: stored.revision,
      checkpoint: Object.freeze({
        ...checkpoint,
        status: "running",
        pauseReason: null,
        retryNotBefore: null,
      }),
    });
    checkpoint = stored.checkpoint;
  }

  const entries = scheduledEntries(input.schedule);
  const completedKeys = new Set(
    checkpoint.receipts.map((item) => item.requestKey),
  );
  const next = entries.find((entry) => !completedKeys.has(requestKey(entry)));

  if (next !== undefined) {
    const key = requestKey(next);
    let evidenceReceipt: DnaCurrentStateAcquisitionEvidenceReceipt;
    try {
      const response = await dispatchDnaCurrentStateRequest({
        pool: input.pool,
        request: next.request,
      });
      evidenceReceipt = receipt(
        await input.persistEvidence({
          cycleId: normalizedCycleId,
          group: next.group,
          requestKey: key,
          request: next.request,
          response,
          observedAt: attemptedAt,
        }),
        key,
        input.schedule.evaluatedAt,
        attemptedAt,
      );
    } catch (error) {
      const recovery = classifyDnaCurrentStateAcquisitionFailure({
        error,
        operation: "current_state_request",
      });
      const retryNotBefore =
        recovery.retryAfterSeconds === null
          ? null
          : new Date(
              Date.parse(attemptedAt) + recovery.retryAfterSeconds * 1_000,
            ).toISOString();
      stored = await input.checkpointRepository.save({
        expectedRevision: stored.revision,
        checkpoint: Object.freeze({
          ...checkpoint,
          status: "paused",
          pauseReason: recovery.reason,
          retryNotBefore,
        }),
      });
      await input.pauseLastGood({
        reason: recovery.reason,
        attemptedAt,
        retryAfterSeconds: recovery.retryAfterSeconds,
      });
      return Object.freeze({
        kind: "paused",
        reason: recovery.reason,
        retryNotBefore,
        stored,
      });
    }

    const receipts = Object.freeze([...checkpoint.receipts, evidenceReceipt]);
    completedKeys.add(key);
    const groups = completedGroups({
      schedule: input.schedule,
      completedRequestKeys: completedKeys,
    });
    stored = await input.checkpointRepository.save({
      expectedRevision: stored.revision,
      checkpoint: Object.freeze({
        ...checkpoint,
        status: "running",
        receipts,
        completedGroups: groups,
        pauseReason: null,
        retryNotBefore: null,
      }),
    });
    return Object.freeze({
      kind: "request_completed",
      requestKey: key,
      group: next.group,
      remainingRequestCount: entries.length - receipts.length,
      stored,
    });
  }

  const observedAt = { ...input.cachedEvidenceObservedAt };
  for (const group of DNA_CURRENT_STATE_ACQUISITION_GROUPS) {
    const groupReceipts = checkpoint.receipts.filter((item) => {
      const entry = entries.find(
        (candidate) => requestKey(candidate) === item.requestKey,
      );
      return entry?.group === group;
    });
    if (groupReceipts.length > 0) {
      observedAt[group] = groupReceipts
        .map((item) => item.observedAt)
        .sort()
        .at(-1)!;
    }
  }
  const completion = inspectDnaCurrentStateAcquisitionCompletion({
    schedule: input.schedule,
    completedAt: attemptedAt,
    completedGroups: checkpoint.completedGroups,
    evidenceObservedAt: observedAt,
  });
  const status = completion.publishable
    ? "ready_to_publish"
    : "awaiting_evidence";
  if (checkpoint.status !== status) {
    stored = await input.checkpointRepository.save({
      expectedRevision: stored.revision,
      checkpoint: Object.freeze({
        ...checkpoint,
        status,
        pauseReason: null,
        retryNotBefore: null,
      }),
    });
  }
  return Object.freeze({
    kind: status,
    incompleteGroups: completion.incompleteGroups,
    stored,
  });
}
