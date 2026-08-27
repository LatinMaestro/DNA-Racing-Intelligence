import type {
  DnaActiveRace,
  DnaCoreAttachedAssets,
  DnaCoreInfo,
  DnaCoreListingPrice,
  DnaCoreOwner,
  DnaCorePower,
  DnaCoreRacingStats,
  DnaCoreSplicingInfo,
  DnaCoreStamina,
  DnaRaceDocument,
  DnaRaceFill,
  DnaSpliceArenaCore,
  DnaSpliceDocument,
  DnaSplicePairInfo,
  DnaSplicePairValidation,
  DnaTierBadge,
  DnaTokenPrices,
  DnaVaultCore,
  DnaVaultInfo,
} from "@/lib/dna-open-lab-v1-client";

export const DNA_OPEN_LAB_SYNTHETIC_API_KEY = `dna_${"a".repeat(43)}`;
export const DNA_OPEN_LAB_SYNTHETIC_VAULT = "0xsynthetic-vault";
export const DNA_OPEN_LAB_SYNTHETIC_CORE_IDS = [101, 102] as const;
export const DNA_OPEN_LAB_SYNTHETIC_RACE_IDS = ["race-501", "race-502"] as const;

export const dnaOpenLabTier1Headers = Object.freeze({
  "X-RateLimit-Limit": "30",
  "X-RateLimit-Remaining": "29",
  "X-RateLimit-Reset": "17",
  "X-RateLimit-Class": "api_key",
});

export const dnaOpenLabVaultInfo: DnaVaultInfo = Object.freeze({
  vault: DNA_OPEN_LAB_SYNTHETIC_VAULT,
  name: "Synthetic Vault",
  profile_url: null,
  banner_url: null,
  future_optional_field: "retained",
});

export const dnaOpenLabVaultCoresFull: readonly DnaVaultCore[] = Object.freeze([
  {
    hid: 101,
    name: "Synthetic Alpha",
    type: "freak",
    element: "water",
    gender: "female",
    fno: 10,
  },
  {
    hid: 102,
    name: "Synthetic Beta",
    type: "morphed",
    element: "fire",
    gender: "male",
    fno: 11,
    future_optional_field: { tolerated: true },
  },
]);

export const dnaOpenLabTierBadge: DnaTierBadge = Object.freeze({
  vault: DNA_OPEN_LAB_SYNTHETIC_VAULT,
  tot_score: 1,
});

export const dnaOpenLabActiveRaces: readonly DnaActiveRace[] = Object.freeze([
  {
    rid: "race-501",
    status: "open",
    race_name: "Synthetic Open Sprint",
    format: "normal",
    class: "open",
    cb: 1500,
    rgate: 8,
    hs_in: 4,
    fee_fixed: { DEZ: 0.2 },
    feeusd: 2.25,
    paytoken: "DEZ",
    start_time: "2026-08-27T03:00:00Z",
    end_time: null,
    version: 3,
    rvmode: "bike",
    future_optional_field: "active-race-extension",
  },
]);

export const dnaOpenLabRaceDocuments: readonly DnaRaceDocument[] = Object.freeze([
  {
    rid: "race-501",
    status: "finished",
    race_name: "Synthetic Finished Race",
    rvmode: "bike",
    start_time: "2026-08-26T03:00:00Z",
    end_time: "2026-08-26T03:10:00Z",
    entrants: [
      { hid: 101, gate: 1 },
      { hid: 102, gate: 2 },
    ],
    results: [
      { hid: 101, place: 1, time: 62.5 },
      { hid: 102, place: 2, time: 63.1 },
    ],
    payouts: { 101: { DEZ: 4.2 } },
    future_optional_field: { document_shape_is_extensible: true },
  },
  {
    rid: "race-502",
    status: "finished",
    race_name: "Synthetic Finished Race Two",
    rvmode: "bike",
    start_time: "2026-08-26T04:00:00Z",
    end_time: "2026-08-26T04:10:00Z",
    entrants: [{ hid: 102, gate: 1 }],
    results: [{ hid: 102, place: 1, time: 61.8 }],
  },
]);

export const dnaOpenLabRaceFills: readonly DnaRaceFill[] = Object.freeze([
  {
    rid: "race-501",
    status: "filled",
    rgate: 8,
    hs_in: 2,
    hids: [101, 102],
    entry_txns_confirmed: { "101": true, "102": true },
    future_optional_field: "fill-extension",
  },
]);

export const dnaOpenLabCoreInfo: readonly DnaCoreInfo[] = Object.freeze([
  {
    hid: 101,
    name: "Synthetic Alpha",
    type: "freak",
    element: "water",
    color: "blue",
    hex_code: "#0000ff",
    fno: 10,
    gender: "female",
    vault: DNA_OPEN_LAB_SYNTHETIC_VAULT,
  },
  {
    hid: 102,
    name: "Synthetic Beta",
    type: "morphed",
    element: "fire",
    color: "red",
    hex_code: "#ff0000",
    fno: 11,
    gender: "male",
    vault: DNA_OPEN_LAB_SYNTHETIC_VAULT,
    future_optional_field: "core-extension",
  },
]);

export const dnaOpenLabCoreRacingStats: readonly DnaCoreRacingStats[] = Object.freeze([
  {
    hid: 101,
    hstats_bike: { races: 12, wins: 3 },
    hstats_car: { races: 0, wins: 0 },
    hstats_horse: { races: 0, wins: 0 },
    ageing: { age: 4 },
    is_maiden: false,
    tourney_profits: { DEZ: 7.5 },
  },
  {
    hid: 102,
    hstats_bike: { races: 6, wins: 1 },
    hstats_car: { races: 0, wins: 0 },
    hstats_horse: { races: 0, wins: 0 },
    ageing: { age: 3 },
    is_maiden: true,
    tourney_profits: { DEZ: 1.2 },
  },
]);

function powerMode(power: number, races: number) {
  return Object.freeze({
    power,
    adjodds: power / 100,
    variance: 0.08,
    races_n: races,
  });
}

export const dnaOpenLabCorePower: readonly DnaCorePower[] = Object.freeze([
  {
    hid: 101,
    power: {
      bike: powerMode(82, 12),
      car: powerMode(0, 0),
      horse: powerMode(0, 0),
    },
    m_stats: { synthetic: true },
  },
  {
    hid: 102,
    power: {
      bike: powerMode(76, 6),
      car: powerMode(0, 0),
      horse: powerMode(0, 0),
    },
    m_stats: { synthetic: true },
  },
]);

export const dnaOpenLabCoreListingPrices: readonly DnaCoreListingPrice[] =
  Object.freeze([
    { hid: 101, price: 125, token: "DEZ", expires_at: "2026-08-28T00:00:00Z" },
    { hid: 102 },
  ]);

export const dnaOpenLabCoreAttachedAssets: readonly DnaCoreAttachedAssets[] =
  Object.freeze([
    {
      hid: 101,
      skino: { bike: { id: "skin-1" }, car: null, horse: null },
      trailsmap: { bike: ["trail-1"] },
    },
    {
      hid: 102,
      skino: { bike: null, car: null, horse: null },
      trailsmap: {},
    },
  ]);

export const dnaOpenLabCoreOwners: readonly DnaCoreOwner[] = Object.freeze([
  { hid: 101, vault: DNA_OPEN_LAB_SYNTHETIC_VAULT },
  { hid: 102, vault: DNA_OPEN_LAB_SYNTHETIC_VAULT },
]);

export const dnaOpenLabCoreStamina: readonly DnaCoreStamina[] = Object.freeze([
  {
    hid: 101,
    stamina: {
      stamina: 8,
      max_stamina: 10,
      next_refill: "2026-08-27T04:00:00Z",
      last_event: "2026-08-27T02:00:00Z",
    },
    spstamina: { giveid: 501, stamina: 2 },
  },
  {
    hid: 102,
    stamina: {
      stamina: 10,
      max_stamina: 10,
      next_refill: null,
      last_event: null,
    },
    spstamina: null,
  },
]);

export const dnaOpenLabCoreSplicingInfo: readonly DnaCoreSplicingInfo[] =
  Object.freeze([
    {
      hid: 101,
      parents: [1, 2],
      grand_parents: [3, 4, 5, 6],
      challenge_credit: 1,
      splice_core: { available: true },
    },
    {
      hid: 102,
      parents: [7, 8],
      grand_parents: [9, 10, 11, 12],
      challenge_credit: 0,
      splice_core: { available: false },
    },
  ]);

export const dnaOpenLabTokenPrices: DnaTokenPrices = Object.freeze({
  ethusd: 3200,
  btcusd: 71000,
  dezusd: 0.125,
  hlxusd: 0.08,
  bgcusd: 0.02,
  tpusd: 0.5,
  methusd: 3200,
  mbtcusd: 71000,
});

export const dnaOpenLabSpliceDocument: DnaSpliceDocument = Object.freeze({
  reqid: "splice-request-1",
  hid: null,
  minted: false,
  minted_at: null,
  requested_at: "2026-08-27T01:00:00Z",
  payment_tx: null,
  found_payment_tx: null,
  info: { synthetic: true },
  request: { father_coreid: 101, mother_coreid: 102 },
  alw_list: [],
  transfers: [],
  errmsg: null,
  retry: null,
  next_retry: null,
});

export const dnaOpenLabSpliceArena: readonly DnaSpliceArenaCore[] = Object.freeze([
  {
    hid: 101,
    name: "Synthetic Alpha",
    type: "freak",
    gender: "female",
    element: "water",
    color: "blue",
    hex_code: "#0000ff",
    fno: 10,
    price_usd: 12.5,
  },
]);

export const dnaOpenLabSplicePairInfo: DnaSplicePairInfo = Object.freeze({
  f: { hid: 101, name: "Synthetic Alpha" },
  m: { hid: 102, name: "Synthetic Beta" },
  baby_info: { element: "water", fno: 12, type: "freak" },
  prices: { DEZ: 100, usd: 12.5 },
});

export const dnaOpenLabSplicePairValidation: DnaSplicePairValidation =
  Object.freeze({ valid: true });
