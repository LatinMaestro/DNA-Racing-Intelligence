import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only full-vault discovery research only. */
const enabled = process.env.TEMP_FULL_VAULT_DISCOVERY_VARIANCE === "1";
const d = enabled ? describe : describe.skip;
const VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";
const ES_BASE = "https://api.dnaracing.run/fbike/esports";
const CBS = [10,12,14,16,18,20,22] as const;
type Rec = Record<string, unknown>;
function req(n:string){ const v=process.env[n]?.trim()??""; if(!v) throw new Error(`${n} missing`); return v; }
function rec(v:unknown):Rec{return v&&typeof v==="object"&&!Array.isArray(v)?v as Rec:{};}
function hid(v:unknown):number|null{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;}
function chunks<T>(a:readonly T[],n:number){const o:T[][]=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n) as T[]);return o;}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function post(path:string,body:Rec){const r=await fetch(`${ES_BASE}${path}`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json","User-Agent":"DNA-Racing-Intelligence read-only full-vault discovery variance"},body:JSON.stringify(body)});const text=await r.text();let json:unknown=null;try{json=JSON.parse(text)}catch{}return {status:r.status,json,text:json===null?text.slice(0,1200):null};}
async function hstats(ids:number[]){const out=[];for(const batch of chunks(ids,12)){const rows=await Promise.all(batch.map(async id=>({hid:id,...await post("/hstats",{hid:id,season:"all"})})));out.push(...rows);await sleep(180);}return out;}

d("TEMPORARY full-vault discovery variance - DO NOT MERGE",()=>{it("captures fresh Bike-only full-vault discovery evidence",async()=>{
  const key=req("DNA_OPEN_LAB_API_KEY_1");
  const c=createDnaOpenLabV1Client({apiKey:key});
  const t=createDnaOpenLabV1TelemetryClient({apiKey:key});
  const owned=(await c.vaultCoresFull(VAULT)).result as readonly Rec[];
  const ids=owned.map(x=>hid(x.hid)).filter((x):x is number=>x!==null);
  expect(ids.length).toBeGreaterThan(150);
  const telemetry:unknown[]=[]; const stats:unknown[]=[];
  for(const batch of chunks(ids,20)){
    const [tr,sr]=await Promise.all([t.coreTelemetryBulk(batch),c.coreRacingStatsBulk(batch)]);
    if(Array.isArray(tr.result)) telemetry.push(...tr.result);
    stats.push(...sr.result);
    await sleep(200);
  }
  const benchmarks:Rec={};
  for(const cb of CBS){const x=await t.coreTelemetryBenchmark(ids[0]!,cb);benchmarks[String(cb)]=rec(rec(x.result).benchmark);await sleep(160);}
  const esportHstats=await hstats(ids);
  const maps=await post("/maps",{});
  const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,vault:VAULT,owned,ids,telemetry,stats,benchmarks,esportHstats,maps:maps.json};
  await mkdir("artifacts",{recursive:true});
  await writeFile("artifacts/temporary-full-vault-discovery-variance-2026-09-07.json",JSON.stringify(out),"utf8");
  console.log("FULL_VAULT_DISCOVERY_VARIANCE_SUMMARY",JSON.stringify({generatedAt:out.generatedAt,owned:ids.length,telemetry:telemetry.length,stats:stats.length,hstats:esportHstats.length}));
},8*60_000);});
