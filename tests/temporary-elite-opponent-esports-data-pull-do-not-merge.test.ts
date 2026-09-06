import { mkdir, writeFile } from "node:fs/promises";
import { describe, it } from "vitest";

const enabled = process.env.DNA_ELITE_OPPONENT_ESPORTS_PULL === "1";
const describeConnected = enabled ? describe : describe.skip;
const TEAM_ID = "68082d17da";
const VAULT = "0xa95db43f2f3e59d9fb6db54b4e98fc714bced07b";
const BASES = [
  "https://api.dnaracing.run/fbike/esports",
  "https://api.dnaracing.run/fbike/pub/v1/esports",
] as const;

type AnyRecord = Record<string, unknown>;
function required(name:string):string { const v=process.env[name]; if(!v||v.trim()!==v) throw new Error(`${name} missing`); return v; }
function rec(v:unknown):AnyRecord|null { return v!==null&&typeof v==="object"&&!Array.isArray(v)?v as AnyRecord:null; }
function collectHids(value:unknown): number[] {
  const out=new Set<number>();
  const visit=(v:unknown):void=>{
    if(Array.isArray(v)){ for(const x of v) visit(x); return; }
    const r=rec(v); if(!r) return;
    for(const [k,x] of Object.entries(r)){
      if(/^(hid|core_id|core_hid)$/iu.test(k)){ const n=Number(x); if(Number.isSafeInteger(n)&&n>0) out.add(n); }
      visit(x);
    }
  };
  visit(value); return [...out].sort((a,b)=>a-b);
}

async function request(base:string,path:string,params:Record<string,unknown>,apiKey:string,authMode:"bearer"|"xtoken"="bearer"){
  const url=new URL(`${base}${path}`);
  for(const [k,v] of Object.entries(params)){
    if(v===null||v===undefined) continue;
    if(Array.isArray(v)) for(const item of v) url.searchParams.append(k,String(item));
    else url.searchParams.set(k,String(v));
  }
  const headers:Record<string,string>={Accept:"application/json","User-Agent":"DNA-Racing-Intelligence read-only research"};
  if(authMode==="bearer") headers.Authorization=`Bearer ${apiKey}`; else headers["X-Token"]=apiKey;
  const r=await fetch(url,{headers});
  const text=await r.text(); let json:unknown=null; try{json=JSON.parse(text);}catch{/*ignore*/}
  return {url:url.href,status:r.status,json,text:json===null?text.slice(0,5000):null};
}

function looksUsable(probe:{status:number;json:unknown}):boolean {
  if(probe.status < 200 || probe.status >= 300) return false;
  const r=rec(probe.json);
  if(r?.status==="error") return false;
  return probe.json!==null;
}

describeConnected("temporary elite opponent esports data pull",()=>{
  it("pulls read-only team, map, standings and history evidence",async()=>{
    const apiKey=required("DNA_OPEN_LAB_API_KEY_1");
    await mkdir("artifacts/temporary-elite-opponent-esports",{recursive:true});
    const attempts:Record<string,unknown>={}; let chosen:string|null=null; let chosenAuth:"bearer"|"xtoken"="bearer"; let team:unknown=null;
    for(const base of BASES){
      for(const authMode of ["bearer","xtoken"] as const){
        const probe=await request(base,"/teams",{team_id:TEAM_ID},apiKey,authMode);
        attempts[`${base}|${authMode}`]=probe;
        if(looksUsable(probe)){chosen=base;chosenAuth=authMode;team=probe.json;break;}
      }
      if(chosen) break;
    }
    if(!chosen){
      await writeFile("artifacts/temporary-elite-opponent-esports/esports.json",JSON.stringify({fetchedAt:new Date().toISOString(),teamId:TEAM_ID,vault:VAULT,chosenBase:null,attempts}),"utf8");
      return;
    }
    const base=chosen;
    const authMode=chosenAuth;
    const [vaultStats,maps,standings,seasonState,seasons,history,teamByVault,allTeams] = await Promise.all([
      request(base,"/vault_stats",{team_id:TEAM_ID,of_vault:VAULT,season:0},apiKey,authMode),
      request(base,"/maps",{},apiKey,authMode),
      request(base,"/standings",{season:"active"},apiKey,authMode),
      request(base,"/season_state",{},apiKey,authMode),
      request(base,"/seasons",{},apiKey,authMode),
      request(base,"/team/match_history",{team_id:TEAM_ID,limit:100,skip:0},apiKey,authMode),
      request(base,"/team",{of_vault:VAULT},apiKey,authMode),
      request(base,"/teams",{},apiKey,authMode),
    ]);
    const initial={team,vaultStats:vaultStats.json,maps:maps.json,standings:standings.json,seasonState:seasonState.json,seasons:seasons.json,history:history.json,teamByVault:teamByVault.json,allTeams:allTeams.json};
    const hids=collectHids(initial);
    const hstats:unknown[]=[];
    for(const hid of hids){
      const current=await request(base,"/hstats",{hid,season:"all"},apiKey,authMode);
      hstats.push({hid,response:current.json,status:current.status});
    }
    let coresByHids:unknown=null;
    if(hids.length){ coresByHids=(await request(base,"/cores_by_hids",{hids},apiKey,authMode)).json; }
    const eventIds=new Set<string>();
    const visitEvents=(v:unknown):void=>{ if(Array.isArray(v)){for(const x of v)visitEvents(x);return;} const r=rec(v); if(!r)return; for(const [k,x] of Object.entries(r)){if(/event_id/iu.test(k)&&typeof x==="string"&&x)eventIds.add(x);visitEvents(x);} };
    visitEvents(history.json);
    const events:unknown[]=[];
    for(const eventId of [...eventIds].slice(0,40)){
      const ev=await request(base,"/event",{event_id:eventId},apiKey,authMode);
      events.push({eventId,response:ev.json,status:ev.status});
    }
    await writeFile("artifacts/temporary-elite-opponent-esports/esports.json",JSON.stringify({
      fetchedAt:new Date().toISOString(),teamId:TEAM_ID,vault:VAULT,chosenBase:base,chosenAuth:authMode,attempts,initial,hids,hstats,coresByHids,eventIds:[...eventIds],events
    }),"utf8");
  },180_000);
});
