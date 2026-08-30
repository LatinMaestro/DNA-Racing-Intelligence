import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DnaOpenLabApiError,
  createDnaOpenLabV1Client,
  type DnaCoreSplicingInfo,
  type DnaOpenLabResponse,
} from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_BREEDING_LINEAGE_CENSUS === "1";
const describeConnected = enabled ? describe : describe.skip;
const OWNER_VAULT = "0x5a29c2f20faf3f5160d27efa5100aa10e9bb934d";
const RESEARCH_EXPIRES_AT = "2026-08-31T14:00:00.000Z";
const REQUESTS_PER_MINUTE = 150;
const REQUEST_INTERVAL_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE) + 5;
const CORE_BATCH_SIZE = 20;
const DEFAULT_MAX_HID = 26_000;

type AnyRecord = Record<string, unknown>;
type ParentLink = Readonly<{
  childHid: number;
  parentHids: readonly number[];
}>;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
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
  const preferredValues = preferred.flatMap((key) => lineageIds(record[key]));
  if (preferredValues.length > 0) return [...new Set(preferredValues)];
  return [
    ...new Set(Object.values(record).flatMap((entry) => lineageIds(entry))),
  ];
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size) as T[]);
  }
  return out;
}

function assertAuthority(): void {
  if (Date.now() >= Date.parse(RESEARCH_EXPIRES_AT)) {
    throw new Error("Temporary August 150 rpm research authority has expired.");
  }
}

describeConnected("lineage-first breeding census fallback", () => {
  it(
    "reverse-indexes offspring of owned and current Arena parents without crawling all races first",
    async () => {
      assertAuthority();
      const apiKey = required("DNA_OPEN_LAB_API_KEY_1");
      const client = createDnaOpenLabV1Client({ apiKey });
      const maxHid = Number(
        process.env.BREEDING_CENSUS_MAX_HID ?? DEFAULT_MAX_HID,
      );
      if (!Number.isSafeInteger(maxHid) || maxHid < 1 || maxHid > 100_000) {
        throw new Error("BREEDING_CENSUS_MAX_HID is invalid");
      }

      let lastStartAt = 0;
      let requestCount = 0;
      let retryCount = 0;
      let minimumObservedRemaining: number | null = null;
      let maximumObservedLimit: number | null = null;

      const paced = async <T>(
        operation: () => Promise<DnaOpenLabResponse<T>>,
      ): Promise<DnaOpenLabResponse<T>> => {
        for (let attempt = 0; attempt < 5; attempt++) {
          assertAuthority();
          const wait = REQUEST_INTERVAL_MS - (Date.now() - lastStartAt);
          if (wait > 0)
            await new Promise((resolve) => setTimeout(resolve, wait));
          assertAuthority();
          lastStartAt = Date.now();
          requestCount++;
          try {
            const response = await operation();
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
            return response;
          } catch (error) {
            if (
              error instanceof DnaOpenLabApiError &&
              attempt < 4 &&
              (error.kind === "rate_limited" ||
                (error.httpStatus !== null && error.httpStatus >= 500))
            ) {
              retryCount++;
              const seconds =
                error.rateLimit?.retryAfterSeconds ??
                error.rateLimit?.resetSeconds ??
                Math.min(30, 2 ** attempt);
              await new Promise((resolve) =>
                setTimeout(resolve, Math.max(1, seconds) * 1_000),
              );
              continue;
            }
            throw error;
          }
        }
        throw new Error("unreachable request retry exhaustion");
      };

      const owned = (await paced(() => client.vaultCoresFull(OWNER_VAULT)))
        .result;
      const parentTargets = new Set<number>(
        owned.map((core) => Number(core.hid)),
      );
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
          const rows = response.result.cores as AnyRecord[];
          arenas[mode]!.push(...rows);
          for (const row of rows) {
            const hid = finiteHid(row.hid);
            if (hid !== null) parentTargets.add(hid);
          }
          if (!response.result.has_more) break;
        }
      }

      const allHids = Array.from({ length: maxHid }, (_, index) => index + 1);
      const splicingRows: DnaCoreSplicingInfo[] = [];
      const failedSingletons: number[] = [];

      const fetchAdaptive = async (batch: readonly number[]): Promise<void> => {
        try {
          const response = await paced(() =>
            client.coreSplicingInfoBulk(batch),
          );
          splicingRows.push(...response.result);
        } catch (error) {
          if (batch.length === 1) {
            failedSingletons.push(batch[0]!);
            return;
          }
          const midpoint = Math.ceil(batch.length / 2);
          await fetchAdaptive(batch.slice(0, midpoint));
          await fetchAdaptive(batch.slice(midpoint));
        }
      };

      for (const batch of chunks(allHids, CORE_BATCH_SIZE)) {
        await fetchAdaptive(batch);
      }

      const links: ParentLink[] = [];
      const offspringByParent = new Map<number, number[]>();
      const relevantChildHids = new Set<number>();
      for (const row of splicingRows) {
        const childHid = finiteHid(row.hid);
        if (childHid === null) continue;
        const parentHids = lineageIds(row.parents).filter(
          (hid) => hid !== childHid,
        );
        if (parentHids.length === 0) continue;
        links.push({ childHid, parentHids });
        for (const parentHid of parentHids) {
          if (!parentTargets.has(parentHid)) continue;
          relevantChildHids.add(childHid);
          const children = offspringByParent.get(parentHid) ?? [];
          children.push(childHid);
          offspringByParent.set(parentHid, children);
        }
      }

      const relevantHids = [
        ...new Set([...parentTargets, ...relevantChildHids]),
      ].sort((a, b) => a - b);
      const info: AnyRecord[] = [];
      const stats: AnyRecord[] = [];
      const power: AnyRecord[] = [];
      const splicing: AnyRecord[] = [];
      for (const batch of chunks(relevantHids, CORE_BATCH_SIZE)) {
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

      await mkdir("artifacts", { recursive: true });
      await writeFile(
        "artifacts/breeding-lineage-census.json",
        JSON.stringify({
          schemaVersion: 1,
          fetchedAt: new Date().toISOString(),
          maxHidScanned: maxHid,
          requestCount,
          retryCount,
          maximumObservedLimit,
          minimumObservedRemaining,
          ownerCoreCount: owned.length,
          arenaCounts: Object.fromEntries(
            Object.entries(arenas).map(([mode, rows]) => [mode, rows.length]),
          ),
          targetParentCount: parentTargets.size,
          splicingRowCount: splicingRows.length,
          failedSingletonCount: failedSingletons.length,
          failedSingletons,
          parentChildLinkCount: links.length,
          relevantOffspringCount: relevantChildHids.size,
          relevantCoreCount: relevantHids.length,
          offspringByParent: [...offspringByParent.entries()]
            .map(([parentHid, childHids]) => ({
              parentHid,
              childHids: [...new Set(childHids)].sort((a, b) => a - b),
            }))
            .sort((a, b) => a.parentHid - b.parentHid),
          coreFamilies: { info, stats, power, splicing },
        }),
        "utf8",
      );

      expect(parentTargets.size).toBeGreaterThan(0);
      expect(splicingRows.length).toBeGreaterThan(0);
    },
    60 * 60_000,
  );
});
