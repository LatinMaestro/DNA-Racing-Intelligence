import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
const enabled=process.env.TEMP_CHAT_PAIR_SHORTLIST==='1'; const d=enabled?describe:describe.skip;
function env(n:string){const v=process.env[n]?.trim()??'';if(!v)throw new Error(`${n} missing`);return v;}
const pairs=[
 ['Yankee Trek x Mr Brightside',16515,170],
 ['Yankee Trek x Cash Bag',583,170],
 ['Yankee Trek x Allurity',1675,170],
 ['Zoey x Mr Brightside',16515,20292],
 ['Zoey x Cash Bag',583,20292],
 ['Zoey x Allurity',1675,20292],
 ['Echo Star x Mr Brightside',16515,16148],
 ['Echo Star x Cash Bag',583,16148],
 ['Echo Star x Allurity',1675,16148],
 ['Sakura x Mr Brightside',16515,19525],
 ['Sakura x Cash Bag',583,19525],
 ['Titan Mage x Cash Bag',583,23283],
 ['Titan Mage x Allurity',1675,23283],
 ['Swift Fist x Cash Bag',583,23282],
 ['Swift Fist x Allurity',1675,23282],
 ['Vixey x Salford Soldier',25104,9089],
 ['Sakura x Fancy Fox',2188,19525],
 ['Echo Star x Lush',1504,16148],
 ['Zoey x Moltres',24931,20292],
 ['Titan Mage x Full Squish',22166,23283],
] as const;
d('temporary pair shortlist',()=>{it('validates recommended breeding candidates',async()=>{
 const c=createDnaOpenLabV1Client({apiKey:env('DNA_OPEN_LAB_API_KEY_1')}); const out:any[]=[];
 for(const [label,fatherCoreId,motherCoreId] of pairs){
   let info:any=null,validation:any=null,error:any=null;
   try{info=(await c.splicePairInfo({fatherCoreId,motherCoreId})).result;}catch(e){error={info:String(e)}}
   try{validation=(await c.splicePairValidate({fatherCoreId,motherCoreId})).result;}catch(e){error={...(error??{}),validation:String(e)}}
   out.push({label,fatherCoreId,motherCoreId,info,validation,error});
   await new Promise(r=>setTimeout(r,450));
 }
 await mkdir('artifacts',{recursive:true}); await writeFile('artifacts/temporary-chat-pair-shortlist.json',JSON.stringify({generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,pairs:out},null,2));
 expect(out.length).toBe(pairs.length);
},900000);});
