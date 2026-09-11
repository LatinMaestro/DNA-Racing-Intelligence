import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

const enabled=process.env.TEMP_CHAT_ARENA_TELEMETRY==='1'; const d=enabled?describe:describe.skip;
function env(n:string){const v=process.env[n]?.trim()??'';if(!v)throw new Error(`${n} missing`);return v;}
function chunks<T>(xs:readonly T[],n:number){const o:T[][]=[];for(let i=0;i<xs.length;i+=n)o.push(xs.slice(i,i+n) as T[]);return o;}

d('temporary arena telemetry',()=>{it('pulls current Bike arena sire evidence',async()=>{
 const key=env('DNA_OPEN_LAB_API_KEY_1'); const c=createDnaOpenLabV1Client({apiKey:key}); const t=createDnaOpenLabV1TelemetryClient({apiKey:key});
 const arena: any[]=[]; let page=1;
 for(;page<=25;page++){const r=(await c.spliceArena({filter:{rvmode:'bike'},page})).result;arena.push(...r.cores);if(!r.has_more)break;await new Promise(x=>setTimeout(x,450));}
 const males=arena.filter(x=>String(x.gender).toLowerCase()==='male'); const ids=males.map(x=>x.hid);
 const telemetry:unknown[]=[]; const stats:unknown[]=[]; const splicing:unknown[]=[];
 for(const batch of chunks(ids,20)){
   const tr=await t.coreTelemetryBulk(batch); if(Array.isArray(tr.result))telemetry.push(...tr.result);else telemetry.push(tr.result);
   stats.push(...((await c.coreRacingStatsBulk(batch)).result as unknown[]));
   splicing.push(...((await c.coreSplicingInfoBulk(batch)).result as unknown[]));
   await new Promise(x=>setTimeout(x,450));
 }
 const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,arena,males,telemetry,stats,splicing};
 await mkdir('artifacts',{recursive:true}); await writeFile('artifacts/temporary-chat-arena-telemetry.json',JSON.stringify(out,null,2));
 expect(males.length).toBeGreaterThan(0);
},900000);});
