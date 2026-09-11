import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only esports history research. */
const enabled=process.env.TEMP_LATEST_ESPORTS_20260911==='1';
const d=enabled?describe:describe.skip;
const BASE='https://api.dnaracing.run/fbike/esports';
const VAULT='0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d';
type Rec=Record<string,unknown>;
function rec(v:unknown):Rec{return v&&typeof v==='object'&&!Array.isArray(v)?v as Rec:{};}
function rows(v:unknown):Rec[]{const r=rec(v);return Array.isArray(r.result)?r.result.map(rec):[];}
async function post(path:string,body:Rec){const r=await fetch(`${BASE}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','User-Agent':'DNA-Racing-Intelligence temporary read-only esports history'},body:JSON.stringify(body)});const text=await r.text();let json:unknown=null;try{json=JSON.parse(text);}catch{/*ignore*/}return {status:r.status,json,text:json===null?text.slice(0,2000):null};}
function chunks<T>(xs:readonly T[],n:number){const o:T[][]=[];for(let i=0;i<xs.length;i+=n)o.push(xs.slice(i,i+n) as T[]);return o;}

d('TEMPORARY latest esports match history',()=>{it('captures current Latin team history and all linked events',async()=>{
 const team=await post('/team',{of_vault:VAULT}); const teamRow=rec(rec(team.json).result); const teamId=String(teamRow.team_id??teamRow.id??'953adec8ad');
 const [history,maps,raceTypes,seasonState]=await Promise.all([
   post('/team/match_history',{team_id:teamId,limit:100,skip:0,bucket:null}),post('/maps',{}),post('/race_types',{}),post('/season_state',{})
 ]);
 const eventIds=[...new Set(rows(history.json).map(x=>typeof x.event_id==='string'?x.event_id:null).filter((x):x is string=>x!==null))];
 const events:unknown[]=[];
 for(const batch of chunks(eventIds,12)){events.push(...await Promise.all(batch.map(async eventId=>({eventId,...await post('/event',{event_id:eventId})}))));}
 const out={generatedAt:new Date().toISOString(),team:team.json,history:history.json,maps:maps.json,raceTypes:raceTypes.json,seasonState:seasonState.json,events};
 await mkdir('artifacts',{recursive:true}); await writeFile('artifacts/temporary-latest-esports-match-history-2026-09-11.json',JSON.stringify(out),'utf8');
 console.log('LATEST_ESPORTS_HISTORY',JSON.stringify({generatedAt:out.generatedAt,teamId,historyRows:rows(history.json).length,eventCount:events.length}));
 expect(rows(history.json).length).toBeGreaterThan(0); expect(events.length).toBeGreaterThan(0);
},3*60_000);});
