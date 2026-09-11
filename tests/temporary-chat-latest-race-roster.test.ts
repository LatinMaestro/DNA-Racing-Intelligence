import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";
import { writeFile } from "node:fs/promises";

const connected = process.env.DNA_OPEN_LAB_CONNECTED_DISCOVERY === "1";
const describeConnected = connected ? describe : describe.skip;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing`);
  return value;
}

function chunks<T>(values: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += n) out.push(values.slice(i, i + n));
  return out;
}

describeConnected("temporary latest race roster pull", () => {
  it("writes full-vault read-only evidence for chat analysis", async () => {
    const key = env("DNA_OPEN_LAB_API_KEY_1");
    const vault = env("DNA_OPEN_LAB_VAULT");
    const client = createDnaOpenLabV1Client({ apiKey: key });
    const telemetryClient = createDnaOpenLabV1TelemetryClient({ apiKey: key });

    const cores = (await client.vaultCoresFull(vault)).result;
    const ids = cores.map((c) => c.hid);
    const recentRaces = (await client.vaultRecentRaces(vault)).result;

    const racingStats: unknown[] = [];
    const power: unknown[] = [];
    const telemetry: unknown[] = [];
    for (const batch of chunks(ids, 20)) {
      racingStats.push(...((await client.coreRacingStatsBulk(batch)).result as unknown[]));
      power.push(...((await client.corePowerBulk(batch)).result as unknown[]));
      const tr = (await telemetryClient.coreTelemetryBulk(batch)).result;
      if (Array.isArray(tr)) telemetry.push(...tr);
      else telemetry.push(tr);
    }

    const recentIds = recentRaces.map((r) => r.rid).filter((x) => x !== undefined && x !== null);
    const raceDocs: unknown[] = [];
    for (const batch of chunks(recentIds, 20)) {
      raceDocs.push(...((await client.raceDocs(batch)).result as unknown[]));
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      temporary: true,
      doNotMerge: true,
      vault,
      cores,
      recentRaces,
      raceDocs,
      racingStats,
      power,
      telemetry,
    };
    await writeFile("temporary-chat-latest-race-roster.json", JSON.stringify(payload));
    expect(cores.length).toBeGreaterThan(0);
    expect(racingStats.length).toBe(cores.length);
  }, 900_000);
});
