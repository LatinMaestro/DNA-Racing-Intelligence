import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DnaOpenLabApiError,
  createDnaOpenLabV1Client,
  type DnaOpenLabResponse,
  type DnaRaceDocument,
  type DnaRaceIdentifier,
} from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only latest race + roster research. */
const enabled = process.env.TEMP_LATEST_ROSTER_20260911 === "1";
const d = enabled ? describe : describe.skip;
const VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";
const START = "2026-09-09T00:00:00.000Z";
const LIMIT = 200;
const MIN_WINDOW_MS = 1_000;
const INTERVAL_MS = 1_050;
const BATCH = 20;
const ESPORTS = "https://api.dnaracing.run/fbike/esports";
const CBS = [10, 12, 14, 16, 18, 20, 22] as const;

type Rec = Record<string, unknown>;
type Window = { startTime: string; endTime: string };
function rec(v: unknown): Rec { return v && typeof v === "object" && !Array.isArray(v) ? v as Rec : {}; }
function hid(v: unknown): number | null { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; }
function chunks<T>(xs: readonly T[], n: number): T[][] { const out: T[][] = []; for (let i=0;i<xs.length;i+=n) out.push(xs.slice(i,i+n) as T[]); return out; }
function req(n: string): string { const v = process.env[n]?.trim() ?? ""; if (!v) throw new Error(`${n} missing`); return v; }
function hidsFrom(v: unknown): number[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return [...new Set(v.flatMap(hidsFrom))];
  const direct = hid(v); if (direct !== null) return [direct];
  if (typeof v !== "object") return [];
  const r = v as Rec;
  const preferred = ["hid","hids","core_id","coreId","token_id","tokenId"].flatMap(k => hidsFrom(r[k]));
  if (preferred.length) return [...new Set(preferred)];
  return [...new Set(Object.values(r).flatMap(hidsFrom))];
}
function ownedInRace(race: Rec, owned: Set<number>): number[] {
  return [...new Set([race.hids, race.yellowstars, race.bluestars].flatMap(hidsFrom).filter(x => owned.has(x)))];
}
function key(rid: DnaRaceIdentifier): string { return String(rid); }
function split(w: Window): [Window,Window] {
  const a=Date.parse(w.startTime), b=Date.parse(w.endTime), m=a+Math.floor((b-a)/2);
  if (b-a<=MIN_WINDOW_MS || m<=a || m>=b) throw new Error(`saturated window ${w.startTime}..${w.endTime}`);
  return [{startTime:new Date(a).toISOString(),endTime:new Date(m).toISOString()},{startTime:new Date(m).toISOString(),endTime:w.endTime}];
}
async function post(path: string, body: Rec) {
  const r = await fetch(`${ESPORTS}${path}`, {method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json","User-Agent":"DNA-Racing-Intelligence temporary read-only roster audit"},body:JSON.stringify(body)});
  const text=await r.text(); let json:unknown=null; try{json=JSON.parse(text);}catch{/* ignore */}
  return {status:r.status,json,text:json===null?text.slice(0,1000):null};
}

d("TEMPORARY latest owner races and best-roster audit",()=>{it("pulls latest owner races, full-vault Bike telemetry, ageing, hstats and maps",async()=>{
  const fetchedAt=new Date().toISOString();
  const apiKey=req("DNA_OPEN_LAB_API_KEY_1");
  const client=createDnaOpenLabV1Client({apiKey});
  const telemetryClient=createDnaOpenLabV1TelemetryClient({apiKey});
  let last=0, requestCount=0, retryCount=0;
  const paced=async<T>(op:()=>Promise<DnaOpenLabResponse<T>>):Promise<DnaOpenLabResponse<T>>=>{
    for(let attempt=0;attempt<4;attempt++){
      const wait=INTERVAL_MS-(Date.now()-last); if(wait>0) await new Promise(r=>setTimeout(r,wait)); last=Date.now(); requestCount++;
      try{return await op();}catch(e){
        if(e instanceof DnaOpenLabApiError && (e.kind==="rate_limited" || (e.httpStatus!==null&&e.httpStatus>=500)) && attempt<3){retryCount++; const sec=e.rateLimit?.retryAfterSeconds??e.rateLimit?.resetSeconds??2; await new Promise(r=>setTimeout(r,Math.max(1,sec)*1000)); continue;}
        throw e;
      }
    }
    throw new Error("unreachable");
  };

  await paced(()=>client.testAuth());
  const owned=(await paced(()=>client.vaultCoresFull(VAULT))).result as readonly Rec[];
  const ids=owned.map(x=>hid(x.hid)).filter((x):x is number=>x!==null);
  const idSet=new Set(ids); expect(ids.length).toBeGreaterThan(100);

  const byRid=new Map<string,DnaRaceDocument>();
  const queue:Window[]=[{startTime:START,endTime:fetchedAt}];
  let splitCount=0;
  while(queue.length){
    const w=queue.shift()!;
    const resp=await paced(()=>client.racesFinished({startTime:w.startTime,endTime:w.endTime,limit:LIMIT}));
    if(resp.result.length>=LIMIT){const [l,r]=split(w); queue.unshift(r,l); splitCount++; continue;}
    for(const race of resp.result) byRid.set(key(race.rid),race);
  }
  const recent=(await paced(()=>client.vaultRecentRaces(VAULT))).result as readonly DnaRaceDocument[];
  for(const race of recent) byRid.set(key(race.rid),race);

  const hydrated:DnaRaceDocument[]=[];
  for(const batch of chunks([...byRid.values()].map(r=>r.rid),BATCH)) hydrated.push(...(await paced(()=>client.raceDocs(batch))).result);
  const ownedRaces=hydrated.filter(r=>ownedInRace(r as Rec,idSet).length>0).map(r=>({...r,owned_hids:ownedInRace(r as Rec,idSet)}));

  const telemetry:unknown[]=[]; const stats:Rec[]=[]; const power:Rec[]=[]; const stamina:Rec[]=[];
  for(const batch of chunks(ids,BATCH)){
    const [tr,sr,pr,st]=await Promise.all([
      paced(()=>telemetryClient.coreTelemetryBulk(batch)),
      paced(()=>client.coreRacingStatsBulk(batch)),
      paced(()=>client.corePowerBulk(batch)),
      paced(()=>client.coreStaminaBulk(batch)),
    ]);
    if(Array.isArray(tr.result)) telemetry.push(...tr.result); else telemetry.push(tr.result);
    stats.push(...(sr.result as Rec[])); power.push(...(pr.result as Rec[])); stamina.push(...(st.result as Rec[]));
  }

  const hstats:unknown[]=[];
  for(const batch of chunks(ids,12)){
    const rows=await Promise.all(batch.map(async id=>({hid:id,...await post("/hstats",{hid:id,season:"all"})})));
    hstats.push(...rows); await new Promise(r=>setTimeout(r,120));
  }
  const [maps,raceTypes,team]=await Promise.all([post("/maps",{}),post("/race_types",{}),post("/team",{of_vault:VAULT})]);
  const benchmarks:Rec={};
  for(const cb of CBS){benchmarks[String(cb)]=rec(rec((await paced(()=>telemetryClient.coreTelemetryBenchmark(ids[0]!,cb))).result).benchmark);}

  const out={generatedAt:fetchedAt,window:{start:START,end:fetchedAt},requestStats:{requestCount,retryCount,splitCount},ownedCores:owned,ownedRaces,telemetry,racingStats:stats,power,stamina,hstats,benchmarks,esports:{maps:maps.json,raceTypes:raceTypes.json,team:team.json}};
  await mkdir("artifacts",{recursive:true});
  await writeFile("artifacts/temporary-latest-owner-races-roster-audit-2026-09-11.json",JSON.stringify(out),"utf8");
  console.log("LATEST_ROSTER_AUDIT",JSON.stringify({generatedAt:fetchedAt,owned:ids.length,ownedRaces:ownedRaces.length,globalHydrated:hydrated.length,requestCount,retryCount,splitCount}));
  expect(ownedRaces.length).toBeGreaterThan(0); expect(telemetry.length).toBeGreaterThan(0); expect(hstats.length).toBe(ids.length);
},12*60_000);});
