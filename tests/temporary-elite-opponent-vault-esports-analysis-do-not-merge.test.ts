import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

const enabled = process.env.DNA_ELITE_OPPONENT_ANALYSIS === "1";
const describeConnected = enabled ? describe : describe.skip;
const TARGET_VAULT = "0xa95db43f2f3e59d9fb6db54b4e98fc714bced07b";
const TEAM_ID = "68082d17da";
const TEAM_URL = `https://esports.dnaracing.run/teams?team_id=${TEAM_ID}`;
const CBS = [10, 12, 14, 16, 18, 20, 22] as const;

type AnyRecord = Record<string, unknown>;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let i = 0; i < values.length; i += size) output.push(values.slice(i, i + size) as T[]);
  return output;
}

function record(value: unknown): AnyRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

function positiveHids(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((hid) => Number.isSafeInteger(hid) && hid > 0))];
}

function collectScriptSources(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/giu)) {
    try { found.push(new URL(match[1]!, baseUrl).href); } catch { /* ignore */ }
  }
  return [...new Set(found)];
}

function interestingStrings(text: string): string[] {
  const patterns = [
    /https?:\\?\/\\?\/[^"'`\\s<>]{4,220}/giu,
    /\/[A-Za-z0-9_.~-]*(?:api|team|roster|map|match|standing|league|race)[A-Za-z0-9_./?&=:%~-]{0,180}/giu,
    /(?:team_id|teamId|roster|maps|standings|matches|supabase|graphql|firebase)[^\n\r]{0,220}/giu,
  ];
  const out = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0].replace(/\\u0026/gu, "&").replace(/\\\//gu, "/");
      if (value.length <= 260) out.add(value);
      if (out.size >= 600) break;
    }
    if (out.size >= 600) break;
  }
  return [...out];
}

describeConnected("temporary elite opponent vault/esports analysis", () => {
  it("pulls public vault evidence and discovers the public esports team data surface", async () => {
    const apiKey = required("DNA_OPEN_LAB_API_KEY_1");
    const client = createDnaOpenLabV1Client({ apiKey });
    const telemetryClient = createDnaOpenLabV1TelemetryClient({ apiKey });

    const [vaultInfo, vaultCoreIds, vaultCoresFull, recentRaces, tierBadge] = await Promise.all([
      client.vaultInfo(TARGET_VAULT),
      client.vaultCores(TARGET_VAULT),
      client.vaultCoresFull(TARGET_VAULT),
      client.vaultRecentRaces(TARGET_VAULT),
      client.vaultTierBadge(TARGET_VAULT),
    ]);

    const hids = positiveHids(vaultCoreIds.result);
    expect(hids.length).toBeGreaterThan(0);

    const families: Record<string, unknown[]> = {
      info: [], stats: [], power: [], stamina: [], splicing: [], telemetry: [],
    };
    for (const batch of chunks(hids, 20)) {
      const responses = await Promise.all([
        client.coreInfoBulk(batch),
        client.coreRacingStatsBulk(batch),
        client.corePowerBulk(batch),
        client.coreStaminaBulk(batch),
        client.coreSplicingInfoBulk(batch),
        telemetryClient.coreTelemetryBulk(batch),
      ]);
      const keys = ["info", "stats", "power", "stamina", "splicing", "telemetry"] as const;
      responses.forEach((response, idx) => {
        const value = response.result;
        if (Array.isArray(value)) families[keys[idx]!].push(...value);
        else families[keys[idx]!].push(value);
      });
    }

    // One benchmark probe per distance is enough to inspect the global contract.
    const benchmarkProbeHid = hids[0]!;
    const benchmarks: unknown[] = [];
    for (const cb of CBS) {
      const response = await telemetryClient.coreTelemetryBenchmark(benchmarkProbeHid, cb);
      benchmarks.push({ hid: benchmarkProbeHid, cb, result: response.result });
    }

    const teamResponse = await fetch(TEAM_URL, {
      headers: { "User-Agent": "Mozilla/5.0 DNA-Racing-Intelligence read-only research" },
      redirect: "follow",
    });
    const teamHtml = await teamResponse.text();
    const scriptSources = collectScriptSources(teamHtml, TEAM_URL);
    const scripts: Array<{ url: string; status: number; length: number; interesting: string[] }> = [];
    for (const src of scriptSources.slice(0, 30)) {
      try {
        const response = await fetch(src, { headers: { "User-Agent": "Mozilla/5.0" } });
        const text = await response.text();
        scripts.push({ url: src, status: response.status, length: text.length, interesting: interestingStrings(text) });
      } catch {
        scripts.push({ url: src, status: 0, length: 0, interesting: [] });
      }
    }

    await mkdir("artifacts/temporary-elite-opponent", { recursive: true });
    await writeFile(
      "artifacts/temporary-elite-opponent/vault-api.json",
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        targetVault: TARGET_VAULT,
        vaultInfo: vaultInfo.result,
        tierBadge: tierBadge.result,
        hids,
        coreCount: hids.length,
        vaultCoresFull: vaultCoresFull.result,
        recentRaces: recentRaces.result,
        families,
        benchmarks,
      }),
      "utf8",
    );
    await writeFile(
      "artifacts/temporary-elite-opponent/esports-discovery.json",
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        teamId: TEAM_ID,
        teamUrl: TEAM_URL,
        pageStatus: teamResponse.status,
        pageLength: teamHtml.length,
        pageInteresting: interestingStrings(teamHtml),
        scriptSources,
        scripts,
      }),
      "utf8",
    );
  }, 180_000);
});
