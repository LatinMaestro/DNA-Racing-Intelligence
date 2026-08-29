import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  createDnaOpenLabV1Client,
  type DnaCoreInfo,
  type DnaCorePower,
  type DnaCoreRacingStats,
  type DnaCoreSplicingInfo,
  type DnaSpliceArenaCore,
  type DnaVaultCore,
} from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_OWNER_BREEDING_ANALYSIS === "1";
const describeConnected = enabled ? describe : describe.skip;
const CURRENT_PRO_LEAGUE_ROSTER = Object.freeze([
  583, 170, 11848, 15833, 9537, 19802, 20292, 10980, 8902, 19423,
  14540, 16757, 1675, 12254, 9926, 16515, 9918, 20365, 20376, 16148,
  9089, 949, 8431, 20274, 823,
]);

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function uniquePositive(values: readonly number[]): number[] {
  return [...new Set(values)].filter(
    (value) => Number.isSafeInteger(value) && value > 0,
  );
}

describeConnected("one-off owner breeding analysis", () => {
  it(
    "retrieves the complete owned vault and Bike Splice Arena read-only evidence",
    async () => {
      const client = createDnaOpenLabV1Client({
        apiKey: required("DNA_OPEN_LAB_API_KEY_1"),
      });
      const vault = required("DNA_OPEN_LAB_VAULT");
      let lastRequestAt = 0;
      const paced = async <T>(request: () => Promise<T>): Promise<T> => {
        const elapsed = Date.now() - lastRequestAt;
        if (elapsed < 2_100) {
          await new Promise((resolve) => setTimeout(resolve, 2_100 - elapsed));
        }
        const result = await request();
        lastRequestAt = Date.now();
        return result;
      };

      const owned = (
        await paced(() => client.vaultCoresFull(vault))
      ).result as readonly DnaVaultCore[];
      const ownedIds = uniquePositive(owned.map((core) => core.hid));
      expect(ownedIds.length).toBeGreaterThan(0);

      const fetchCoreFamilies = async (hids: readonly number[]) => {
        const info: DnaCoreInfo[] = [];
        const power: DnaCorePower[] = [];
        const stats: DnaCoreRacingStats[] = [];
        const splicing: DnaCoreSplicingInfo[] = [];
        for (const batch of chunks(hids, 20)) {
          info.push(...(await paced(() => client.coreInfoBulk(batch))).result);
          power.push(...(await paced(() => client.corePowerBulk(batch))).result);
          stats.push(
            ...(await paced(() => client.coreRacingStatsBulk(batch))).result,
          );
          splicing.push(
            ...(await paced(() => client.coreSplicingInfoBulk(batch))).result,
          );
        }
        return { info, power, stats, splicing };
      };

      const ownedFamilies = await fetchCoreFamilies(ownedIds);

      const arenaRows: DnaSpliceArenaCore[] = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const response = await paced(() =>
          client.spliceArena({ filter: { rvmode: "bike" }, page }),
        );
        arenaRows.push(...response.result.cores);
        hasMore = response.result.has_more;
        if (hasMore && response.result.page !== page) {
          throw new Error("Arena page authority drifted");
        }
        page += 1;
        if (page > 500) throw new Error("Arena pagination safety bound exceeded");
      }
      const arenaIds = uniquePositive(arenaRows.map((core) => core.hid));
      const arenaFamilies = await fetchCoreFamilies(arenaIds);
      const tokenPrices = (await paced(() => client.tokenPrices())).result;

      const document = {
        schemaVersion: 1,
        fetchedAt: new Date().toISOString(),
        currentProLeagueRoster: CURRENT_PRO_LEAGUE_ROSTER,
        owned: {
          cores: owned,
          ...ownedFamilies,
        },
        arena: {
          cores: arenaRows,
          ...arenaFamilies,
        },
        tokenPrices,
      };

      await mkdir("artifacts", { recursive: true });
      await writeFile(
        "artifacts/owner-breeding-analysis.json",
        JSON.stringify(document),
        "utf8",
      );

      expect(document.owned.info.length).toBe(ownedIds.length);
      expect(document.arena.info.length).toBe(arenaIds.length);
      console.log(
        JSON.stringify({
          ownerCoreCount: ownedIds.length,
          arenaCoreCount: arenaIds.length,
          arenaPages: page - 1,
          output: "artifacts/owner-breeding-analysis.json",
        }),
      );
    },
    1_200_000,
  );
});
