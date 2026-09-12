import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";
import { writeFile, mkdir } from "node:fs/promises";

const enabled = process.env.TEMP_CHAT_TRAINER_TABLE_REVIEW === "1";
const d = enabled ? describe : describe.skip;
function env(name:string){const v=process.env[name]?.trim()??""; if(!v) throw new Error(`${name} missing`); return v;}
function chunks<T>(xs:readonly T[],n:number){const out:T[][]=[]; for(let i=0;i<xs.length;i+=n) out.push(xs.slice(i,i+n) as T[]); return out;}

const TARGET_NAMES = [
  "Frost Rocket","Crown of Thunder","Green Halo","Wicked Flare","Solar Ember","Cold Shoulder","Royal Cascade","Bad Habit","Desert Echo","Divine Rush","Soft Voltage","Covert Meteor","Burning Obelisk","Viral Gauntlet",
  "Silent Bruiser","Phantom Panther","Mistfall","Phoenix Crown","Edge Panther","Thunder Matrix","First Light","Fierce Shield","Brazen Mantis","Core Oracle","Final Flash","Second Wind","Nervy Runner","Flux Dagger","Vivid Rebel","Vapor Blade","Twilight Havoc","Tidal Strike","Lynx Mystic",
  "Peak Crown","Cryo Havoc","Creeper","Vespera","Forge Serpent","Bold Nexus","Brutal Bullet","Steel Blaze","Darling Cash","Iron Dynamo","Blazing Karma","Bubble Trouble","Cold Rush","Frozen Blade","Sandstone","Hex Crusher","Hollow Rebel","Cyber Overdrive","Kinetic Spark","Cinder King","Violet Jaguar",
  "Pulse Shade","Cursed Monolith","Full Spice","Bank Roll","Fatal Attraction","Dancing Comet","Shogun Bloom","Fire Magnet","Spellbreaker","Zero Mercy"
] as const;

d("temporary Trainer table review",()=>{
  it("pulls current target telemetry and benchmarks",async()=>{
    const key=env("DNA_OPEN_LAB_API_KEY_1"); const vault=env("DNA_OPEN_LAB_VAULT");
    const c=createDnaOpenLabV1Client({apiKey:key}); const t=createDnaOpenLabV1TelemetryClient({apiKey:key});
    const allCores=(await c.vaultCoresFull(vault)).result;
    const wanted=new Set(TARGET_NAMES); const cores=allCores.filter(x=>wanted.has(x.name as any)); const ids=cores.map(x=>x.hid);
    const telemetry:unknown[]=[]; const racingStats:unknown[]=[];
    for(const batch of chunks(ids,20)){
      const tr=(await t.coreTelemetryBulk(batch)).result; if(Array.isArray(tr)) telemetry.push(...tr); else telemetry.push(tr);
      racingStats.push(...((await c.coreRacingStatsBulk(batch)).result as unknown[]));
      await new Promise(r=>setTimeout(r,300));
    }
    const sampleId=ids[0]!; const benchmarks:Record<string,unknown>={};
    for(const cb of [10,12,14,16,18,20,22]){benchmarks[String(cb)]=(await t.coreTelemetryBenchmark(sampleId,cb)).result; await new Promise(r=>setTimeout(r,200));}
    const recentRaces=(await c.vaultRecentRaces(vault)).result;
    const recentIds=recentRaces.map(r=>r.rid).filter(x=>x!==undefined&&x!==null); const raceDocs:unknown[]=[];
    for(const batch of chunks(recentIds,20)){raceDocs.push(...((await c.raceDocs(batch)).result as unknown[])); await new Promise(r=>setTimeout(r,250));}
    const missing=TARGET_NAMES.filter(n=>!cores.some(c=>c.name===n));
    await mkdir("artifacts",{recursive:true});
    await writeFile("artifacts/temporary-chat-trainer-table-review-2026-09-12.json",JSON.stringify({generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,vault,cores,telemetry,racingStats,benchmarks,recentRaces,raceDocs,missing},null,2));
    expect(cores.length).toBeGreaterThan(50); expect(Object.keys(benchmarks)).toHaveLength(7);
  },900000);
});
