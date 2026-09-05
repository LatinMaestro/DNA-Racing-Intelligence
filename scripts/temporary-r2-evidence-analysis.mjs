#!/usr/bin/env node

/**
 * TEMPORARY / DO NOT MERGE.
 *
 * One-off read-only analysis of already-retained DNA Open Lab P5 evidence.
 * This script performs R2 LIST + GET only. It makes no DNA API calls, no Neon
 * writes, no R2 writes/deletes and no deployment changes. Outputs are sanitized
 * derived summaries only; raw request/response envelopes are never emitted.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const OUTPUT_DIR = process.env.TEMP_ANALYSIS_OUTPUT_DIR ?? "temp-analysis-output";
const MAX_OBJECTS = 17_500;
const MAX_TOTAL_BYTES = 1_151_165_717;
const MAX_OBJECT_BYTES = 8_388_608;
const READ_CONCURRENCY = 16;
const EXTERNAL_PAIR_LIMIT_PER_OWNED_CORE = 50;

const SOURCE_FAMILIES = new Set([
  "finished_races",
  "race_activity",
  "token_prices",
  "vault_identity",
  "core_current_state",
  "splice_arena",
]);

const CLASS_MATRIX = Object.freeze({
  Genesis: Object.freeze({
    Genesis: "Morphed",
    Morphed: "Freak",
    Freak: "Freak",
    "X-Class": "X-Class",
  }),
  Morphed: Object.freeze({
    Genesis: "Freak",
    Morphed: "Freak",
    Freak: "X-Class",
    "X-Class": "X-Class",
  }),
  Freak: Object.freeze({
    Genesis: "Freak",
    Morphed: "X-Class",
    Freak: "X-Class",
    "X-Class": "X-Class",
  }),
  "X-Class": Object.freeze({
    Genesis: "X-Class",
    Morphed: "X-Class",
    Freak: "X-Class",
    "X-Class": "X-Class",
  }),
});

const ELEMENT_RANK = Object.freeze({ Metal: 4, Fire: 3, Earth: 2, Water: 1 });
const BASE_SPLICE_FEE = Object.freeze({
  Metal: Object.freeze({ Genesis: 40, Morphed: 25, Freak: 12, "X-Class": 8 }),
  Fire: Object.freeze({ Genesis: 30, Morphed: 16, Freak: 10, "X-Class": 6 }),
  Earth: Object.freeze({ Genesis: 20, Morphed: 10, Freak: 7, "X-Class": 4 }),
  Water: Object.freeze({ Genesis: 10, Morphed: 6, Freak: 4, "X-Class": 3 }),
});

function requiredEnvironment(name) {
  const value = process.env[name];
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.trim() !== value ||
    value.length > 4096 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function normalizeVault(value) {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/u.test(normalized)) {
    throw new Error("TARGET_VAULT is invalid");
  }
  return normalized;
}

function ownerPrefix(ownerId) {
  return createHash("sha256")
    .update(`dna-open-lab-owner\u0000${ownerId}`, "utf8")
    .digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asPositiveInt(value) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asText(value, maximum = 512) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function asTimestamp(value) {
  const text = asText(value, 128);
  if (text === null || !Number.isFinite(Date.parse(text))) return null;
  return new Date(text).toISOString();
}

function primitive(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  return undefined;
}

function flattenScalars(value, maximumEntries = 96) {
  const output = {};
  const visit = (node, path, depth) => {
    if (Object.keys(output).length >= maximumEntries || depth > 6) return;
    const scalar = primitive(node);
    if (scalar !== undefined) {
      if (path !== "") output[path] = scalar;
      return;
    }
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        if (Object.keys(output).length >= maximumEntries) break;
        visit(node[index], `${path}[${index}]`, depth + 1);
      }
      return;
    }
    const record = asRecord(node);
    if (record === null) return;
    for (const [key, entry] of Object.entries(record)) {
      if (Object.keys(output).length >= maximumEntries) break;
      const next = path === "" ? key : `${path}.${key}`;
      visit(entry, next, depth + 1);
    }
  };
  visit(value, "", 0);
  return output;
}

function extractLineageIds(value) {
  const ids = new Set();
  const visit = (node, keyHint, depth) => {
    if (depth > 6) return;
    const numeric = asPositiveInt(node);
    if (numeric !== null && /(hid|core.?id|father|mother|parent)/iu.test(keyHint)) {
      ids.add(numeric);
      return;
    }
    if (
      typeof node === "string" &&
      /^[1-9][0-9]*$/u.test(node) &&
      /(hid|core.?id|father|mother|parent)/iu.test(keyHint)
    ) {
      const parsed = Number(node);
      if (Number.isSafeInteger(parsed)) ids.add(parsed);
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, keyHint, depth + 1);
      return;
    }
    const record = asRecord(node);
    if (record === null) return;
    for (const [key, entry] of Object.entries(record)) {
      visit(entry, key, depth + 1);
    }
  };
  visit(value, "parent", 0);
  return [...ids].sort((left, right) => left - right);
}

function incrementObjectCounter(target, key) {
  if (key === null || key === undefined || key === "") return;
  const text = String(key);
  target[text] = (target[text] ?? 0) + 1;
}

function normalizeClass(value) {
  const text = asText(value, 64);
  if (text === null) return null;
  const normalized = text.toLowerCase().replace(/[ _]/gu, "-");
  if (normalized === "genesis") return "Genesis";
  if (normalized === "morphed") return "Morphed";
  if (normalized === "freak") return "Freak";
  if (normalized === "x-class" || normalized === "xclass") return "X-Class";
  return null;
}

function normalizeElement(value) {
  const text = asText(value, 64)?.toLowerCase() ?? null;
  if (text === "metal") return "Metal";
  if (text === "fire") return "Fire";
  if (text === "earth") return "Earth";
  if (text === "water") return "Water";
  return null;
}

function normalizeGender(value) {
  const text = asText(value, 64)?.toLowerCase() ?? null;
  if (text === "male" || text === "m") return "male";
  if (text === "female" || text === "f") return "female";
  return null;
}

function lowerElement(left, right) {
  const a = normalizeElement(left);
  const b = normalizeElement(right);
  if (a === null || b === null) return null;
  return ELEMENT_RANK[a] <= ELEMENT_RANK[b] ? a : b;
}

function offspringClass(left, right) {
  const a = normalizeClass(left);
  const b = normalizeClass(right);
  if (a === null || b === null) return null;
  return CLASS_MATRIX[a]?.[b] ?? null;
}

function dnaBaseFee(core) {
  const element = normalizeElement(core.element);
  const coreClass = normalizeClass(core.type);
  if (element === null || coreClass === null) return null;
  return BASE_SPLICE_FEE[element]?.[coreClass] ?? null;
}

function safeCoreIdentity(record) {
  const hid = asPositiveInt(record.hid);
  if (hid === null) return null;
  return {
    hid,
    name: asText(record.name, 256),
    type: asText(record.type, 64),
    element: asText(record.element, 64),
    gender: asText(record.gender, 64),
    fno: asPositiveInt(record.fno),
  };
}

function newRaceDiagnostic(hid) {
  return {
    hid,
    raceCount: 0,
    participantEntryCount: 0,
    yellowEligibleRaces: 0,
    yellowAssignmentOpportunities: 0,
    blueAssignmentOpportunities: 0,
    yellowAssignments: 0,
    blueAssignments: 0,
    bothAssignments: 0,
    firstRaceAt: null,
    lastRaceAt: null,
    modes: {},
    rawTracks: {},
    formats: {},
    payouts: {},
    eventTags: {},
    gateCounts: {},
  };
}

function raceDiagnostic(map, hid) {
  let current = map.get(hid);
  if (current === undefined) {
    current = newRaceDiagnostic(hid);
    map.set(hid, current);
  }
  return current;
}

function mergeIdentity(existing, incoming, conflictCounter) {
  if (existing === undefined) return { ...incoming };
  const output = { ...existing };
  for (const key of ["name", "type", "element", "gender", "fno"]) {
    if (output[key] == null && incoming[key] != null) output[key] = incoming[key];
    else if (incoming[key] != null && output[key] != null && output[key] !== incoming[key]) {
      conflictCounter.count += 1;
    }
  }
  return output;
}

function sortedCounter(counter) {
  return Object.fromEntries(
    Object.entries(counter).sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    }),
  );
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function bodyToText(body, expectedLength) {
  if (body == null || typeof body[Symbol.asyncIterator] !== "function") {
    throw new Error("R2 object body is unavailable");
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    total += bytes.byteLength;
    if (total > MAX_OBJECT_BYTES || total > expectedLength + 1) {
      throw new Error("R2 object body exceeds its bounded length");
    }
    chunks.push(bytes);
  }
  if (total !== expectedLength) {
    throw new Error("R2 object body length disagrees with listing metadata");
  }
  const joined = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return joined.toString("utf8");
}

async function listEvidenceObjects(client, bucketName, prefix) {
  let continuationToken;
  const objects = [];
  let totalBytes = 0;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: 1000,
        ...(continuationToken === undefined
          ? {}
          : { ContinuationToken: continuationToken }),
      }),
    );
    for (const object of page.Contents ?? []) {
      const key = asText(object.Key, 4096);
      const size = asFiniteNumber(object.Size);
      if (
        key === null ||
        size === null ||
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > MAX_OBJECT_BYTES ||
        !/\/requests\/[0-9]{6}\.json$/u.test(key)
      ) {
        throw new Error("Unexpected object under the temporary evidence prefix");
      }
      objects.push({ key, size });
      totalBytes += size;
      if (objects.length > MAX_OBJECTS || totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("Temporary evidence inventory exceeds the approved P5 bounds");
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && continuationToken === undefined) {
      throw new Error("R2 listing pagination is incomplete");
    }
  } while (continuationToken !== undefined);
  objects.sort((left, right) => left.key.localeCompare(right.key));
  return { objects, totalBytes };
}

const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID").toLowerCase();
if (!/^[a-f0-9]{32}$/u.test(accountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID is invalid");
const authorizedOwnerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
const accessKeyId = requiredEnvironment("DNA_R2_ACCESS_KEY_ID");
const secretAccessKey = requiredEnvironment("DNA_R2_SECRET_ACCESS_KEY");
const bucketName = requiredEnvironment("DNA_R2_BUCKET_NAME");
const targetVault = normalizeVault(requiredEnvironment("TARGET_VAULT"));

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
  maxAttempts: 4,
});

const evidencePrefix = [
  "dna-open-lab",
  "v1",
  ownerPrefix(authorizedOwnerId),
  "first-private-preview-backfill",
  "",
].join("/");

await mkdir(OUTPUT_DIR, { recursive: true });
console.log("Temporary R2 analysis: listing retained evidence objects...");
const { objects, totalBytes } = await listEvidenceObjects(s3, bucketName, evidencePrefix);
if (objects.length < 1) throw new Error("No retained P5 evidence objects were found");
console.log(`Temporary R2 analysis: found ${objects.length} bounded evidence objects.`);

const familyCounts = {};
const endpointCounts = {};
const measurementEvidenceSha256 = new Set();
const observedAtValues = [];
const coreRace = new Map();
const seenRaceIds = new Set();
const ownedIds = new Set();
const ownedIdentity = new Map();
const ownedCurrent = new Map();
const arenaCores = new Map();
const identityConflicts = { count: 0 };
const diagnostics = {
  malformedEvidenceDocuments: 0,
  duplicateRaceDocuments: 0,
  unidentifiedFinishedRaceDocuments: 0,
  finishedRaceDocumentsWithoutParticipants: 0,
  starAssignmentsOutsideParticipantList: 0,
  arenaIdentityConflicts: 0,
};
const raceUniverse = {
  uniqueRaceDocuments: 0,
  participantEntries: 0,
  modes: {},
  rawTracks: {},
  formats: {},
  payouts: {},
  gateCounts: {},
  eventTags: {},
};

function currentCore(hid) {
  let value = ownedCurrent.get(hid);
  if (value === undefined) {
    value = { hid };
    ownedCurrent.set(hid, value);
  }
  return value;
}

function consumeVaultIdentity(endpoint, result) {
  if (endpoint !== "vault.cores_full") return;
  for (const raw of asArray(result)) {
    const record = asRecord(raw);
    if (record === null) continue;
    const identity = safeCoreIdentity(record);
    if (identity === null) continue;
    ownedIds.add(identity.hid);
    ownedIdentity.set(
      identity.hid,
      mergeIdentity(ownedIdentity.get(identity.hid), identity, identityConflicts),
    );
  }
}

function consumeCoreCurrent(endpoint, result) {
  for (const raw of asArray(result)) {
    const record = asRecord(raw);
    if (record === null) continue;
    const hid = asPositiveInt(record.hid);
    if (hid === null) continue;
    const target = currentCore(hid);
    if (endpoint === "cores.info_bulk") {
      const identity = safeCoreIdentity(record);
      if (identity !== null) {
        ownedIdentity.set(
          hid,
          mergeIdentity(ownedIdentity.get(hid), identity, identityConflicts),
        );
      }
      target.info = {
        name: asText(record.name, 256),
        type: asText(record.type, 64),
        element: asText(record.element, 64),
        color: asText(record.color, 128),
        fno: asPositiveInt(record.fno),
        gender: asText(record.gender, 64),
        vault: asText(record.vault, 128),
      };
    } else if (endpoint === "cores.racing_stats_bulk") {
      target.racingStats = {
        isMaiden: typeof record.is_maiden === "boolean" ? record.is_maiden : null,
        ageingScalars: flattenScalars(record.ageing, 64),
        bikeScalars: flattenScalars(record.hstats_bike, 96),
        carScalars: flattenScalars(record.hstats_car, 96),
        horseScalars: flattenScalars(record.hstats_horse, 96),
        tournamentProfitScalars: flattenScalars(record.tourney_profits, 64),
      };
    } else if (endpoint === "cores.power_bulk") {
      const power = asRecord(record.power);
      target.power = {};
      for (const mode of ["bike", "car", "horse"]) {
        const value = asRecord(power?.[mode]);
        if (value === null) continue;
        target.power[mode] = {
          power: primitive(value.power) ?? null,
          adjustedOdds: primitive(value.adjodds) ?? null,
          variance: primitive(value.variance) ?? null,
          racesN: asPositiveInt(value.races_n) ?? 0,
        };
      }
      target.powerMetadataScalars = flattenScalars(record.m_stats, 64);
    } else if (endpoint === "cores.listing_price_bulk") {
      target.listing = {
        price: asFiniteNumber(record.price),
        token: asText(record.token, 64),
        expiresAt: asTimestamp(record.expires_at),
      };
    } else if (endpoint === "cores.attached_assets_bulk") {
      target.attachedAssetScalars = flattenScalars(
        { skino: record.skino, trailsmap: record.trailsmap },
        96,
      );
    } else if (endpoint === "cores.owner_bulk") {
      target.ownerVault = asText(record.vault, 128);
    } else if (endpoint === "cores.stamina_bulk") {
      target.staminaScalars = flattenScalars(
        { stamina: record.stamina, splice_stamina: record.spstamina },
        64,
      );
    } else if (endpoint === "cores.splicing_info_bulk") {
      target.splicing = {
        parentIds: extractLineageIds(record.parents),
        grandParentIds: extractLineageIds(record.grand_parents),
        challengeCreditScalars: flattenScalars(record.challenge_credit, 32),
        spliceCoreScalars: flattenScalars(record.splice_core, 64),
      };
    }
  }
}

function consumeArena(endpoint, result) {
  const mode = endpoint.startsWith("splice.arena.") ? endpoint.slice("splice.arena.".length) : null;
  const root = asRecord(result);
  if (mode === null || root === null) return;
  for (const raw of asArray(root.cores)) {
    const record = asRecord(raw);
    if (record === null) continue;
    const identity = safeCoreIdentity(record);
    if (identity === null) continue;
    const price = asFiniteNumber(record.price_usd);
    let current = arenaCores.get(identity.hid);
    if (current === undefined) {
      current = {
        ...identity,
        listingModes: new Set(),
        priceUsdByMode: {},
      };
      arenaCores.set(identity.hid, current);
    } else {
      for (const key of ["name", "type", "element", "gender", "fno"]) {
        if (identity[key] != null && current[key] != null && identity[key] !== current[key]) {
          diagnostics.arenaIdentityConflicts += 1;
        }
        if (current[key] == null && identity[key] != null) current[key] = identity[key];
      }
    }
    current.listingModes.add(mode);
    if (price !== null) current.priceUsdByMode[mode] = price;
  }
}

function consumeFinishedRaces(result) {
  for (const raw of asArray(result)) {
    const race = asRecord(raw);
    if (race === null) continue;
    const ridText =
      typeof race.rid === "string" || Number.isSafeInteger(race.rid)
        ? String(race.rid)
        : null;
    if (ridText === null || ridText.trim() === "") {
      diagnostics.unidentifiedFinishedRaceDocuments += 1;
      continue;
    }
    if (seenRaceIds.has(ridText)) {
      diagnostics.duplicateRaceDocuments += 1;
      continue;
    }
    seenRaceIds.add(ridText);
    raceUniverse.uniqueRaceDocuments += 1;

    const mode = asText(race.rvmode, 32);
    const track = asText(race.track, 128);
    const format = asText(race.format, 128);
    const payout = asText(race.payout, 128);
    const startAt = asTimestamp(race.start_time);
    const gateCount = asPositiveInt(race.rgate);
    const tags = asArray(race.eventtags)
      .map((value) => asText(value, 128))
      .filter((value) => value !== null);
    incrementObjectCounter(raceUniverse.modes, mode);
    incrementObjectCounter(raceUniverse.rawTracks, track);
    incrementObjectCounter(raceUniverse.formats, format);
    incrementObjectCounter(raceUniverse.payouts, payout);
    incrementObjectCounter(raceUniverse.gateCounts, gateCount);
    for (const tag of tags) incrementObjectCounter(raceUniverse.eventTags, tag);

    const participants = [...new Set(asArray(race.hids).map(asPositiveInt).filter((value) => value !== null))];
    const yellow = [...new Set(asArray(race.yellowstars).map(asPositiveInt).filter((value) => value !== null))];
    const blue = [...new Set(asArray(race.bluestars).map(asPositiveInt).filter((value) => value !== null))];
    if (participants.length === 0) diagnostics.finishedRaceDocumentsWithoutParticipants += 1;
    const participantSet = new Set(participants);
    for (const starHid of [...yellow, ...blue]) {
      if (!participantSet.has(starHid)) diagnostics.starAssignmentsOutsideParticipantList += 1;
    }

    raceUniverse.participantEntries += participants.length;
    for (const hid of participants) {
      const diag = raceDiagnostic(coreRace, hid);
      diag.raceCount += 1;
      diag.participantEntryCount += 1;
      incrementObjectCounter(diag.modes, mode);
      incrementObjectCounter(diag.rawTracks, track);
      incrementObjectCounter(diag.formats, format);
      incrementObjectCounter(diag.payouts, payout);
      incrementObjectCounter(diag.gateCounts, gateCount);
      for (const tag of tags) incrementObjectCounter(diag.eventTags, tag);
      if (gateCount !== null && gateCount > 3) {
        diag.yellowEligibleRaces += 1;
        if (yellow.length > 0) diag.yellowAssignmentOpportunities += 1;
      }
      if (blue.length > 0) diag.blueAssignmentOpportunities += 1;
      const hasYellow = yellow.includes(hid) && (gateCount === null || gateCount > 3);
      const hasBlue = blue.includes(hid);
      if (hasYellow) diag.yellowAssignments += 1;
      if (hasBlue) diag.blueAssignments += 1;
      if (hasYellow && hasBlue) diag.bothAssignments += 1;
      if (startAt !== null) {
        if (diag.firstRaceAt === null || startAt < diag.firstRaceAt) diag.firstRaceAt = startAt;
        if (diag.lastRaceAt === null || startAt > diag.lastRaceAt) diag.lastRaceAt = startAt;
      }
    }

    for (const hid of [...yellow, ...blue]) {
      if (!participantSet.has(hid)) {
        const diag = raceDiagnostic(coreRace, hid);
        if (yellow.includes(hid) && (gateCount === null || gateCount > 3)) diag.yellowAssignments += 1;
        if (blue.includes(hid)) diag.blueAssignments += 1;
      }
    }
  }
}

function consumeEvidence(document) {
  const family = asText(document.family, 64);
  const endpoint = asText(document.endpoint, 128);
  const observedAt = asTimestamp(document.observedAt);
  const requestOrdinal = asPositiveInt(document.requestOrdinal);
  const measurementSha = asText(document.measurementEvidenceSha256, 64);
  const response = asRecord(document.response);
  if (
    document.version !== 1 ||
    document.source !== "dna_open_lab" ||
    document.sourceVersion !== "v1" ||
    family === null ||
    !SOURCE_FAMILIES.has(family) ||
    endpoint === null ||
    observedAt === null ||
    requestOrdinal === null ||
    measurementSha === null ||
    !/^[a-f0-9]{64}$/u.test(measurementSha) ||
    response === null
  ) {
    diagnostics.malformedEvidenceDocuments += 1;
    return;
  }
  incrementObjectCounter(familyCounts, family);
  incrementObjectCounter(endpointCounts, endpoint);
  measurementEvidenceSha256.add(measurementSha);
  observedAtValues.push(observedAt);
  const result = response.result;
  if (family === "finished_races" && endpoint === "races.finished") consumeFinishedRaces(result);
  else if (family === "vault_identity") consumeVaultIdentity(endpoint, result);
  else if (family === "core_current_state") consumeCoreCurrent(endpoint, result);
  else if (family === "splice_arena") consumeArena(endpoint, result);
}

let nextIndex = 0;
let completed = 0;
async function worker() {
  while (true) {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= objects.length) return;
    const object = objects[index];
    const opened = await s3.send(
      new GetObjectCommand({ Bucket: bucketName, Key: object.key }),
    );
    if (opened.ContentLength !== undefined && Number(opened.ContentLength) !== object.size) {
      throw new Error("R2 object ContentLength disagrees with listing metadata");
    }
    const text = await bodyToText(opened.Body, object.size);
    const expectedSha = opened.Metadata?.["dna-body-sha256"];
    if (typeof expectedSha === "string" && /^[a-f0-9]{64}$/u.test(expectedSha)) {
      if (sha256(text) !== expectedSha) throw new Error("R2 evidence checksum mismatch");
    }
    let document;
    try {
      document = JSON.parse(text);
    } catch {
      diagnostics.malformedEvidenceDocuments += 1;
      continue;
    }
    const record = asRecord(document);
    if (record === null) diagnostics.malformedEvidenceDocuments += 1;
    else consumeEvidence(record);
    completed += 1;
    if (completed % 500 === 0 || completed === objects.length) {
      console.log(`Temporary R2 analysis: processed ${completed}/${objects.length} objects.`);
    }
  }
}

await Promise.all(Array.from({ length: READ_CONCURRENCY }, () => worker()));

for (const hid of ownedCurrent.keys()) ownedIds.add(hid);
for (const hid of ownedIds) {
  if (!ownedIdentity.has(hid)) {
    const current = ownedCurrent.get(hid)?.info;
    if (current !== undefined) {
      ownedIdentity.set(hid, {
        hid,
        name: current.name ?? null,
        type: current.type ?? null,
        element: current.element ?? null,
        gender: current.gender ?? null,
        fno: current.fno ?? null,
      });
    } else {
      ownedIdentity.set(hid, { hid, name: null, type: null, element: null, gender: null, fno: null });
    }
  }
}

function finalizeRaceDiagnostic(diag) {
  return {
    ...diag,
    yellowAssignmentRateEligible:
      diag.yellowEligibleRaces > 0 ? diag.yellowAssignments / diag.yellowEligibleRaces : null,
    yellowAssignmentRateWhenAvailable:
      diag.yellowAssignmentOpportunities > 0
        ? diag.yellowAssignments / diag.yellowAssignmentOpportunities
        : null,
    blueAssignmentRateWhenAvailable:
      diag.blueAssignmentOpportunities > 0
        ? diag.blueAssignments / diag.blueAssignmentOpportunities
        : null,
    modes: sortedCounter(diag.modes),
    rawTracks: sortedCounter(diag.rawTracks),
    formats: sortedCounter(diag.formats),
    payouts: sortedCounter(diag.payouts),
    eventTags: sortedCounter(diag.eventTags),
    gateCounts: sortedCounter(diag.gateCounts),
  };
}

const allCoreRaceDiagnostics = [...coreRace.values()]
  .map(finalizeRaceDiagnostic)
  .sort((left, right) => right.raceCount - left.raceCount || left.hid - right.hid);

const ownedCoreOutput = [...ownedIds]
  .sort((left, right) => left - right)
  .map((hid) => ({
    ...ownedIdentity.get(hid),
    currentState: ownedCurrent.get(hid) ?? null,
    historicalApiRaceDiagnostic: coreRace.has(hid)
      ? finalizeRaceDiagnostic(coreRace.get(hid))
      : finalizeRaceDiagnostic(newRaceDiagnostic(hid)),
  }));

const arenaOutput = [...arenaCores.values()]
  .map((core) => {
    const prices = Object.values(core.priceUsdByMode).filter((value) => Number.isFinite(value));
    return {
      hid: core.hid,
      name: core.name,
      type: core.type,
      element: core.element,
      gender: core.gender,
      fno: core.fno,
      listingModes: [...core.listingModes].sort(),
      priceUsdByMode: Object.fromEntries(Object.entries(core.priceUsdByMode).sort()),
      minimumArenaPriceUsd: prices.length > 0 ? Math.min(...prices) : null,
      historicalApiRaceDiagnostic: coreRace.has(core.hid)
        ? finalizeRaceDiagnostic(coreRace.get(core.hid))
        : finalizeRaceDiagnostic(newRaceDiagnostic(core.hid)),
    };
  })
  .sort((left, right) =>
    right.historicalApiRaceDiagnostic.raceCount - left.historicalApiRaceDiagnostic.raceCount ||
    left.hid - right.hid,
  );

function knownOwnedRelationship(leftHid, rightHid) {
  const left = ownedCurrent.get(leftHid)?.splicing;
  const right = ownedCurrent.get(rightHid)?.splicing;
  const leftParents = new Set(left?.parentIds ?? []);
  const rightParents = new Set(right?.parentIds ?? []);
  const leftGrand = new Set(left?.grandParentIds ?? []);
  const rightGrand = new Set(right?.grandParentIds ?? []);
  if (leftParents.has(rightHid) || rightParents.has(leftHid)) return "parent";
  if (leftGrand.has(rightHid) || rightGrand.has(leftHid)) return "grandparent";
  if (
    leftParents.size === 2 &&
    rightParents.size === 2 &&
    [...leftParents].every((value) => rightParents.has(value))
  ) {
    return "full_sibling";
  }
  return null;
}

function pairProjection(left, right) {
  const leftF = asPositiveInt(left.fno);
  const rightF = asPositiveInt(right.fno);
  const leftFee = dnaBaseFee(left);
  const rightFee = dnaBaseFee(right);
  return {
    offspringClass: offspringClass(left.type, right.type),
    offspringElement: lowerElement(left.element, right.element),
    offspringFno: leftF !== null && rightF !== null ? leftF + rightF : null,
    dnaBaseFeeSourceUnits:
      leftFee !== null && rightFee !== null ? Math.max(leftFee, rightFee) : null,
  };
}

const ownedOwnedPairs = [];
const ownedIdentityList = [...ownedIds]
  .map((hid) => ownedIdentity.get(hid))
  .filter((value) => value !== undefined);
for (let leftIndex = 0; leftIndex < ownedIdentityList.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < ownedIdentityList.length; rightIndex += 1) {
    const left = ownedIdentityList[leftIndex];
    const right = ownedIdentityList[rightIndex];
    const leftGender = normalizeGender(left.gender);
    const rightGender = normalizeGender(right.gender);
    if (leftGender === null || rightGender === null || leftGender === rightGender) continue;
    const relationship = knownOwnedRelationship(left.hid, right.hid);
    if (relationship !== null) continue;
    ownedOwnedPairs.push({
      left: { hid: left.hid, name: left.name, gender: leftGender, type: left.type, element: left.element, fno: left.fno },
      right: { hid: right.hid, name: right.name, gender: rightGender, type: right.type, element: right.element, fno: right.fno },
      projection: pairProjection(left, right),
      lineageScreen: "no_known_parent_grandparent_or_full_sibling_conflict_in_retained_owned_lineage",
      validationStatus: "exploratory_only_pair_validate_still_required",
      leftRaceEvidenceCoverage: coreRace.get(left.hid)?.raceCount ?? 0,
      rightRaceEvidenceCoverage: coreRace.get(right.hid)?.raceCount ?? 0,
    });
  }
}
ownedOwnedPairs.sort(
  (left, right) =>
    right.leftRaceEvidenceCoverage + right.rightRaceEvidenceCoverage -
      (left.leftRaceEvidenceCoverage + left.rightRaceEvidenceCoverage) ||
    left.left.hid - right.left.hid ||
    left.right.hid - right.right.hid,
);

const externalPairScreen = [];
for (const owned of ownedIdentityList) {
  const ownedGender = normalizeGender(owned.gender);
  if (ownedGender === null) continue;
  const candidates = [];
  const ownedLineage = ownedCurrent.get(owned.hid)?.splicing;
  const prohibitedKnown = new Set([
    ...(ownedLineage?.parentIds ?? []),
    ...(ownedLineage?.grandParentIds ?? []),
  ]);
  for (const arena of arenaOutput) {
    if (ownedIds.has(arena.hid) || prohibitedKnown.has(arena.hid)) continue;
    const arenaGender = normalizeGender(arena.gender);
    if (arenaGender === null || arenaGender === ownedGender) continue;
    candidates.push({
      owned: { hid: owned.hid, name: owned.name, gender: ownedGender, type: owned.type, element: owned.element, fno: owned.fno },
      arena: {
        hid: arena.hid,
        name: arena.name,
        gender: arenaGender,
        type: arena.type,
        element: arena.element,
        fno: arena.fno,
        listingModes: arena.listingModes,
        minimumArenaPriceUsd: arena.minimumArenaPriceUsd,
      },
      projection: pairProjection(owned, arena),
      externalRaceEvidenceCoverage: arena.historicalApiRaceDiagnostic.raceCount,
      rawStarDiagnostics: {
        yellowAssignments: arena.historicalApiRaceDiagnostic.yellowAssignments,
        blueAssignments: arena.historicalApiRaceDiagnostic.blueAssignments,
        yellowEligibleRaces: arena.historicalApiRaceDiagnostic.yellowEligibleRaces,
        yellowAssignmentOpportunities:
          arena.historicalApiRaceDiagnostic.yellowAssignmentOpportunities,
        blueAssignmentOpportunities:
          arena.historicalApiRaceDiagnostic.blueAssignmentOpportunities,
      },
      lineageScreen:
        "owned_parent_and_grandparent_conflicts_checked_only; external_full_lineage_unavailable",
      validationStatus: "exploratory_only_requires_pair_validate_and_lineage_check",
      rankingBasis:
        "evidence_coverage_only; raw_star_counts_are_diagnostic_and_receive_no_positive_quality_weight",
    });
  }
  candidates.sort((left, right) => {
    if (right.externalRaceEvidenceCoverage !== left.externalRaceEvidenceCoverage) {
      return right.externalRaceEvidenceCoverage - left.externalRaceEvidenceCoverage;
    }
    const leftPrice = left.arena.minimumArenaPriceUsd ?? Number.POSITIVE_INFINITY;
    const rightPrice = right.arena.minimumArenaPriceUsd ?? Number.POSITIVE_INFINITY;
    if (leftPrice !== rightPrice) return leftPrice - rightPrice;
    return left.arena.hid - right.arena.hid;
  });
  externalPairScreen.push(...candidates.slice(0, EXTERNAL_PAIR_LIMIT_PER_OWNED_CORE));
}

const dataCurrentThrough = observedAtValues.length > 0 ? observedAtValues.sort().at(-1) : null;
const dataFirstObserved = observedAtValues.length > 0 ? observedAtValues.sort().at(0) : null;

const summary = {
  temporaryBranchOnly: true,
  doNotMergeIntoMain: true,
  targetVault,
  generatedAt: new Date().toISOString(),
  source: {
    retainedR2EvidenceObjectCount: objects.length,
    retainedR2EvidenceBytes: totalBytes,
    measurementEvidenceSha256: [...measurementEvidenceSha256].sort(),
    firstObservedAt: dataFirstObserved,
    dataCurrentThrough,
    familyObjectCounts: sortedCounter(familyCounts),
    endpointObjectCounts: sortedCounter(endpointCounts),
  },
  coverage: {
    ownedCoreCount: ownedIds.size,
    allObservedRaceCoreCount: allCoreRaceDiagnostics.length,
    currentArenaCoreCount: arenaOutput.length,
    uniqueFinishedRaceDocumentCount: raceUniverse.uniqueRaceDocuments,
    raceParticipantEntryCount: raceUniverse.participantEntries,
    ownedOwnedExploratoryPairCount: ownedOwnedPairs.length,
    ownedArenaExploratoryPairScreenCount: externalPairScreen.length,
  },
  raceUniverse: {
    modes: sortedCounter(raceUniverse.modes),
    rawTracksUnclassified: sortedCounter(raceUniverse.rawTracks),
    formats: sortedCounter(raceUniverse.formats),
    payouts: sortedCounter(raceUniverse.payouts),
    gateCounts: sortedCounter(raceUniverse.gateCounts),
    eventTags: sortedCounter(raceUniverse.eventTags),
  },
  diagnostics: {
    ...diagnostics,
    identityConflicts: identityConflicts.count,
  },
  limitations: [
    "Historical DNA Open Lab API race evidence does not currently establish direct elapsed race time or finishing position for this retained path.",
    "The API source field 'track' is retained as an unclassified source value and is not silently treated as exact distance.",
    "Raw Yellow/source-Gold and Blue assignment counts are diagnostics only; they receive no positive quality weight without established pre-race opponent quality.",
    "Current power/adjusted-odds/variance/racing-stat fields are timestamped current observations and are not leaked backward into historical performance claims.",
    "The breeding pair files are exploratory candidate screens only. External full lineage and official pair_validate authority are not present in this retained P5 evidence and must be checked before a splice decision.",
  ],
};

const warning = [
  "TEMPORARY R2 ANALYSIS OUTPUT — DO NOT MERGE INTO MAIN",
  "",
  "Generated from read-only LIST/GET access to already-retained private P5 evidence.",
  "No raw request/response envelope is included in this output.",
  "No DNA API call, Neon write, R2 write/delete or deployment was performed.",
  "",
  "Breeding pair files are exploratory screens, not validated recommendations.",
  "The API race evidence currently lacks authoritative elapsed-time/finishing-position fields on this path.",
  "",
].join("\n");

await Promise.all([
  writeFile(`${OUTPUT_DIR}/TEMPORARY_DO_NOT_MERGE.txt`, warning, "utf8"),
  writeFile(`${OUTPUT_DIR}/analysis-summary.json`, stableJson(summary), "utf8"),
  writeFile(`${OUTPUT_DIR}/owned-core-current-state.json`, stableJson(ownedCoreOutput), "utf8"),
  writeFile(`${OUTPUT_DIR}/all-core-race-diagnostics.json`, stableJson(allCoreRaceDiagnostics), "utf8"),
  writeFile(`${OUTPUT_DIR}/arena-core-catalogue.json`, stableJson(arenaOutput), "utf8"),
  writeFile(`${OUTPUT_DIR}/breeding-owned-owned-exploratory-screen.json`, stableJson(ownedOwnedPairs), "utf8"),
  writeFile(`${OUTPUT_DIR}/breeding-owned-arena-exploratory-screen.json`, stableJson(externalPairScreen), "utf8"),
]);

const stepSummary = process.env.GITHUB_STEP_SUMMARY;
if (typeof stepSummary === "string" && stepSummary.trim() !== "") {
  await appendFile(
    stepSummary,
    [
      "## TEMPORARY R2 analysis — DO NOT MERGE",
      "",
      `- Retained evidence objects read: **${objects.length}**`,
      `- Unique finished race documents observed: **${raceUniverse.uniqueRaceDocuments}**`,
      `- Race-participating Core IDs observed: **${allCoreRaceDiagnostics.length}**`,
      `- Owned Cores observed: **${ownedIds.size}**`,
      `- Arena Cores observed: **${arenaOutput.length}**`,
      `- Owned-owned exploratory pair screens: **${ownedOwnedPairs.length}**`,
      `- Owned-arena exploratory pair screens retained: **${externalPairScreen.length}**`,
      "",
      "> This branch and workflow are temporary. Do not merge or cherry-pick them into main.",
      "> Output is derived/sanitized; no raw API envelope is uploaded.",
      "",
    ].join("\n"),
    "utf8",
  );
}

console.log("Temporary R2 analysis complete. Derived files are ready for one-day artifact upload.");
