import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";
const enabled=process.env.TEMP_CANDIDATE_TELEMETRY==='1'; const d=enabled?describe:describe.skip;
function req(n:string){const v=process.env[n]?.trim()??''; if(!v) throw new Error(`${n} missing`); return v;}
const ids=[20777,20827,20582,17785,23457,23283,20365,22148,23467,19495,22164,9918,20382,16757,11848,10457,583,1675,949,19423] as const;
function b(v:unknown):unknown{if(Array.isArray(v))return v.slice(0,50).map(b);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v as Record<string,unknown>).map(([k,x])=>[k,b(x)]));return v;}
d('TEMPORARY candidate own telemetry - DO NOT MERGE',()=>{it('reads own telemetry without writes',async()=>{const c=createDnaOpenLabV1TelemetryClient({apiKey:req('DNA_OPEN_LAB_API_KEY_1')});const r=await c.coreTelemetryBulk(ids);console.log('CANDIDATE_OWN_TELEMETRY',JSON.stringify(b(r.result)));expect(r.result).toBeTruthy();},60_000);});
