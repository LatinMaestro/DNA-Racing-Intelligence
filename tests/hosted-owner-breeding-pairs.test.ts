import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_OWNER_BREEDING_PAIRS === "1";
const describeConnected = enabled ? describe : describe.skip;

const pairs = Object.freeze([
  { label: "Cash Bag x Reese Dylan", fatherCoreId: 583, motherCoreId: 11848, fatherSource: "vault", motherSource: "vault" },
  { label: "Hibiscus x Reese Dylan", fatherCoreId: 949, motherCoreId: 11848, fatherSource: "vault", motherSource: "vault" },
  { label: "Krillin x Reese Dylan", fatherCoreId: 15833, motherCoreId: 11848, fatherSource: "vault", motherSource: "vault" },
  { label: "Cash Bag x Luna Reese", fatherCoreId: 583, motherCoreId: 14126, fatherSource: "vault", motherSource: "vault" },
  { label: "Hibiscus x Luna Reese", fatherCoreId: 949, motherCoreId: 14126, fatherSource: "vault", motherSource: "vault" },
  { label: "Cash Bag x Grand Nectar", fatherCoreId: 583, motherCoreId: 10830, fatherSource: "vault", motherSource: "vault" },
  { label: "Hibiscus x Grand Nectar", fatherCoreId: 949, motherCoreId: 10830, fatherSource: "vault", motherSource: "vault" },
  { label: "Grand Azula x First Light", fatherCoreId: 9852, motherCoreId: 22145, fatherSource: "vault", motherSource: "vault" },
  { label: "Legacy Runner x First Light", fatherCoreId: 20382, motherCoreId: 22145, fatherSource: "vault", motherSource: "vault" },
  { label: "The Ice Cream Man x First Light", fatherCoreId: 11432, motherCoreId: 22145, fatherSource: "vault", motherSource: "vault" },
  { label: "Berserker x Reese Dylan", fatherCoreId: 24298, motherCoreId: 11848, fatherSource: "arena", motherSource: "vault" },
  { label: "Berserker x First Light", fatherCoreId: 24298, motherCoreId: 22145, fatherSource: "arena", motherSource: "vault" },
  { label: "Bright Lights x Reese Dylan", fatherCoreId: 17053, motherCoreId: 11848, fatherSource: "arena", motherSource: "vault" },
  { label: "Bong Ripper x Reese Dylan", fatherCoreId: 23835, motherCoreId: 11848, fatherSource: "arena", motherSource: "vault" },
  { label: "Alien Nosejob x Reese Dylan", fatherCoreId: 8665, motherCoreId: 11848, fatherSource: "arena", motherSource: "vault" },
  { label: "Legacy Runner x Low on Dough", fatherCoreId: 20382, motherCoreId: 8174, fatherSource: "vault", motherSource: "arena" },
  { label: "Grand Azula x Taco Surprise", fatherCoreId: 9852, motherCoreId: 11956, fatherSource: "vault", motherSource: "arena" },
  { label: "The Ice Cream Man x Taco Surprise", fatherCoreId: 11432, motherCoreId: 11956, fatherSource: "vault", motherSource: "arena" },
]);

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

describeConnected("one-off owner breeding pair validation", () => {
  it(
    "validates and prices shortlisted pairs without transactions",
    async () => {
      const client = createDnaOpenLabV1Client({
        apiKey: required("DNA_OPEN_LAB_API_KEY_1"),
      });
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
      const results = [];
      for (const pair of pairs) {
        let validation: unknown = null;
        let validationError: string | null = null;
        try {
          validation = (
            await paced(() => client.splicePairValidate(pair))
          ).result;
        } catch (error) {
          validationError =
            error instanceof Error ? error.message : "validation failed";
        }
        let pairInfo: unknown = null;
        let pairInfoError: string | null = null;
        try {
          pairInfo = (await paced(() => client.splicePairInfo(pair))).result;
        } catch (error) {
          pairInfoError =
            error instanceof Error ? error.message : "pair info failed";
        }
        results.push({ ...pair, validation, validationError, pairInfo, pairInfoError });
      }
      await mkdir("artifacts", { recursive: true });
      await writeFile(
        "artifacts/owner-breeding-pairs.json",
        JSON.stringify({ schemaVersion: 1, fetchedAt: new Date().toISOString(), results }),
        "utf8",
      );
      expect(results.length).toBe(pairs.length);
      console.log(JSON.stringify({ pairCount: results.length, output: "artifacts/owner-breeding-pairs.json" }));
    },
    300_000,
  );
});
