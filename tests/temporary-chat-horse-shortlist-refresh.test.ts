import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { createDnaOpenLabV1Client, type DnaRaceIdentifier } from "@/lib/dna-open-lab-v1-client";
import { createDnaCoreRaceHistoryClient } from "@/lib/dna-core-race-history-client";
const enabled=process.env.HORSE_SHORTLIST_REFRESH==="1";
const apiKey=process.env.DNA_OPEN_LAB_API_KEY_1??"";
const IDS=[23260,23429,20367,20775,19495,25565,23230,20260,23486,20777,23294,20582,22175,25574,23276,19110,23269,22347,20769,22145,25562,23394,23399,23283,22330,25564,20773,25555,20365,20862,21722,20778,22128] as const;
function chunks<T>(v:readonly T[],n:number){const o:T[][]=[];for(let i=0;i<v.length;i+=n)o.push([...v.slice(i,i+n)]);return o}
async function wait(ms:number){await new Promise(r=>setTimeout(r,ms))}
function rid(v:unknown):DnaRaceIdentifier|null{if(typeof v==="number"&&Number.isSafeInteger(v)&&v>0)return v;if(typeof v!=="string")return null;const x=v.trim();return x?x:null}
describe.runIf(enabled)("Horse shortlist live refresh",()=>{it("captures current shortlist",async()=>{
 if(!apiKey)throw new Error("API key missing");
 const client=createDnaOpenLabV1Client({apiKey}); const history=createDnaCoreRaceHistoryClient(); let last=0;
 async function paced<T>(fn:()=>Promise<T>){const d=Math.max(0,2100-(Date.now()-last));if(d)await wait(d);last=Date.now();return await fn()}
 const coreInfo=[]; const racingStats=[];
 for(const g of chunks(IDS,20)){coreInfo.push(...(await paced(()=>client.coreInfoBulk(g))).result);racingStats.push(...(await paced(()=>client.coreRacingStatsBulk(g))).result)}
 const histories:Record<string,unknown[]>={}; const rids=new Map<string,DnaRaceIdentifier>();
 for(const id of IDS){const rows=[...(await paced(()=>history.page({coreId:id,page:1}))).result];histories[String(id)]=rows;for(const row of rows){if(row.rvmode!=="horse")continue;const r=rid(row.rid);if(r!==null)rids.set(String(r),r)}}
 const raceDocs=[]; for(const g of chunks([...rids.values()].slice(0,500),20))raceDocs.push(...(await paced(()=>client.raceDocs(g))).result);
 await writeFile("horse-shortlist-live-refresh.json",JSON.stringify({generatedAt:new Date().toISOString(),ids:IDS,coreInfo,racingStats,histories,raceDocs},null,2));
 expect(racingStats.length).toBe(IDS.length);
},5*60*1000)})