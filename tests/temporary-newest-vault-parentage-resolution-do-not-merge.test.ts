import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
/** TEMPORARY / DO NOT MERGE / DO NOT CHERRY-PICK. Read-only child parentage resolution. */
const enabled=process.env.TEMP_NEWEST_PARENTAGE==='1'; const d=enabled?describe:describe.skip; type Rec=Record<string,unknown>;
const VAULT='0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d';
function req(n:string){const v=process.env[n]?.trim()??'';if(!v)throw new Error(`${n} missing`);return v;}
const hid=(v:unknown):number|null=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;};
const asRec=(v:unknown):Rec=>v&&typeof v==='object'&&!Array.isArray(v)?v as Rec:{};
function parents(r:Rec){const p=asRec(r.parents);return {father:hid(p.father),mother:hid(p.mother)};}
d('TEMPORARY newest vault parentage resolution - DO NOT MERGE',()=>{it('reads newest child parentage',async()=>{
 const c=createDnaOpenLabV1Client({apiKey:req('DNA_OPEN_LAB_API_KEY_1')});const vault=(await c.vaultCoresFull(VAULT)).result as readonly Rec[];
 const newest=vault.map(r=>({hid:hid(r.hid),name:String(r.name??''),gender:String(r.gender??''),element:String(r.element??''),type:String(r.type??''),fno:r.fno})).filter(r=>r.hid!==null).sort((a,b)=>(b.hid as number)-(a.hid as number)).slice(0,25);
 const ids=newest.map(r=>r.hid as number);const sp=(await c.coreSplicingInfoBulk(ids)).result as readonly Rec[];const by=new Map<number,Rec>();for(const r of sp){const id=hid(r.hid);if(id)by.set(id,r);}const resolved=newest.map(r=>({...r,parents:parents(by.get(r.hid as number)??{})}));
 const out={generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,resolved};console.log('NEWEST_VAULT_PARENTAGE',JSON.stringify(out,null,2));await mkdir('artifacts',{recursive:true});await writeFile('artifacts/temporary-newest-vault-parentage-resolution.json',JSON.stringify(out,null,2));expect(resolved.length).toBeGreaterThan(5);
},120000);});
