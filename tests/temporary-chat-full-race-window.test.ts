import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { crawlDnaFinishedRaceWindows } from "../lib/dna-open-lab-finished-race-window-crawler";
import { writeFile } from "node:fs/promises";

const connected=process.env.DNA_OPEN_LAB_CONNECTED_DISCOVERY==="1";
const describeConnected=connected?describe:describe.skip;
function env(name:string):string{const v=process.env[name];if(!v)throw new Error(`${name} missing`);return v;}
function chunks<T>(values:readonly T[],n:number):T[][]{const out:T[][]=[];for(let i=0;i<values.length;i+=n)out.push(values.slice(i,i+n));return out;}

describeConnected("temporary complete recent race window",()=>{
  it("crawls and hydrates owner races from the last two days",async()=>{
    const client=createDnaOpenLabV1Client({apiKey:env("DNA_OPEN_LAB_API_KEY_1")});
    const vault=env("DNA_OPEN_LAB_VAULT");
    const coreIds=(await client.vaultCores(vault)).result; const owned=new Set(coreIds);
    const endTime=new Date().toISOString();
    const startTime="2026-09-09T00:00:00.000Z";
    const crawl=await crawlDnaFinishedRaceWindows({
      startTime,endTime,
      fetchWindow:async(w)=>(await client.racesFinished(w)).result,
      minimumWindowMilliseconds:60_000,
    });
    const allIds=crawl.races.map(r=>r.rid);
    const ownerDocs:unknown[]=[];
    let hydrated=0;
    for(const batch of chunks(allIds,20)){
      const docs=(await client.raceDocs(batch)).result; hydrated+=docs.length;
      for(const doc of docs){const hids=doc.hids??[];if(hids.some(h=>owned.has(h)))ownerDocs.push(doc);}
    }
    await writeFile("temporary-chat-full-race-window.json",JSON.stringify({generatedAt:new Date().toISOString(),temporary:true,doNotMerge:true,vault,startTime,endTime,crawl:{requestCount:crawl.requestCount,splitCount:crawl.splitCount,totalIndex:crawl.races.length,hydrated},ownerDocs}));
    expect(ownerDocs.length).toBeGreaterThan(0);
  },1_200_000);
});
