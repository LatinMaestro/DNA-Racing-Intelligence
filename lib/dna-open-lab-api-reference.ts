export const DNA_OPEN_LAB_LLM_REFERENCE_URL =
  "https://api.dnaracing.run/fbike/pub/v1/llm.txt" as const;
export const DNA_OPEN_LAB_V1_REFERENCE_BASE_URL =
  "https://api.dnaracing.run/fbike/pub/v1" as const;

export const DNA_OPEN_LAB_MAX_ACTIVE_KEYS_PER_VAULT = 3 as const;

export const DNA_OPEN_LAB_REFERENCE_RATE_TIERS = Object.freeze([
  Object.freeze({ minimumTierScore: 2.5, requestsPerMinute: 150 }),
  Object.freeze({ minimumTierScore: 2, requestsPerMinute: 80 }),
  Object.freeze({ minimumTierScore: 1, requestsPerMinute: 30 }),
] as const);

export const DNA_OPEN_LAB_REFERENCE_RATE_HEADERS = Object.freeze([
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "X-RateLimit-Reset",
  "X-RateLimit-Class",
  "Retry-After",
] as const);

export const DNA_OPEN_LAB_REFERENCE_LIMITS = Object.freeze({
  vaultInfoBulk: 100,
  vaultSearch: 50,
  vaultSearchMinimumQueryLength: 2,
  finishedRaces: 200,
  raceDocs: 20,
  raceFills: 20,
  coreBulk: 20,
} as const);

export type DnaOpenLabReferenceScope =
  "open" | "vault" | "races" | "cores" | "tokens" | "splice";

export type DnaOpenLabReferenceEndpoint = Readonly<{
  id: string;
  scope: DnaOpenLabReferenceScope;
  method: "GET" | "POST";
  path: string;
  maximumBatchSize?: number;
}>;

const endpoint = (
  value: DnaOpenLabReferenceEndpoint,
): DnaOpenLabReferenceEndpoint => Object.freeze(value);

/**
 * Machine-readable API contract authority used by tests and future agents.
 *
 * Source: DNA Open Lab v1 llm.txt plus the owner-supplied 2026-10-07 live
 * API Reference recording. The recording confirms the current Cores surface
 * contains 19 live operations, including telemetry, telemetry_bulk and
 * telemetry_benchmark.
 *
 * Keep documented bounds even if a live endpoint happens to accept a larger
 * request. A more permissive observation is not authority to exceed the
 * published contract.
 */
export const DNA_OPEN_LAB_REFERENCE_ENDPOINTS = Object.freeze([
  endpoint({ id: "test.get", scope: "open", method: "GET", path: "/test" }),
  endpoint({ id: "test.post", scope: "open", method: "POST", path: "/test" }),
  endpoint({
    id: "test_auth.post",
    scope: "vault",
    method: "POST",
    path: "/test_auth",
  }),
  endpoint({
    id: "vault.info",
    scope: "vault",
    method: "POST",
    path: "/vault/info",
  }),
  endpoint({
    id: "vault.info_bulk",
    scope: "vault",
    method: "POST",
    path: "/vault/info_bulk",
    maximumBatchSize: DNA_OPEN_LAB_REFERENCE_LIMITS.vaultInfoBulk,
  }),
  endpoint({
    id: "vault.search",
    scope: "vault",
    method: "GET",
    path: "/vault/search",
    maximumBatchSize: DNA_OPEN_LAB_REFERENCE_LIMITS.vaultSearch,
  }),
  endpoint({
    id: "vault.cores",
    scope: "vault",
    method: "GET",
    path: "/vault/:vault/cores",
  }),
  endpoint({
    id: "vault.cores_full",
    scope: "vault",
    method: "GET",
    path: "/vault/:vault/cores_full",
  }),
  endpoint({
    id: "vault.tier_badge",
    scope: "vault",
    method: "GET",
    path: "/vault/:vault/tier_badge",
  }),
  endpoint({
    id: "vault.recent_races",
    scope: "vault",
    method: "GET",
    path: "/vault/:vault/recent_races",
  }),
  endpoint({
    id: "races.active.get",
    scope: "races",
    method: "GET",
    path: "/races/active",
  }),
  endpoint({
    id: "races.active.post",
    scope: "races",
    method: "POST",
    path: "/races/active",
  }),
  endpoint({
    id: "races.finished",
    scope: "races",
    method: "POST",
    path: "/races/finished",
    maximumBatchSize: DNA_OPEN_LAB_REFERENCE_LIMITS.finishedRaces,
  }),
  endpoint({
    id: "races.docs",
    scope: "races",
    method: "POST",
    path: "/races/docs",
    maximumBatchSize: DNA_OPEN_LAB_REFERENCE_LIMITS.raceDocs,
  }),
  endpoint({
    id: "races.fills",
    scope: "races",
    method: "POST",
    path: "/races/fills",
    maximumBatchSize: DNA_OPEN_LAB_REFERENCE_LIMITS.raceFills,
  }),
  ...[
    "info",
    "racing_stats",
    "power",
    "listing_price",
    "attached_assets",
    "owner",
    "stamina",
    "splicing_info",
  ].flatMap((verb) => [
    endpoint({
      id: `cores.${verb}`,
      scope: "cores",
      method: "GET",
      path: `/cores/:hid/${verb}`,
    }),
    endpoint({
      id: `cores.${verb}_bulk`,
      scope: "cores",
      method: "POST",
      path: `/cores/${verb}_bulk`,
      maximumBatchSize: DNA_OPEN_LAB_REFERENCE_LIMITS.coreBulk,
    }),
  ]),
  endpoint({
    id: "cores.telemetry",
    scope: "cores",
    method: "GET",
    path: "/cores/:hid/telemetry",
  }),
  endpoint({
    id: "cores.telemetry_bulk",
    scope: "cores",
    method: "POST",
    path: "/cores/telemetry_bulk",
    maximumBatchSize: DNA_OPEN_LAB_REFERENCE_LIMITS.coreBulk,
  }),
  endpoint({
    id: "cores.telemetry_benchmark",
    scope: "cores",
    method: "GET",
    path: "/cores/:hid/telemetry_benchmark",
  }),
  endpoint({
    id: "tokens.prices.get",
    scope: "tokens",
    method: "GET",
    path: "/tokens/prices",
  }),
  endpoint({
    id: "tokens.prices.post",
    scope: "tokens",
    method: "POST",
    path: "/tokens/prices",
  }),
  endpoint({
    id: "splice.doc.get",
    scope: "splice",
    method: "GET",
    path: "/splice/doc/:reqid",
  }),
  endpoint({
    id: "splice.doc.post",
    scope: "splice",
    method: "POST",
    path: "/splice/doc",
  }),
  endpoint({
    id: "splice.arena",
    scope: "splice",
    method: "POST",
    path: "/splice/arena",
  }),
  endpoint({
    id: "splice.pair_info",
    scope: "splice",
    method: "GET",
    path: "/splice/pair_info",
  }),
  endpoint({
    id: "splice.pair_validate",
    scope: "splice",
    method: "GET",
    path: "/splice/pair_validate",
  }),
] as const);

export const DNA_OPEN_LAB_REFERENCE_BEST_PRACTICES = Object.freeze([
  "cache-repeatable-data",
  "prefer-bulk-endpoints",
  "poll-no-faster-than-data-changes",
  "honour-rate-limit-headers-and-retry-after",
  "keep-api-keys-server-side",
  "attribute-dna-racing",
] as const);
