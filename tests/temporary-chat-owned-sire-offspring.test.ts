import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";
const enabled=process.env.TEMP_CHAT_OWNED_SIRE_OFFSPRING==='1';const d=enabled?describe:describe.skip;
const SIRES=[14540,16515,19438,9918,16147] as const;
function env(n:string){const v=process.env[n]?.trim()??'';if(!v)throw new Error(`${n} missing`);return v;}
function chunks<T>(xs:readonly T[],n:number){const o:T[][]=[];for(let i=0;i<xs.length;i+=n)o.push(xs.slice(i,i+n) as T[]);return o;}
d('temporary owned sire offspring',()=>{it('pulls offspring quality for low-F owned sires',async()=>{
 const key=env('DNA_OPEN_LAB_API_KEY_1');const c=createDnaOpenLabV1Client({apiKey:key});const t=createDnaOpenLabV1TelemetryClient({apiKey:key});
 const sireSplicing=(await c.coreSplicingInfoBulk([...SIRES])).result as any[];const offspring=[...new Set(sireSplicing.flatMap(x=>(x.splice_core?.life_splices??[]) as number[]))];
 const info:unknown[]=[];const telemetry:unknown[]=[];for(const batch of chunks(offspring,20)){info.push(...((await c.coreInfoBulk(batch)).result as unknown[]));const tr=await t.coreTelemetryBulk(batch);if(Array.isArray(tr.result))telemetry.push(...tr.result);else telemetry.push(tr.result);await new Promise(r=>setTimeout(r,450));}
 const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,sires:SIRES,sireSplicing,offspring,info,telemetry};await mkdir('artifacts',{recursive:true});await writeFile('artifacts/temporary-chat-owned-sire-offspring.json',JSON.stringify(out,null,2));expect(sireSplicing.length).toBe(SIRES.length);
},900000);});
