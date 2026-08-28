import { createHash } from "node:crypto";

import type {
  AdaptedCoreDetailsRow,
  CoreClass,
  CoreElement,
  CoreSex,
} from "@/domain/source-adapters";
import type { RaceMode } from "@/domain/import-contract";
import type {
  DnaActiveRace,
  DnaCoreAttachedAssets,
  DnaCoreInfo,
  DnaCoreListingPrice,
  DnaCoreOwner,
  DnaCorePower,
  DnaCorePowerMode,
  DnaCoreRacingStats,
  DnaCoreSplicingInfo,
  DnaCoreStamina,
  DnaOpenLabScope,
  DnaRaceMode,
  DnaRaceDocument,
  DnaRaceFill,
  DnaSpliceArenaResult,
  DnaSplicePairInfo,
  DnaTokenPrices,
  DnaVaultCore,
} from "@/lib/dna-open-lab-v1-client";

export const DNA_OPEN_LAB_SOURCE = "dna_open_lab" as const;
export const DNA_OPEN_LAB_SOURCE_VERSION = "v1" as const;

export class DnaOpenLabAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DnaOpenLabAdapterError";
  }
}

export type DnaOpenLabEvidence<T> = Readonly<{
  source: typeof DNA_OPEN_LAB_SOURCE;
  sourceVersion: typeof DNA_OPEN_LAB_SOURCE_VERSION;
  scope: DnaOpenLabScope;
  endpoint: string;
  entityKey: string;
  observedAt: string;
  rawEvidenceSha256: string;
  canonical: T;
}>;

export type CanonicalActiveRaceSnapshot = Readonly<{
  sourceType: "active_race_snapshot";
  sourceRaceId: string;
  status: string;
  displayName: string;
  mode: RaceMode;
  format: string | null;
  raceClassSourceValue: string | number | null;
  fixedFeesByAsset: Readonly<Record<string, number>>;
  entryFeeUsd: number;
  paymentAsset: string;
  startAt: string | null;
  endAt: string | null;
}>;

export type DnaRaceDocumentEndpoint =
  "races.finished" | "races.docs" | "vault.recent_races";

export type CanonicalRaceDocumentMetadata = Readonly<{
  sourceType: "race_document";
  sourceRaceId: string;
  status?: string;
  displayName?: string;
  mode?: RaceMode;
  format?: string | null;
  raceClassSourceValue?: string | number | null;
  gateCount?: number;
  filledGateCount?: number;
  entrantCoreIds?: readonly string[];
  fixedFeesByAsset?: Readonly<Record<string, number>>;
  entryFeeUsd?: number;
  paymentAsset?: string;
  startAt?: string | null;
  endAt?: string | null;
  eventTagsSourceValues?: readonly string[];
  payoutSourceValue?: string;
  prizeSourceValue?: number;
  prizeUsdSourceValue?: number;
  trackSourceValue?: string;
  yellowStarSourceCoreIds?: readonly string[];
  blueStarSourceCoreIds?: readonly string[];
}>;

export type CanonicalRaceFillSnapshot = Readonly<{
  sourceType: "race_fill_snapshot";
  sourceRaceId: string;
  status: string;
  gateCount: number;
  filledGateCount: number;
  entrantCoreIds: readonly string[];
  entryConfirmationsBySourceKey: Readonly<Record<string, boolean>>;
}>;

export type JsonSourceValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonSourceValue[]
  | Readonly<{ [key: string]: JsonSourceValue }>;

export type CanonicalCoreRacingStatsSnapshot = Readonly<{
  sourceType: "core_racing_stats_snapshot";
  sourceCoreId: string;
  statsByMode: Readonly<Record<DnaRaceMode, JsonSourceValue>>;
  ageingSourceValue: JsonSourceValue;
  isMaiden: boolean;
  tournamentProfitsSourceValue: JsonSourceValue;
}>;

export type CanonicalCorePowerModeSnapshot = Readonly<{
  powerSourceValue: JsonSourceValue;
  adjustedOddsSourceValue: JsonSourceValue;
  varianceSourceValue: JsonSourceValue;
  raceCount: number;
}>;

export type CanonicalCorePowerSnapshot = Readonly<{
  sourceType: "core_power_snapshot";
  sourceCoreId: string;
  byMode: Readonly<Record<DnaRaceMode, CanonicalCorePowerModeSnapshot>>;
  aggregateStatsSourceValue: JsonSourceValue;
}>;

export type CanonicalCoreListingSnapshot = Readonly<{
  sourceType: "core_listing_snapshot";
  sourceCoreId: string;
  priceSourceValue?: number;
  paymentAssetSourceValue?: string;
  expiresAt?: string;
}>;

export type CanonicalCoreAttachedAssetsSnapshot = Readonly<{
  sourceType: "core_attached_assets_snapshot";
  sourceCoreId: string;
  skinSourceValueByMode: Readonly<Record<DnaRaceMode, JsonSourceValue>>;
  trailsSourceValue: JsonSourceValue;
}>;

export type CanonicalCoreOwnerSnapshot = Readonly<{
  sourceType: "core_owner_snapshot";
  sourceCoreId: string;
  vaultSourceValue: string;
}>;

export type CanonicalCoreStaminaSnapshot = Readonly<{
  sourceType: "core_stamina_snapshot";
  sourceCoreId: string;
  current: number;
  maximum: number;
  nextRefillAt: string | null;
  lastEventAt: string | null;
  special: Readonly<{
    sourceGiveId: string;
    current: number;
    maximum?: number;
  }> | null;
}>;

export type CanonicalCoreSplicingSnapshot = Readonly<{
  sourceType: "core_splicing_snapshot";
  sourceCoreId: string;
  parentsSourceValue: JsonSourceValue;
  grandparentsSourceValue: JsonSourceValue;
  challengeCreditSourceValue: JsonSourceValue;
  spliceCoreSourceValue: JsonSourceValue;
}>;

export const DNA_TOKEN_PRICE_ASSETS = Object.freeze([
  "ETH",
  "BTC",
  "DEZ",
  "HLX",
  "BGC",
  "TP",
  "METH",
  "MBTC",
] as const);

export type DnaTokenPriceAsset = (typeof DNA_TOKEN_PRICE_ASSETS)[number];

export type CanonicalTokenPricesSnapshot = Readonly<{
  sourceType: "token_prices_snapshot";
  valuationUse: "current_reference_only";
  usdReferencePriceByAsset: Readonly<Record<DnaTokenPriceAsset, number>>;
}>;

export type CanonicalSpliceArenaListing = Readonly<{
  sourceCoreId: string;
  displayName: string;
  coreTypeSourceValue: string;
  genderSourceValue: string;
  elementSourceValue: string;
  colorSourceValue: string;
  hexColorSourceValue: string;
  fNumber: number;
  priceUsdSourceValue: number;
}>;

export type CanonicalSpliceArenaPageSnapshot = Readonly<{
  sourceType: "splice_arena_page_snapshot";
  mode: DnaRaceMode;
  page: number;
  pageSizeLimit: number;
  hasMore: boolean;
  listings: readonly CanonicalSpliceArenaListing[];
}>;

export type CanonicalSplicePairInfoSnapshot = Readonly<{
  sourceType: "splice_pair_info_snapshot";
  fatherSourceCoreId: string;
  motherSourceCoreId: string;
  fatherSourceValue: JsonSourceValue;
  motherSourceValue: JsonSourceValue;
  baby: Readonly<{
    elementSourceValue: string;
    fNumber: number;
    typeSourceValue: string;
  }>;
  pricesSourceValue: JsonSourceValue;
}>;

function adapterError(message: string): never {
  throw new DnaOpenLabAdapterError(message);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1) adapterError(`${field} is required`);
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    adapterError(`${field} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    adapterError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function nonNegativeFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    adapterError(`${field} must be a finite non-negative number`);
  }
  return value;
}

function booleanValue(value: boolean, field: string): boolean {
  if (typeof value !== "boolean") adapterError(`${field} must be boolean`);
  return value;
}

function timestamp(value: string, field: string): string {
  const normalized = requiredText(value, field);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    )
  ) {
    adapterError(`${field} must be a timezone-qualified ISO timestamp`);
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    adapterError(`${field} must be a valid timestamp`);
  }
  return parsed.toISOString();
}

function optionalTimestamp(value: string | null, field: string): string | null {
  return value === null ? null : timestamp(value, field);
}

function optionalText(value: string | null, field: string): string | null {
  return value === null ? null : requiredText(value, field);
}

function raceClassSourceValue(
  value: string | number | null,
  field: string,
): string | number | null {
  if (value === null) return null;
  if (typeof value === "string") return requiredText(value, field);
  if (!Number.isFinite(value)) adapterError(`${field} must be finite`);
  return value;
}

function sourceCoreIds(
  values: readonly number[],
  field: string,
): readonly string[] {
  return Object.freeze(
    values.map((value) => String(positiveInteger(value, field))),
  );
}

function sourceTextValues(
  values: readonly string[],
  field: string,
): readonly string[] {
  return Object.freeze(values.map((value) => requiredText(value, field)));
}

function fixedFeesByAsset(
  values: Readonly<Record<string, number>>,
  field: string,
): Readonly<Record<string, number>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(values).map(([asset, amount]) => [
        requiredText(asset, `${field}.asset`),
        nonNegativeFinite(amount, `${field}.${asset}`),
      ]),
    ),
  );
}

function coreClass(value: string): CoreClass {
  const normalized = requiredText(value, "core.type")
    .toLowerCase()
    .replace(/[^a-z]/gu, "");
  const classes: Readonly<Record<string, CoreClass>> = {
    genesis: "Genesis",
    morphed: "Morphed",
    freak: "Freak",
    xclass: "X-Class",
  };
  return classes[normalized] ?? adapterError("core.type is unsupported");
}

function coreElement(value: string): CoreElement {
  const elements: Readonly<Record<string, CoreElement>> = {
    metal: "Metal",
    fire: "Fire",
    earth: "Earth",
    water: "Water",
  };
  return (
    elements[requiredText(value, "core.element").toLowerCase()] ??
    adapterError("core.element is unsupported")
  );
}

function coreSex(value: string): CoreSex {
  const normalized = requiredText(value, "core.gender").toLowerCase();
  if (normalized === "male" || normalized === "female") return normalized;
  return adapterError("core.gender is unsupported");
}

function raceMode(value: string): RaceMode {
  const normalized = requiredText(value, "race.mode").toLowerCase();
  if (normalized === "bike" || normalized === "car" || normalized === "horse") {
    return normalized;
  }
  return adapterError("race.mode is unsupported");
}

function raceIdentifier(value: string | number): string {
  if (typeof value === "number")
    return String(positiveInteger(value, "race.id"));
  return requiredText(value, "race.id");
}

function raceDocumentScope(endpoint: DnaRaceDocumentEndpoint): DnaOpenLabScope {
  return endpoint === "vault.recent_races" ? "vault" : "races";
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return adapterError("raw API evidence contains a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return adapterError("raw API evidence contains a non-JSON value");
}

function jsonSourceValue(value: unknown, field: string): JsonSourceValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      adapterError(`${field} contains a non-finite number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((entry, index) =>
        jsonSourceValue(entry, `${field}[${String(index)}]`),
      ),
    );
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      adapterError(`${field} contains a non-JSON object`);
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [
            key,
            jsonSourceValue(entry, `${field}.${key}`),
          ]),
      ),
    );
  }
  return adapterError(`${field} contains a non-JSON value`);
}

function sourceCoreIdentifier(value: number): string {
  return String(positiveInteger(value, "core.hid"));
}

export function dnaOpenLabRawEvidenceSha256(raw: unknown): string {
  return createHash("sha256").update(canonicalJson(raw), "utf8").digest("hex");
}

export function adaptDnaTokenPrices(input: {
  raw: DnaTokenPrices;
  observedAt: string;
}): DnaOpenLabEvidence<CanonicalTokenPricesSnapshot> {
  const canonical: CanonicalTokenPricesSnapshot = Object.freeze({
    sourceType: "token_prices_snapshot",
    valuationUse: "current_reference_only",
    usdReferencePriceByAsset: Object.freeze({
      ETH: nonNegativeFinite(input.raw.ethusd, "tokens.prices.ETH"),
      BTC: nonNegativeFinite(input.raw.btcusd, "tokens.prices.BTC"),
      DEZ: nonNegativeFinite(input.raw.dezusd, "tokens.prices.DEZ"),
      HLX: nonNegativeFinite(input.raw.hlxusd, "tokens.prices.HLX"),
      BGC: nonNegativeFinite(input.raw.bgcusd, "tokens.prices.BGC"),
      TP: nonNegativeFinite(input.raw.tpusd, "tokens.prices.TP"),
      METH: nonNegativeFinite(input.raw.methusd, "tokens.prices.METH"),
      MBTC: nonNegativeFinite(input.raw.mbtcusd, "tokens.prices.MBTC"),
    }),
  });
  return evidence({
    scope: "tokens",
    endpoint: "tokens.prices",
    entityKey: "token-prices:current",
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

export function adaptDnaSpliceArenaPage(input: {
  raw: DnaSpliceArenaResult;
  mode: DnaRaceMode;
  observedAt: string;
}): DnaOpenLabEvidence<CanonicalSpliceArenaPageSnapshot> {
  const mode = raceMode(input.mode) as DnaRaceMode;
  const page = positiveInteger(input.raw.page, "spliceArena.page");
  const pageSizeLimit = positiveInteger(
    input.raw.limit,
    "spliceArena.pageSizeLimit",
  );
  if (input.raw.cores.length > pageSizeLimit) {
    adapterError("spliceArena listing count cannot exceed its page limit");
  }
  const seen = new Set<string>();
  const listings = Object.freeze(
    input.raw.cores.map((core) => {
      const sourceCoreId = sourceCoreIdentifier(core.hid);
      if (seen.has(sourceCoreId)) {
        adapterError("spliceArena page cannot contain duplicate Core IDs");
      }
      seen.add(sourceCoreId);
      return Object.freeze({
        sourceCoreId,
        displayName: requiredText(core.name, "spliceArena.core.name"),
        coreTypeSourceValue: requiredText(core.type, "spliceArena.core.type"),
        genderSourceValue: requiredText(core.gender, "spliceArena.core.gender"),
        elementSourceValue: requiredText(
          core.element,
          "spliceArena.core.element",
        ),
        colorSourceValue: requiredText(core.color, "spliceArena.core.color"),
        hexColorSourceValue: requiredText(
          core.hex_code,
          "spliceArena.core.hexColor",
        ),
        fNumber: positiveInteger(core.fno, "spliceArena.core.fNumber"),
        priceUsdSourceValue: nonNegativeFinite(
          core.price_usd,
          "spliceArena.core.priceUsd",
        ),
      });
    }),
  );
  const canonical: CanonicalSpliceArenaPageSnapshot = Object.freeze({
    sourceType: "splice_arena_page_snapshot",
    mode,
    page,
    pageSizeLimit,
    hasMore: booleanValue(input.raw.has_more, "spliceArena.hasMore"),
    listings,
  });
  return evidence({
    scope: "splice",
    endpoint: "splice.arena",
    entityKey: `splice-arena:${mode}:page:${String(page)}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

export function adaptDnaSplicePairInfo(input: {
  raw: DnaSplicePairInfo;
  fatherCoreId: number;
  motherCoreId: number;
  observedAt: string;
}): DnaOpenLabEvidence<CanonicalSplicePairInfoSnapshot> {
  const fatherSourceCoreId = sourceCoreIdentifier(input.fatherCoreId);
  const motherSourceCoreId = sourceCoreIdentifier(input.motherCoreId);
  if (fatherSourceCoreId === motherSourceCoreId) {
    adapterError("splicePairInfo parents must be distinct Cores");
  }
  const canonical: CanonicalSplicePairInfoSnapshot = Object.freeze({
    sourceType: "splice_pair_info_snapshot",
    fatherSourceCoreId,
    motherSourceCoreId,
    fatherSourceValue: jsonSourceValue(input.raw.f, "splicePairInfo.father"),
    motherSourceValue: jsonSourceValue(input.raw.m, "splicePairInfo.mother"),
    baby: Object.freeze({
      elementSourceValue: requiredText(
        input.raw.baby_info.element,
        "splicePairInfo.baby.element",
      ),
      fNumber: positiveInteger(
        input.raw.baby_info.fno,
        "splicePairInfo.baby.fNumber",
      ),
      typeSourceValue: requiredText(
        input.raw.baby_info.type,
        "splicePairInfo.baby.type",
      ),
    }),
    pricesSourceValue: jsonSourceValue(
      input.raw.prices,
      "splicePairInfo.prices",
    ),
  });
  return evidence({
    scope: "splice",
    endpoint: "splice.pair_info",
    entityKey: `splice-pair:${fatherSourceCoreId}:${motherSourceCoreId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

function evidence<T>(input: {
  scope: DnaOpenLabScope;
  endpoint: string;
  entityKey: string;
  observedAt: string;
  raw: unknown;
  canonical: T;
}): DnaOpenLabEvidence<T> {
  return Object.freeze({
    source: DNA_OPEN_LAB_SOURCE,
    sourceVersion: DNA_OPEN_LAB_SOURCE_VERSION,
    scope: input.scope,
    endpoint: requiredText(input.endpoint, "endpoint"),
    entityKey: requiredText(input.entityKey, "entityKey"),
    observedAt: timestamp(input.observedAt, "observedAt"),
    rawEvidenceSha256: dnaOpenLabRawEvidenceSha256(input.raw),
    canonical: input.canonical,
  });
}

function canonicalCoreDetails(input: {
  hid: number;
  name: string;
  type: string;
  element: string;
  gender: string;
  fno: number;
  color: string | null;
}): AdaptedCoreDetailsRow {
  const hid = positiveInteger(input.hid, "core.hid");
  return Object.freeze({
    sourceType: "core_details",
    sourceCoreId: String(hid),
    displayName: requiredText(input.name, "core.name"),
    coreClass: coreClass(input.type),
    element: coreElement(input.element),
    fNumber: positiveInteger(input.fno, "core.fno"),
    sex: coreSex(input.gender),
    colorSourceValue:
      input.color === null ? null : requiredText(input.color, "core.color"),
    fatherSourceCoreId: null,
    fatherNameSourceValue: null,
    motherSourceCoreId: null,
    motherNameSourceValue: null,
  });
}

export function adaptDnaCoreInfo(input: {
  raw: DnaCoreInfo;
  observedAt: string;
}): DnaOpenLabEvidence<AdaptedCoreDetailsRow> {
  const canonical = canonicalCoreDetails({
    hid: input.raw.hid,
    name: input.raw.name,
    type: input.raw.type,
    element: input.raw.element,
    gender: input.raw.gender,
    fno: input.raw.fno,
    color: input.raw.color,
  });
  return evidence({
    scope: "cores",
    endpoint: "cores.info",
    entityKey: `core:${canonical.sourceCoreId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

export function adaptDnaVaultCore(input: {
  raw: DnaVaultCore;
  observedAt: string;
}): DnaOpenLabEvidence<AdaptedCoreDetailsRow> {
  const canonical = canonicalCoreDetails({
    hid: input.raw.hid,
    name: input.raw.name,
    type: input.raw.type,
    element: input.raw.element,
    gender: input.raw.gender,
    fno: input.raw.fno,
    color: null,
  });
  return evidence({
    scope: "vault",
    endpoint: "vault.cores_full",
    entityKey: `core:${canonical.sourceCoreId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

export function adaptDnaActiveRace(input: {
  raw: DnaActiveRace;
  observedAt: string;
}): DnaOpenLabEvidence<CanonicalActiveRaceSnapshot> {
  const sourceRaceId = raceIdentifier(input.raw.rid);
  const canonical: CanonicalActiveRaceSnapshot = Object.freeze({
    sourceType: "active_race_snapshot",
    sourceRaceId,
    status: requiredText(input.raw.status, "race.status"),
    displayName: requiredText(input.raw.race_name, "race.name"),
    mode: raceMode(input.raw.rvmode),
    format:
      input.raw.format === null
        ? null
        : requiredText(input.raw.format, "race.format"),
    raceClassSourceValue: raceClassSourceValue(input.raw.class, "race.class"),
    fixedFeesByAsset: fixedFeesByAsset(input.raw.fee_fixed, "race.fixedFee"),
    entryFeeUsd: nonNegativeFinite(input.raw.feeusd, "race.entryFeeUsd"),
    paymentAsset: requiredText(input.raw.paytoken, "race.paymentAsset"),
    startAt: optionalTimestamp(input.raw.start_time, "race.startAt"),
    endAt: optionalTimestamp(input.raw.end_time ?? null, "race.endAt"),
  });
  return evidence({
    scope: "races",
    endpoint: "races.active",
    entityKey: `race:${sourceRaceId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

export function adaptDnaRaceDocument(input: {
  raw: DnaRaceDocument;
  observedAt: string;
  endpoint: DnaRaceDocumentEndpoint;
}): DnaOpenLabEvidence<CanonicalRaceDocumentMetadata> {
  const sourceRaceId = raceIdentifier(input.raw.rid);
  const canonical: CanonicalRaceDocumentMetadata = Object.freeze({
    sourceType: "race_document",
    sourceRaceId,
    ...(input.raw.status === undefined
      ? {}
      : { status: requiredText(input.raw.status, "race.status") }),
    ...(input.raw.race_name === undefined
      ? {}
      : { displayName: requiredText(input.raw.race_name, "race.name") }),
    ...(input.raw.rvmode === undefined
      ? {}
      : { mode: raceMode(input.raw.rvmode) }),
    ...(input.raw.format === undefined
      ? {}
      : { format: optionalText(input.raw.format, "race.format") }),
    ...(input.raw.class === undefined
      ? {}
      : {
          raceClassSourceValue: raceClassSourceValue(
            input.raw.class,
            "race.class",
          ),
        }),
    ...(input.raw.rgate === undefined
      ? {}
      : { gateCount: positiveInteger(input.raw.rgate, "race.gateCount") }),
    ...(input.raw.hs_in === undefined
      ? {}
      : {
          filledGateCount: nonNegativeInteger(
            input.raw.hs_in,
            "race.filledGateCount",
          ),
        }),
    ...(input.raw.hids === undefined
      ? {}
      : {
          entrantCoreIds: sourceCoreIds(input.raw.hids, "race.entrantCoreId"),
        }),
    ...(input.raw.fee_fixed === undefined
      ? {}
      : {
          fixedFeesByAsset: fixedFeesByAsset(
            input.raw.fee_fixed,
            "race.fixedFee",
          ),
        }),
    ...(input.raw.feeusd === undefined
      ? {}
      : {
          entryFeeUsd: nonNegativeFinite(input.raw.feeusd, "race.entryFeeUsd"),
        }),
    ...(input.raw.paytoken === undefined
      ? {}
      : {
          paymentAsset: requiredText(input.raw.paytoken, "race.paymentAsset"),
        }),
    ...(input.raw.start_time === undefined
      ? {}
      : {
          startAt: optionalTimestamp(input.raw.start_time, "race.startAt"),
        }),
    ...(input.raw.end_time === undefined
      ? {}
      : { endAt: optionalTimestamp(input.raw.end_time, "race.endAt") }),
    ...(input.raw.eventtags === undefined
      ? {}
      : {
          eventTagsSourceValues: sourceTextValues(
            input.raw.eventtags,
            "race.eventTag",
          ),
        }),
    ...(input.raw.payout === undefined
      ? {}
      : {
          payoutSourceValue: requiredText(input.raw.payout, "race.payout"),
        }),
    ...(input.raw.prize === undefined
      ? {}
      : {
          prizeSourceValue: nonNegativeFinite(input.raw.prize, "race.prize"),
        }),
    ...(input.raw.prizeusd === undefined
      ? {}
      : {
          prizeUsdSourceValue: nonNegativeFinite(
            input.raw.prizeusd,
            "race.prizeUsd",
          ),
        }),
    ...(input.raw.track === undefined
      ? {}
      : {
          trackSourceValue: requiredText(input.raw.track, "race.track"),
        }),
    ...(input.raw.yellowstars === undefined
      ? {}
      : {
          yellowStarSourceCoreIds: sourceCoreIds(
            input.raw.yellowstars,
            "race.yellowStarCoreId",
          ),
        }),
    ...(input.raw.bluestars === undefined
      ? {}
      : {
          blueStarSourceCoreIds: sourceCoreIds(
            input.raw.bluestars,
            "race.blueStarCoreId",
          ),
        }),
  });
  return evidence({
    scope: raceDocumentScope(input.endpoint),
    endpoint: input.endpoint,
    entityKey: `race:${sourceRaceId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

export function adaptDnaRaceFill(input: {
  raw: DnaRaceFill;
  observedAt: string;
}): DnaOpenLabEvidence<CanonicalRaceFillSnapshot> {
  const sourceRaceId = raceIdentifier(input.raw.rid);
  const gateCount = positiveInteger(input.raw.rgate, "raceFill.gateCount");
  const filledGateCount = nonNegativeInteger(
    input.raw.hs_in,
    "raceFill.filledGateCount",
  );
  if (filledGateCount > gateCount) {
    adapterError("raceFill.filledGateCount cannot exceed raceFill.gateCount");
  }

  const entrantCoreIds = Object.freeze(
    input.raw.hids.map((hid) => String(positiveInteger(hid, "raceFill.hid"))),
  );
  if (entrantCoreIds.length !== filledGateCount) {
    adapterError("raceFill entrant count must equal raceFill.filledGateCount");
  }

  const entryConfirmationsBySourceKey = Object.freeze(
    Object.fromEntries(
      Object.entries(input.raw.entry_txns_confirmed)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sourceKey, confirmed]) => [
          requiredText(sourceKey, "raceFill.entryConfirmation.sourceKey"),
          confirmed,
        ]),
    ),
  );

  const canonical: CanonicalRaceFillSnapshot = Object.freeze({
    sourceType: "race_fill_snapshot",
    sourceRaceId,
    status: requiredText(input.raw.status, "raceFill.status"),
    gateCount,
    filledGateCount,
    entrantCoreIds,
    entryConfirmationsBySourceKey,
  });

  return evidence({
    scope: "races",
    endpoint: "races.fills",
    entityKey: `race:${sourceRaceId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

export function adaptDnaCoreRacingStats(input: {
  raw: DnaCoreRacingStats;
  observedAt: string;
}): DnaOpenLabEvidence<CanonicalCoreRacingStatsSnapshot> {
  const sourceCoreId = sourceCoreIdentifier(input.raw.hid);
  const canonical: CanonicalCoreRacingStatsSnapshot = Object.freeze({
    sourceType: "core_racing_stats_snapshot",
    sourceCoreId,
    statsByMode: Object.freeze({
      bike: jsonSourceValue(input.raw.hstats_bike, "core.racingStats.bike"),
      car: jsonSourceValue(input.raw.hstats_car, "core.racingStats.car"),
      horse: jsonSourceValue(input.raw.hstats_horse, "core.racingStats.horse"),
    }),
    ageingSourceValue: jsonSourceValue(input.raw.ageing, "core.ageing"),
    isMaiden: booleanValue(input.raw.is_maiden, "core.isMaiden"),
    tournamentProfitsSourceValue: jsonSourceValue(
      input.raw.tourney_profits,
      "core.tournamentProfits",
    ),
  });
  return evidence({
    scope: "cores",
    endpoint: "cores.racing_stats",
    entityKey: `core:${sourceCoreId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

function canonicalCorePowerMode(
  input: DnaCorePowerMode,
  mode: DnaRaceMode,
): CanonicalCorePowerModeSnapshot {
  return Object.freeze({
    powerSourceValue: jsonSourceValue(input.power, `core.power.${mode}.power`),
    adjustedOddsSourceValue: jsonSourceValue(
      input.adjodds,
      `core.power.${mode}.adjustedOdds`,
    ),
    varianceSourceValue: jsonSourceValue(
      input.variance,
      `core.power.${mode}.variance`,
    ),
    raceCount: nonNegativeInteger(
      input.races_n,
      `core.power.${mode}.raceCount`,
    ),
  });
}

export function adaptDnaCorePower(input: {
  raw: DnaCorePower;
  observedAt: string;
}): DnaOpenLabEvidence<CanonicalCorePowerSnapshot> {
  const sourceCoreId = sourceCoreIdentifier(input.raw.hid);
  const canonical: CanonicalCorePowerSnapshot = Object.freeze({
    sourceType: "core_power_snapshot",
    sourceCoreId,
    byMode: Object.freeze({
      bike: canonicalCorePowerMode(input.raw.power.bike, "bike"),
      car: canonicalCorePowerMode(input.raw.power.car, "car"),
      horse: canonicalCorePowerMode(input.raw.power.horse, "horse"),
    }),
    aggregateStatsSourceValue: jsonSourceValue(
      input.raw.m_stats,
      "core.power.aggregateStats",
    ),
  });
  return evidence({
    scope: "cores",
    endpoint: "cores.power",
    entityKey: `core:${sourceCoreId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

export function adaptDnaCoreListingPrice(input: {
  raw: DnaCoreListingPrice;
  observedAt: string;
}): DnaOpenLabEvidence<CanonicalCoreListingSnapshot> {
  const sourceCoreId = sourceCoreIdentifier(input.raw.hid);
  const canonical: CanonicalCoreListingSnapshot = Object.freeze({
    sourceType: "core_listing_snapshot",
    sourceCoreId,
    ...(input.raw.price === undefined
      ? {}
      : {
          priceSourceValue: nonNegativeFinite(
            input.raw.price,
            "core.listing.price",
          ),
        }),
    ...(input.raw.token === undefined
      ? {}
      : {
          paymentAssetSourceValue: requiredText(
            input.raw.token,
            "core.listing.paymentAsset",
          ),
        }),
    ...(input.raw.expires_at === undefined
      ? {}
      : {
          expiresAt: timestamp(input.raw.expires_at, "core.listing.expiresAt"),
        }),
  });
  return evidence({
    scope: "cores",
    endpoint: "cores.listing_price",
    entityKey: `core:${sourceCoreId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

export function adaptDnaCoreAttachedAssets(input: {
  raw: DnaCoreAttachedAssets;
  observedAt: string;
}): DnaOpenLabEvidence<CanonicalCoreAttachedAssetsSnapshot> {
  const sourceCoreId = sourceCoreIdentifier(input.raw.hid);
  const canonical: CanonicalCoreAttachedAssetsSnapshot = Object.freeze({
    sourceType: "core_attached_assets_snapshot",
    sourceCoreId,
    skinSourceValueByMode: Object.freeze({
      bike: jsonSourceValue(input.raw.skino.bike, "core.assets.skin.bike"),
      car: jsonSourceValue(input.raw.skino.car, "core.assets.skin.car"),
      horse: jsonSourceValue(input.raw.skino.horse, "core.assets.skin.horse"),
    }),
    trailsSourceValue: jsonSourceValue(
      input.raw.trailsmap,
      "core.assets.trails",
    ),
  });
  return evidence({
    scope: "cores",
    endpoint: "cores.attached_assets",
    entityKey: `core:${sourceCoreId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

export function adaptDnaCoreOwner(input: {
  raw: DnaCoreOwner;
  observedAt: string;
}): DnaOpenLabEvidence<CanonicalCoreOwnerSnapshot> {
  const sourceCoreId = sourceCoreIdentifier(input.raw.hid);
  const canonical: CanonicalCoreOwnerSnapshot = Object.freeze({
    sourceType: "core_owner_snapshot",
    sourceCoreId,
    vaultSourceValue: requiredText(input.raw.vault, "core.owner.vault"),
  });
  return evidence({
    scope: "cores",
    endpoint: "cores.owner",
    entityKey: `core:${sourceCoreId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

export function adaptDnaCoreStamina(input: {
  raw: DnaCoreStamina;
  observedAt: string;
}): DnaOpenLabEvidence<CanonicalCoreStaminaSnapshot> {
  const sourceCoreId = sourceCoreIdentifier(input.raw.hid);
  const special =
    input.raw.spstamina === null
      ? null
      : Object.freeze({
          sourceGiveId:
            typeof input.raw.spstamina.giveid === "number"
              ? String(
                  positiveInteger(
                    input.raw.spstamina.giveid,
                    "core.stamina.special.giveId",
                  ),
                )
              : requiredText(
                  input.raw.spstamina.giveid,
                  "core.stamina.special.giveId",
                ),
          current: nonNegativeFinite(
            input.raw.spstamina.stamina,
            "core.stamina.special.current",
          ),
          ...(input.raw.spstamina.max_stamina === undefined
            ? {}
            : {
                maximum: nonNegativeFinite(
                  input.raw.spstamina.max_stamina,
                  "core.stamina.special.maximum",
                ),
              }),
        });
  const canonical: CanonicalCoreStaminaSnapshot = Object.freeze({
    sourceType: "core_stamina_snapshot",
    sourceCoreId,
    current: nonNegativeFinite(
      input.raw.stamina.stamina,
      "core.stamina.current",
    ),
    maximum: nonNegativeFinite(
      input.raw.stamina.max_stamina,
      "core.stamina.maximum",
    ),
    nextRefillAt: optionalTimestamp(
      input.raw.stamina.next_refill,
      "core.stamina.nextRefillAt",
    ),
    lastEventAt: optionalTimestamp(
      input.raw.stamina.last_event,
      "core.stamina.lastEventAt",
    ),
    special,
  });
  return evidence({
    scope: "cores",
    endpoint: "cores.stamina",
    entityKey: `core:${sourceCoreId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}

export function adaptDnaCoreSplicingInfo(input: {
  raw: DnaCoreSplicingInfo;
  observedAt: string;
}): DnaOpenLabEvidence<CanonicalCoreSplicingSnapshot> {
  const sourceCoreId = sourceCoreIdentifier(input.raw.hid);
  const canonical: CanonicalCoreSplicingSnapshot = Object.freeze({
    sourceType: "core_splicing_snapshot",
    sourceCoreId,
    parentsSourceValue: jsonSourceValue(
      input.raw.parents,
      "core.splicing.parents",
    ),
    grandparentsSourceValue: jsonSourceValue(
      input.raw.grand_parents,
      "core.splicing.grandparents",
    ),
    challengeCreditSourceValue: jsonSourceValue(
      input.raw.challenge_credit,
      "core.splicing.challengeCredit",
    ),
    spliceCoreSourceValue: jsonSourceValue(
      input.raw.splice_core,
      "core.splicing.spliceCore",
    ),
  });
  return evidence({
    scope: "cores",
    endpoint: "cores.splicing_info",
    entityKey: `core:${sourceCoreId}`,
    observedAt: input.observedAt,
    raw: input.raw,
    canonical,
  });
}
