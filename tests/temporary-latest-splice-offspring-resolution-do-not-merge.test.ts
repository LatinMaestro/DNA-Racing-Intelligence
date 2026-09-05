import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only owner splice resolution. */
const enabled=process.env.TEMP_LATEST_SPLICE_RESOLUTION==='1'; const d=enabled?describe:describe.skip;
type Rec=Record<string,unknown>;
const VAULT='0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d';
const PAIRS=[
  {label:'Better Luck Next Time x She Will Reign',father:19423,mother:16757},
  {label:'Rising Hope x Flying Nimbus',father:16147,mother:13540},
  {label:'Hibiscus x Solar Ember',father:949,mother:21516},
  {label:'Cash Bag x Flame Dash',father:583,mother:22164},
] as const;
function req(n:string){const v=process.env[n]?.trim()??'';if(!v)throw new Error(`${n} missing`);return v;}
const asRec=(v:unknown):Rec=>v&&typeof v==='object'&&!Array.isArray(v)?v as Rec:{};
const hid=(v:unknown):number|null=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;};
function childIds(row:Rec){const s=asRec(row.splice_core);const x=s.life_splices;return Array.isArray(x)?[...new Set(x.map(hid).filter((v):v is number=>v!==null))]:[];}

d('TEMPORARY latest splice offspring resolution - DO NOT MERGE',()=>{it('resolves five newly completed splices read-only',async()=>{
 const c=createDnaOpenLabV1Client({apiKey:req('DNA_OPEN_LAB_API_KEY_1')});
 const vault=(await c.vaultCoresFull(VAULT)).result as readonly Rec[];
 const firebolt=vault.filter(r=>String(r.name??'').trim().toLowerCase()==='firebolt');
 expect(firebolt.length).toBeGreaterThan(0);
 const fireboltId=hid(firebolt[0]!.hid)!;
 const pairs=[...PAIRS,{label:'Drift King x Firebolt',father:19802,mother:fireboltId}];
 const parentIds=[...new Set(pairs.flatMap(p=>[p.father,p.mother]))];
 const spliceRows=(await c.coreSplicingInfoBulk(parentIds)).result as readonly Rec[];
 const byId=new Map<number,Rec>();for(const r of spliceRows){const id=hid(r.hid);if(id)byId.set(id,r);}
 const resolved=[] as Rec[];
 for(const p of pairs){const fkids=childIds(byId.get(p.father)??{}),mkids=childIds(byId.get(p.mother)??{});const common=fkids.filter(x=>mkids.includes(x));resolved.push({...p,commonChildren:common});}
 const childIdsAll=[...new Set(resolved.flatMap(r=>Array.isArray(r.commonChildren)?r.commonChildren as number[]:[]))];
 const infos=childIdsAll.length?(await c.coreInfoBulk(childIdsAll)).result as readonly Rec[]:[];
 const infoBy=new Map<number,Rec>();for(const r of infos){const id=hid(r.hid);if(id)infoBy.set(id,r);}
 const output=resolved.map(r=>({...r,children:(r.commonChildren as number[]).map(id=>({hid:id,...infoBy.get(id)}))}));
 const newest=vault.map(r=>({hid:hid(r.hid),name:r.name,gender:r.gender,element:r.element,type:r.type,fno:r.fno})).filter(r=>r.hid!==null).sort((a,b)=>(b.hid as number)-(a.hid as number)).slice(0,20);
 const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,firebolt:firebolt.map(r=>({hid:r.hid,name:r.name,gender:r.gender,element:r.element,type:r.type,fno:r.fno})),pairs:output,newestVault:newest};
 console.log('LATEST_SPLICE_RESOLUTION',JSON.stringify(out,null,2));await mkdir('artifacts',{recursive:true});await writeFile('artifacts/temporary-latest-splice-offspring-resolution.json',JSON.stringify(out,null,2));expect(childIdsAll.length).toBeGreaterThanOrEqual(5);
},120_000);});
