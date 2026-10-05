import { createHash } from "node:crypto";

import type { RaceMode } from "@/domain/import-contract";
import type { DnaPopulationCoreLinkedHistory } from "./dna-population-core-race-link-index";

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u;
const POSITIVE_DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MODES = Object.freeze(["bike", "car", "horse"] as const);

export type DnaCompactCoreOutcomeEvidence = Readonly<{
  source: "race_merge" | "core_history_api";
  sourceCoreId: number;
  sourceRaceId: string;
  finishPosition: number;
  elapsedMilliseconds: number;
}>;

export type DnaRaceMergeOutcomeSourceRow = Readonly<{
  event_id: unknown;
  token_id: unknown;
  pos: unknown;
  time: unknown;
}>;

export type DnaPopulationCoreOutcomeGapPlan = Readonly<{
  version: 1;
  status: "complete";
  linkedCoreCount: number;
  requiredMembershipCount: number;
  coveredMembershipCount: number;
  raceMergeCoveredMembershipCount: number;
  apiCoveredMembershipCount: number;
  exactCrossSourceOverlapCount: number;
  replayDuplicateCount: number;
  extraOutcomeCount: number;
  missingMembershipCount: number;
  apiGapCoreCount: number;
  apiGapCoreIds: readonly number[];
  requiredMembershipSetSha256: string;
  coveredMembershipSetSha256: string;
  missingMembershipSetSha256: string;
  dnaProviderRequestCount: 0;
}>;

export type DnaPopulationCoreOutcomeGapPlanDependencies = Readonly<{
  linkedHistories: AsyncIterable<DnaPopulationCoreLinkedHistory>;
  loadRaceMergeOutcomes: (
    sourceCoreId: number,
  ) => Promise<readonly DnaCompactCoreOutcomeEvidence[]>;
  loadPersistedApiOutcomes: (
    sourceCoreId: number,
  ) => Promise<readonly DnaCompactCoreOutcomeEvidence[]>;
  bounds: Readonly<{
    maximumLinkedCores: number;
    maximumRequiredMemberships: number;
    maximumOutcomesPerSourcePerCore: number;
  }>;
  maximumConcurrentCoreLoads?: number;
}>;

function planError(message: string): never {
  throw new Error(`DNA population Core outcome reconciliation: ${message}`);
}

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    planError(`${field} is outside its bound`);
  }
  return value;
}

function sourceRaceId(value: unknown): string {
  const text =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (text.length < 1 || text.length > 512 || CONTROL_PATTERN.test(text)) {
    planError("source Race identity is invalid");
  }
  return text;
}

function sourceCoreId(value: unknown): number {
  const text =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!POSITIVE_INTEGER_PATTERN.test(text)) {
    planError("source Core identity is invalid");
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    planError("source Core identity is invalid");
  }
  return parsed;
}

function finishPosition(value: unknown): number {
  const text =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!POSITIVE_INTEGER_PATTERN.test(text)) {
    planError("finish position is invalid");
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    planError("finish position is invalid");
  }
  return parsed;
}

function elapsedMilliseconds(value: unknown): number {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!POSITIVE_DECIMAL_PATTERN.test(text)) {
    planError("elapsed time is invalid");
  }
  const [integerPart = "", fractionalPart = ""] = text.split(".");
  if (fractionalPart.length > 3 && !/^0*$/u.test(fractionalPart.slice(3))) {
    const seconds = Number(text);
    const scaledMilliseconds = seconds * 1_000;
    const nearestMillisecond = Math.round(scaledMilliseconds);
    if (
      !Number.isFinite(seconds) ||
      !Number.isSafeInteger(nearestMillisecond) ||
      nearestMillisecond < 1 ||
      Math.abs(scaledMilliseconds - nearestMillisecond) > 0.000001
    ) {
      planError("elapsed time precision is unsupported");
    }
    return nearestMillisecond;
  }
  const milliseconds =
    BigInt(integerPart) * 1_000n +
    BigInt((fractionalPart.slice(0, 3) + "000").slice(0, 3));
  if (milliseconds < 1n || milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    planError("elapsed time is invalid");
  }
  return Number(milliseconds);
}

function positiveElapsedMilliseconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    planError("elapsed milliseconds are invalid");
  }
  return value;
}

function mode(value: unknown): RaceMode {
  if (typeof value !== "string" || !MODES.includes(value as RaceMode)) {
    planError("linked Race mode is invalid");
  }
  return value as RaceMode;
}

function naturalKey(
  sourceCoreIdValue: number,
  sourceRaceIdValue: string,
): string {
  return `${sourceCoreIdValue}\u0000${sourceRaceIdValue}`;
}

function membershipIdentity(input: {
  sourceCoreId: number;
  sourceRaceId: string;
  mode: RaceMode;
}): string {
  return `${input.sourceCoreId}\u0000${input.sourceRaceId}\u0000${input.mode}`;
}

function sameOutcome(
  left: DnaCompactCoreOutcomeEvidence,
  right: DnaCompactCoreOutcomeEvidence,
): boolean {
  return (
    left.sourceCoreId === right.sourceCoreId &&
    left.sourceRaceId === right.sourceRaceId &&
    left.finishPosition === right.finishPosition &&
    left.elapsedMilliseconds === right.elapsedMilliseconds
  );
}

function validateOutcome(
  input: DnaCompactCoreOutcomeEvidence,
  expectedSource: DnaCompactCoreOutcomeEvidence["source"],
  requestedCoreId: number,
): DnaCompactCoreOutcomeEvidence {
  if (input.source !== expectedSource) {
    planError("outcome source authority is invalid");
  }
  const coreId = sourceCoreId(input.sourceCoreId);
  const raceId = sourceRaceId(input.sourceRaceId);
  const position = finishPosition(input.finishPosition);
  const elapsed = positiveElapsedMilliseconds(input.elapsedMilliseconds);
  if (coreId !== requestedCoreId) {
    planError("outcome changed requested Core identity");
  }
  return Object.freeze({
    source: expectedSource,
    sourceCoreId: coreId,
    sourceRaceId: raceId,
    finishPosition: position,
    elapsedMilliseconds: elapsed,
  });
}

export function adaptDnaRaceMergeOutcomeSourceRow(
  row: DnaRaceMergeOutcomeSourceRow,
): DnaCompactCoreOutcomeEvidence {
  return Object.freeze({
    source: "race_merge" as const,
    sourceCoreId: sourceCoreId(row.token_id),
    sourceRaceId: sourceRaceId(row.event_id),
    finishPosition: finishPosition(row.pos),
    elapsedMilliseconds: elapsedMilliseconds(row.time),
  });
}

type PreloadedCoreHistory = Readonly<{
  history: DnaPopulationCoreLinkedHistory;
  sourceCoreId: number;
  raceMergeOutcomes: readonly DnaCompactCoreOutcomeEvidence[];
  persistedApiOutcomes: readonly DnaCompactCoreOutcomeEvidence[];
}>;

type PreloadResult =
  | Readonly<{ status: "fulfilled"; value: PreloadedCoreHistory }>
  | Readonly<{ status: "rejected"; reason: unknown }>;

function preloadCoreHistory(
  input: DnaPopulationCoreOutcomeGapPlanDependencies,
  history: DnaPopulationCoreLinkedHistory,
): Promise<PreloadResult> {
  const coreId = sourceCoreId(history.sourceCoreId);
  return Promise.all([
    input.loadRaceMergeOutcomes(coreId),
    input.loadPersistedApiOutcomes(coreId),
  ]).then(
    ([raceMergeOutcomes, persistedApiOutcomes]) =>
      Object.freeze({
        status: "fulfilled" as const,
        value: Object.freeze({
          history,
          sourceCoreId: coreId,
          raceMergeOutcomes,
          persistedApiOutcomes,
        }),
      }),
    (reason: unknown) =>
      Object.freeze({
        status: "rejected" as const,
        reason,
      }),
  );
}

async function* preloadCoreHistories(
  input: DnaPopulationCoreOutcomeGapPlanDependencies,
  maximumConcurrentCoreLoads: number,
): AsyncIterable<PreloadedCoreHistory> {
  const queue: Promise<PreloadResult>[] = [];
  const next = async (): Promise<PreloadedCoreHistory> => {
    const pending = queue.shift();
    if (pending === undefined) {
      planError("preload queue is unexpectedly empty");
    }
    const result = await pending;
    if (result.status === "rejected") throw result.reason;
    return result.value;
  };

  for await (const history of input.linkedHistories) {
    queue.push(preloadCoreHistory(input, history));
    if (queue.length >= maximumConcurrentCoreLoads) {
      yield await next();
    }
  }
  while (queue.length > 0) {
    yield await next();
  }
}

/**
 * Reconciles performance outcomes without making any DNA request.
 *
 * Required Race/Core membership comes from the canonical Race authority.
 * Owner-supplied/retained Race Merge outcomes are preferred first because they
 * already contain Race ID + Core ID + finish position + elapsed time. Existing
 * persisted Core-history API outcomes fill Race Merge gaps. Only Cores with at
 * least one still-missing required membership are returned for later
 * /fbike/i/hraces acquisition.
 */
export async function planDnaPopulationCoreOutcomeGapAcquisition(
  input: DnaPopulationCoreOutcomeGapPlanDependencies,
): Promise<DnaPopulationCoreOutcomeGapPlan> {
  const maximumLinkedCores = positiveBound(
    input.bounds.maximumLinkedCores,
    "maximumLinkedCores",
    1_000_000,
  );
  const maximumRequiredMemberships = positiveBound(
    input.bounds.maximumRequiredMemberships,
    "maximumRequiredMemberships",
    100_000_000,
  );
  const maximumOutcomesPerSourcePerCore = positiveBound(
    input.bounds.maximumOutcomesPerSourcePerCore,
    "maximumOutcomesPerSourcePerCore",
    1_000_000,
  );
  const maximumConcurrentCoreLoads = positiveBound(
    input.maximumConcurrentCoreLoads ?? 1,
    "maximumConcurrentCoreLoads",
    128,
  );
  const requiredDigest = createHash("sha256");
  const coveredDigest = createHash("sha256");
  const missingDigest = createHash("sha256");
  const apiGapCoreIds: number[] = [];

  let linkedCoreCount = 0;
  let requiredMembershipCount = 0;
  let coveredMembershipCount = 0;
  let raceMergeCoveredMembershipCount = 0;
  let apiCoveredMembershipCount = 0;
  let exactCrossSourceOverlapCount = 0;
  let replayDuplicateCount = 0;
  let extraOutcomeCount = 0;
  let missingMembershipCount = 0;
  let previousCoreId = 0;

  for await (const preloaded of preloadCoreHistories(
    input,
    maximumConcurrentCoreLoads,
  )) {
    const history = preloaded.history;
    const coreId = preloaded.sourceCoreId;
    if (coreId <= previousCoreId) {
      planError("linked Core history ordering is invalid");
    }
    previousCoreId = coreId;
    linkedCoreCount += 1;
    if (linkedCoreCount > maximumLinkedCores) {
      planError("linked Core count exceeds its bound");
    }

    const required = new Map<string, RaceMode>();
    for (const candidateMode of MODES) {
      const raceMode = mode(candidateMode);
      const raceIds = history.raceIdsByMode[raceMode];
      for (const rawRaceId of raceIds) {
        const raceId = sourceRaceId(rawRaceId);
        if (required.has(raceId)) {
          planError("one Race is linked to the same Core more than once");
        }
        required.set(raceId, raceMode);
        requiredMembershipCount += 1;
        if (requiredMembershipCount > maximumRequiredMemberships) {
          planError("required membership count exceeds its bound");
        }
        requiredDigest.update(
          `${membershipIdentity({
            sourceCoreId: coreId,
            sourceRaceId: raceId,
            mode: raceMode,
          })}\n`,
          "utf8",
        );
      }
    }
    if (required.size !== history.raceCount) {
      planError("linked Core Race count does not reconcile");
    }

    const selected = new Map<string, DnaCompactCoreOutcomeEvidence>();
    const raceMergeSeen = new Map<string, DnaCompactCoreOutcomeEvidence>();

    const raceMergeOutcomes = preloaded.raceMergeOutcomes;
    if (raceMergeOutcomes.length > maximumOutcomesPerSourcePerCore) {
      planError("Race Merge outcomes exceed the per-Core bound");
    }
    for (const rawOutcome of raceMergeOutcomes) {
      const outcome = validateOutcome(rawOutcome, "race_merge", coreId);
      const key = naturalKey(coreId, outcome.sourceRaceId);
      const previous = raceMergeSeen.get(key);
      if (previous !== undefined) {
        if (!sameOutcome(previous, outcome)) {
          planError("Race Merge replay conflicts on one Core/Race outcome");
        }
        replayDuplicateCount += 1;
        continue;
      }
      raceMergeSeen.set(key, outcome);
      if (!required.has(outcome.sourceRaceId)) {
        extraOutcomeCount += 1;
        continue;
      }
      selected.set(key, outcome);
      raceMergeCoveredMembershipCount += 1;
    }

    const apiSeen = new Map<string, DnaCompactCoreOutcomeEvidence>();
    const persistedApiOutcomes = preloaded.persistedApiOutcomes;
    if (persistedApiOutcomes.length > maximumOutcomesPerSourcePerCore) {
      planError("API outcomes exceed the per-Core bound");
    }
    for (const rawOutcome of persistedApiOutcomes) {
      const outcome = validateOutcome(rawOutcome, "core_history_api", coreId);
      const key = naturalKey(coreId, outcome.sourceRaceId);
      const previousApi = apiSeen.get(key);
      if (previousApi !== undefined) {
        if (!sameOutcome(previousApi, outcome)) {
          planError("API replay conflicts on one Core/Race outcome");
        }
        replayDuplicateCount += 1;
        continue;
      }
      apiSeen.set(key, outcome);
      if (!required.has(outcome.sourceRaceId)) {
        extraOutcomeCount += 1;
        continue;
      }
      const previous = selected.get(key);
      if (previous !== undefined) {
        if (!sameOutcome(previous, outcome)) {
          planError("Race Merge and API outcomes conflict");
        }
        exactCrossSourceOverlapCount += 1;
        continue;
      }
      selected.set(key, outcome);
      apiCoveredMembershipCount += 1;
    }

    let coreMissing = 0;
    for (const [raceId, raceMode] of required.entries()) {
      const key = naturalKey(coreId, raceId);
      const outcome = selected.get(key);
      const identity = membershipIdentity({
        sourceCoreId: coreId,
        sourceRaceId: raceId,
        mode: raceMode,
      });
      if (outcome === undefined) {
        missingMembershipCount += 1;
        coreMissing += 1;
        missingDigest.update(`${identity}\n`, "utf8");
      } else {
        coveredMembershipCount += 1;
        coveredDigest.update(
          `${identity}\u0000${outcome.finishPosition}\u0000${outcome.elapsedMilliseconds}\n`,
          "utf8",
        );
      }
    }
    if (coreMissing > 0) apiGapCoreIds.push(coreId);
  }

  if (linkedCoreCount < 1 || requiredMembershipCount < 1) {
    planError("linked population outcome authority is empty");
  }
  if (
    coveredMembershipCount + missingMembershipCount !==
    requiredMembershipCount
  ) {
    planError("outcome coverage does not reconcile");
  }
  if (
    raceMergeCoveredMembershipCount + apiCoveredMembershipCount !==
    coveredMembershipCount
  ) {
    planError("selected outcome provenance does not reconcile");
  }

  return Object.freeze({
    version: 1 as const,
    status: "complete" as const,
    linkedCoreCount,
    requiredMembershipCount,
    coveredMembershipCount,
    raceMergeCoveredMembershipCount,
    apiCoveredMembershipCount,
    exactCrossSourceOverlapCount,
    replayDuplicateCount,
    extraOutcomeCount,
    missingMembershipCount,
    apiGapCoreCount: apiGapCoreIds.length,
    apiGapCoreIds: Object.freeze(apiGapCoreIds),
    requiredMembershipSetSha256: requiredDigest.digest("hex"),
    coveredMembershipSetSha256: coveredDigest.digest("hex"),
    missingMembershipSetSha256: missingDigest.digest("hex"),
    dnaProviderRequestCount: 0 as const,
  });
}
