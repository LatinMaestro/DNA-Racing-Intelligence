import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only early trial telemetry screen. */
const enabled=process.env.TEMP_NEWBORN_LIVE_TELEMETRY_SCREEN==='1'; const d=enabled?describe:describe.skip;
const TARGETS=new Map<number,string>([[25557,'Frozen Blade'],[25574,'Frost Rocket'],[25555,'Cyber Overdrive'],[25558,'Iron Dynamo'],[25562,'Nervy Runner'],[25564,'Creeper'],[25565,'Final Flash'],[9216,'Peak Crown']]);
const CBS=[10,12,14,16,18,20,22] as const; type Rec=Record<string,unknown>;
function req(n:string){const v=process.env[n]?.trim()??'';if(!v)throw new Error(`${n} missing`);return v;}
function rec(v:unknown):Rec{return v&&typeof v==='object'&&!Array.isArray(v)?v as Rec:{};}
function num(v:unknown):number|null{const x=Number(v);return Number.isFinite(x)?x:null;}
function teleMap(payload:unknown){const out=new Map<number,Rec>();for(const x of Array.isArray(payload)?payload:[]){const r=rec(x);const id=Number(r.hid);if(Number.isSafeInteger(id)&&id>0)out.set(id,r);}return out;}

d('TEMPORARY newborn live telemetry early distance screen - DO NOT MERGE',()=>{it('summarizes current telemetry vs global benchmarks',async()=>{
 const t=createDnaOpenLabV1TelemetryClient({apiKey:req('DNA_OPEN_LAB_API_KEY_1')});
 const ids=[...TARGETS.keys()]; const bulk=await t.coreTelemetryBulk(ids); const by=teleMap(bulk.result);
 const benchmarks:Record<string,Rec>={}; for(const cb of CBS){const b=await t.coreTelemetryBenchmark(ids[0]!,cb);benchmarks[String(cb)]=rec(rec(b.result).benchmark);}
 const summaries=[];
 for(const [hid,name] of TARGETS){const data=rec(by.get(hid)?.data);const distances=[];for(const cb of CBS){const r=rec(data[String(cb)]);const races=num(r.races_n)??0;const timeMedian=num(r.time_median);const speedMax=num(r.speed_mx);if(races<1||timeMedian===null)continue;const medianSpeed=cb*100/timeMedian;const b=benchmarks[String(cb)]??{};const globalAvg=num(b.speed_avg);const globalMax=num(b.speed_mx);const advantage=globalAvg===null?null:(medianSpeed/globalAvg-1)*100;const headroom=globalAvg!==null&&globalMax!==null&&globalMax>globalAvg?(medianSpeed-globalAvg)/(globalMax-globalAvg):null;distances.push({distance:cb*100,races,timeMedian,medianSpeed,bestSpeed:speedMax,medianVsGlobalAvgPct:advantage,globalHeadroomFraction:headroom});}
 distances.sort((a,b)=>(b.medianVsGlobalAvgPct??-999)-(a.medianVsGlobalAvgPct??-999)||b.races-a.races);
 summaries.push({hid,name,totalTelemetryRaces:distances.reduce((a,b)=>a+b.races,0),preferred:distances[0]?.distance??null,distances});}
 const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,summaries};console.log('NEWBORN_LIVE_TELEMETRY_EARLY_SCREEN',JSON.stringify(out,null,2));await mkdir('artifacts',{recursive:true});await writeFile('artifacts/temporary-newborn-live-telemetry-early-distance-screen.json',JSON.stringify(out,null,2));expect(summaries).toHaveLength(8);
},120000);});
