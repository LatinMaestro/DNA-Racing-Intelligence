import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const enabled = process.env.DNA_ESPORTS_PUBLIC_API_DISCOVERY === "1";
const describeConnected = enabled ? describe : describe.skip;
const TEAM_ID = "68082d17da";
const VAULT = "0xa95db43f2f3e59d9fb6db54b4e98fc714bced07b";
const PAGE = `https://esports.dnaracing.run/teams?team_id=${TEAM_ID}`;

function snippets(text: string, needle: string, radius = 1200): string[] {
  const out: string[] = [];
  let at = 0;
  while ((at = text.indexOf(needle, at)) >= 0 && out.length < 50) {
    out.push(text.slice(Math.max(0, at - radius), Math.min(text.length, at + needle.length + radius)));
    at += needle.length;
  }
  return out;
}

async function getJson(url: string): Promise<{status:number; text:string; json:unknown|null}> {
  try {
    const r = await fetch(url, {headers:{"User-Agent":"Mozilla/5.0 DNA Racing read-only research"}});
    const text = await r.text();
    let json: unknown | null = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return {status:r.status,text:text.slice(0,100000),json};
  } catch (error) {
    return {status:0,text:String(error),json:null};
  }
}

describeConnected("temporary esports public api discovery", () => {
  it("resolves the live public esports API base and team endpoints", async () => {
    const page = await fetch(PAGE, {headers:{"User-Agent":"Mozilla/5.0"}});
    const html = await page.text();
    const match = html.match(/<script[^>]+src=["']([^"']+)["']/iu);
    expect(match?.[1]).toBeTruthy();
    const scriptUrl = new URL(match![1]!, PAGE).href;
    const jsResponse = await fetch(scriptUrl, {headers:{"User-Agent":"Mozilla/5.0"}});
    const js = await jsResponse.text();

    const relevant = [
      ...snippets(js, "YC="), ...snippets(js, "JC="),
      ...snippets(js, "HC="), ...snippets(js, "VC="),
      ...snippets(js, "J="), ...snippets(js, "function J"),
      ...snippets(js, "api.dnaracing.run"),
      ...snippets(js, "vault_stats"), ...snippets(js, "cores_by_hids"),
      ...snippets(js, "all_teams"), ...snippets(js, "team_id:e"),
    ];

    const urlCandidates = [...new Set(
      relevant.flatMap((s) => [...s.matchAll(/https:\/\/api\.dnaracing\.run[^"'`\\s,;)]+/gu)].map((m)=>m[0]))
    )];

    const bases = [...new Set([
      ...urlCandidates.map((u)=>u.replace(/\\?.*$/u,"")),
      "https://api.dnaracing.run/esports",
      "https://api.dnaracing.run/fbike/esports",
      "https://api.dnaracing.run/fbike/pub/esports",
      "https://api.dnaracing.run/fbike/pub/v1/esports",
      "https://api.dnaracing.run",
    ])];

    const probes: Record<string, unknown> = {};
    for (const base of bases.slice(0,20)) {
      const clean = base.replace(/\/+$/u, "");
      const team = await getJson(`${clean}/teams?team_id=${encodeURIComponent(TEAM_ID)}`);
      const vaultStats = await getJson(`${clean}/vault_stats?team_id=${encodeURIComponent(TEAM_ID)}&of_vault=${encodeURIComponent(VAULT)}&season=0`);
      const maps = await getJson(`${clean}/maps`);
      probes[clean] = {
        team:{status:team.status,text:team.text.slice(0,2000),json:team.json},
        vaultStats:{status:vaultStats.status,text:vaultStats.text.slice(0,2000),json:vaultStats.json},
        maps:{status:maps.status,text:maps.text.slice(0,2000),json:maps.json},
      };
    }

    await mkdir("artifacts/temporary-esports-api",{recursive:true});
    await writeFile("artifacts/temporary-esports-api/frontend.js", js, "utf8");
    await writeFile("artifacts/temporary-esports-api/discovery.json", JSON.stringify({
      fetchedAt:new Date().toISOString(), scriptUrl, scriptLength:js.length, relevant, urlCandidates, bases, probes
    }), "utf8");
  }, 120_000);
});
