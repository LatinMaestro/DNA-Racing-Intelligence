import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import {
  DnaOpenLabApiError,
  createDnaOpenLabV1Client,
  type DnaOpenLabResponse,
} from "../lib/dna-open-lab-v1-client";

const enabled = process.env.TEMP_HORSE_CAR_DISCOVERY === "1";
const d = enabled ? describe : describe.skip;
const VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";
const REQUEST_INTERVAL_MS = 2200;

type AnyRecord = Record<string, unknown>;

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} missing`);
  return value;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size) as T[]);
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

d("temporary Horse/Car vault discovery evidence", () => {
  it("pulls every owned Core with current multi-mode racing, power, stamina and recent race evidence", async () => {
    const client = createDnaOpenLabV1Client({ apiKey: required("DNA_OPEN_LAB_API_KEY_1") });
    let lastStarted = 0;
    let requestCount = 0;

    const paced = async <T>(operation: () => Promise<DnaOpenLabResponse<T>>): Promise<DnaOpenLabResponse<T>> => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const wait = REQUEST_INTERVAL_MS - (Date.now() - lastStarted);
        if (wait > 0) await sleep(wait);
        lastStarted = Date.now();
        requestCount++;
        try {
          const response = await operation();
          if (response.rateLimit.remaining === 0 && response.rateLimit.resetSeconds) {
            await sleep(response.rateLimit.resetSeconds * 1000);
          }
          return response;
        } catch (error) {
          if (error instanceof DnaOpenLabApiError && error.kind === "rate_limited" && attempt < 3) {
            const seconds = error.rateLimit?.retryAfterSeconds ?? error.rateLimit?.resetSeconds ?? 31;
            await sleep(Math.max(1, seconds) * 1000);
            continue;
          }
          throw error;
        }
      }
      throw new Error("unreachable");
    };

    const cores = (await paced(() => client.vaultCoresFull(VAULT))).result;
    const ids = cores.map((core) => core.hid);
    const racingStats: AnyRecord[] = [];
    const power: AnyRecord[] = [];
    const stamina: AnyRecord[] = [];

    for (const batch of chunks(ids, 20)) {
      racingStats.push(...((await paced(() => client.coreRacingStatsBulk(batch))).result as AnyRecord[]));
      power.push(...((await paced(() => client.corePowerBulk(batch))).result as AnyRecord[]));
      stamina.push(...((await paced(() => client.coreStaminaBulk(batch))).result as AnyRecord[]));
    }

    const recentRaces = (await paced(() => client.vaultRecentRaces(VAULT))).result;
    const recentIds = recentRaces.map((race) => race.rid).filter((rid) => rid !== undefined && rid !== null);
    const raceDocs: AnyRecord[] = [];
    for (const batch of chunks(recentIds, 20)) {
      raceDocs.push(...((await paced(() => client.raceDocs(batch))).result as AnyRecord[]));
    }

    const out = {
      generatedAt: new Date().toISOString(),
      temporary: true,
      doNotMerge: true,
      vault: VAULT,
      requestCount,
      cores,
      racingStats,
      power,
      stamina,
      recentRaces,
      raceDocs,
    };

    await mkdir("artifacts", { recursive: true });
    await writeFile(
      "artifacts/temporary-chat-horse-car-vault-discovery-2026-09-12.json",
      JSON.stringify(out, null, 2),
    );

    expect(cores.length).toBeGreaterThan(150);
    expect(racingStats.length).toBe(cores.length);
    expect(power.length).toBe(cores.length);
    expect(stamina.length).toBe(cores.length);
  }, 900000);
});
