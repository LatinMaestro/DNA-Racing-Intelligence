import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DnaOpenLabApiError,
  createDnaOpenLabV1Client,
  type DnaOpenLabResponse,
  type DnaRaceDocument,
  type DnaRaceIdentifier,
} from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

const enabled = process.env.DNA_TEMP_LATEST_DISCOVERY_20260909 === "1";
const describeConnected = enabled ? describe : describe.skip;
const OWNER_VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";
const START = "2026-09-07T00:00:00.000Z";
const FINISHED_LIMIT = 200;
const MIN_WINDOW_MS = 1_000;
const REQUEST_INTERVAL_MS = 1_050;
const CORE_BATCH_SIZE = 20;

type AnyRecord = Record<string, unknown>;
type Window = { startTime: string; endTime: string };

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size) as T[]);
  return out;
}

function finiteHid(value: unknown): number | null {
  const hid = Number(value);
  return Number.isSafeInteger(hid) && hid > 0 ? hid : null;
}

function hidsFrom(value: unknown): number[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return [...new Set(value.flatMap((entry) => hidsFrom(entry)))];
  const direct = finiteHid(value);
  if (direct !== null) return [direct];
  if (typeof value !== "object") return [];
  const record = value as AnyRecord;
  const preferred = ["hid", "hids", "core_id", "coreId", "token_id", "tokenId"];
  const directPreferred = preferred.flatMap((key) => hidsFrom(record[key]));
  if (directPreferred.length > 0) return [...new Set(directPreferred)];
  return [...new Set(Object.values(record).flatMap((entry) => hidsFrom(entry)))];
}

function raceOwnedHids(race: AnyRecord, owned: Set<number>): number[] {
  const values = [race.hids, race.yellowstars, race.bluestars];
  return [...new Set(values.flatMap((value) => hidsFrom(value)).filter((hid) => owned.has(hid)))];
}

function raceKey(rid: DnaRaceIdentifier): string {
  return String(rid);
}

function splitWindow(window: Window): [Window, Window] {
  const start = Date.parse(window.startTime);
  const end = Date.parse(window.endTime);
  const midpoint = start + Math.floor((end - start) / 2);
  if (end - start <= MIN_WINDOW_MS || midpoint <= start || midpoint >= end) {
    throw new Error(`Finished-race window remained saturated at ${window.startTime}..${window.endTime}`);
  }
  return [
    { startTime: new Date(start).toISOString(), endTime: new Date(midpoint).toISOString() },
    { startTime: new Date(midpoint).toISOString(), endTime: window.endTime },
  ];
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function withinWindow(race: AnyRecord, start: number, end: number): boolean {
  const candidates = [race.end_time, race.start_time, race.created_at, race.updated_at]
    .map(timestamp)
    .filter((value): value is number => value !== null);
  return candidates.length === 0 || candidates.some((value) => value >= start && value <= end);
}

function classificationText(race: AnyRecord): string {
  return [race.race_name, race.eventtags, race.format, race.track, race.status, race.series, race.event]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function classify(race: AnyRecord): string[] {
  const text = classificationText(race);
  const tags: string[] = [];
  if (text.includes("trainer")) tags.push("trainer");
  if (text.includes("trial")) tags.push("trial");
  if (text.includes("esport")) tags.push("esports");
  if (text.includes("pro league") || text.includes("pro-league")) tags.push("pro_league");
  return tags;
}

describeConnected("temporary latest Trainer and Esports discovery evidence", () => {
  it("pulls the fresh owner race window plus current full-vault telemetry without persistence", async () => {
    const fetchedAt = new Date().toISOString();
    const end = fetchedAt;
    const apiKey = required("DNA_OPEN_LAB_API_KEY_1");
    const client = createDnaOpenLabV1Client({ apiKey });
    const telemetryClient = createDnaOpenLabV1TelemetryClient({ apiKey });

    let lastStartAt = 0;
    let requestCount = 0;
    let retryCount = 0;
    let minimumRemaining: number | null = null;
    let maximumLimit: number | null = null;

    const paced = async <T>(operation: () => Promise<DnaOpenLabResponse<T>>): Promise<DnaOpenLabResponse<T>> => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const wait = REQUEST_INTERVAL_MS - (Date.now() - lastStartAt);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        lastStartAt = Date.now();
        requestCount++;
        try {
          const response = await operation();
          if (response.rateLimit.limit !== null) maximumLimit = Math.max(maximumLimit ?? 0, response.rateLimit.limit);
          if (response.rateLimit.remaining !== null) minimumRemaining = Math.min(minimumRemaining ?? response.rateLimit.remaining, response.rateLimit.remaining);
          return response;
        } catch (error) {
          if (
            error instanceof DnaOpenLabApiError &&
            (error.kind === "rate_limited" || (error.httpStatus !== null && error.httpStatus >= 500)) &&
            attempt < 3
          ) {
            retryCount++;
            const seconds = error.rateLimit?.retryAfterSeconds ?? error.rateLimit?.resetSeconds ?? 2;
            await new Promise((resolve) => setTimeout(resolve, Math.max(1, seconds) * 1_000));
            continue;
          }
          throw error;
        }
      }
      throw new Error("unreachable request failure");
    };

    await paced(() => client.testAuth());
    const vaultResponse = await paced(() => client.vaultCoresFull(OWNER_VAULT));
    const ownedCores = vaultResponse.result;
    const ownedHids = new Set(ownedCores.map((core) => Number(core.hid)));
    expect(ownedHids.size).toBeGreaterThan(0);

    const recentResponse = await paced(() => client.vaultRecentRaces(OWNER_VAULT));
    const recent = recentResponse.result as readonly DnaRaceDocument[];

    const byRid = new Map<string, DnaRaceDocument>();
    const queue: Window[] = [{ startTime: START, endTime: end }];
    const acceptedWindows: Window[] = [];
    let splitCount = 0;
    while (queue.length > 0) {
      const window = queue.shift()!;
      const response = await paced(() => client.racesFinished({
        startTime: window.startTime,
        endTime: window.endTime,
        limit: FINISHED_LIMIT,
      }));
      if (response.result.length >= FINISHED_LIMIT) {
        const [left, right] = splitWindow(window);
        queue.unshift(right, left);
        splitCount++;
        continue;
      }
      acceptedWindows.push(window);
      for (const race of response.result) byRid.set(raceKey(race.rid), race);
    }

    const startMs = Date.parse(START);
    const endMs = Date.parse(end);
    const candidateRids = new Map<string, DnaRaceIdentifier>();
    for (const race of byRid.values()) {
      if (raceOwnedHids(race as AnyRecord, ownedHids).length > 0) candidateRids.set(raceKey(race.rid), race.rid);
    }
    for (const race of recent) {
      if (withinWindow(race as AnyRecord, startMs, endMs)) candidateRids.set(raceKey(race.rid), race.rid);
    }

    const hydrated: DnaRaceDocument[] = [];
    const fills: AnyRecord[] = [];
    for (const batch of chunks([...candidateRids.values()], 20)) {
      const docs = await paced(() => client.raceDocs(batch));
      hydrated.push(...docs.result);
      try {
        const fillResponse = await paced(() => client.raceFills(batch));
        fills.push(...(fillResponse.result as AnyRecord[]));
      } catch {
        // Race documents are sufficient; some historical fills may be unavailable.
      }
    }

    const ownedHydrated = hydrated.filter((race) => raceOwnedHids(race as AnyRecord, ownedHids).length > 0);
    const discoveryRaceDocs = ownedHydrated.map((race) => ({
      ...race,
      owned_hids: raceOwnedHids(race as AnyRecord, ownedHids),
      discovery_tags: classify(race as AnyRecord),
    }));

    const telemetry: unknown[] = [];
    const racingStats: AnyRecord[] = [];
    const power: AnyRecord[] = [];
    for (const batch of chunks([...ownedHids].sort((a, b) => a - b), CORE_BATCH_SIZE)) {
      const telemetryResponse = await paced(() => telemetryClient.coreTelemetryBulk(batch));
      if (Array.isArray(telemetryResponse.result)) telemetry.push(...telemetryResponse.result);
      else telemetry.push(telemetryResponse.result);
      const statsResponse = await paced(() => client.coreRacingStatsBulk(batch));
      racingStats.push(...(statsResponse.result as AnyRecord[]));
      const powerResponse = await paced(() => client.corePowerBulk(batch));
      power.push(...(powerResponse.result as AnyRecord[]));
    }

    const result = {
      generatedAt: fetchedAt,
      window: { start: START, end },
      requestStats: { requestCount, retryCount, minimumRemaining, maximumLimit },
      counts: {
        ownedCores: ownedCores.length,
        vaultRecent: recent.length,
        globalFinishedUnique: byRid.size,
        acceptedFinishedWindows: acceptedWindows.length,
        splitCount,
        candidateRids: candidateRids.size,
        ownedHydrated: ownedHydrated.length,
        trainerTagged: discoveryRaceDocs.filter((race) => race.discovery_tags.includes("trainer")).length,
        trialTagged: discoveryRaceDocs.filter((race) => race.discovery_tags.includes("trial")).length,
        esportsTagged: discoveryRaceDocs.filter((race) => race.discovery_tags.includes("esports") || race.discovery_tags.includes("pro_league")).length,
      },
      ownedCores,
      vaultRecentRaces: recent,
      ownedRaceDocs: discoveryRaceDocs,
      raceFills: fills,
      telemetry,
      racingStats,
      power,
    };

    await mkdir("/tmp", { recursive: true });
    await writeFile(
      "/tmp/temporary-latest-trainer-esports-discovery-2026-09-09.json",
      JSON.stringify(result, null, 2),
      "utf8",
    );

    expect(result.counts.ownedCores).toBeGreaterThan(0);
    expect(result.telemetry.length).toBeGreaterThan(0);
    expect(result.racingStats.length).toBeGreaterThan(0);
  }, 12 * 60 * 1_000);
});
