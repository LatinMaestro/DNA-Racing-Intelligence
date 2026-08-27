import type {
  DnaOpenLabScope,
  DnaRaceIdentifier,
  DnaRaceMode,
} from "./dna-open-lab-v1-client";

const MAXIMUM_CORE_BULK = 20;
const MAXIMUM_RACE_BULK = 20;

export type DnaCurrentStateEndpoint =
  | "vault.info"
  | "vault.cores_full"
  | "vault.tier_badge"
  | "vault.recent_races"
  | "races.active"
  | "races.fills"
  | "cores.info_bulk"
  | "cores.racing_stats_bulk"
  | "cores.power_bulk"
  | "cores.listing_price_bulk"
  | "cores.attached_assets_bulk"
  | "cores.owner_bulk"
  | "cores.stamina_bulk"
  | "cores.splicing_info_bulk"
  | "tokens.prices"
  | "splice.arena"
  | "splice.pair_info"
  | "splice.pair_validate";

export type DnaCurrentStateRequest = Readonly<{
  scope: DnaOpenLabScope;
  endpoint: DnaCurrentStateEndpoint;
  payload: Readonly<Record<string, unknown>>;
}>;

export type DnaSplicePairCandidate = Readonly<{
  fatherCoreId: number;
  motherCoreId: number;
}>;

export type DnaCurrentStateSyncPlan = Readonly<{
  bootstrap: readonly DnaCurrentStateRequest[];
  hydrate: readonly DnaCurrentStateRequest[];
  deferredUntilP3: readonly [
    "cores.telemetry",
    "cores.telemetry_bulk",
    "cores.telemetry_benchmark",
  ];
}>;

const CORE_BULK_ENDPOINTS = Object.freeze([
  "cores.info_bulk",
  "cores.racing_stats_bulk",
  "cores.power_bulk",
  "cores.listing_price_bulk",
  "cores.attached_assets_bulk",
  "cores.owner_bulk",
  "cores.stamina_bulk",
  "cores.splicing_info_bulk",
] as const);

function planError(message: string): never {
  throw new Error(`DNA Open Lab current-state sync plan: ${message}`);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 512) {
    planError(`${field} is invalid`);
  }
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    planError(`${field} must be a positive safe integer`);
  }
  return value;
}

function uniqueCoreIds(values: readonly number[]): readonly number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of values) {
    const id = positiveInteger(value, "core id");
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return Object.freeze(result);
}

function raceIdentity(value: DnaRaceIdentifier): string {
  if (typeof value === "number") {
    return String(positiveInteger(value, "race id"));
  }
  return requiredText(value, "race id");
}

function uniqueRaceIds(
  values: readonly DnaRaceIdentifier[],
): readonly DnaRaceIdentifier[] {
  const seen = new Set<string>();
  const result: DnaRaceIdentifier[] = [];
  for (const value of values) {
    const identity = raceIdentity(value);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(value);
  }
  return Object.freeze(result);
}

function uniqueModes(values: readonly DnaRaceMode[]): readonly DnaRaceMode[] {
  const allowed = new Set<DnaRaceMode>(["bike", "car", "horse"]);
  const seen = new Set<DnaRaceMode>();
  const result: DnaRaceMode[] = [];
  for (const value of values) {
    if (!allowed.has(value)) planError("splice mode is unsupported");
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return Object.freeze(result);
}

function uniquePairs(
  values: readonly DnaSplicePairCandidate[],
): readonly DnaSplicePairCandidate[] {
  const seen = new Set<string>();
  const result: DnaSplicePairCandidate[] = [];
  for (const value of values) {
    const fatherCoreId = positiveInteger(value.fatherCoreId, "fatherCoreId");
    const motherCoreId = positiveInteger(value.motherCoreId, "motherCoreId");
    const identity = `${fatherCoreId}:${motherCoreId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(Object.freeze({ fatherCoreId, motherCoreId }));
  }
  return Object.freeze(result);
}

function batches<T>(
  values: readonly T[],
  size: number,
): readonly (readonly T[])[] {
  const result: (readonly T[])[] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(Object.freeze(values.slice(offset, offset + size)));
  }
  return Object.freeze(result);
}

function request(
  scope: DnaOpenLabScope,
  endpoint: DnaCurrentStateEndpoint,
  payload: Readonly<Record<string, unknown>> = {},
): DnaCurrentStateRequest {
  return Object.freeze({ scope, endpoint, payload: Object.freeze(payload) });
}

/**
 * Builds a deterministic two-stage current-state request plan without making
 * network calls. Bootstrap requests discover current ownership and active race
 * identity. Hydration requests consume only identities already observed by the
 * caller and keep every documented bulk operation within the v1 limit of 20.
 *
 * Telemetry is deliberately excluded from normal P2 synchronization. Its three
 * endpoints remain transport-only until connected P3 inspection establishes
 * their schema, chronology, units and meaning.
 */
export function createDnaCurrentStateSyncPlan(input: {
  vault: string;
  ownedCoreIds?: readonly number[];
  activeRaceIds?: readonly DnaRaceIdentifier[];
  spliceModes?: readonly DnaRaceMode[];
  splicePairs?: readonly DnaSplicePairCandidate[];
}): DnaCurrentStateSyncPlan {
  const vault = requiredText(input.vault, "vault");
  const ownedCoreIds = uniqueCoreIds(input.ownedCoreIds ?? []);
  const activeRaceIds = uniqueRaceIds(input.activeRaceIds ?? []);
  const spliceModes = uniqueModes(
    input.spliceModes ?? ["bike", "car", "horse"],
  );
  const splicePairs = uniquePairs(input.splicePairs ?? []);

  const bootstrap: DnaCurrentStateRequest[] = [
    request("vault", "vault.info", { vault }),
    request("vault", "vault.cores_full", { vault }),
    request("vault", "vault.tier_badge", { vault }),
    request("vault", "vault.recent_races", { vault }),
    request("races", "races.active"),
    request("tokens", "tokens.prices"),
    ...spliceModes.map((rvmode) =>
      request("splice", "splice.arena", { filter: Object.freeze({ rvmode }) }),
    ),
  ];

  const hydrate: DnaCurrentStateRequest[] = [];
  for (const batch of batches(ownedCoreIds, MAXIMUM_CORE_BULK)) {
    for (const endpoint of CORE_BULK_ENDPOINTS) {
      hydrate.push(request("cores", endpoint, { hids: batch }));
    }
  }
  for (const batch of batches(activeRaceIds, MAXIMUM_RACE_BULK)) {
    hydrate.push(request("races", "races.fills", { rids: batch }));
  }
  for (const pair of splicePairs) {
    hydrate.push(request("splice", "splice.pair_info", pair));
    hydrate.push(request("splice", "splice.pair_validate", pair));
  }

  return Object.freeze({
    bootstrap: Object.freeze(bootstrap),
    hydrate: Object.freeze(hydrate),
    deferredUntilP3: Object.freeze([
      "cores.telemetry",
      "cores.telemetry_bulk",
      "cores.telemetry_benchmark",
    ]),
  });
}
