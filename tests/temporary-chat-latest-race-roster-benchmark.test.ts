import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";
import { writeFile } from "node:fs/promises";

const connected = process.env.DNA_OPEN_LAB_CONNECTED_DISCOVERY === "1";
const describeConnected = connected ? describe : describe.skip;
function env(name: string): string { const v = process.env[name]; if (!v) throw new Error(`${name} missing`); return v; }
function chunks<T>(values: readonly T[], n: number): T[][] { const out:T[][]=[]; for(let i=0;i<values.length;i+=n) out.push(values.slice(i,i+n)); return out; }

describeConnected("temporary latest race roster plus benchmarks", () => {
  it("writes current full-vault evidence", async () => {
    const key=env("DNA_OPEN_LAB_API_KEY_1"); const vault=env("DNA_OPEN_LAB_VAULT");
    const client=createDnaOpenLabV1Client({apiKey:key}); const tc=createDnaOpenLabV1TelemetryClient({apiKey:key});
    const cores=(await client.vaultCoresFull(vault)).result; const ids=cores.map(c=>c.hid);
    const recentRaces=(await client.vaultRecentRaces(vault)).result;
    const racingStats:unknown[]=[]; const power:unknown[]=[]; const telemetry:unknown[]=[];
    for(const batch of chunks(ids,20)){
      racingStats.push(...((await client.coreRacingStatsBulk(batch)).result as unknown[]));
      power.push(...((await client.corePowerBulk(batch)).result as unknown[]));
      const tr=(await tc.coreTelemetryBulk(batch)).result; if(Array.isArray(tr)) telemetry.push(...tr); else telemetry.push(tr);
    }
    const sampleId=ids[0]!; const benchmarks:Record<string,unknown>={};
    for(const cb of [10,12,14,16,18,20,22]) benchmarks[String(cb)]=(await tc.coreTelemetryBenchmark(sampleId,cb)).result;
    const recentIds=recentRaces.map(r=>r.rid).filter(x=>x!==undefined&&x!==null); const raceDocs:unknown[]=[];
    for(const batch of chunks(recentIds,20)) raceDocs.push(...((await client.raceDocs(batch)).result as unknown[]));
    await writeFile("temporary-chat-latest-race-roster-benchmark.json",JSON.stringify({generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,vault,cores,recentRaces,raceDocs,racingStats,power,telemetry,benchmarks}));
    expect(cores.length).toBeGreaterThan(0); expect(Object.keys(benchmarks)).toHaveLength(7);
  },900_000);
});
