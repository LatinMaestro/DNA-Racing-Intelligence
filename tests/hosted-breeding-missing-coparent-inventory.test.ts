import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DnaOpenLabApiError,
  createDnaOpenLabV1Client,
  type DnaOpenLabResponse,
} from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_BREEDING_COPARENT_ENRICHMENT === "1";
const describeConnected = enabled ? describe : describe.skip;
const RESEARCH_EXPIRES_AT = "2026-08-31T14:00:00.000Z";
const REQUESTS_PER_MINUTE = 150;
const REQUEST_INTERVAL_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE) + 5;
const CORE_BATCH_SIZE = 20;

type AnyRecord = Record<string, unknown>;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

function assertAuthorityActive(): void {
  if (Date.now() >= Date.parse(RESEARCH_EXPIRES_AT)) {
    throw new Error("Temporary August 150 rpm research authority has expired.");
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size) as T[]);
  }
  return output;
}

function positiveHids(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value > 0);
}

describeConnected("missing breeding co-parent inventory", () => {
  it(
    "enriches every parent missing from the target-parent/offspring history universe",
    async () => {
      assertAuthorityActive();
      const censusPath =
        process.env.BREEDING_CENSUS_PATH ??
        "artifacts/source/breeding-lineage-census-upgraded.json";
      const census = JSON.parse(
        await readFile(censusPath, "utf8"),
      ) as AnyRecord;
      const universe = census.universe as AnyRecord;
      const existingHids = new Set(positiveHids(universe.hids));
      const directParents = (universe.directParentsByChild ?? {}) as Record<
        string,
        unknown
      >;
      const allParents = new Set<number>();
      for (const parents of Object.values(directParents)) {
        const ids = [...new Set(positiveHids(parents))];
        if (ids.length !== 2) continue;
        ids.forEach((hid) => allParents.add(hid));
      }
      const missingHids = [...allParents]
        .filter((hid) => !existingHids.has(hid))
        .sort((left, right) => left - right);
      if (missingHids.length === 0) {
        throw new Error(
          "No missing co-parents found; enrichment is unnecessary.",
        );
      }

      const client = createDnaOpenLabV1Client({
        apiKey: required("DNA_OPEN_LAB_API_KEY_1"),
      });
      let lastStartedAt = 0;
      let requestCount = 0;
      let retryCount = 0;
      let maximumObservedLimit: number | null = null;
      let minimumObservedRemaining: number | null = null;

      const observe = (response: DnaOpenLabResponse<unknown>) => {
        if (response.rateLimit.limit !== null) {
          maximumObservedLimit = Math.max(
            maximumObservedLimit ?? 0,
            response.rateLimit.limit,
          );
        }
        if (response.rateLimit.remaining !== null) {
          minimumObservedRemaining = Math.min(
            minimumObservedRemaining ?? response.rateLimit.remaining,
            response.rateLimit.remaining,
          );
        }
      };

      const paced = async <T>(
        operation: () => Promise<DnaOpenLabResponse<T>>,
      ): Promise<DnaOpenLabResponse<T>> => {
        for (let attempt = 0; attempt < 6; attempt++) {
          assertAuthorityActive();
          const wait = REQUEST_INTERVAL_MS - (Date.now() - lastStartedAt);
          if (wait > 0)
            await new Promise((resolve) => setTimeout(resolve, wait));
          assertAuthorityActive();
          lastStartedAt = Date.now();
          requestCount++;
          try {
            const response = await operation();
            observe(response as DnaOpenLabResponse<unknown>);
            return response;
          } catch (error) {
            const retryable =
              error instanceof DnaOpenLabApiError &&
              (error.kind === "rate_limited" ||
                (error.httpStatus !== null && error.httpStatus >= 500));
            if (!retryable || attempt >= 5) throw error;
            retryCount++;
            const seconds =
              error instanceof DnaOpenLabApiError
                ? (error.rateLimit?.retryAfterSeconds ??
                  error.rateLimit?.resetSeconds ??
                  2)
                : 2;
            await new Promise((resolve) =>
              setTimeout(resolve, Math.max(1, seconds) * 1_000),
            );
          }
        }
        throw new Error("unreachable co-parent enrichment retry exhaustion");
      };

      const info: AnyRecord[] = [];
      const stats: AnyRecord[] = [];
      const power: AnyRecord[] = [];
      const splicing: AnyRecord[] = [];
      for (const batch of chunks(missingHids, CORE_BATCH_SIZE)) {
        const [infoResponse, statsResponse, powerResponse, splicingResponse] =
          await Promise.all([
            paced(() => client.coreInfoBulk(batch)),
            paced(() => client.coreRacingStatsBulk(batch)),
            paced(() => client.corePowerBulk(batch)),
            paced(() => client.coreSplicingInfoBulk(batch)),
          ]);
        info.push(...(infoResponse.result as AnyRecord[]));
        stats.push(...(statsResponse.result as AnyRecord[]));
        power.push(...(powerResponse.result as AnyRecord[]));
        splicing.push(...(splicingResponse.result as AnyRecord[]));
      }

      const fetchedInfoHids = new Set(
        info
          .map((row) => Number(row.hid))
          .filter((hid) => Number.isSafeInteger(hid) && hid > 0),
      );
      const missingInfo = missingHids.filter(
        (hid) => !fetchedInfoHids.has(hid),
      );

      const output = {
        schemaVersion: 1,
        fetchedAt: new Date().toISOString(),
        sourceCensusFetchedAt: census.fetchedAt ?? null,
        sourceUniverseCount: existingHids.size,
        cleanRelationCount: Object.values(directParents).filter(
          (parents) => new Set(positiveHids(parents)).size === 2,
        ).length,
        uniqueParentCount: allParents.size,
        missingCoParentCount: missingHids.length,
        requestCount,
        retryCount,
        maximumObservedLimit,
        minimumObservedRemaining,
        missingInfoHids: missingInfo,
        universe: { hids: missingHids },
        coreFamilies: { info, stats, power, splicing },
      };

      await mkdir("artifacts/coparents", { recursive: true });
      await writeFile(
        "artifacts/coparents/breeding-missing-coparent-inventory.json",
        JSON.stringify(output),
        "utf8",
      );

      expect(missingHids.length).toBeGreaterThan(0);
      expect(missingInfo.length).toBe(0);
      expect(info.length).toBe(missingHids.length);
      expect(stats.length).toBe(missingHids.length);
      expect(power.length).toBe(missingHids.length);
    },
    30 * 60_000,
  );
});
