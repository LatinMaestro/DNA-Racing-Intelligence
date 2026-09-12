import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";
import { writeFile } from "node:fs/promises";

// Temporary read-only targeted pull for 2026-09-12 Trainer table review after breeding.
const connected = process.env.DNA_OPEN_LAB_CONNECTED_DISCOVERY === "1";
const describeConnected = connected ? describe : describe.skip;
function env(name: string): string { const v = process.env[name]; if (!v) throw new Error(`${name} missing`); return v; }
function chunks<T>(values: readonly T[], n: number): T[][] { const out:T[][]=[]; for(let i=0;i<values.length;i+=n) out.push(values.slice(i,i+n)); return out; }
const TARGET_NAMES = [
  "Frost Rocket","Crown of Thunder","Green Halo","Wicked Flare","Solar Ember","Cold Shoulder","Royal Cascade","Bad Habit","Desert Echo","Divine Rush","Soft Voltage","Covert Meteor","Burning Obelisk","Viral Gauntlet",
  "Silent Bruiser","Phantom Panther","Mistfall","Phoenix Crown","Edge Panther","Thunder Matrix","First Light","Fierce Shield","Brazen Mantis","Core Oracle","Final Flash","Second Wind","Nervy Runner","Flux Dagger","Vivid Rebel","Vapor Blade","Twilight Havoc","Tidal Strike","Lynx Mystic",
  "Peak Crown","Cryo Havoc","Creeper","Vespera","Forge Serpent","Bold Nexus","Brutal Bullet","Steel Blaze","Darling Cash","Iron Dynamo","Blazing Karma","Bubble Trouble","Cold Rush","Frozen Blade","Sandstone","Hex Crusher","Hollow Rebel","Cyber Overdrive","Kinetic Spark","Cinder King","Violet Jaguar",
  "Pulse Shade","Cursed Monolith","Full Spice","Bank Roll","Fatal Attraction","Dancing Comet","Shogun Bloom","Fire Magnet","Spellbreaker","Zero Mercy"
] as const;

describeConnected("temporary targeted Trainer roster plus benchmarks", () => {
  it("writes current target evidence", async () => {
    const key=env("DNA_OPEN_LAB_API_KEY_1"); const vault=env("DNA_OPEN_LAB_VAULT");
    const client=createDnaOpenLabV1Client({apiKey:key}); const tc=createDnaOpenLabV1TelemetryClient({apiKey:key});
    const allCores=(await client.vaultCoresFull(vault)).result;
    const wanted=new Set(TARGET_NAMES); const cores=allCores.filter(c=>wanted.has(c.name as any)); const ids=cores.map(c=>c.hid);
    const racingStats:unknown[]=[]; const telemetry:unknown[]=[];
    for(const batch of chunks(ids,20)){
      racingStats.push(...((await client.coreRacingStatsBulk(batch)).result as unknown[]));
      const tr=(await tc.coreTelemetryBulk(batch)).result; if(Array.isArray(tr)) telemetry.push(...tr); else telemetry.push(tr);
      await new Promise(r=>setTimeout(r,250));
    }
    const sampleId=ids[0]!; const benchmarks:Record<string,unknown>={};
    for(const cb of [10,12,14,16,18,20,22]) { benchmarks[String(cb)]=(await tc.coreTelemetryBenchmark(sampleId,cb)).result; await new Promise(r=>setTimeout(r,150)); }
    const recentRaces=(await client.vaultRecentRaces(vault)).result;
    const recentIds=recentRaces.map(r=>r.rid).filter(x=>x!==undefined&&x!==null); const raceDocs:unknown[]=[];
    for(const batch of chunks(recentIds,20)) { raceDocs.push(...((await client.raceDocs(batch)).result as unknown[])); await new Promise(r=>setTimeout(r,200)); }
    const missing=TARGET_NAMES.filter(n=>!cores.some(c=>c.name===n));
    await writeFile("temporary-chat-latest-race-roster-benchmark.json",JSON.stringify({generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,vault,cores,racingStats,telemetry,benchmarks,recentRaces,raceDocs,missing},null,2));
    expect(cores.length).toBeGreaterThan(50); expect(Object.keys(benchmarks)).toHaveLength(7);
  },900_000);
});
