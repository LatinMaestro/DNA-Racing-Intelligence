import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createDnaOpenLabV1Client,
  type DnaOpenLabResponse,
} from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

const enabled = process.env.TEMP_BREEDING_ARENA_VAULT_EVALUATION === "1";
const describeConnected = enabled ? describe : describe.skip;
const VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";
const BASE = "https://api.dnaracing.run/fbike/pub/v1";
const OUT = `${process.env.RUNNER_TEMP ?? "/tmp"}/temporary-breeding-arena-vault-evaluation.json`;

type AnyRecord = Record<string, unknown>;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size) as T[]);
  }
  return result;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrapRows(value: unknown): AnyRecord[] {
  if (Array.isArray(value)) return value.filter((row): row is AnyRecord => !!row && typeof row === "object" && !Array.isArray(row));
  if (!value || typeof value !== "object") return [];
  const record = value as AnyRecord;
  for (const key of ["cores", "offspring", "children", "result", "rows", "data"]) {
    if (Array.isArray(record[key])) return unwrapRows(record[key]);
  }
  return [];
}

async function rawGet(apiKey: string, path: string): Promise<AnyRecord> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    cache: "no-store",
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: response.status, path, error: "non-json" };
  }
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as AnyRecord) : null;
  const success = record?.status === "success";
  return {
    ok: response.ok && success,
    status: response.status,
    path,
    result: success ? record?.result ?? null : null,
    error: success ? null : record?.err ?? record?.error ?? null,
  };
}

function observeTelemetryRow(value: unknown): AnyRecord[] {
  if (Array.isArray(value)) return value.filter((x): x is AnyRecord => !!x && typeof x === "object" && !Array.isArray(x));
  if (!value || typeof value !== "object") return [];
  const record = value as AnyRecord;
  if (typeof record.hid === "number") return [record];
  for (const key of ["cores", "result", "data", "rows"]) {
    const rows = observeTelemetryRow(record[key]);
    if (rows.length > 0) return rows;
  }
  return [];
}

function bestMedianSpeedSignal(telemetry: unknown): number {
  if (!telemetry || typeof telemetry !== "object") return -Infinity;
  const record = telemetry as AnyRecord;
  const data = record.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return -Infinity;
  let best = -Infinity;
  for (const row of Object.values(data as AnyRecord)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as AnyRecord;
    const speed = Number(r.speed_median ?? r.speed_med ?? r.speed_avg ?? NaN);
    if (Number.isFinite(speed)) best = Math.max(best, speed);
  }
  return best;
}

describeConnected("temporary read-only breeding Arena/vault evaluation", () => {
  it("captures current Bike Arena, owner parents, telemetry, splicing and breeder relations", async () => {
    const apiKey1 = required("DNA_OPEN_LAB_API_KEY_1");
    const apiKey2 = required("DNA_OPEN_LAB_API_KEY_2");
    const apiKey3 = required("DNA_OPEN_LAB_API_KEY_3");
    if (new Set([apiKey1, apiKey2, apiKey3]).size !== 3) throw new Error("three distinct API keys required");

    const client = createDnaOpenLabV1Client({ apiKey: apiKey1 });
    const telemetryClient = createDnaOpenLabV1TelemetryClient({ apiKey: apiKey2 });
    const fetchedAt = new Date().toISOString();

    const ownerVault = await client.vaultCoresFull(VAULT);
    const ownerHids = ownerVault.result.map((core) => Number(core.hid));

    const arena: AnyRecord[] = [];
    for (let page = 1; page <= 100; page++) {
      const response = await client.spliceArena({ filter: { rvmode: "bike" }, page });
      arena.push(...(response.result.cores as AnyRecord[]));
      if (!response.result.has_more) break;
    }

    const universeHids = [...new Set([...ownerHids, ...arena.map((row) => Number(row.hid)).filter((hid) => Number.isSafeInteger(hid) && hid > 0)])].sort((a, b) => a - b);
    const stats: AnyRecord[] = [];
    const splicing: AnyRecord[] = [];
    const telemetry: AnyRecord[] = [];
    for (const batch of chunks(universeHids, 20)) {
      const [statsResponse, splicingResponse, telemetryResponse] = await Promise.all([
        client.coreRacingStatsBulk(batch),
        client.coreSplicingInfoBulk(batch),
        telemetryClient.coreTelemetryBulk(batch),
      ]);
      stats.push(...(statsResponse.result as unknown as AnyRecord[]));
      splicing.push(...(splicingResponse.result as unknown as AnyRecord[]));
      telemetry.push(...observeTelemetryRow(telemetryResponse.result));
      await sleep(150);
    }

    const telemetryByHid = new Map<number, AnyRecord>();
    for (const row of telemetry) {
      const hid = Number(row.hid);
      if (Number.isSafeInteger(hid)) telemetryByHid.set(hid, row);
    }

    const ownedParentIds = ownerVault.result
      .filter((core) => ["male", "female"].includes(String(core.gender).toLowerCase()))
      .map((core) => Number(core.hid));
    const arenaMaleIds = arena
      .filter((core) => String(core.gender).toLowerCase() === "male")
      .map((core) => Number(core.hid))
      .filter((hid) => Number.isSafeInteger(hid) && hid > 0)
      .sort((a, b) => bestMedianSpeedSignal(telemetryByHid.get(b)) - bestMedianSpeedSignal(telemetryByHid.get(a)))
      .slice(0, 50);
    const relationIds = [...new Set([...ownedParentIds, ...arenaMaleIds])];
    const ownerGenderByHid = new Map(ownerVault.result.map((core) => [Number(core.hid), String(core.gender).toLowerCase()]));
    const arenaGenderByHid = new Map(arena.map((core) => [Number(core.hid), String(core.gender).toLowerCase()]));

    const relations: AnyRecord[] = [];
    for (const hid of relationIds) {
      const gender = ownerGenderByHid.get(hid) ?? arenaGenderByHid.get(hid) ?? "";
      const path = gender === "female" ? `/dam/${hid}` : `/sire/${hid}`;
      const relation = await rawGet(apiKey3, path);
      relations.push({ hid, gender, ...relation, rows: unwrapRows(relation.result).length });
      await sleep(425);
    }

    const benchmarkHid = ownerHids[0]!;
    const benchmarks: Record<string, unknown> = {};
    for (const cb of [10, 12, 14, 16, 18, 20, 22]) {
      try {
        benchmarks[String(cb)] = (await telemetryClient.coreTelemetryBenchmark(benchmarkHid, cb)).result;
      } catch (error) {
        benchmarks[String(cb)] = { error: error instanceof Error ? error.message : String(error) };
      }
      await sleep(150);
    }

    const pairFemalesWanted = new Set([
      "Zoey", "Flying Nimbus", "She Will Reign", "Vixey", "Allurity", "Sakura",
      "Flame Dash", "Scarlet Panther", "Titan Mage", "Swift Fist", "Peak Crown",
      "Frost Rocket", "Cyber Overdrive", "Divine Riot", "Violet Jaguar", "Lethal Claw",
      "Lightning Gale", "Whispering Rain", "Nyxara"
    ]);
    const yankee = ownerVault.result.find((core) => String(core.name).toLowerCase() === "yankee trek");
    const pairInfoYankee: AnyRecord[] = [];
    if (yankee && String(yankee.gender).toLowerCase() === "male") {
      for (const mother of ownerVault.result.filter((core) => String(core.gender).toLowerCase() === "female" && pairFemalesWanted.has(String(core.name)))) {
        try {
          const response = await client.splicePairInfo({ fatherCoreId: Number(yankee.hid), motherCoreId: Number(mother.hid) });
          pairInfoYankee.push({ motherHid: Number(mother.hid), motherName: mother.name, ok: true, result: response.result });
        } catch (error) {
          pairInfoYankee.push({ motherHid: Number(mother.hid), motherName: mother.name, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        await sleep(150);
      }
    }

    const output = {
      fetchedAt,
      vault: VAULT,
      ownerVault: ownerVault.result,
      arena,
      stats,
      splicing,
      telemetry,
      benchmarks,
      relations,
      arenaMaleRelationIds: arenaMaleIds,
      yankeeTrek: yankee ?? null,
      pairInfoYankee,
      counts: {
        owner: ownerVault.result.length,
        arena: arena.length,
        universe: universeHids.length,
        relations: relations.length,
      },
    };

    await mkdir(process.env.RUNNER_TEMP ?? "/tmp", { recursive: true });
    await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    expect(output.ownerVault.length).toBeGreaterThan(0);
    expect(output.arena.length).toBeGreaterThan(0);
  }, 12 * 60_000);
});
