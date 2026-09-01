import {
  crawlDnaFinishedRaceWindows,
  DNA_FINISHED_RACE_WINDOW_LIMIT,
} from "./dna-open-lab-finished-race-window-crawler";
import type {
  DnaOpenLabP5FirstBackfillFamilyInventoryResult,
  DnaOpenLabP5FirstBackfillInventoryRequest,
} from "./dna-open-lab-p5-first-backfill-inventory-runner";
import {
  DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES,
  type DnaOpenLabP5FirstBackfillAuthorityClass,
  type DnaOpenLabP5FirstBackfillSourceFamily,
} from "./dna-open-lab-p5-first-backfill-measurement";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";
import {
  DnaOpenLabApiError,
  type DnaOpenLabClient,
  type DnaOpenLabRecord,
  type DnaOpenLabResponse,
  type DnaRaceDocument,
  type DnaRaceIdentifier,
  type DnaSpliceArenaResult,
  type DnaVaultCore,
} from "./dna-open-lab-v1-client";
/*
 * A persistently malformed envelope may cover a time window rather than one
 * race. Subdivide that window instead of inventing a partial race or silently
 * omitting as many as the endpoint limit permits.
 */
function splitMalformedFinishedRaceWindow(error: unknown): boolean {
  return (
    error instanceof DnaOpenLabApiError && error.kind === "malformed_response"
  );
}

const CORE_BULK_LIMIT = 20;
const RACE_BULK_LIMIT = 20;
const MAXIMUM_ARENA_PAGES_PER_MODE = 512;
const MAXIMUM_OBSERVED_BYTES = 8 * 1024 * 1024 * 1024;
const RACE_MODES = Object.freeze(["bike", "car", "horse"] as const);

const FAMILY_AUTHORITY = Object.freeze({
  finished_races: "available_paginated_history_at_cutoff",
  race_activity: "current_state_only",
  token_prices: "current_state_only",
  vault_identity: "bounded_recent_state_only",
  core_current_state: "current_state_only",
  splice_arena: "current_state_only",
} satisfies Readonly<
  Record<
    DnaOpenLabP5FirstBackfillSourceFamily,
    DnaOpenLabP5FirstBackfillAuthorityClass
  >
>);

const CORE_ENDPOINTS = Object.freeze([
  "cores.info_bulk",
  "cores.racing_stats_bulk",
  "cores.power_bulk",
  "cores.listing_price_bulk",
  "cores.attached_assets_bulk",
  "cores.owner_bulk",
  "cores.stamina_bulk",
  "cores.splicing_info_bulk",
] as const);

type CoreEndpoint = (typeof CORE_ENDPOINTS)[number];

export type DnaOpenLabP5FirstBackfillEndpointObservation = Readonly<{
  endpoint: string;
  requestCount: number;
  responseBytes: number;
  responseRecordCount: number;
}>;

export type DnaOpenLabP5FirstBackfillFamilyObservation = Readonly<{
  family: DnaOpenLabP5FirstBackfillSourceFamily;
  authorityClass: DnaOpenLabP5FirstBackfillAuthorityClass;
  authorityCutoffAt: string;
  observedAt: string;
  observedSourceRecordCount: number;
  observedApiRequestCount: number;
  observedResponseBytes: number;
  maximumObservedResponseBytes: number;
  unresolvedIdentityObservationUpperBound: number;
  terminalUnitCount: number;
  splitCount: number;
  endpointObservations: readonly DnaOpenLabP5FirstBackfillEndpointObservation[];
  aggregateEvidenceSha256: string;
}>;

export type DnaOpenLabP5FirstBackfillFamilyUpperBounds = Readonly<{
  sourceRecordUpperBound: number;
  apiRequestUpperBound: number;
  retainedR2BytesUpperBound: number;
  classAOperationsUpperBound: number;
  classBOperationsUpperBound: number;
  neonIncrementalBytesUpperBound: number;
  unresolvedIdentityObservationUpperBound: number;
}>;

type EndpointCounter = {
  requestCount: number;
  responseBytes: number;
  responseRecordCount: number;
};

type FamilyCounter = {
  requestCount: number;
  responseBytes: number;
  maximumResponseBytes: number;
  sourceRecordCount: number;
  endpoints: Map<string, EndpointCounter>;
};

function adapterError(): never {
  throw new Error("DNA Open Lab P5 first backfill family adapter failed.");
}

function timestamp(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    ) ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    adapterError();
  }
  return new Date(normalized).toISOString();
}

function requiredText(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 512) adapterError();
  return normalized;
}

function count(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) adapterError();
  return value;
}

function add(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) adapterError();
  return result;
}

function responseBytes(value: unknown): number {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    adapterError();
  }
  if (json === undefined) adapterError();
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > MAXIMUM_OBSERVED_BYTES) adapterError();
  return bytes;
}

function records(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) adapterError();
  return value;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    adapterError();
  }
  return value as Readonly<Record<string, unknown>>;
}

function positiveCoreId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) adapterError();
  return Number(value);
}

function raceIdentity(value: DnaRaceIdentifier): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) adapterError();
    return String(value);
  }
  return requiredText(value);
}

function uniqueRaceIds(value: unknown): readonly DnaRaceIdentifier[] {
  const seen = new Set<string>();
  return records(value).map((entry) => {
    const rid = record(entry).rid;
    if (typeof rid !== "string" && typeof rid !== "number") adapterError();
    const identity = raceIdentity(rid);
    if (seen.has(identity)) adapterError();
    seen.add(identity);
    return rid;
  });
}

function batches<T>(values: readonly T[], size: number): readonly T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function counter(): FamilyCounter {
  return {
    requestCount: 0,
    responseBytes: 0,
    maximumResponseBytes: 0,
    sourceRecordCount: 0,
    endpoints: new Map(),
  };
}

function note(
  family: FamilyCounter,
  endpoint: string,
  result: unknown,
  sourceRecordCount: number,
): void {
  const bytes = responseBytes(result);
  const records = count(sourceRecordCount);
  family.requestCount = add(family.requestCount, 1);
  family.responseBytes = add(family.responseBytes, bytes);
  family.maximumResponseBytes = Math.max(family.maximumResponseBytes, bytes);
  family.sourceRecordCount = add(family.sourceRecordCount, records);
  const endpointCounter = family.endpoints.get(endpoint) ?? {
    requestCount: 0,
    responseBytes: 0,
    responseRecordCount: 0,
  };
  endpointCounter.requestCount = add(endpointCounter.requestCount, 1);
  endpointCounter.responseBytes = add(endpointCounter.responseBytes, bytes);
  endpointCounter.responseRecordCount = add(
    endpointCounter.responseRecordCount,
    records,
  );
  family.endpoints.set(endpoint, endpointCounter);
}

async function acquire<T>(input: {
  request: DnaOpenLabP5FirstBackfillInventoryRequest;
  scope: "vault" | "races" | "cores" | "tokens" | "splice";
  endpoint: string;
  counter: FamilyCounter;
  sourceRecordCount: (value: T) => number;
  execute: (
    client: DnaOpenLabClient,
    laneId: string,
  ) => Promise<DnaOpenLabResponse<T>>;
}): Promise<T> {
  const result = await input.request<T>({
    scope: input.scope,
    request: input.execute,
  });
  note(input.counter, input.endpoint, result, input.sourceRecordCount(result));
  return result;
}

function endpointObservations(
  endpoints: ReadonlyMap<string, EndpointCounter>,
): readonly DnaOpenLabP5FirstBackfillEndpointObservation[] {
  return Object.freeze(
    [...endpoints.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([endpoint, value]) => Object.freeze({ endpoint, ...value })),
  );
}

function coreResultIds(value: unknown): readonly number[] {
  const seen = new Set<number>();
  return records(value).map((entry) => {
    const hid = positiveCoreId(record(entry).hid);
    if (seen.has(hid)) adapterError();
    seen.add(hid);
    return hid;
  });
}

function invokeCoreEndpoint(input: {
  endpoint: CoreEndpoint;
  client: DnaOpenLabClient;
  hids: readonly number[];
}): Promise<DnaOpenLabResponse<readonly DnaOpenLabRecord<object>[]>> {
  switch (input.endpoint) {
    case "cores.info_bulk":
      return input.client.coreInfoBulk(input.hids);
    case "cores.racing_stats_bulk":
      return input.client.coreRacingStatsBulk(input.hids);
    case "cores.power_bulk":
      return input.client.corePowerBulk(input.hids);
    case "cores.listing_price_bulk":
      return input.client.coreListingPriceBulk(input.hids);
    case "cores.attached_assets_bulk":
      return input.client.coreAttachedAssetsBulk(input.hids);
    case "cores.owner_bulk":
      return input.client.coreOwnerBulk(input.hids);
    case "cores.stamina_bulk":
      return input.client.coreStaminaBulk(input.hids);
    case "cores.splicing_info_bulk":
      return input.client.coreSplicingInfoBulk(input.hids);
  }
}

/**
 * Builds the endpoint-aware, read-only half of the P5 complete-inventory
 * measurement. The returned callback is stateful by design and accepts only
 * the fixed six-family order used by the guarded inventory runner.
 *
 * Projection of retained R2, operation and Neon upper bounds remains an
 * explicit injected policy. The adapter measures actual terminal endpoint
 * coverage and cannot silently invent storage multipliers.
 */
export function createDnaOpenLabP5FirstBackfillFamilyAdapter(input: {
  vault: string;
  finishedRaceHistoryStartAt: string;
  authorityCutoffAt: string;
  now?: () => string;
  projectUpperBounds: (
    observation: DnaOpenLabP5FirstBackfillFamilyObservation,
  ) => DnaOpenLabP5FirstBackfillFamilyUpperBounds;
}): Readonly<{
  measureFamily: (input: {
    family: DnaOpenLabP5FirstBackfillSourceFamily;
    request: DnaOpenLabP5FirstBackfillInventoryRequest;
  }) => Promise<DnaOpenLabP5FirstBackfillFamilyInventoryResult>;
}> {
  const vault = requiredText(input.vault);
  const historyStartAt = timestamp(input.finishedRaceHistoryStartAt);
  const authorityCutoffAt = timestamp(input.authorityCutoffAt);
  const now = input.now ?? (() => new Date().toISOString());
  if (Date.parse(historyStartAt) > Date.parse(authorityCutoffAt))
    adapterError();

  const familyOrder = DNA_OPEN_LAB_P5_FIRST_BACKFILL_SOURCE_FAMILIES;
  let nextFamilyIndex = 0;
  let ownedCoreIds: readonly number[] | null = null;

  const measureFamily = async (familyInput: {
    family: DnaOpenLabP5FirstBackfillSourceFamily;
    request: DnaOpenLabP5FirstBackfillInventoryRequest;
  }): Promise<DnaOpenLabP5FirstBackfillFamilyInventoryResult> => {
    const { family, request } = familyInput;
    if (family !== familyOrder[nextFamilyIndex]) adapterError();
    nextFamilyIndex += 1;
    const observed = counter();
    let terminalUnitCount = 0;
    let splitCount = 0;
    let unresolvedIdentityObservationUpperBound = 0;

    if (family === "finished_races") {
      const crawl = await crawlDnaFinishedRaceWindows({
        startTime: historyStartAt,
        endTime: authorityCutoffAt,
        fetchWindow: async (window) =>
          acquire({
            request,
            scope: "races",
            endpoint: "races.finished",
            counter: observed,
            sourceRecordCount: (value: readonly DnaRaceDocument[]) =>
              records(value).length,
            execute: (client) => client.racesFinished(window),
          }),
        invalidRecordHandling: "count_as_unresolved_observation",
        splitOnFetchError: splitMalformedFinishedRaceWindow,
      });
      observed.sourceRecordCount = crawl.races.length;
      terminalUnitCount = crawl.completedWindows.length;
      splitCount = crawl.splitCount;
      unresolvedIdentityObservationUpperBound =
        crawl.unresolvedIdentityObservationUpperBound;
    } else if (family === "race_activity") {
      const active = await acquire({
        request,
        scope: "races",
        endpoint: "races.active",
        counter: observed,
        sourceRecordCount: (value) => records(value).length,
        execute: (client) => client.racesActive(),
      });
      const raceIds = uniqueRaceIds(active);
      for (const batch of batches(raceIds, RACE_BULK_LIMIT)) {
        const fills = await acquire({
          request,
          scope: "races",
          endpoint: "races.fills",
          counter: observed,
          sourceRecordCount: (value) => records(value).length,
          execute: (client) => client.raceFills(batch),
        });
        const expected = batch.map(raceIdentity).sort();
        const returned = uniqueRaceIds(fills).map(raceIdentity).sort();
        if (JSON.stringify(returned) !== JSON.stringify(expected)) {
          adapterError();
        }
      }
      terminalUnitCount = 1 + Math.ceil(raceIds.length / RACE_BULK_LIMIT);
    } else if (family === "token_prices") {
      await acquire({
        request,
        scope: "tokens",
        endpoint: "tokens.prices",
        counter: observed,
        sourceRecordCount: (value) => {
          record(value);
          return 1;
        },
        execute: (client) => client.tokenPrices(),
      });
      terminalUnitCount = 1;
    } else if (family === "vault_identity") {
      await acquire({
        request,
        scope: "vault",
        endpoint: "vault.info",
        counter: observed,
        sourceRecordCount: (value) => {
          record(value);
          return 1;
        },
        execute: (client) => client.vaultInfo(vault),
      });
      const cores = await acquire({
        request,
        scope: "vault",
        endpoint: "vault.cores_full",
        counter: observed,
        sourceRecordCount: (value) => records(value).length,
        execute: (client) => client.vaultCoresFull(vault),
      });
      await acquire({
        request,
        scope: "vault",
        endpoint: "vault.tier_badge",
        counter: observed,
        sourceRecordCount: (value) => {
          record(value);
          return 1;
        },
        execute: (client) => client.vaultTierBadge(vault),
      });
      const recentRaces = await acquire({
        request,
        scope: "vault",
        endpoint: "vault.recent_races",
        counter: observed,
        sourceRecordCount: (value) => records(value).length,
        execute: (client) => client.vaultRecentRaces(vault),
      });
      uniqueRaceIds(recentRaces);
      const seen = new Set<number>();
      ownedCoreIds = Object.freeze(
        records(cores)
          .map((entry) => positiveCoreId((entry as DnaVaultCore).hid))
          .sort((left, right) => left - right)
          .map((hid) => {
            if (seen.has(hid)) adapterError();
            seen.add(hid);
            return hid;
          }),
      );
      terminalUnitCount = 4;
    } else if (family === "core_current_state") {
      if (ownedCoreIds === null || ownedCoreIds.length < 1) adapterError();
      const coreBatches = batches(ownedCoreIds, CORE_BULK_LIMIT);
      for (const batch of coreBatches) {
        const batchSet = new Set(batch);
        for (const endpoint of CORE_ENDPOINTS) {
          const result = await acquire({
            request,
            scope: "cores",
            endpoint,
            counter: observed,
            sourceRecordCount: (value) => records(value).length,
            execute: (client) =>
              invokeCoreEndpoint({ endpoint, client, hids: batch }),
          });
          const returnedCoreIds = coreResultIds(result);
          if (
            returnedCoreIds.length !== batch.length ||
            returnedCoreIds.some((hid) => !batchSet.has(hid))
          ) {
            adapterError();
          }
        }
      }
      terminalUnitCount = coreBatches.length * CORE_ENDPOINTS.length;
    } else if (family === "splice_arena") {
      for (const mode of RACE_MODES) {
        const seenCoreIds = new Set<number>();
        let expectedLimit: number | null = null;
        let page = 1;
        while (true) {
          const result = await acquire({
            request,
            scope: "splice",
            endpoint: `splice.arena.${mode}`,
            counter: observed,
            sourceRecordCount: (value: DnaSpliceArenaResult) =>
              records(record(value).cores).length,
            execute: (client) =>
              client.spliceArena({ filter: { rvmode: mode }, page }),
          });
          const pageRecord = record(result);
          const returnedPage = pageRecord.page;
          const limit = pageRecord.limit;
          const hasMore = pageRecord.has_more;
          if (
            !Number.isSafeInteger(returnedPage) ||
            returnedPage !== page ||
            !Number.isSafeInteger(limit) ||
            Number(limit) < 1 ||
            typeof hasMore !== "boolean" ||
            (expectedLimit !== null && expectedLimit !== limit)
          ) {
            adapterError();
          }
          expectedLimit = Number(limit);
          for (const entry of records(pageRecord.cores)) {
            const hid = positiveCoreId(record(entry).hid);
            if (seenCoreIds.has(hid)) adapterError();
            seenCoreIds.add(hid);
          }
          terminalUnitCount = add(terminalUnitCount, 1);
          if (!hasMore) break;
          if (page >= MAXIMUM_ARENA_PAGES_PER_MODE) adapterError();
          page += 1;
        }
      }
    } else {
      adapterError();
    }

    if (observed.requestCount < 1 || terminalUnitCount < 1) adapterError();
    const endpoints = endpointObservations(observed.endpoints);
    const observedAt = timestamp(now());
    if (Date.parse(observedAt) < Date.parse(authorityCutoffAt)) adapterError();
    const evidenceBase = Object.freeze({
      family,
      authorityClass: FAMILY_AUTHORITY[family],
      authorityCutoffAt,
      observedAt,
      observedSourceRecordCount: observed.sourceRecordCount,
      observedApiRequestCount: observed.requestCount,
      observedResponseBytes: observed.responseBytes,
      maximumObservedResponseBytes: observed.maximumResponseBytes,
      unresolvedIdentityObservationUpperBound,
      terminalUnitCount,
      splitCount,
      endpointObservations: endpoints,
      ...(family === "finished_races" ? { historyStartAt } : {}),
    });
    const observation: DnaOpenLabP5FirstBackfillFamilyObservation =
      Object.freeze({
        ...evidenceBase,
        aggregateEvidenceSha256: dnaOpenLabRawEvidenceSha256(evidenceBase),
      });
    const bounds = input.projectUpperBounds(observation);
    if (
      count(bounds.sourceRecordUpperBound) <
        add(
          observed.sourceRecordCount,
          unresolvedIdentityObservationUpperBound,
        ) ||
      count(bounds.unresolvedIdentityObservationUpperBound) !==
        unresolvedIdentityObservationUpperBound ||
      count(bounds.apiRequestUpperBound) < observed.requestCount ||
      count(bounds.retainedR2BytesUpperBound) < observed.responseBytes ||
      count(bounds.classAOperationsUpperBound) < observed.requestCount ||
      count(bounds.classBOperationsUpperBound) < observed.requestCount
    ) {
      adapterError();
    }
    return Object.freeze({
      family,
      authorityClass: FAMILY_AUTHORITY[family],
      observedAt,
      terminalInventoryObserved: true,
      observedSourceRecordCount: observed.sourceRecordCount,
      unresolvedIdentityObservationUpperBound,
      sourceRecordUpperBound: bounds.sourceRecordUpperBound,
      apiRequestUpperBound: bounds.apiRequestUpperBound,
      retainedR2BytesUpperBound: bounds.retainedR2BytesUpperBound,
      classAOperationsUpperBound: bounds.classAOperationsUpperBound,
      classBOperationsUpperBound: bounds.classBOperationsUpperBound,
      neonIncrementalBytesUpperBound: count(
        bounds.neonIncrementalBytesUpperBound,
      ),
      evidenceRef: `aggregate-sha256:${observation.aggregateEvidenceSha256}`,
    });
  };

  return Object.freeze({ measureFamily });
}

export const DNA_OPEN_LAB_P5_FIRST_BACKFILL_ENDPOINT_LIMITS = Object.freeze({
  finishedRaceWindow: DNA_FINISHED_RACE_WINDOW_LIMIT,
  coreBulk: CORE_BULK_LIMIT,
  raceBulk: RACE_BULK_LIMIT,
  arenaPagesPerMode: MAXIMUM_ARENA_PAGES_PER_MODE,
});
