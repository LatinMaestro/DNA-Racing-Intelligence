import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DnaOpenLabApiError,
  createDnaOpenLabV1Client,
  type DnaOpenLabResponse,
} from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

const enabled = process.env.DNA_BREEDING_COMPLETE_ENRICHMENT === "1";
const describeConnected = enabled ? describe : describe.skip;
const RESEARCH_EXPIRES_AT = "2026-08-31T14:00:00.000Z";
const REQUESTS_PER_MINUTE = 150;
const REQUEST_INTERVAL_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE) + 5;
const BATCH_SIZE = 20;
const TELEMETRY_BENCHMARK_CBS = [10, 12, 14, 18] as const;

type AnyRecord = Record<string, unknown>;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

function positiveHids(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(Number)
    .filter((hid) => Number.isSafeInteger(hid) && hid > 0);
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size) as T[]);
  }
  return output;
}

function assertAuthorityActive(): void {
  if (Date.now() >= Date.parse(RESEARCH_EXPIRES_AT)) {
    throw new Error("Temporary August 150 rpm research authority has expired.");
  }
}

describeConnected("complete breeder-universe API enrichment", () => {
  it(
    "captures every useful read-only Core family for target parents, offspring, and co-parents",
    async () => {
      assertAuthorityActive();
      const census = JSON.parse(
        await readFile(
          process.env.BREEDING_CENSUS_PATH ??
            "artifacts/source/breeding-lineage-census-upgraded.json",
          "utf8",
        ),
      ) as AnyRecord;
      const coParents = JSON.parse(
        await readFile(
          process.env.BREEDING_COPARENT_PATH ??
            "artifacts/source/breeding-missing-coparent-inventory.json",
          "utf8",
        ),
      ) as AnyRecord;
      const hids = [
        ...new Set([
          ...positiveHids((census.universe as AnyRecord)?.hids),
          ...positiveHids((coParents.universe as AnyRecord)?.hids),
        ]),
      ].sort((left, right) => left - right);
      if (hids.length < 1)
        throw new Error("Breeder enrichment universe is empty.");

      const apiKey = required("DNA_OPEN_LAB_API_KEY_1");
      const client = createDnaOpenLabV1Client({ apiKey });
      const telemetryClient = createDnaOpenLabV1TelemetryClient({ apiKey });
      let permitTail: Promise<void> = Promise.resolve();
      let lastStartedAt = 0;
      let requestCount = 0;
      let retryCount = 0;
      let maximumObservedLimit: number | null = null;
      let minimumObservedRemaining: number | null = null;

      const acquirePermit = async () => {
        const previous = permitTail;
        let release: (() => void) | undefined;
        permitTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          assertAuthorityActive();
          const wait = REQUEST_INTERVAL_MS - (Date.now() - lastStartedAt);
          if (wait > 0)
            await new Promise((resolve) => setTimeout(resolve, wait));
          assertAuthorityActive();
          lastStartedAt = Date.now();
        } finally {
          release?.();
        }
      };

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
          await acquirePermit();
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
        throw new Error("unreachable enrichment retry exhaustion");
      };

      const families: Record<
        | "info"
        | "stats"
        | "power"
        | "listing"
        | "assets"
        | "owner"
        | "stamina"
        | "splicing"
        | "telemetry"
        | "telemetryBenchmark",
        unknown[]
      > = {
        info: [],
        stats: [],
        power: [],
        listing: [],
        assets: [],
        owner: [],
        stamina: [],
        splicing: [],
        telemetry: [],
        telemetryBenchmark: [],
      };

      // Probe the newly discovered distance-scoped benchmark contract before
      // spending the rest of the research allowance on the full universe.
      const benchmarkProbeHid = hids[0]!;
      const benchmarkProbeCb = TELEMETRY_BENCHMARK_CBS[0]!;
      const benchmarkProbe = await paced(() =>
        telemetryClient.coreTelemetryBenchmark(
          benchmarkProbeHid,
          benchmarkProbeCb,
        ),
      );
      families.telemetryBenchmark.push({
        hid: benchmarkProbeHid,
        cb: benchmarkProbeCb,
        result: benchmarkProbe.result,
      });

      for (const batch of chunks(hids, BATCH_SIZE)) {
        const responses = await Promise.all([
          paced(() => client.coreInfoBulk(batch)),
          paced(() => client.coreRacingStatsBulk(batch)),
          paced(() => client.corePowerBulk(batch)),
          paced(() => client.coreListingPriceBulk(batch)),
          paced(() => client.coreAttachedAssetsBulk(batch)),
          paced(() => client.coreOwnerBulk(batch)),
          paced(() => client.coreStaminaBulk(batch)),
          paced(() => client.coreSplicingInfoBulk(batch)),
          paced(() => telemetryClient.coreTelemetryBulk(batch)),
        ]);
        const keys = [
          "info",
          "stats",
          "power",
          "listing",
          "assets",
          "owner",
          "stamina",
          "splicing",
          "telemetry",
        ] as const;
        responses.forEach((response, index) => {
          const result = response.result;
          if (Array.isArray(result)) families[keys[index]!].push(...result);
          else families[keys[index]!].push(result);
        });
      }

      for (const hid of hids) {
        for (const cb of TELEMETRY_BENCHMARK_CBS) {
          if (hid === benchmarkProbeHid && cb === benchmarkProbeCb) continue;
          const response = await paced(() =>
            telemetryClient.coreTelemetryBenchmark(hid, cb),
          );
          families.telemetryBenchmark.push({
            hid,
            cb,
            result: response.result,
          });
        }
      }

      const tokenPrices = await paced(() => client.tokenPrices());
      const activeRaces = await paced(() => client.racesActive());

      await mkdir("artifacts/enrichment", { recursive: true });
      await writeFile(
        "artifacts/enrichment/breeding-complete-core-enrichment.json",
        JSON.stringify({
          schemaVersion: 2,
          fetchedAt: new Date().toISOString(),
          coreCount: hids.length,
          hids,
          requestCount,
          retryCount,
          maximumObservedLimit,
          minimumObservedRemaining,
          telemetryBenchmarkCbs: TELEMETRY_BENCHMARK_CBS,
          families,
          tokenPrices: tokenPrices.result,
          activeRaces: activeRaces.result,
          authority: {
            telemetryMeaning: "unclassified_until_validated",
            performanceRanking: "elapsed_time_speed_remains_primary",
          },
        }),
        "utf8",
      );

      expect(hids.length).toBeGreaterThan(1000);
      expect(families.info.length).toBe(hids.length);
      expect(families.stats.length).toBe(hids.length);
      expect(families.power.length).toBe(hids.length);
      expect(families.telemetryBenchmark.length).toBe(
        hids.length * TELEMETRY_BENCHMARK_CBS.length,
      );
    },
    90 * 60_000,
  );
});
