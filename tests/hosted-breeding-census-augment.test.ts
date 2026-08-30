import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DnaOpenLabApiError,
  createDnaOpenLabV1Client,
  type DnaOpenLabResponse,
} from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_BREEDING_CENSUS_AUGMENT === "1";
const describeConnected = enabled ? describe : describe.skip;
const RESEARCH_EXPIRES_AT = "2026-08-31T14:00:00.000Z";
const REQUESTS_PER_MINUTE = 150;
const REQUEST_INTERVAL_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE) + 5;

type AnyRecord = Record<string, unknown>;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} missing`);
  return value;
}

function hidOrNull(value: unknown): number | null {
  const hid = Number(value);
  return Number.isSafeInteger(hid) && hid > 0 ? hid : null;
}

function lineageIds(value: unknown): number[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((entry) => lineageIds(entry)))];
  }
  const direct = hidOrNull(value);
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
  const preferredIds = preferred.flatMap((key) => lineageIds(record[key]));
  if (preferredIds.length > 0) return [...new Set(preferredIds)];
  return [...new Set(Object.values(record).flatMap((entry) => lineageIds(entry)))];
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

function assertAuthority(): void {
  if (Date.now() >= Date.parse(RESEARCH_EXPIRES_AT)) {
    throw new Error("Temporary August high-rate research authority has expired.");
  }
}

describeConnected("lineage census augmentation", () => {
  it(
    "upgrades the census contract and recovers authoritative splice timestamps where exposed",
    async () => {
      assertAuthority();
      const sourcePath =
        process.env.BREEDING_CENSUS_SOURCE_PATH ??
        "artifacts/source/breeding-lineage-census.json";
      const source = JSON.parse(await readFile(sourcePath, "utf8")) as AnyRecord;
      const families = (source.coreFamilies ?? {}) as AnyRecord;
      const info = (families.info ?? []) as AnyRecord[];
      const splicing = (families.splicing ?? []) as AnyRecord[];
      const hids = [...new Set(info.map((row) => hidOrNull(row.hid)).filter((hid): hid is number => hid !== null))].sort(
        (a, b) => a - b,
      );

      const directParentsByChild: Record<string, number[]> = {};
      const requestIds: { childHid: number; path: string; requestId: string }[] = [];
      for (const row of splicing) {
        const childHid = hidOrNull(row.hid);
        if (childHid === null) continue;
        const parents = lineageIds(row.parents).filter((hid) => hid !== childHid);
        if (parents.length > 0) {
          directParentsByChild[String(childHid)] = [...new Set(parents)];
        }
        for (const request of extractRequestIds(row.splice_core)) {
          requestIds.push({ childHid, path: request.path, requestId: request.value });
        }
      }

      const client = createDnaOpenLabV1Client({
        apiKey: required("DNA_OPEN_LAB_API_KEY_1"),
      });
      let lastStartAt = 0;
      let requestCount = 0;
      let retryCount = 0;
      const paced = async <T>(
        operation: () => Promise<DnaOpenLabResponse<T>>,
      ): Promise<DnaOpenLabResponse<T>> => {
        for (let attempt = 0; attempt < 5; attempt++) {
          assertAuthority();
          const wait = REQUEST_INTERVAL_MS - (Date.now() - lastStartAt);
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
          lastStartAt = Date.now();
          requestCount++;
          try {
            return await operation();
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
        throw new Error("unreachable retry exhaustion");
      };

      const spliceDocuments: AnyRecord[] = [];
      const seen = new Set<string>();
      for (const request of requestIds) {
        if (seen.has(request.requestId)) continue;
        seen.add(request.requestId);
        try {
          const response = await paced(() => client.spliceDocument(request.requestId));
          spliceDocuments.push({
            ...request,
            document: response.result,
            error: null,
          });
        } catch (error) {
          spliceDocuments.push({
            ...request,
            document: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      await mkdir("artifacts/inventory", { recursive: true });
      await writeFile(
        "artifacts/inventory/breeding-lineage-census-upgraded.json",
        JSON.stringify({
          ...source,
          schemaVersion: 2,
          augmentedAt: new Date().toISOString(),
          universe: { hids, directParentsByChild },
          spliceDiscovery: { requestIds, spliceDocuments },
          augmentation: {
            requestCount,
            retryCount,
            requestIdCount: requestIds.length,
            uniqueRequestIdCount: seen.size,
            spliceDocumentCount: spliceDocuments.length,
          },
        }),
        "utf8",
      );

      expect(hids.length).toBeGreaterThan(0);
      expect(Object.keys(directParentsByChild).length).toBeGreaterThan(0);
    },
    30 * 60_000,
  );
});
