import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DnaOpenLabApiError,
  createDnaOpenLabV1Client,
  type DnaOpenLabResponse,
  type DnaRaceDocument,
  type DnaRaceIdentifier,
} from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

const enabled = process.env.DNA_BREEDING_UNIVERSE_BACKFILL === "1";
const describeConnected = enabled ? describe : describe.skip;
const OWNER_VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";
const RESEARCH_EXPIRES_AT = "2026-08-31T14:00:00.000Z";
const HISTORY_START = "2020-01-01T00:00:00.000Z";
const REQUESTS_PER_MINUTE = 150;
const REQUEST_INTERVAL_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE) + 5;
const FINISHED_LIMIT = 200;
const MIN_FINISHED_WINDOW_MS = 1_000;
const CORE_BATCH_SIZE = 20;
const CONCURRENCY_GROUP = 8;

type AnyRecord = Record<string, unknown>;
type CoreFamilies = {
  info: AnyRecord[];
  stats: AnyRecord[];
  power: AnyRecord[];
  listing: AnyRecord[];
  assets: AnyRecord[];
  owner: AnyRecord[];
  stamina: AnyRecord[];
  splicing: AnyRecord[];
  telemetry: unknown[];
};

type Window = { startTime: string; endTime: string };

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

function assertResearchAuthorityActive(): void {
  if (Date.now() >= Date.parse(RESEARCH_EXPIRES_AT)) {
    throw new Error(
      "Temporary August high-rate research authority has expired; no further inventory requests may start.",
    );
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size) as T[]);
  }
  return out;
}

function ridKey(rid: DnaRaceIdentifier): string {
  return String(rid);
}

function finiteHid(value: unknown): number | null {
  const hid = Number(value);
  return Number.isSafeInteger(hid) && hid > 0 ? hid : null;
}

function lineageIds(value: unknown): number[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((entry) => lineageIds(entry)))];
  }
  const direct = finiteHid(value);
  if (direct !== null) return [direct];
  if (typeof value !== "object") return [];
  const record = value as AnyRecord;
  const preferred = [
    "hid",
    "id",
    "core_id",
    "coreId",
    "token_id",
    "tokenId",
    "father_id",
    "fatherId",
    "mother_id",
    "motherId",
  ];
  const directPreferred = preferred.flatMap((key) => lineageIds(record[key]));
  if (directPreferred.length > 0) return [...new Set(directPreferred)];
  return [
    ...new Set(Object.values(record).flatMap((entry) => lineageIds(entry))),
  ];
}

function extractRequestIds(
  value: unknown,
  path = "splice_core",
): { path: string; value: string }[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      extractRequestIds(entry, `${path}[${index}]`),
    );
  }
  if (typeof value !== "object") return [];
  const record = value as AnyRecord;
  const out: { path: string; value: string }[] = [];
  for (const [key, entry] of Object.entries(record)) {
    const nextPath = `${path}.${key}`;
    if (
      typeof entry === "string" &&
      entry.trim() !== "" &&
      /(req(?:uest)?[_-]?id|requestid)/i.test(key)
    ) {
      out.push({ path: nextPath, value: entry.trim() });
    }
    out.push(...extractRequestIds(entry, nextPath));
  }
  return out;
}

function addRaceHids(target: Set<number>, race: AnyRecord): void {
  for (const value of [race.hids, race.yellowstars, race.bluestars]) {
    for (const hid of lineageIds(value)) target.add(hid);
  }
}

function coarseWindows(startIso: string, endIso: string): Window[] {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const step = 180 * 24 * 60 * 60 * 1_000;
  const out: Window[] = [];
  for (let cursor = start; cursor < end; cursor += step) {
    out.push({
      startTime: new Date(cursor).toISOString(),
      endTime: new Date(Math.min(end, cursor + step)).toISOString(),
    });
  }
  return out;
}

function splitWindow(window: Window): [Window, Window] {
  const start = Date.parse(window.startTime);
  const end = Date.parse(window.endTime);
  const midpoint = start + Math.floor((end - start) / 2);
  if (
    end - start <= MIN_FINISHED_WINDOW_MS ||
    midpoint <= start ||
    midpoint >= end
  ) {
    throw new Error(
      `Finished-race window remained saturated at ${window.startTime}..${window.endTime}`,
    );
  }
  return [
    {
      startTime: new Date(start).toISOString(),
      endTime: new Date(midpoint).toISOString(),
    },
    {
      startTime: new Date(midpoint).toISOString(),
      endTime: new Date(end).toISOString(),
    },
  ];
}

function canonicalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

describeConnected("aggressive owner breeding universe backfill", () => {
  it(
    "captures the broadest available race/core/lineage inventory under the temporary 150 rpm authority",
    async () => {
      const fetchedAt = new Date().toISOString();
      if (Date.parse(fetchedAt) >= Date.parse(RESEARCH_EXPIRES_AT)) {
        throw new Error(
          "Temporary August 150 rpm research authority has expired.",
        );
      }

      const apiKey = required("DNA_OPEN_LAB_API_KEY_1");
      const client = createDnaOpenLabV1Client({ apiKey });
      const telemetryClient = createDnaOpenLabV1TelemetryClient({ apiKey });
      let permitTail: Promise<void> = Promise.resolve();
      let lastStartAt = 0;
      let openLabRequestCount = 0;
      let rateLimitedCount = 0;
      let minimumObservedRemaining: number | null = null;
      let maximumObservedLimit: number | null = null;

      const acquire = async () => {
        const previous = permitTail;
        let release: (() => void) | undefined;
        permitTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          assertResearchAuthorityActive();
          const wait = REQUEST_INTERVAL_MS - (Date.now() - lastStartAt);
          if (wait > 0)
            await new Promise((resolve) => setTimeout(resolve, wait));
          assertResearchAuthorityActive();
          lastStartAt = Date.now();
        } finally {
          release?.();
        }
      };

      const observe = (response: DnaOpenLabResponse<unknown>) => {
        const { limit, remaining } = response.rateLimit;
        if (limit !== null)
          maximumObservedLimit = Math.max(maximumObservedLimit ?? 0, limit);
        if (remaining !== null) {
          minimumObservedRemaining = Math.min(
            minimumObservedRemaining ?? remaining,
            remaining,
          );
        }
      };

      const paced = async <T>(
        operation: () => Promise<DnaOpenLabResponse<T>>,
      ): Promise<DnaOpenLabResponse<T>> => {
        for (let attempt = 0; attempt < 4; attempt++) {
          await acquire();
          openLabRequestCount++;
          try {
            const response = await operation();
            observe(response as DnaOpenLabResponse<unknown>);
            if (
              response.rateLimit.remaining === 0 &&
              response.rateLimit.resetSeconds
            ) {
              await new Promise((resolve) =>
                setTimeout(resolve, response.rateLimit.resetSeconds! * 1_000),
              );
            }
            return response;
          } catch (error) {
            if (
              error instanceof DnaOpenLabApiError &&
              error.kind === "rate_limited" &&
              attempt < 3
            ) {
              rateLimitedCount++;
              const seconds =
                error.rateLimit?.retryAfterSeconds ??
                error.rateLimit?.resetSeconds ??
                2;
              await new Promise((resolve) =>
                setTimeout(resolve, Math.max(1, seconds) * 1_000),
              );
              continue;
            }
            throw error;
          }
        }
        throw new Error("unreachable paced request failure");
      };

      const safe = async <T>(
        label: string,
        operation: () => Promise<DnaOpenLabResponse<T>>,
      ) => {
        try {
          const response = await paced(operation);
          return {
            label,
            ok: true as const,
            result: response.result,
            error: null,
          };
        } catch (error) {
          return {
            label,
            ok: false as const,
            result: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      };

      const auth = await paced(() => client.testAuth());
      const tierBadge = await paced(() => client.vaultTierBadge(OWNER_VAULT));
      const ownerVault = await paced(() => client.vaultCoresFull(OWNER_VAULT));
      const ownerRecentRaces = await paced(() =>
        client.vaultRecentRaces(OWNER_VAULT),
      );
      const activeRaces = await paced(() => client.racesActive());
      const tokenPrices = await paced(() => client.tokenPrices());

      const arenas: Record<string, AnyRecord[]> = {
        bike: [],
        car: [],
        horse: [],
      };
      for (const mode of ["bike", "car", "horse"] as const) {
        for (let page = 1; page <= 100; page++) {
          const response = await paced(() =>
            client.spliceArena({ filter: { rvmode: mode }, page }),
          );
          arenas[mode]!.push(...(response.result.cores as AnyRecord[]));
          if (!response.result.has_more) break;
        }
      }

      const finishedByRid = new Map<string, DnaRaceDocument>();
      const acceptedWindows: Window[] = [];
      const queue = coarseWindows(HISTORY_START, fetchedAt);
      let splitCount = 0;
      while (queue.length > 0) {
        const window = queue.shift()!;
        const response = await paced(() =>
          client.racesFinished({
            startTime: window.startTime,
            endTime: window.endTime,
            limit: FINISHED_LIMIT,
          }),
        );
        const rows = response.result;
        if (rows.length >= FINISHED_LIMIT) {
          const [left, right] = splitWindow(window);
          queue.unshift(right, left);
          splitCount++;
          continue;
        }
        acceptedWindows.push(window);
        for (const row of rows) {
          const key = ridKey(row.rid);
          if (!finishedByRid.has(key)) finishedByRid.set(key, row);
        }
      }

      const rids = [...finishedByRid.values()].map((race) => race.rid);
      const hydratedDocs: AnyRecord[] = [];
      const raceFills: AnyRecord[] = [];
      const raceHydrationErrors: AnyRecord[] = [];
      const ridBatches = chunks(rids, 20);
      for (const group of chunks(ridBatches, CONCURRENCY_GROUP)) {
        const results = await Promise.all(
          group.flatMap((batch) => [
            safe("raceDocs", () => client.raceDocs(batch)),
            safe("raceFills", () => client.raceFills(batch)),
          ]),
        );
        for (const result of results) {
          if (!result.ok) {
            raceHydrationErrors.push(result);
          } else if (result.label === "raceDocs") {
            hydratedDocs.push(...((result.result ?? []) as AnyRecord[]));
          } else {
            raceFills.push(...((result.result ?? []) as AnyRecord[]));
          }
        }
      }

      const discoveredHids = new Set<number>();
      for (const core of ownerVault.result)
        discoveredHids.add(Number(core.hid));
      for (const rows of Object.values(arenas)) {
        for (const core of rows) {
          const hid = finiteHid(core.hid);
          if (hid !== null) discoveredHids.add(hid);
        }
      }
      for (const race of finishedByRid.values())
        addRaceHids(discoveredHids, race as AnyRecord);
      for (const race of hydratedDocs) addRaceHids(discoveredHids, race);
      for (const fill of raceFills) addRaceHids(discoveredHids, fill);
      for (const race of ownerRecentRaces.result)
        addRaceHids(discoveredHids, race as AnyRecord);
      for (const race of activeRaces.result)
        addRaceHids(discoveredHids, race as AnyRecord);

      const families: CoreFamilies = {
        info: [],
        stats: [],
        power: [],
        listing: [],
        assets: [],
        owner: [],
        stamina: [],
        splicing: [],
        telemetry: [],
      };
      const coreFamilyErrors: AnyRecord[] = [];
      const fetchedHids = new Set<number>();
      const directParentsByChild = new Map<number, number[]>();

      for (let generation = 0; generation < 5; generation++) {
        const frontier = [...discoveredHids]
          .filter((hid) => !fetchedHids.has(hid))
          .sort((a, b) => a - b);
        if (frontier.length === 0) break;
        for (const group of chunks(
          chunks(frontier, CORE_BATCH_SIZE),
          CONCURRENCY_GROUP,
        )) {
          for (const batch of group)
            batch.forEach((hid) => fetchedHids.add(hid));
          const batchResults = await Promise.all(
            group.map(async (batch) => {
              const results = await Promise.all([
                safe("info", () => client.coreInfoBulk(batch)),
                safe("stats", () => client.coreRacingStatsBulk(batch)),
                safe("power", () => client.corePowerBulk(batch)),
                safe("listing", () => client.coreListingPriceBulk(batch)),
                safe("assets", () => client.coreAttachedAssetsBulk(batch)),
                safe("owner", () => client.coreOwnerBulk(batch)),
                safe("stamina", () => client.coreStaminaBulk(batch)),
                safe("splicing", () => client.coreSplicingInfoBulk(batch)),
                safe("telemetry", () =>
                  telemetryClient.coreTelemetryBulk(batch),
                ),
              ]);
              return { batch, results };
            }),
          );

          for (const batchResult of batchResults) {
            for (const result of batchResult.results) {
              if (!result.ok) {
                coreFamilyErrors.push({
                  batch: batchResult.batch,
                  family: result.label,
                  error: result.error,
                });
                continue;
              }
              const rows = Array.isArray(result.result)
                ? (result.result as AnyRecord[])
                : [result.result];
              if (result.label === "telemetry")
                families.telemetry.push(...rows);
              else
                (
                  families[
                    result.label as keyof Omit<CoreFamilies, "telemetry">
                  ] as AnyRecord[]
                ).push(...rows);
              if (result.label === "splicing") {
                for (const row of rows) {
                  const child = finiteHid(row?.hid);
                  if (child === null) continue;
                  const directParents = lineageIds(row?.parents).filter(
                    (hid) => hid !== child,
                  );
                  directParentsByChild.set(child, directParents);
                  for (const parent of directParents)
                    discoveredHids.add(parent);
                  for (const grandParent of lineageIds(
                    row?.grand_parents ?? row?.grandparents,
                  )) {
                    if (grandParent !== child) discoveredHids.add(grandParent);
                  }
                }
              }
            }
          }
        }
      }

      const spliceRequestCandidates = new Map<
        string,
        { coreHid: number; paths: string[] }
      >();
      const spliceCoreShapeKeys = new Set<string>();
      for (const row of families.splicing) {
        const hid = finiteHid(row.hid);
        if (hid === null) continue;
        if (row.splice_core && typeof row.splice_core === "object") {
          for (const key of Object.keys(row.splice_core as AnyRecord))
            spliceCoreShapeKeys.add(key);
        }
        for (const candidate of extractRequestIds(row.splice_core)) {
          const existing = spliceRequestCandidates.get(candidate.value);
          if (existing) existing.paths.push(candidate.path);
          else
            spliceRequestCandidates.set(candidate.value, {
              coreHid: hid,
              paths: [candidate.path],
            });
        }
      }

      const spliceDocuments: AnyRecord[] = [];
      const spliceDocumentErrors: AnyRecord[] = [];
      for (const group of chunks(
        [...spliceRequestCandidates.entries()],
        CONCURRENCY_GROUP,
      )) {
        const results = await Promise.all(
          group.map(async ([requestId, meta]) => {
            const result = await safe("spliceDocument", () =>
              client.spliceDocument(requestId),
            );
            return { requestId, meta, result };
          }),
        );
        for (const item of results) {
          if (item.result.ok) {
            spliceDocuments.push({
              requestId: item.requestId,
              coreHid: item.meta.coreHid,
              paths: item.meta.paths,
              document: item.result.result,
            });
          } else {
            spliceDocumentErrors.push({
              requestId: item.requestId,
              coreHid: item.meta.coreHid,
              paths: item.meta.paths,
              error: item.result.error,
            });
          }
        }
      }

      const mintedAtByHid: Record<string, string> = {};
      for (const item of spliceDocuments) {
        const hid = finiteHid(item.document?.hid ?? item.coreHid);
        const mintedAt = canonicalTimestamp(item.document?.minted_at);
        if (hid !== null && mintedAt !== null)
          mintedAtByHid[String(hid)] = mintedAt;
      }

      await mkdir("artifacts", { recursive: true });
      await writeFile(
        "artifacts/breeding-universe-inventory.json",
        JSON.stringify({
          schemaVersion: 1,
          fetchedAt,
          temporaryResearchAuthority: {
            requestsPerMinute: REQUESTS_PER_MINUTE,
            expiresAt: RESEARCH_EXPIRES_AT,
          },
          observedRateLimit: {
            maximumObservedLimit,
            minimumObservedRemaining,
            rateLimitedCount,
            openLabRequestCount,
          },
          authResult: auth.result,
          tierBadge: tierBadge.result,
          ownerVault: ownerVault.result,
          ownerRecentRaces: ownerRecentRaces.result,
          activeRaces: activeRaces.result,
          tokenPrices: tokenPrices.result,
          arenas,
          finishedRaceCrawl: {
            startTime: HISTORY_START,
            endTime: fetchedAt,
            acceptedWindowCount: acceptedWindows.length,
            splitCount,
            uniqueRaceCount: finishedByRid.size,
            acceptedWindows,
            races: [...finishedByRid.values()],
            hydratedDocs,
            raceFills,
            hydrationErrors: raceHydrationErrors,
          },
          universe: {
            discoveredCoreCount: discoveredHids.size,
            fetchedCoreCount: fetchedHids.size,
            hids: [...discoveredHids].sort((a, b) => a - b),
            directParentsByChild: Object.fromEntries(
              [...directParentsByChild.entries()].map(([hid, parents]) => [
                String(hid),
                parents,
              ]),
            ),
          },
          coreFamilies: families,
          coreFamilyErrors,
          spliceDiscovery: {
            spliceCoreShapeKeys: [...spliceCoreShapeKeys].sort(),
            requestCandidateCount: spliceRequestCandidates.size,
            spliceDocuments,
            spliceDocumentErrors,
            mintedAtByHid,
          },
        }),
        "utf8",
      );

      expect(Number(tierBadge.result.tot_score)).toBeGreaterThanOrEqual(0);
      expect(finishedByRid.size).toBeGreaterThan(0);
      expect(discoveredHids.size).toBeGreaterThan(200);
      expect(families.splicing.length).toBeGreaterThan(100);
    },
    330 * 60_000,
  );
});
