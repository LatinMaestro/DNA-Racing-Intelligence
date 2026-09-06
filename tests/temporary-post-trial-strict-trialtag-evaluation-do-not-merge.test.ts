import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client, type DnaRaceDocument, type DnaRaceIdentifier } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only strict Trial-tag evaluation only. */
const enabled=process.env.TEMP_POST_TRIAL_STRICT==='1'; const d=enabled?describe:describe.skip; type Rec=Record<string,unknown>;
const CBS=[10,12,14,16,18,20,22] as const;
const ROSTER=new Map<number,string>([
 [25557,'Frozen Blade'],[25574,'Frost Rocket'],[25555,'Cyber Overdrive'],[25558,'Iron Dynamo'],[25562,'Nervy Runner'],[25564,'Creeper'],[25565,'Final Flash'],[9216,'Peak Crown'],
 [20777,'Drift Mirage'],[23442,'Vivid Rebel'],[23429,'Lynx Mystic'],[23466,'Vapor Blade'],[22145,'First Light'],[23388,'Violet Jaguar'],[23269,'Livid Jaguar'],[23271,'Flux Dagger'],[23283,'Titan Mage'],[22148,'Mistfall'],[23467,'Forge Serpent'],[20524,'Starline'],[20769,'Blue Vortex'],[23457,'Silent Bruiser'],[22338,'Divine Riot'],[23484,'Phantom Panther'],[23273,'Edge Panther']
]);
const START='2026-09-05T20:00:00.000Z', END='2026-09-06T07:15:00.000Z';
function req(n:string){const v=process.env[n]?.trim()??'';if(!v)throw new Error(`${n} missing`);return v;}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function rec(v:unknown):Rec{return v&&typeof v==='object'&&!Array.isArray(v)?v as Rec:{};}
function num(v:unknown):number|null{const n=Number(v);return Number.isFinite(n)?n:null;}
function hid(v:unknown):number|null{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;}
function ints(v:unknown):number[]{return Array.isArray(v)?v.map(hid).filter((x):x is number=>x!==null):[];}
function chunks<T>(a:readonly T[],n:number){const o:T[][]=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n) as T[]);return o;}
function isTrial(r:Rec){const tags=Array.isArray(r.eventtags)?r.eventtags.map(x=>String(x).toLowerCase()):[];const name=String(r.race_name??'').toLowerCase();return tags.includes('trial')||name==='trainer series';}
function dist(r:Rec){const cb=num(r.cb);return cb===null?null:cb*100;}
function teleMap(v:unknown){const m=new Map<number,Rec>();for(const x of Array.isArray(v)?v:[]){const r=rec(x),id=hid(r.hid);if(id)m.set(id,r);}return m;}
async function allFinished(c:ReturnType<typeof createDnaOpenLabV1Client>,start:string,end:string,depth=0):Promise<Rec[]>{const r=await c.racesFinished({startTime:start,endTime:end,limit:200});await sleep(420);const rows=(r.result as readonly DnaRaceDocument[]).map(rec);const span=Date.parse(end)-Date.parse(start);if(rows.length>=200&&span>300000&&depth<12){const mid=new Date((Date.parse(start)+Date.parse(end))/2).toISOString();return [...await allFinished(c,start,mid,depth+1),...await allFinished(c,mid,end,depth+1)];}return rows;}

d('TEMPORARY strict Trial-tag post-trial evaluation',()=>{it('evaluates Trial-tag docs + current population-relative telemetry',async()=>{
 const key=req('DNA_OPEN_LAB_API_KEY_1');const c=createDnaOpenLabV1Client({apiKey:key}),t=createDnaOpenLabV1TelemetryClient({apiKey:key});
 const idx=await allFinished(c,START,END);const ridMap=new Map<string,DnaRaceIdentifier>();for(const r of idx){if(typeof r.rid==='string'||typeof r.rid==='number')ridMap.set(String(r.rid),r.rid);}const docs:Rec[]=[];for(const batch of chunks([...ridMap.values()],20)){const x=await c.raceDocs(batch);docs.push(...(x.result as readonly DnaRaceDocument[]).map(rec));await sleep(420);}const trials=docs.filter(isTrial).filter(r=>ints(r.hids).some(id=>ROSTER.has(id)));
 const telemetry=new Map<number,Rec>();for(const batch of chunks([...ROSTER.keys()],20)){const x=await t.coreTelemetryBulk(batch);for(const [id,r] of teleMap(x.result))telemetry.set(id,r);await sleep(420);}const bench:Record<string,Rec>={};for(const cb of CBS){const x=await t.coreTelemetryBenchmark([...ROSTER.keys()][0]!,cb);bench[String(cb)]=rec(rec(x.result).benchmark);await sleep(420);}
 const summaries=[];
 for(const [id,name] of ROSTER){const coreDocs=trials.filter(r=>ints(r.hids).includes(id));const by=new Map<number,{races:number;blue:number;yellow:number}>();for(const r of coreDocs){const d0=dist(r);if(d0===null)continue;const q=by.get(d0)??{races:0,blue:0,yellow:0};q.races++;if(ints(r.bluestars).includes(id))q.blue++;if(ints(r.yellowstars).includes(id))q.yellow++;by.set(d0,q);}const trial=[...by.entries()].map(([distance,q])=>({distance,...q,starCount:q.blue+q.yellow,starRate:(q.blue+q.yellow)/q.races})).sort((a,b)=>a.distance-b.distance);
  const data=rec(telemetry.get(id)?.data);const tel=[];for(const cb of CBS){const rr=rec(data[String(cb)]),n=num(rr.races_n)??0,tm=num(rr.time_median),best=num(rr.speed_mx);if(n<1||tm===null)continue;const distance=cb*100,med=distance/tm,b=bench[String(cb)]??{},ga=num(b.speed_avg),gm=num(b.speed_mx);tel.push({distance,races:n,medianSpeed:med,bestSpeed:best,medianTime:tm,medianVsGlobalAvgPct:ga===null?null:(med/ga-1)*100,headroom:ga!==null&&gm!==null&&gm>ga?(med-ga)/(gm-ga):null});}
  const eligible=tel.filter(x=>x.races>=5);const best=[...(eligible.length?eligible:tel)].sort((a,b)=>(b.medianVsGlobalAvgPct??-999)-(a.medianVsGlobalAvgPct??-999)||b.races-a.races)[0]??null;
  const stars=trial.reduce((a,x)=>a+x.starCount,0),trialRaces=trial.reduce((a,x)=>a+x.races,0);summaries.push({hid:id,name,trialRaces,blue:trial.reduce((a,x)=>a+x.blue,0),yellow:trial.reduce((a,x)=>a+x.yellow,0),starRate:trialRaces?stars/trialRaces:0,trialDistances:trial,telemetry:tel,bestTelemetry:best});
 }
 const tagCounts=new Map<string,number>();for(const r of docs){const key2=JSON.stringify({race_name:r.race_name,eventtags:r.eventtags,track:r.track});tagCounts.set(key2,(tagCounts.get(key2)??0)+1);}const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,window:{start:START,end:END},finishedIndexRows:idx.length,hydratedDocs:docs.length,trialDocs:trials.length,trialRids:trials.map(r=>r.rid),summaries,classificationCounts:[...tagCounts.entries()].map(([k,count])=>({key:JSON.parse(k),count})).sort((a,b)=>b.count-a.count).slice(0,20)};
 console.log('STRICT_POST_TRIAL_EVAL',JSON.stringify(out,null,2));await mkdir('artifacts',{recursive:true});await writeFile('artifacts/temporary-post-trial-strict-trialtag-evaluation.json',JSON.stringify(out,null,2));expect(out.trialDocs).toBeGreaterThan(0);expect(summaries).toHaveLength(25);
},8*60_000);});
