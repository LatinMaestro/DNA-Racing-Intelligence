import type {
  DnaCurrentStateEndpoint,
  DnaCurrentStateRequest,
  DnaCurrentStateSyncPlan,
} from "./dna-open-lab-current-state-sync-plan";
import type { DnaSyncInterruptionReason } from "./dna-open-lab-last-good-publication";
import { DnaOpenLabApiError } from "./dna-open-lab-v1-client";
import { DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE } from "./dna-open-lab-request-budget";

export const DNA_CURRENT_STATE_ACQUISITION_GROUPS = Object.freeze([
  "race_activity",
  "token_prices",
  "vault_identity",
  "core_current_state",
  "splice_arena",
] as const);

export type DnaCurrentStateAcquisitionGroup =
  (typeof DNA_CURRENT_STATE_ACQUISITION_GROUPS)[number];

export const DNA_CURRENT_STATE_ACQUISITION_INTERVAL_MILLISECONDS =
  Object.freeze({
    race_activity: 24 * 60 * 60_000,
    token_prices: 24 * 60 * 60_000,
    vault_identity: 24 * 60 * 60_000,
    core_current_state: 24 * 60 * 60_000,
    splice_arena: 24 * 60 * 60_000,
  } satisfies Readonly<Record<DnaCurrentStateAcquisitionGroup, number>>);

export type DnaCurrentStateAcquisitionCheckpoint = Readonly<{
  completedAt: string;
}>;

export type DnaScheduledCurrentStateRequest = Readonly<{
  group: DnaCurrentStateAcquisitionGroup;
  request: DnaCurrentStateRequest;
}>;

export type DnaCurrentStateAcquisitionSchedule = Readonly<{
  evaluatedAt: string;
  status: "ready" | "idle" | "retry_blocked";
  completionScope: "all_current_state" | "scheduled_requests_only";
  maximumAggregateRequestsPerMinute: typeof DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE;
  dueGroups: readonly DnaCurrentStateAcquisitionGroup[];
  requestBatches: readonly (readonly DnaScheduledCurrentStateRequest[])[];
  scheduledRequestCount: number;
  nextEvaluationAt: string;
  onDemandPairRequestCount: number;
}>;

export type DnaCurrentStateAcquisitionCompletion = Readonly<{
  publishable: boolean;
  incompleteGroups: readonly DnaCurrentStateAcquisitionGroup[];
}>;

export type DnaCurrentStateAcquisitionRecovery = Readonly<{
  reason: DnaSyncInterruptionReason;
  retryAfterSeconds: number | null;
  retryRequestImmediately: false;
  preserveLastGood: true;
  catchUpRequired: true;
}>;

const endpointGroups: Readonly<
  Record<
    DnaCurrentStateEndpoint,
    DnaCurrentStateAcquisitionGroup | "on_demand_pair"
  >
> = Object.freeze({
  "vault.info": "vault_identity",
  "vault.cores_full": "vault_identity",
  "vault.tier_badge": "vault_identity",
  "vault.recent_races": "vault_identity",
  "races.active": "race_activity",
  "races.fills": "race_activity",
  "cores.info_bulk": "core_current_state",
  "cores.racing_stats_bulk": "core_current_state",
  "cores.power_bulk": "core_current_state",
  "cores.listing_price_bulk": "core_current_state",
  "cores.attached_assets_bulk": "core_current_state",
  "cores.owner_bulk": "core_current_state",
  "cores.stamina_bulk": "core_current_state",
  "cores.splicing_info_bulk": "core_current_state",
  "tokens.prices": "token_prices",
  "splice.arena": "splice_arena",
  "splice.pair_info": "on_demand_pair",
  "splice.pair_validate": "on_demand_pair",
});

function acquisitionError(message: string): never {
  throw new Error(`DNA Open Lab current-state acquisition cadence: ${message}`);
}

function timestamp(value: string, field: string): string {
  const normalized = value.trim();
  const parsed = new Date(normalized);
  if (
    normalized.length < 1 ||
    Number.isNaN(parsed.getTime()) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    )
  ) {
    acquisitionError(`${field} must be a timezone-qualified ISO timestamp`);
  }
  return parsed.toISOString();
}

function endpointGroup(
  request: DnaCurrentStateRequest,
): DnaCurrentStateAcquisitionGroup | "on_demand_pair" {
  const group = endpointGroups[request.endpoint];
  if (group === undefined) {
    return acquisitionError(
      `endpoint ${request.endpoint} has no cadence authority`,
    );
  }
  return group;
}

function requestBatches(
  requests: readonly DnaScheduledCurrentStateRequest[],
): readonly (readonly DnaScheduledCurrentStateRequest[])[] {
  const result: (readonly DnaScheduledCurrentStateRequest[])[] = [];
  for (
    let offset = 0;
    offset < requests.length;
    offset += DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
  ) {
    result.push(
      Object.freeze(
        requests.slice(offset, offset + DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE),
      ),
    );
  }
  return Object.freeze(result);
}

function allRequests(
  plan: DnaCurrentStateSyncPlan,
): readonly DnaCurrentStateRequest[] {
  return Object.freeze([...plan.bootstrap, ...plan.hydrate]);
}

/**
 * Builds a deterministic daily acquisition schedule. The shared 24-hour
 * interval is the owner's zero-ongoing-cost freshness policy, not undocumented
 * DNA endpoint semantics. All recurring families therefore become due
 * together and publish as one complete valid generation.
 * Batches are capped at the same conservative 30-request aggregate allowance
 * as the client pool; execution must still pass through that pool so headers,
 * Retry-After and a lower observed allowance remain authoritative.
 *
 * Pair previews/validation are intentionally on-demand and never enter the
 * recurring current-state crawl.
 */
export function createDnaCurrentStateAcquisitionSchedule(input: {
  evaluatedAt: string;
  plan: DnaCurrentStateSyncPlan;
  checkpoints?: Partial<
    Record<
      DnaCurrentStateAcquisitionGroup,
      DnaCurrentStateAcquisitionCheckpoint
    >
  >;
  retryNotBefore?: string | null;
}): DnaCurrentStateAcquisitionSchedule {
  const evaluatedAt = timestamp(input.evaluatedAt, "evaluatedAt");
  const evaluatedMilliseconds = Date.parse(evaluatedAt);
  const retryNotBefore =
    input.retryNotBefore === null || input.retryNotBefore === undefined
      ? null
      : timestamp(input.retryNotBefore, "retryNotBefore");

  const checkpointMilliseconds = new Map<
    DnaCurrentStateAcquisitionGroup,
    number
  >();
  for (const group of DNA_CURRENT_STATE_ACQUISITION_GROUPS) {
    const checkpoint = input.checkpoints?.[group];
    if (checkpoint === undefined) continue;
    const completedAt = timestamp(
      checkpoint.completedAt,
      `${group}.completedAt`,
    );
    const completedMilliseconds = Date.parse(completedAt);
    if (completedMilliseconds > evaluatedMilliseconds) {
      acquisitionError(`${group}.completedAt cannot be in the future`);
    }
    checkpointMilliseconds.set(group, completedMilliseconds);
  }

  const onDemandPairRequestCount = allRequests(input.plan).filter(
    (request) => endpointGroup(request) === "on_demand_pair",
  ).length;

  if (
    retryNotBefore !== null &&
    Date.parse(retryNotBefore) > evaluatedMilliseconds
  ) {
    return Object.freeze({
      evaluatedAt,
      status: "retry_blocked",
      completionScope: "all_current_state",
      maximumAggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      dueGroups: Object.freeze([]),
      requestBatches: Object.freeze([]),
      scheduledRequestCount: 0,
      nextEvaluationAt: retryNotBefore,
      onDemandPairRequestCount,
    });
  }

  const completeRefreshDue = DNA_CURRENT_STATE_ACQUISITION_GROUPS.some(
    (group) => {
      const completed = checkpointMilliseconds.get(group);
      return (
        completed === undefined ||
        evaluatedMilliseconds - completed >=
          DNA_CURRENT_STATE_ACQUISITION_INTERVAL_MILLISECONDS[group]
      );
    },
  );
  const dueGroups = completeRefreshDue
    ? [...DNA_CURRENT_STATE_ACQUISITION_GROUPS]
    : [];
  const dueSet = new Set(dueGroups);
  const scheduled = allRequests(input.plan)
    .map((request) => ({ group: endpointGroup(request), request }))
    .filter(
      (entry): entry is DnaScheduledCurrentStateRequest =>
        entry.group !== "on_demand_pair" && dueSet.has(entry.group),
    )
    .map((entry) => Object.freeze(entry));

  const nextDueMilliseconds = Math.min(
    ...DNA_CURRENT_STATE_ACQUISITION_GROUPS.map((group) => {
      const completed = checkpointMilliseconds.get(group);
      return completed === undefined
        ? evaluatedMilliseconds
        : completed +
            DNA_CURRENT_STATE_ACQUISITION_INTERVAL_MILLISECONDS[group];
    }),
  );

  return Object.freeze({
    evaluatedAt,
    status: dueGroups.length > 0 ? "ready" : "idle",
    completionScope: "all_current_state",
    maximumAggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
    dueGroups: Object.freeze(dueGroups),
    requestBatches: requestBatches(scheduled),
    scheduledRequestCount: scheduled.length,
    nextEvaluationAt: new Date(
      Math.max(evaluatedMilliseconds, nextDueMilliseconds),
    ).toISOString(),
    onDemandPairRequestCount,
  });
}

/**
 * A cycle may publish only when every due group completed during this attempt
 * and every current-state group has cached-or-refreshed evidence no newer than
 * the completion time. Callers that acquire after schedule evaluation must pass
 * that later completion time explicitly. A failed due group therefore
 * preserves the prior last-good generation instead of publishing a mixed
 * partial refresh.
 */
export function inspectDnaCurrentStateAcquisitionCompletion(input: {
  schedule: DnaCurrentStateAcquisitionSchedule;
  completedAt?: string;
  completedGroups: readonly DnaCurrentStateAcquisitionGroup[];
  evidenceObservedAt: Partial<Record<DnaCurrentStateAcquisitionGroup, string>>;
}): DnaCurrentStateAcquisitionCompletion {
  const completedAt =
    input.completedAt === undefined
      ? input.schedule.evaluatedAt
      : timestamp(input.completedAt, "completedAt");
  const evaluatedMilliseconds = Date.parse(completedAt);
  if (evaluatedMilliseconds < Date.parse(input.schedule.evaluatedAt)) {
    acquisitionError("completedAt cannot precede the schedule evaluation");
  }
  const completed = new Set(input.completedGroups);
  for (const group of completed) {
    if (!DNA_CURRENT_STATE_ACQUISITION_GROUPS.includes(group)) {
      acquisitionError(`completed group ${group} is unsupported`);
    }
  }

  const requiredEvidenceGroups =
    input.schedule.completionScope === "scheduled_requests_only"
      ? input.schedule.dueGroups
      : DNA_CURRENT_STATE_ACQUISITION_GROUPS;

  const incompleteGroups = requiredEvidenceGroups.filter((group) => {
    const observedAt = input.evidenceObservedAt[group];
    if (observedAt === undefined) return true;
    const normalized = timestamp(observedAt, `${group}.evidenceObservedAt`);
    if (Date.parse(normalized) > evaluatedMilliseconds) {
      acquisitionError(`${group} evidence cannot follow the completion time`);
    }
    return input.schedule.dueGroups.includes(group) && !completed.has(group);
  });

  return Object.freeze({
    publishable: incompleteGroups.length === 0,
    incompleteGroups: Object.freeze(incompleteGroups),
  });
}

/** Maps one failed attempt to a non-destructive last-good pause directive. */
export function classifyDnaCurrentStateAcquisitionFailure(input: {
  error: unknown;
  operation: "eligibility_probe" | "current_state_request";
}): DnaCurrentStateAcquisitionRecovery {
  let reason: DnaSyncInterruptionReason = "api_unavailable";
  let retryAfterSeconds: number | null = null;

  if (input.error instanceof DnaOpenLabApiError) {
    retryAfterSeconds =
      input.error.rateLimit?.retryAfterSeconds ??
      (input.error.rateLimit?.remaining === 0
        ? input.error.rateLimit.resetSeconds
        : null);
    if (input.error.kind === "rate_limited") {
      reason = "rate_limited";
    } else if (
      input.operation === "eligibility_probe" ||
      input.error.httpStatus === 401 ||
      input.error.httpStatus === 403
    ) {
      reason = "api_ineligible";
    } else if (
      input.error.kind === "invalid_configuration" ||
      input.error.kind === "invalid_request" ||
      input.error.kind === "malformed_response" ||
      (input.error.kind === "api_error" &&
        input.error.httpStatus !== null &&
        input.error.httpStatus < 500)
    ) {
      reason = "invalid_payload";
    }
  }

  return Object.freeze({
    reason,
    retryAfterSeconds,
    retryRequestImmediately: false,
    preserveLastGood: true,
    catchUpRequired: true,
  });
}
