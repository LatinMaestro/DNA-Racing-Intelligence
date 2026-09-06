import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only matchup research only. */
const enabled=process.env.TEMP_BLACK_SHEEP_MATCH_PULL==='1';
const d=enabled?describe:describe.skip;
const LATIN='0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d';
const BLACK='0xa95db43f2f3e59d9fb6db54b4e98fc714bced07b';
const BLACK_TEAM='68082d17da';
const BASE='https://api.dnaracing.run/fbike/esports';
const CBS=[10,12,14,16,18,20,22] as const;
type Rec=Record<string,unknown>;
function req(n:string){const v=process.env[n]?.trim()??'';if(!v)throw new Error(`${n} missing`);return v;}
function rec(v:unknown):Rec{return v&&typeof v==='object'&&!Array.isArray(v)?v as Rec:{};}
function hid(v:unknown):number|null{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;}
function chunks<T>(a:readonly T[],n:number){const o:T[][]=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n) as T[]);return o;}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function post(path:string,body:Rec){const r=await fetch(`${BASE}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','User-Agent':'DNA-Racing-Intelligence read-only matchup research'},body:JSON.stringify(body)});const text=await r.text();let json:unknown=null;try{json=JSON.parse(text);}catch{/*ignore*/}return {status:r.status,json,text:json===null?text.slice(0,3000):null};}
async function hstats(ids:number[]){const out=[];for(const batch of chunks(ids,12)){const rows=await Promise.all(batch.map(async id=>({hid:id,...await post('/hstats',{hid:id,season:'all'})})));out.push(...rows);await sleep(150);}return out;}
function resultRows(v:unknown):Rec[]{const r=rec(v);return Array.isArray(r.result)?r.result.map(rec):[];}

d('TEMPORARY BLACK SHEEP match full-vault pull - DO NOT MERGE',()=>{it('captures current Latin universe, Black Sheep roster, maps and matchup evidence',async()=>{
 const key=req('DNA_OPEN_LAB_API_KEY_1');const c=createDnaOpenLabV1Client({apiKey:key});const t=createDnaOpenLabV1TelemetryClient({apiKey:key});
 const owned=(await c.vaultCoresFull(LATIN)).result as readonly Rec[];const latinIds=owned.map(x=>hid(x.hid)).filter((x):x is number=>x!==null);expect(latinIds.length).toBeGreaterThan(100);
 const [latinTeam,blackTeam,maps,raceTypes,blackHistory,latinHistory,seasonState,allTeams]=await Promise.all([
  post('/team',{of_vault:LATIN}),post('/team',{of_vault:BLACK}),post('/maps',{}),post('/race_types',{}),
  post('/team/match_history',{team_id:BLACK_TEAM,limit:100,skip:0,bucket:null}),
  post('/team/match_history',{team_id:'953adec8ad',limit:100,skip:0,bucket:null}),post('/season_state',{}),post('/teams',{})
 ]);
 const blackTeamRow=rec(rec(blackTeam.json).result);const blackIds=Array.isArray(blackTeamRow.cores_list)?blackTeamRow.cores_list.map(hid).filter((x):x is number=>x!==null):[];expect(blackIds.length).toBeGreaterThanOrEqual(12);
 const benchmarks:Rec={};for(const cb of CBS){const r=await t.coreTelemetryBenchmark(latinIds[0]!,cb);benchmarks[String(cb)]=rec(rec(r.result).benchmark);await sleep(180);}
 const latinTelemetry:unknown[]=[];const latinStats:unknown[]=[];const latinPower:unknown[]=[];const latinStamina:unknown[]=[];
 for(const batch of chunks(latinIds,20)){const [tr,sr,pr,st]=await Promise.all([t.coreTelemetryBulk(batch),c.coreRacingStatsBulk(batch),c.corePowerBulk(batch),c.coreStaminaBulk(batch)]);latinTelemetry.push(...(Array.isArray(tr.result)?tr.result:[]));latinStats.push(...sr.result);latinPower.push(...pr.result);latinStamina.push(...st.result);await sleep(220);}
 const blackTelemetry:unknown[]=[];for(const batch of chunks(blackIds,20)){const tr=await t.coreTelemetryBulk(batch);blackTelemetry.push(...(Array.isArray(tr.result)?tr.result:[]));await sleep(180);}
 const [latinHstats,blackHstats]=await Promise.all([hstats(latinIds),hstats(blackIds)]);
 const eventIds=new Set<string>();for(const row of [...resultRows(blackHistory.json),...resultRows(latinHistory.json)]){if(typeof row.event_id==='string')eventIds.add(row.event_id);}
 const events=[];for(const batch of chunks([...eventIds],12)){const rows=await Promise.all(batch.map(async eventId=>({eventId,...await post('/event',{event_id:eventId})})));events.push(...rows);await sleep(150);}
 const tomorrow=resultRows(latinHistory.json).find(row=>row.opponent_team_id===BLACK_TEAM&&(row.bucket==='upcoming'||row.stage==='scheduled'||row.stage==='live'))??null;
 const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,latinVault:LATIN,blackVault:BLACK,latinOwned:owned,latinIds,blackIds,benchmarks,latinTelemetry,latinStats,latinPower,latinStamina,latinHstats,blackTelemetry,blackHstats,esports:{latinTeam:latinTeam.json,blackTeam:blackTeam.json,maps:maps.json,raceTypes:raceTypes.json,blackHistory:blackHistory.json,latinHistory:latinHistory.json,seasonState:seasonState.json,allTeams:allTeams.json,tomorrow,events}};
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/temporary-black-sheep-match-full-vault.json',JSON.stringify(out),'utf8');
 console.log('BLACK_SHEEP_MATCH_PULL_SUMMARY',JSON.stringify({generatedAt:out.generatedAt,latinOwned:latinIds.length,blackRoster:blackIds.length,tomorrow,latinTeamUpdated:rec(rec(latinTeam.json).result).updated_at,blackTeamUpdated:blackTeamRow.updated_at,maps:resultRows(maps.json).map(x=>({name:x.name,races_n:x.races_n})),eventCount:events.length}));
},8*60_000);});
