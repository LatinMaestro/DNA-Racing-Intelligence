import { describe, expect, it } from "vitest";
import { DnaOpenLabApiError } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only breeding research only. */
const enabled = process.env.TEMP_ALL_DISTANCE_TELEMETRY === "1";
const d = enabled ? describe : describe.skip;
function required(name: string): string { const v=process.env[name]?.trim()??""; if(!v) throw new Error(`${name} missing`); return v; }
const targets = [
  [20777,14,"Drift Mirage 1400"], [20827,10,"Cyber Dancer 1000"], [20582,14,"Green Charger 1400"], [17785,14,"Snowfall 1400"], [23457,14,"Silent Bruiser 1400"],
  [23283,18,"Titan Mage 1800"], [20365,18,"Lightning Gale 1800"], [20365,20,"Lightning Gale 2000"], [22148,16,"Mistfall 1600"], [22148,18,"Mistfall 1800"], [23467,18,"Forge Serpent 1800"], [19495,16,"Sword Dancer 1600"],
  [22164,22,"Flame Dash 2200"], [9918,20,"Cash Cruiser 2000"], [9918,22,"Cash Cruiser 2200"], [20382,20,"Legacy Runner 2000"], [20382,22,"Legacy Runner 2200"],
  [16757,20,"She Will Reign 2000"], [16757,22,"She Will Reign 2200"], [11848,18,"Reese Dylan 1800"], [11848,20,"Reese Dylan 2000"], [10457,20,"Salsa 2000"]
] as const;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function bounded(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0,10).map(bounded);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([k,v])=>[k,bounded(v)]));
  return value;
}
d("TEMPORARY all-distance telemetry benchmark - DO NOT MERGE",()=>{
 it("reads population telemetry for ranked breeding candidates without writes",async()=>{
   const client=createDnaOpenLabV1TelemetryClient({apiKey:required("DNA_OPEN_LAB_API_KEY_1")});
   const results=[];
   for(const [hid,cb,label] of targets){
     try { const r=await client.coreTelemetryBenchmark(hid,cb); results.push({hid,cb,label,outcome:"success",result:bounded(r.result)}); }
     catch(e){ if(e instanceof DnaOpenLabApiError) results.push({hid,cb,label,outcome:"api_error",status:e.httpStatus,kind:e.kind,message:e.message}); else throw e; }
     await sleep(520);
   }
   console.log("ALL_DISTANCE_TELEMETRY",JSON.stringify(results));
   expect(results.length).toBe(targets.length);
 },120_000);
});
