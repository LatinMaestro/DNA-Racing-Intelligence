import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

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

async function request(base:string,path:string,params:Record<string,unknown>,apiKey:string){
  const url=new URL(`${base}${path}`);
  for(const [k,v] of Object.entries(params)){
    if(v===null||v===undefined) continue;
    if(Array.isArray(v)) for(const item of v) url.searchParams.append(k,String(item));
    else url.searchParams.set(k,String(v));
  }
  const r=await fetch(url,{headers:{Authorization:`Bearer ${apiKey}`,Accept:"application/json","User-Agent":"DNA-Racing-Intelligence read-only research"}});
  const text=await r.text(); let json:unknown=null; try{json=JSON.parse(text);}catch{/*ignore*/}
  return {url:url.href,status:r.status,json,text:json===null?text.slice(0,5000):null};
}

describeConnected("temporary elite opponent esports data pull",()=>{
  it("pulls read-only team, map, standings and history evidence",async()=>{
    const apiKey=required("DNA_OPEN_LAB_API_KEY_1");
    const attempts:Record<string,unknown>={}; let chosen:string|null=null; let team:unknown=null;
    for(const base of BASES){
      const probe=await request(base,"/teams",{team_id:TEAM_ID},apiKey);
      attempts[base]=probe;
      const r=rec(probe.json); const success=r&&(r.status==="success"||"result" in r||"data" in r);
      if(success){chosen=base;team=probe.json;break;}
    }
    expect(chosen).not.toBeNull();
    const base=chosen!;
    const [vaultStats,maps,standings,seasonState,seasons,history,teamByVault] = await Promise.all([
      request(base,"/vault_stats",{team_id:TEAM_ID,of_vault:VAULT,season:0},apiKey),
      request(base,"/maps",{},apiKey),
      request(base,"/standings",{season:"active"},apiKey),
      request(base,"/season_state",{},apiKey),
      request(base,"/seasons",{},apiKey),
      request(base,"/team/match_history",{team_id:TEAM_ID,limit:100,skip:0},apiKey),
      request(base,"/team",{of_vault:VAULT},apiKey),
    ]);
    const initial={team,vaultStats:vaultStats.json,maps:maps.json,standings:standings.json,seasonState:seasonState.json,seasons:seasons.json,history:history.json,teamByVault:teamByVault.json};
    const hids=collectHids(initial);
    const hstats:unknown[]=[];
    for(const hid of hids){
      const current=await request(base,"/hstats",{hid,season:"all"},apiKey);
      hstats.push({hid,response:current.json,status:current.status});
    }
    let coresByHids:unknown=null;
    if(hids.length){
      // Frontend uses repeated hids query params.
      coresByHids=(await request(base,"/cores_by_hids",{hids},apiKey)).json;
    }
    const eventIds=new Set<string>();
    const visitEvents=(v:unknown):void=>{ if(Array.isArray(v)){for(const x of v)visitEvents(x);return;} const r=rec(v); if(!r)return; for(const [k,x] of Object.entries(r)){if(/event_id/iu.test(k)&&typeof x==="string"&&x)eventIds.add(x);visitEvents(x);} };
    visitEvents(history.json);
    const events:unknown[]=[];
    for(const eventId of [...eventIds].slice(0,40)){
      const ev=await request(base,"/event",{event_id:eventId},apiKey);
      events.push({eventId,response:ev.json,status:ev.status});
    }
    await mkdir("artifacts/temporary-elite-opponent-esports",{recursive:true});
    await writeFile("artifacts/temporary-elite-opponent-esports/esports.json",JSON.stringify({
      fetchedAt:new Date().toISOString(),teamId:TEAM_ID,vault:VAULT,chosenBase:base,attempts,initial,hids,hstats,coresByHids,eventIds:[...eventIds],events
    }),"utf8");
  },180_000);
});
