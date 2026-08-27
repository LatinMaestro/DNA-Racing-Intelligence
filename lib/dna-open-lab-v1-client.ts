export const DNA_OPEN_LAB_V1_BASE_URL =
  "https://api.dnaracing.run/fbike/pub/v1" as const;

export type DnaOpenLabScope = "vault" | "races" | "cores" | "tokens" | "splice";

export type DnaRaceMode = "bike" | "car" | "horse";
export type DnaRaceIdentifier = string | number;
export type DnaOpenLabRecord<T extends object> = Readonly<
  T & Record<string, unknown>
>;

export type DnaOpenLabRateLimit = Readonly<{
  limit: number | null;
  remaining: number | null;
  resetSeconds: number | null;
  rateClass: string | null;
  retryAfterSeconds: number | null;
}>;

export type DnaOpenLabResponse<T> = Readonly<{
  result: T;
  httpStatus: number;
  rateLimit: DnaOpenLabRateLimit;
}>;

export type DnaOpenLabApiErrorKind =
  | "invalid_configuration"
  | "invalid_request"
  | "malformed_response"
  | "api_error"
  | "rate_limited";

export class DnaOpenLabApiError extends Error {
  readonly kind: DnaOpenLabApiErrorKind;
  readonly httpStatus: number | null;
  readonly rateLimit: DnaOpenLabRateLimit | null;

  constructor(input: {
    kind: DnaOpenLabApiErrorKind;
    message: string;
    httpStatus?: number | null;
    rateLimit?: DnaOpenLabRateLimit | null;
  }) {
    super(input.message);
    this.name = "DnaOpenLabApiError";
    this.kind = input.kind;
    this.httpStatus = input.httpStatus ?? null;
    this.rateLimit = input.rateLimit ?? null;
  }
}

export type DnaVaultInfo = DnaOpenLabRecord<{
  vault: string;
  name: string;
  profile_url: string | null;
  banner_url: string | null;
}>;

export type DnaVaultCore = DnaOpenLabRecord<{
  hid: number;
  name: string;
  type: string;
  element: string;
  gender: string;
  fno: number;
}>;

export type DnaTierBadge = DnaOpenLabRecord<{
  vault: string;
  tot_score: number;
}>;

export type DnaActiveRace = DnaOpenLabRecord<{
  rid: DnaRaceIdentifier;
  status: string;
  race_name: string;
  format: string | null;
  class: string | null;
  cb: number | null;
  rgate: number;
  hs_in: number;
  fee_fixed: Readonly<Record<string, number>>;
  feeusd: number;
  paytoken: string;
  start_time: string;
  end_time: string | null;
  version: number | string;
  rvmode: DnaRaceMode;
}>;

export type DnaRaceDocument = DnaOpenLabRecord<{
  rid: DnaRaceIdentifier;
}>;

export type DnaRaceFill = DnaOpenLabRecord<{
  rid: DnaRaceIdentifier;
  status: string;
  rgate: number;
  hs_in: number;
  hids: readonly number[];
  entry_txns_confirmed: Readonly<Record<string, boolean>>;
}>;

export type DnaCoreInfo = DnaOpenLabRecord<{
  hid: number;
  name: string;
  type: string;
  element: string;
  color: string;
  hex_code: string;
  fno: number;
  gender: string;
  vault: string;
}>;

export type DnaCoreRacingStats = DnaOpenLabRecord<{
  hid: number;
  hstats_bike: unknown;
  hstats_car: unknown;
  hstats_horse: unknown;
  ageing: unknown;
  is_maiden: boolean;
  tourney_profits: unknown;
}>;

export type DnaCorePowerMode = DnaOpenLabRecord<{
  power: unknown;
  adjodds: unknown;
  variance: unknown;
  races_n: number;
}>;

export type DnaCorePower = DnaOpenLabRecord<{
  hid: number;
  power: Readonly<{
    bike: DnaCorePowerMode;
    car: DnaCorePowerMode;
    horse: DnaCorePowerMode;
  }>;
  m_stats: unknown;
}>;

export type DnaCoreListingPrice = DnaOpenLabRecord<{
  hid: number;
  price?: number;
  token?: string;
  expires_at?: string;
}>;

export type DnaCoreAttachedAssets = DnaOpenLabRecord<{
  hid: number;
  skino: Readonly<Record<DnaRaceMode, unknown>>;
  trailsmap: unknown;
}>;

export type DnaCoreOwner = DnaOpenLabRecord<{
  hid: number;
  vault: string;
}>;

export type DnaCoreStamina = DnaOpenLabRecord<{
  hid: number;
  stamina: DnaOpenLabRecord<{
    stamina: number;
    max_stamina: number;
    next_refill: string | null;
    last_event: string | null;
  }>;
  spstamina: DnaOpenLabRecord<{ giveid: number; stamina: number }> | null;
}>;

export type DnaCoreSplicingInfo = DnaOpenLabRecord<{
  hid: number;
  parents: unknown;
  grand_parents: unknown;
  challenge_credit: unknown;
  splice_core: unknown;
}>;

export type DnaTokenPrices = DnaOpenLabRecord<{
  ethusd: number;
  btcusd: number;
  dezusd: number;
  hlxusd: number;
  bgcusd: number;
  tpusd: number;
  methusd: number;
  mbtcusd: number;
}>;

export type DnaSpliceDocument = DnaOpenLabRecord<{
  reqid: string;
  hid: number | null;
  minted: boolean;
  minted_at: string | null;
  requested_at: string;
  payment_tx: unknown;
  found_payment_tx: unknown;
  info: unknown;
  request: unknown;
  alw_list: unknown;
  transfers: unknown;
  errmsg: string | null;
  retry: unknown;
  next_retry: string | null;
}>;

export type DnaSpliceArenaCore = DnaOpenLabRecord<{
  hid: number;
  name: string;
  type: string;
  gender: string;
  element: string;
  color: string;
  hex_code: string;
  fno: number;
  price_usd: number;
}>;

/**
 * Paginated Arena shape observed by the redacted connected P3 discovery. The
 * endpoint returns its Core rows under `cores`; it does not return a root array.
 */
export type DnaSpliceArenaResult = DnaOpenLabRecord<{
  cores: readonly DnaSpliceArenaCore[];
  has_more: boolean;
  limit: number;
  page: number;
}>;

export type DnaSplicePairInfo = DnaOpenLabRecord<{
  f: DnaOpenLabRecord<Record<string, unknown>>;
  m: DnaOpenLabRecord<Record<string, unknown>>;
  baby_info: DnaOpenLabRecord<{
    element: string;
    fno: number;
    type: string;
  }>;
  prices: DnaOpenLabRecord<Record<string, unknown>> | null;
}>;

export type DnaSplicePairValidation = DnaOpenLabRecord<{
  valid: true;
}>;

export type DnaOpenLabTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export type DnaOpenLabClient = Readonly<{
  testAuth: () => Promise<DnaOpenLabResponse<unknown>>;
  vaultInfo: (vault: string) => Promise<DnaOpenLabResponse<DnaVaultInfo>>;
  vaultInfoBulk: (
    vaults: readonly string[],
  ) => Promise<DnaOpenLabResponse<Readonly<Record<string, DnaVaultInfo>>>>;
  vaultSearch: (input: {
    query: string;
    limit?: number;
  }) => Promise<DnaOpenLabResponse<readonly DnaVaultInfo[]>>;
  vaultCores: (vault: string) => Promise<DnaOpenLabResponse<readonly number[]>>;
  vaultCoresFull: (
    vault: string,
  ) => Promise<DnaOpenLabResponse<readonly DnaVaultCore[]>>;
  vaultTierBadge: (vault: string) => Promise<DnaOpenLabResponse<DnaTierBadge>>;
  vaultRecentRaces: (
    vault: string,
  ) => Promise<DnaOpenLabResponse<readonly DnaRaceDocument[]>>;
  racesActive: () => Promise<DnaOpenLabResponse<readonly DnaActiveRace[]>>;
  racesFinished: (input?: {
    startTime?: string;
    endTime?: string;
    limit?: number;
  }) => Promise<DnaOpenLabResponse<readonly DnaRaceDocument[]>>;
  raceDocs: (
    rids: readonly DnaRaceIdentifier[],
  ) => Promise<DnaOpenLabResponse<readonly DnaRaceDocument[]>>;
  raceFills: (
    rids: readonly DnaRaceIdentifier[],
  ) => Promise<DnaOpenLabResponse<readonly DnaRaceFill[]>>;
  coreInfo: (hid: number) => Promise<DnaOpenLabResponse<DnaCoreInfo>>;
  coreInfoBulk: (
    hids: readonly number[],
  ) => Promise<DnaOpenLabResponse<readonly DnaCoreInfo[]>>;
  coreRacingStats: (
    hid: number,
  ) => Promise<DnaOpenLabResponse<DnaCoreRacingStats>>;
  coreRacingStatsBulk: (
    hids: readonly number[],
  ) => Promise<DnaOpenLabResponse<readonly DnaCoreRacingStats[]>>;
  corePower: (hid: number) => Promise<DnaOpenLabResponse<DnaCorePower>>;
  corePowerBulk: (
    hids: readonly number[],
  ) => Promise<DnaOpenLabResponse<readonly DnaCorePower[]>>;
  coreListingPrice: (
    hid: number,
  ) => Promise<DnaOpenLabResponse<DnaCoreListingPrice>>;
  coreListingPriceBulk: (
    hids: readonly number[],
  ) => Promise<DnaOpenLabResponse<readonly DnaCoreListingPrice[]>>;
  coreAttachedAssets: (
    hid: number,
  ) => Promise<DnaOpenLabResponse<DnaCoreAttachedAssets>>;
  coreAttachedAssetsBulk: (
    hids: readonly number[],
  ) => Promise<DnaOpenLabResponse<readonly DnaCoreAttachedAssets[]>>;
  coreOwner: (hid: number) => Promise<DnaOpenLabResponse<DnaCoreOwner>>;
  coreOwnerBulk: (
    hids: readonly number[],
  ) => Promise<DnaOpenLabResponse<readonly DnaCoreOwner[]>>;
  coreStamina: (hid: number) => Promise<DnaOpenLabResponse<DnaCoreStamina>>;
  coreStaminaBulk: (
    hids: readonly number[],
  ) => Promise<DnaOpenLabResponse<readonly DnaCoreStamina[]>>;
  coreSplicingInfo: (
    hid: number,
  ) => Promise<DnaOpenLabResponse<DnaCoreSplicingInfo>>;
  coreSplicingInfoBulk: (
    hids: readonly number[],
  ) => Promise<DnaOpenLabResponse<readonly DnaCoreSplicingInfo[]>>;
  tokenPrices: () => Promise<DnaOpenLabResponse<DnaTokenPrices>>;
  spliceDocument: (
    requestId: string,
  ) => Promise<DnaOpenLabResponse<DnaSpliceDocument>>;
  spliceArena: (input: {
    filter: Readonly<{ rvmode: DnaRaceMode } & Record<string, unknown>>;
    search?: string;
    vault?: string;
    page?: number;
  }) => Promise<DnaOpenLabResponse<DnaSpliceArenaResult>>;
  splicePairInfo: (input: {
    fatherCoreId: number;
    motherCoreId: number;
  }) => Promise<DnaOpenLabResponse<DnaSplicePairInfo>>;
  splicePairValidate: (input: {
    fatherCoreId: number;
    motherCoreId: number;
  }) => Promise<DnaOpenLabResponse<DnaSplicePairValidation>>;
}>;

const API_KEY_PATTERN = /^dna_[A-Za-z0-9_-]{43}$/;

function invalidConfiguration(message: string): never {
  throw new DnaOpenLabApiError({ kind: "invalid_configuration", message });
}

function invalidRequest(message: string): never {
  throw new DnaOpenLabApiError({ kind: "invalid_request", message });
}

function requiredText(
  value: string,
  field: string,
  maximumLength = 512,
): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximumLength) {
    invalidRequest(`${field} is invalid`);
  }
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    invalidRequest(`${field} must be a positive safe integer`);
  }
  return value;
}

function boundedList<T>(
  values: readonly T[],
  field: string,
  maximumLength: number,
): readonly T[] {
  if (values.length < 1 || values.length > maximumLength) {
    invalidRequest(
      `${field} must contain between 1 and ${maximumLength} values`,
    );
  }
  return values;
}

function coreIds(hids: readonly number[]): readonly number[] {
  return boundedList(hids, "hids", 20).map((hid) =>
    positiveInteger(hid, "hid"),
  );
}

function raceIds(
  rids: readonly DnaRaceIdentifier[],
): readonly DnaRaceIdentifier[] {
  return boundedList(rids, "rids", 20).map((rid) => {
    if (typeof rid === "number") return positiveInteger(rid, "rid");
    return requiredText(rid, "rid", 256);
  });
}

function parseHeaderInteger(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function readDnaOpenLabRateLimit(headers: Headers): DnaOpenLabRateLimit {
  return Object.freeze({
    limit: parseHeaderInteger(headers, "X-RateLimit-Limit"),
    remaining: parseHeaderInteger(headers, "X-RateLimit-Remaining"),
    resetSeconds: parseHeaderInteger(headers, "X-RateLimit-Reset"),
    rateClass: headers.get("X-RateLimit-Class"),
    retryAfterSeconds: parseHeaderInteger(headers, "Retry-After"),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readEnvelope<T>(
  response: Response,
): Promise<DnaOpenLabResponse<T>> {
  const rateLimit = readDnaOpenLabRateLimit(response.headers);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DnaOpenLabApiError({
      kind: "malformed_response",
      message: "DNA Open Lab returned non-JSON content",
      httpStatus: response.status,
      rateLimit,
    });
  }

  if (!isRecord(payload) || typeof payload.status !== "string") {
    throw new DnaOpenLabApiError({
      kind: "malformed_response",
      message: "DNA Open Lab response envelope is invalid",
      httpStatus: response.status,
      rateLimit,
    });
  }

  if (payload.status === "error") {
    const message =
      typeof payload.err === "string" && payload.err.trim() !== ""
        ? payload.err
        : "DNA Open Lab returned an unspecified API error";
    throw new DnaOpenLabApiError({
      kind: response.status === 429 ? "rate_limited" : "api_error",
      message,
      httpStatus: response.status,
      rateLimit,
    });
  }

  if (payload.status !== "success" || !("result" in payload)) {
    throw new DnaOpenLabApiError({
      kind: "malformed_response",
      message: "DNA Open Lab success envelope is invalid",
      httpStatus: response.status,
      rateLimit,
    });
  }

  return Object.freeze({
    result: payload.result as T,
    httpStatus: response.status,
    rateLimit,
  });
}

function buildQuery(
  path: string,
  values: Readonly<Record<string, string | number | undefined>>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query === "" ? path : `${path}?${query}`;
}

function isoTimestamp(
  value: string | undefined,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = requiredText(value, field, 64);
  if (!Number.isFinite(Date.parse(normalized))) {
    invalidRequest(`${field} must be an ISO timestamp`);
  }
  return normalized;
}

export function createDnaOpenLabV1Client(input: {
  apiKey: string;
  transport?: DnaOpenLabTransport;
  baseUrl?: string;
}): DnaOpenLabClient {
  if (!API_KEY_PATTERN.test(input.apiKey)) {
    invalidConfiguration("DNA Open Lab API key format is invalid");
  }
  const transport = input.transport ?? fetch;
  const baseUrl = (input.baseUrl ?? DNA_OPEN_LAB_V1_BASE_URL).replace(
    /\/+$/u,
    "",
  );
  if (!/^https:\/\//u.test(baseUrl)) {
    invalidConfiguration("DNA Open Lab base URL must use HTTPS");
  }

  const request = async <T>(requestInput: {
    scope: DnaOpenLabScope;
    path: string;
    method: "GET" | "POST";
    body?: unknown;
  }): Promise<DnaOpenLabResponse<T>> => {
    const headers = new Headers({
      Authorization: `Bearer ${input.apiKey}`,
      Accept: "application/json",
    });
    let body: string | undefined;
    if (requestInput.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(requestInput.body);
    }
    const response = await transport(`${baseUrl}${requestInput.path}`, {
      method: requestInput.method,
      headers,
      ...(body === undefined ? {} : { body }),
      cache: "no-store",
    });
    return readEnvelope<T>(response);
  };

  const coreSingle = <T>(hid: number, verb: string) =>
    request<T>({
      scope: "cores",
      path: `/cores/${positiveInteger(hid, "hid")}/${verb}`,
      method: "GET",
    });
  const coreBulk = <T>(hids: readonly number[], verb: string) =>
    request<readonly T[]>({
      scope: "cores",
      path: `/cores/${verb}_bulk`,
      method: "POST",
      body: { hids: coreIds(hids) },
    });
  const vaultPath = (vault: string, suffix: string) =>
    `/vault/${encodeURIComponent(requiredText(vault, "vault"))}/${suffix}`;

  return Object.freeze({
    testAuth: () =>
      request<unknown>({ scope: "vault", path: "/test_auth", method: "POST" }),
    vaultInfo: (vault) =>
      request<DnaVaultInfo>({
        scope: "vault",
        path: "/vault/info",
        method: "POST",
        body: { vault: requiredText(vault, "vault") },
      }),
    vaultInfoBulk: (vaults) =>
      request<Readonly<Record<string, DnaVaultInfo>>>({
        scope: "vault",
        path: "/vault/info_bulk",
        method: "POST",
        body: {
          vaults: boundedList(vaults, "vaults", 100).map((vault) =>
            requiredText(vault, "vault"),
          ),
        },
      }),
    vaultSearch: ({ query, limit }) => {
      const normalizedQuery = requiredText(query, "query", 256);
      if (normalizedQuery.length < 2)
        invalidRequest("query must have at least 2 characters");
      if (
        limit !== undefined &&
        (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      ) {
        invalidRequest("limit must be between 1 and 50");
      }
      return request<readonly DnaVaultInfo[]>({
        scope: "vault",
        path: buildQuery("/vault/search", { q: normalizedQuery, limit }),
        method: "GET",
      });
    },
    vaultCores: (vault) =>
      request<readonly number[]>({
        scope: "vault",
        path: vaultPath(vault, "cores"),
        method: "GET",
      }),
    vaultCoresFull: (vault) =>
      request<readonly DnaVaultCore[]>({
        scope: "vault",
        path: vaultPath(vault, "cores_full"),
        method: "GET",
      }),
    vaultTierBadge: (vault) =>
      request<DnaTierBadge>({
        scope: "vault",
        path: vaultPath(vault, "tier_badge"),
        method: "GET",
      }),
    vaultRecentRaces: (vault) =>
      request<readonly DnaRaceDocument[]>({
        scope: "vault",
        path: vaultPath(vault, "recent_races"),
        method: "GET",
      }),
    racesActive: () =>
      request<readonly DnaActiveRace[]>({
        scope: "races",
        path: "/races/active",
        method: "GET",
      }),
    racesFinished: (finishedInput = {}) => {
      const startTime = isoTimestamp(finishedInput.startTime, "startTime");
      const endTime = isoTimestamp(finishedInput.endTime, "endTime");
      if (
        startTime !== undefined &&
        endTime !== undefined &&
        Date.parse(startTime) > Date.parse(endTime)
      ) {
        invalidRequest("startTime cannot be after endTime");
      }
      const limit = finishedInput.limit;
      if (
        limit !== undefined &&
        (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      ) {
        invalidRequest("limit must be between 1 and 200");
      }
      return request<readonly DnaRaceDocument[]>({
        scope: "races",
        path: "/races/finished",
        method: "POST",
        body: {
          ...(startTime === undefined ? {} : { st: startTime }),
          ...(endTime === undefined ? {} : { ed: endTime }),
          ...(limit === undefined ? {} : { limit }),
        },
      });
    },
    raceDocs: (rids) =>
      request<readonly DnaRaceDocument[]>({
        scope: "races",
        path: "/races/docs",
        method: "POST",
        body: { rids: raceIds(rids) },
      }),
    raceFills: (rids) =>
      request<readonly DnaRaceFill[]>({
        scope: "races",
        path: "/races/fills",
        method: "POST",
        body: { rids: raceIds(rids) },
      }),
    coreInfo: (hid) => coreSingle<DnaCoreInfo>(hid, "info"),
    coreInfoBulk: (hids) => coreBulk<DnaCoreInfo>(hids, "info"),
    coreRacingStats: (hid) =>
      coreSingle<DnaCoreRacingStats>(hid, "racing_stats"),
    coreRacingStatsBulk: (hids) =>
      coreBulk<DnaCoreRacingStats>(hids, "racing_stats"),
    corePower: (hid) => coreSingle<DnaCorePower>(hid, "power"),
    corePowerBulk: (hids) => coreBulk<DnaCorePower>(hids, "power"),
    coreListingPrice: (hid) =>
      coreSingle<DnaCoreListingPrice>(hid, "listing_price"),
    coreListingPriceBulk: (hids) =>
      coreBulk<DnaCoreListingPrice>(hids, "listing_price"),
    coreAttachedAssets: (hid) =>
      coreSingle<DnaCoreAttachedAssets>(hid, "attached_assets"),
    coreAttachedAssetsBulk: (hids) =>
      coreBulk<DnaCoreAttachedAssets>(hids, "attached_assets"),
    coreOwner: (hid) => coreSingle<DnaCoreOwner>(hid, "owner"),
    coreOwnerBulk: (hids) => coreBulk<DnaCoreOwner>(hids, "owner"),
    coreStamina: (hid) => coreSingle<DnaCoreStamina>(hid, "stamina"),
    coreStaminaBulk: (hids) => coreBulk<DnaCoreStamina>(hids, "stamina"),
    coreSplicingInfo: (hid) =>
      coreSingle<DnaCoreSplicingInfo>(hid, "splicing_info"),
    coreSplicingInfoBulk: (hids) =>
      coreBulk<DnaCoreSplicingInfo>(hids, "splicing_info"),
    tokenPrices: () =>
      request<DnaTokenPrices>({
        scope: "tokens",
        path: "/tokens/prices",
        method: "GET",
      }),
    spliceDocument: (requestId) =>
      request<DnaSpliceDocument>({
        scope: "splice",
        path: `/splice/doc/${encodeURIComponent(requiredText(requestId, "requestId"))}`,
        method: "GET",
      }),
    spliceArena: ({ filter, search, vault, page }) => {
      if (
        filter.rvmode !== "bike" &&
        filter.rvmode !== "car" &&
        filter.rvmode !== "horse"
      ) {
        invalidRequest("filter.rvmode is invalid");
      }
      if (page !== undefined && (!Number.isSafeInteger(page) || page < 1)) {
        invalidRequest("page must be a positive safe integer");
      }
      return request<DnaSpliceArenaResult>({
        scope: "splice",
        path: "/splice/arena",
        method: "POST",
        body: {
          f: filter,
          ...(search === undefined
            ? {}
            : { search: requiredText(search, "search") }),
          ...(vault === undefined
            ? {}
            : { vault: requiredText(vault, "vault") }),
          ...(page === undefined ? {} : { page }),
        },
      });
    },
    splicePairInfo: ({ fatherCoreId, motherCoreId }) =>
      request<DnaSplicePairInfo>({
        scope: "splice",
        path: buildQuery("/splice/pair_info", {
          father_coreid: positiveInteger(fatherCoreId, "fatherCoreId"),
          mother_coreid: positiveInteger(motherCoreId, "motherCoreId"),
        }),
        method: "GET",
      }),
    splicePairValidate: ({ fatherCoreId, motherCoreId }) =>
      request<DnaSplicePairValidation>({
        scope: "splice",
        path: buildQuery("/splice/pair_validate", {
          father_coreid: positiveInteger(fatherCoreId, "fatherCoreId"),
          mother_coreid: positiveInteger(motherCoreId, "motherCoreId"),
        }),
        method: "GET",
      }),
  });
}
