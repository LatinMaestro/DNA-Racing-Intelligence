import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client, type DnaRaceIdentifier } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only post-day Esports evaluation only. */
const enabled = process.env.TEMP_POST_DAY_ESPORTS === "1";
const d = enabled ? describe : describe.skip;
const LATIN_VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";
const LATIN_TEAM = "953adec8ad";
const BLACK_VAULT = "0xa95db43f2f3e59d9fb6db54b4e98fc714bced07b";
const ES_BASE = "https://api.dnaracing.run/fbike/esports";
const START = "2026-09-06T14:00:00.000Z";
const END = "2026-09-07T14:00:00.000Z";
const CBS = [10,12,14,16,18,20,22] as const;
type Rec = Record<string, unknown>;
function rec(v: unknown): Rec { return v && typeof v === "object" && !Array.isArray(v) ? v as Rec : {}; }
function hid(v: unknown): number | null { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; }
function req(n: string) { const v = process.env[n]?.trim() ?? ""; if (!v) throw new Error(`${n} missing`); return v; }
function chunks<T>(a: readonly T[], n: number) { const o:T[][]=[]; for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n) as T[]); return o; }
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function post(path:string, body:Rec){ const r=await fetch(`${ES_BASE}${path}`,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json","User-Agent":"DNA-Racing-Intelligence read-only post-day audit"},body:JSON.stringify(body)}); const text=await r.text(); let json:unknown=null; try{json=JSON.parse(text)}catch{} return {status:r.status,json,text:json===null?text.slice(0,1500):null}; }
async function hstats(ids:number[]){ const out=[]; for(const batch of chunks(ids,12)){ const rows=await Promise.all(batch.map(async id=>({hid:id,...await post("/hstats",{hid:id,season:"all"})}))); out.push(...rows); await sleep(160);} return out; }

d("TEMPORARY post-day Esports roster evaluation - DO NOT MERGE",()=>{it("pulls current roster, today's events, race stars, telemetry and Black Sheep comparison",async()=>{
 const key=req("DNA_OPEN_LAB_API_KEY_1"); const c=createDnaOpenLabV1Client({apiKey:key}); const t=createDnaOpenLabV1TelemetryClient({apiKey:key});
 const [latinTeam,history,blackTeam,maps] = await Promise.all([
  post("/team",{of_vault:LATIN_VAULT}), post("/team/match_history",{team_id:LATIN_TEAM,limit:100,skip:0,bucket:null}), post("/team",{of_vault:BLACK_VAULT}), post("/maps",{})
 ]);
 const roster = Array.isArray(rec(rec(latinTeam.json).result).cores_list) ? (rec(rec(latinTeam.json).result).cores_list as unknown[]).map(hid).filter((x):x is number=>x!==null) : [];
 const blackRoster = Array.isArray(rec(rec(blackTeam.json).result).cores_list) ? (rec(rec(blackTeam.json).result).cores_list as unknown[]).map(hid).filter((x):x is number=>x!==null) : [];
 expect(roster).toHaveLength(25); expect(blackRoster.length).toBeGreaterThanOrEqual(12);
 const historyResult=rec(rec(history.json).result); const historyRows=Array.isArray(historyResult.rows)?historyResult.rows.map(rec):[];
 const today=historyRows.filter(x=>x.stage==="finished"&&typeof x.finished_at==="string"&&Date.parse(String(x.finished_at))>=Date.parse(START)&&Date.parse(String(x.finished_at))<Date.parse(END)).sort((a,b)=>Date.parse(String(a.start_time))-Date.parse(String(b.start_time)));
 expect(today.length).toBeGreaterThan(0);
 const events=[]; const rids=new Map<string,DnaRaceIdentifier>();
 for(const row of today){ const eventId=String(row.event_id); const er=await post("/event",{event_id:eventId}); const e=rec(rec(er.json).result); events.push({eventId,row,response:er}); const ma=rec(e.map_association); for(const slot of Object.values(ma)){ const races=rec(rec(slot).races); for(const rr of Object.values(races)){ const rid0=rec(rr).rid; if(typeof rid0==="string"||typeof rid0==="number") rids.set(String(rid0),rid0); } } await sleep(100); }
 const raceDocs:unknown[]=[]; for(const batch of chunks([...rids.values()],20)){ try{ const x=await c.raceDocs(batch); raceDocs.push(...x.result);}catch{} await sleep(200); }
 const telemetry:unknown[]=[]; for(const batch of chunks(roster,20)){ const x=await t.coreTelemetryBulk(batch); if(Array.isArray(x.result)) telemetry.push(...x.result); await sleep(200); }
 const blackTelemetry:unknown[]=[]; for(const batch of chunks(blackRoster,20)){ const x=await t.coreTelemetryBulk(batch); if(Array.isArray(x.result)) blackTelemetry.push(...x.result); await sleep(200); }
 const stats:unknown[]=[]; for(const batch of chunks(roster,20)){ const x=await c.coreRacingStatsBulk(batch); stats.push(...x.result); await sleep(200); }
 const benchmarks:Rec={}; for(const cb of CBS){ const x=await t.coreTelemetryBenchmark(roster[0]!,cb); benchmarks[String(cb)]=rec(rec(x.result).benchmark); await sleep(160); }
 const [latinHstats,blackHstats]=await Promise.all([hstats(roster),hstats(blackRoster)]);
 const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,window:{start:START,end:END},latinTeam,blackTeam,maps,today,events,raceDocs,roster,blackRoster,telemetry,blackTelemetry,stats,benchmarks,latinHstats,blackHstats};
 await mkdir("artifacts",{recursive:true}); await writeFile("artifacts/temporary-post-day-esports-roster-eval.json",JSON.stringify(out),"utf8");
 console.log("POST_DAY_ESPORTS_SUMMARY",JSON.stringify({generatedAt:out.generatedAt,todayMatches:today.map(x=>({event_id:x.event_id,opponent:rec(x.opponent).team_name,result:x.result,maps:x.map_allocated,finished_at:x.finished_at})),rosterN:roster.length,blackRosterN:blackRoster.length,raceDocs:raceDocs.length,rids:rids.size}));
},8*60_000);});
