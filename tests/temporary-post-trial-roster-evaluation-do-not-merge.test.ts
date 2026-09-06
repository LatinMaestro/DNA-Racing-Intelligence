import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client, type DnaRaceDocument, type DnaRaceIdentifier } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only post-trial analysis only. */
const enabled=process.env.TEMP_POST_TRIAL_ROSTER_EVAL==='1'; const d=enabled?describe:describe.skip;
type Rec=Record<string,unknown>;
const CBS=[10,12,14,16,18,20,22] as const;
const ROSTER=new Map<number,string>([
 [25557,'Frozen Blade'],[25574,'Frost Rocket'],[25555,'Cyber Overdrive'],[25558,'Iron Dynamo'],[25562,'Nervy Runner'],[25564,'Creeper'],[25565,'Final Flash'],[9216,'Peak Crown'],
 [20777,'Drift Mirage'],[23442,'Vivid Rebel'],[23429,'Lynx Mystic'],[23466,'Vapor Blade'],[22145,'First Light'],[23388,'Violet Jaguar'],[23269,'Livid Jaguar'],[23271,'Flux Dagger'],[23283,'Titan Mage'],[22148,'Mistfall'],[23467,'Forge Serpent'],[20524,'Starline'],[20769,'Blue Vortex'],[23457,'Silent Bruiser'],[22338,'Divine Riot'],[23484,'Phantom Panther'],[23273,'Edge Panther']
]);
const START='2026-09-05T20:00:00.000Z';
const END='2026-09-06T07:15:00.000Z';
function req(n:string){const v=process.env[n]?.trim()??'';if(!v)throw new Error(`${n} missing`);return v;}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function rec(v:unknown):Rec{return v&&typeof v==='object'&&!Array.isArray(v)?v as Rec:{};}
function num(v:unknown):number|null{const n=Number(v);return Number.isFinite(n)?n:null;}
function hid(v:unknown):number|null{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;}
function ints(v:unknown):number[]{return Array.isArray(v)?v.map(hid).filter((x):x is number=>x!==null):[];}
function chunks<T>(a:readonly T[],n:number){const o:T[][]=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n) as T[]);return o;}
function distance(r:Rec):number|null{const cb=num(r.cb);return cb===null?null:cb*100;}
function isBike(r:Rec){return String(r.rvmode??'bike').toLowerCase()==='bike';}
function explicitEsports(r:Rec){const text=[r.race_name,r.format,r.track,...(Array.isArray(r.eventtags)?r.eventtags:[])].map(String).join(' ').toLowerCase();return /esport|pro[ _-]?league|trial/.test(text);}
function ts(r:Rec):number{for(const k of ['end_time','start_time','finished_at','created_at']){const v=r[k];if(typeof v==='string'){const n=Date.parse(v);if(Number.isFinite(n))return n;}}return 0;}
function normalizeSeconds(v:number):number{if(v>10000)return v/1000;return v;}
function extractResult(r:Rec,target:number):{place:number|null;elapsed:number|null}{
 const seen=new Set<unknown>(); let place:number|null=null,elapsed:number|null=null;
 const walk=(v:unknown,depth:number)=>{if(depth>5||v===null||v===undefined||seen.has(v))return;if(typeof v==='object')seen.add(v);
  if(Array.isArray(v)){for(let i=0;i<v.length;i++){const item=v[i];if(Number(item)===target && place===null && /finish|order|position|rank/i.test('array'))place=i+1;walk(item,depth+1);}return;}
  if(typeof v!=='object')return;const o=v as Rec;const id=hid(o.hid??o.core_id??o.coreId??o.token_id??o.tokenId??o.core);
  if(id===target){if(place===null){for(const k of ['position','place','rank','finish_position','finishing_position','result_position']){const x=num(o[k]);if(x!==null&&x>=1&&x<=100){place=x;break;}}}
    if(elapsed===null){for(const k of ['elapsed','elapsed_time','elapsedTime','time','time_s','seconds','finish_time','finishTime','runtime']){const x=num(o[k]);if(x!==null&&x>0){elapsed=normalizeSeconds(x);break;}}}}
  for(const [k,x] of Object.entries(o)){if(/secret|api.?key|authorization|credential/i.test(k))continue;walk(x,depth+1);}
 };
 // Known container keys first so index-based orders are handled sanely.
 for(const key of ['results','result','placements','positions','finish_order','finishing_order','rankings','ranks','times','elapsed','elapsed_times','finish_times','horses','cores','entrants']){
   const v=r[key]; if(Array.isArray(v)){
     const index=v.findIndex(x=>Number(x)===target || hid(rec(x).hid??rec(x).core_id??rec(x).coreId)===target);
     if(index>=0){const row=rec(v[index]);if(place===null){const p=num(row.position??row.place??row.rank??row.finish_position);place=p??( /order|placements|positions|rank/i.test(key)?index+1:null );}
       if(elapsed===null){for(const kk of ['elapsed','elapsed_time','time','time_s','seconds','finish_time']){const e=num(row[kk]);if(e!==null&&e>0){elapsed=normalizeSeconds(e);break;}}}}
   } else {const o=rec(v);const direct=num(o[String(target)]);if(direct!==null){if(/time|elapsed/i.test(key))elapsed=normalizeSeconds(direct);else if(/place|position|rank/i.test(key))place=direct;}}
 }
 walk(r,0); return {place,elapsed};
}
function telemetryMap(payload:unknown){const m=new Map<number,Rec>();for(const v of Array.isArray(payload)?payload:[]){const r=rec(v),id=hid(r.hid);if(id)m.set(id,r);}return m;}
function median(values:number[]):number|null{if(!values.length)return null;const x=[...values].sort((a,b)=>a-b),m=Math.floor(x.length/2);return x.length%2?x[m]!:((x[m-1]!+x[m]!)/2);}
function docShape(r:Rec){return {rid:r.rid,race_name:r.race_name,format:r.format,cb:r.cb,rgate:r.rgate,rvmode:r.rvmode,start_time:r.start_time,end_time:r.end_time,eventtags:r.eventtags,track:r.track,hids:r.hids,yellowstars:r.yellowstars,bluestars:r.bluestars,keys:Object.keys(r).sort()};}

d('TEMPORARY post-trial roster evaluation - DO NOT MERGE',()=>{it('pulls all trial-window races and current telemetry for the 25 rostered cores',async()=>{
 const key=req('DNA_OPEN_LAB_API_KEY_1');const c=createDnaOpenLabV1Client({apiKey:key});const t=createDnaOpenLabV1TelemetryClient({apiKey:key});
 let requests=0;
 async function finishedWindow(start:string,end:string,depth=0):Promise<Rec[]>{requests++;const r=await c.racesFinished({startTime:start,endTime:end,limit:200});await sleep(430);const rows=(r.result as readonly DnaRaceDocument[]).map(rec);const span=Date.parse(end)-Date.parse(start);if(rows.length>=200&&span>5*60_000&&depth<12){const mid=new Date((Date.parse(start)+Date.parse(end))/2).toISOString();return [...await finishedWindow(start,mid,depth+1),...await finishedWindow(mid,end,depth+1)];}return rows;}
 const indexRows=await finishedWindow(START,END);const ridSet=new Map<string,DnaRaceIdentifier>();for(const r of indexRows){const rid=r.rid;if(typeof rid==='string'||typeof rid==='number')ridSet.set(String(rid),rid);}const hydrated:Rec[]=[];
 for(const batch of chunks([...ridSet.values()],20)){requests++;const r=await c.raceDocs(batch);for(const x of r.result as readonly DnaRaceDocument[])hydrated.push(rec(x));await sleep(430);}
 const byRid=new Map<string,Rec>();for(const r of hydrated){if(r.rid!==undefined&&r.rid!==null)byRid.set(String(r.rid),r);}const allDocs=[...byRid.values()].filter(isBike).sort((a,b)=>ts(a)-ts(b));
 const rosterDocs=allDocs.filter(r=>ints(r.hids).some(x=>ROSTER.has(x)));const explicit=rosterDocs.filter(explicitEsports);const selected=explicit.length>=Math.max(3,Math.floor(rosterDocs.length*0.4))?explicit:rosterDocs;
 const trialRowsByCore=new Map<number,Rec[]>();for(const id of ROSTER.keys())trialRowsByCore.set(id,[]);for(const r of selected){for(const id of ints(r.hids))if(ROSTER.has(id))trialRowsByCore.get(id)!.push(r);}
 // Current telemetry + global baselines.
 const tm=new Map<number,Rec>();for(const batch of chunks([...ROSTER.keys()],20)){requests++;const r=await t.coreTelemetryBulk(batch);for(const [id,row] of telemetryMap(r.result))tm.set(id,row);await sleep(430);}
 const benchmarks:Record<string,Rec>={};const sampleHid=[...ROSTER.keys()][0]!;for(const cb of CBS){requests++;const r=await t.coreTelemetryBenchmark(sampleHid,cb);benchmarks[String(cb)]=rec(rec(r.result).benchmark);await sleep(430);}
 const summaries=[];
 for(const [id,name] of ROSTER){const rows=trialRowsByCore.get(id)??[];const trialBy=new Map<number,{races:number;blue:number;yellow:number;places:number[];elapsed:number[]}>();for(const r of rows){const dist=distance(r);if(dist===null)continue;const x=trialBy.get(dist)??{races:0,blue:0,yellow:0,places:[],elapsed:[]};x.races++;if(ints(r.bluestars).includes(id))x.blue++;if(ints(r.yellowstars).includes(id))x.yellow++;const res=extractResult(r,id);if(res.place!==null)x.places.push(res.place);if(res.elapsed!==null)x.elapsed.push(res.elapsed);trialBy.set(dist,x);}
  const trialDistances=[...trialBy.entries()].map(([dist,x])=>{const medElapsed=median(x.elapsed);return {distance:dist,races:x.races,blue:x.blue,yellow:x.yellow,placesN:x.places.length,wins:x.places.filter(p=>p===1).length,podiums:x.places.filter(p=>p<=3).length,avgPlace:x.places.length?x.places.reduce((a,b)=>a+b,0)/x.places.length:null,elapsedN:x.elapsed.length,medianElapsed:medElapsed,medianTrialSpeed:medElapsed===null?null:dist/medElapsed,bestTrialSpeed:x.elapsed.length?Math.max(...x.elapsed.map(e=>dist/e)):null};}).sort((a,b)=>a.distance-b.distance);
  const data=rec(tm.get(id)?.data);const telemetry=[];for(const cb of CBS){const rr=rec(data[String(cb)]);const n=num(rr.races_n)??0,timeMedian=num(rr.time_median),best=num(rr.speed_mx);if(n<1||timeMedian===null)continue;const dist=cb*100,med=dist/timeMedian,b=benchmarks[String(cb)]??{},ga=num(b.speed_avg),gm=num(b.speed_mx);telemetry.push({distance:dist,races:n,medianTime:timeMedian,medianSpeed:med,bestSpeed:best,globalAvg:ga,globalMax:gm,medianVsGlobalAvgPct:ga===null?null:(med/ga-1)*100,globalHeadroomFraction:ga!==null&&gm!==null&&gm>ga?(med-ga)/(gm-ga):null});}
  const bestTelemetry=[...telemetry].filter(x=>x.races>=5).sort((a,b)=>(b.medianVsGlobalAvgPct??-999)-(a.medianVsGlobalAvgPct??-999)||b.races-a.races)[0]??[...telemetry].sort((a,b)=>(b.medianVsGlobalAvgPct??-999)-(a.medianVsGlobalAvgPct??-999))[0]??null;
  summaries.push({hid:id,name,trialRaceCount:rows.length,trialDistances,telemetry,bestTelemetry});
 }
 const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,window:{start:START,end:END},requests,indexRows:indexRows.length,hydratedDocs:allDocs.length,rosterDocs:rosterDocs.length,explicitEsportsDocs:explicit.length,selectionMode:selected===explicit?'explicit_esports_tags':'all_roster_bike_docs_in_trial_window',selectedDocs:selected.length,summaries,docShapes:selected.slice(0,12).map(docShape)};
 console.log('POST_TRIAL_ROSTER_EVALUATION',JSON.stringify(out,null,2));await mkdir('artifacts',{recursive:true});await writeFile('artifacts/temporary-post-trial-roster-evaluation.json',JSON.stringify(out,null,2));expect(summaries).toHaveLength(25);expect(out.hydratedDocs).toBeGreaterThan(0);
},8*60_000);});
