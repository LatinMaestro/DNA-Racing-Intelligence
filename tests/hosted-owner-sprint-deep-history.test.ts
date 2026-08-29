import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const enabled = process.env.DNA_OWNER_BREEDING_PAIRS === "1";
const describeConnected = enabled ? describe : describe.skip;
const HIDS = [8665,12990,13298,3153,11042,27,13540,123,973,14036,9089,13765] as const;
const TARGETS = new Set([1000,1200,1400]);
type AnyRecord = Record<string, any>;
function num(v:any,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function familyOf(r:AnyRecord){const gate=num(r.rgate,0);const d=[r.format,r.race_name,r.payout].filter(v=>v!=null).join(" ").toLowerCase();if(gate===2||d.includes("1v1"))return "1v1";if(d.includes("wta")||d.includes("winner take all"))return "wta";if(d.includes("mad")||d.includes("variance"))return "madness";return "generic";}
function evidenceOf(r:AnyRecord){const name=String(r.race_name??"");const format=String(r.format??"").toLowerCase();if(/\bfree\b/i.test(name))return "normal_free";if(format.includes("esport")||/\b(anchor|glory|measure|miracles)\b/i.test(name))return "esports";return "competitive";}
function starOf(r:AnyRecord,hid:number){const y=Array.isArray(r.yellowstars)?r.yellowstars.map(Number):[];const b=Array.isArray(r.bluestars)?r.bluestars.map(Number):[];return {yellow:y.includes(hid),blue:b.includes(hid)};}
function norm(hid:number,r:AnyRecord){if(String(r.rvmode??"").toLowerCase()!=="bike")return null;const cb=num(r.cb,0),distance=cb>=100?cb:cb*100,time=num(r.time??r.rtime??r.elapsed,0);if(!TARGETS.has(distance)||time<=0)return null;const star=starOf(r,hid);return {hid,rid:String(r.rid??r.rhid??`${hid}:${r.start_time??""}:${distance}:${time}`),distance,gate:num(r.rgate,0),time,speed:distance/time,family:familyOf(r),evidence:evidenceOf(r),startTime:String(r.start_time??""),raceName:String(r.race_name??""),yellowStar:star.yellow,blueStar:star.blue};}

describeConnected("targeted deep sprint history",()=>{
 it("backfills older 1000/1200/1400 timing evidence for shortlisted parents",async()=>{
  let last=0,calls=0;const records:any[]=[];const pages:any[]=[];
  const paced=async<T>(fn:()=>Promise<T>)=>{const wait=2100-(Date.now()-last);if(wait>0)await new Promise(r=>setTimeout(r,wait));const v=await fn();last=Date.now();calls++;return v;};
  for(const hid of HIDS){const seen=new Set<string>();const counts=new Map<number,number>([[1000,0],[1200,0],[1400,0]]);for(let page=1;page<=15;page++){const result=await paced(async()=>{const res=await fetch("https://api.dnaracing.run/fbike/i/hraces",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({hid,page})});const body:any=await res.json();if(!body||!Array.isArray(body.result))throw new Error(`hraces ${hid}/${page} malformed`);return body.result as AnyRecord[];});pages.push({hid,page,n:result.length});for(const raw of result){const z=norm(hid,raw);if(z&&!seen.has(z.rid)){seen.add(z.rid);records.push(z);counts.set(z.distance,(counts.get(z.distance)??0)+1);}}if(result.length<50)break;if([...counts.values()].every(n=>n>=25))break;}}
  await mkdir("artifacts",{recursive:true});
  await writeFile("artifacts/owner-sprint-deep-history.json",JSON.stringify({schemaVersion:1,fetchedAt:new Date().toISOString(),apiCalls:calls,hids:HIDS,pages,records}),"utf8");
  expect(records.length).toBeGreaterThan(0);
 },600_000);
});
