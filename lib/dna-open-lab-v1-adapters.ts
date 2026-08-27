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
  DnaCoreInfo,
  DnaOpenLabScope,
  DnaRaceDocument,
  DnaRaceFill,
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
  raceClass: string | null;
  fixedFeesByAsset: Readonly<Record<string, number>>;
  entryFeeUsd: number;
  paymentAsset: string;
  startAt: string;
  endAt: string | null;
}>;

export type DnaRaceDocumentEndpoint =
  "races.finished" | "races.docs" | "vault.recent_races";

export type CanonicalRaceDocumentReference = Readonly<{
  sourceType: "race_document";
  sourceRaceId: string;
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

export function dnaOpenLabRawEvidenceSha256(raw: unknown): string {
  return createHash("sha256").update(canonicalJson(raw), "utf8").digest("hex");
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
  const fixedFeesByAsset = Object.fromEntries(
    Object.entries(input.raw.fee_fixed).map(([asset, amount]) => [
      requiredText(asset, "race.fixedFee.asset"),
      nonNegativeFinite(amount, `race.fixedFee.${asset}`),
    ]),
  );
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
    raceClass:
      input.raw.class === null
        ? null
        : requiredText(input.raw.class, "race.class"),
    fixedFeesByAsset: Object.freeze(fixedFeesByAsset),
    entryFeeUsd: nonNegativeFinite(input.raw.feeusd, "race.entryFeeUsd"),
    paymentAsset: requiredText(input.raw.paytoken, "race.paymentAsset"),
    startAt: timestamp(input.raw.start_time, "race.startAt"),
    endAt: optionalTimestamp(input.raw.end_time, "race.endAt"),
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
}): DnaOpenLabEvidence<CanonicalRaceDocumentReference> {
  const sourceRaceId = raceIdentifier(input.raw.rid);
  const canonical: CanonicalRaceDocumentReference = Object.freeze({
    sourceType: "race_document",
    sourceRaceId,
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
