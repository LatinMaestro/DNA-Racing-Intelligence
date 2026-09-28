import { describe, expect, it } from "vitest";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const connected =
  process.env.DNA_OPEN_LAB_API_KEY_1?.startsWith("dna_") === true;
const describeConnected = connected ? describe : describe.skip;
const BASE = "https://api.dnaracing.run/fbike/pub/v1";

function key(name: string): string {
  const value = process.env[name];
  if (!value || !/^dna_[A-Za-z0-9_-]{43}$/.test(value))
    throw new Error("key unavailable");
  return value;
}
function safeRate(headers: Headers) {
  const integer = (name: string) => {
    const value = headers.get(name);
    return value !== null && /^\d+$/.test(value) ? Number(value) : null;
  };
  const rateClass = headers.get("X-RateLimit-Class");
  return {
    limit: integer("X-RateLimit-Limit"),
    remaining: integer("X-RateLimit-Remaining"),
    reset: integer("X-RateLimit-Reset"),
    rateClass: rateClass && rateClass.length <= 32 ? rateClass : null,
  };
}
async function docs(apiKey: string, rids: readonly (string | number)[]) {
  const started = Date.now();
  const response = await fetch(BASE + "/races/docs", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rids }),
    cache: "no-store",
  });
  const rate = safeRate(response.headers);
  let resultCount: number | null = null;
  let envelopeStatus: string | null = null;
  let resultKind: "array" | "object" | "other" | null = null;
  let resultKeys: string[] = [];
  try {
    const body = (await response.json()) as {
      status?: unknown;
      result?: unknown;
    };
    envelopeStatus = typeof body.status === "string" ? body.status.slice(0, 32) : null;
    if (Array.isArray(body.result)) {
      resultKind = "array";
      resultCount = body.result.length;
    } else if (body.result !== null && typeof body.result === "object") {
      resultKind = "object";
      resultKeys = Object.keys(body.result as Record<string, unknown>)
        .filter((key) => /^[A-Za-z0-9_-]{1,32}$/.test(key))
        .slice(0, 12);
    } else if (body.result !== undefined) {
      resultKind = "other";
    }
  } catch {}
  return {
    status: response.status,
    envelopeStatus,
    resultKind,
    resultKeys,
    resultCount,
    elapsedMs: Date.now() - started,
    rate,
  };
}

describeConnected("DNA Open Lab throughput probe", () => {
  it("measures docs batch acceptance and independent key counters without writes", async () => {
    const keys = [
      key("DNA_OPEN_LAB_API_KEY_1"),
      key("DNA_OPEN_LAB_API_KEY_2"),
      key("DNA_OPEN_LAB_API_KEY_3"),
    ];
    expect(new Set(keys).size).toBe(3);
    const client = createDnaOpenLabV1Client({ apiKey: keys[0]! });
    const ids: (string | number)[] = [];
    const seen = new Set<string>();
    const end = Date.now();
    for (let window = 0; window < 12 && ids.length < 100; window += 1) {
      const endTime = new Date(
        end - window * 24 * 60 * 60 * 1_000,
      ).toISOString();
      const startTime = new Date(
        end - (window + 1) * 24 * 60 * 60 * 1_000,
      ).toISOString();
      const seed = await client.racesFinished({
        startTime,
        endTime,
        limit: 200,
      });
      for (const race of seed.result) {
        if (typeof race.rid !== "string" && typeof race.rid !== "number")
          continue;
        const identity = String(race.rid);
        if (seen.has(identity)) continue;
        seen.add(identity);
        ids.push(race.rid);
        if (ids.length === 100) break;
      }
    }
    if (ids.length < 100) throw new Error("insufficient bounded race sample");
    const batches = [];
    for (const size of [20, 50, 100] as const)
      batches.push({
        size,
        ...(await docs(keys[0]!, ids.slice(0, size))),
      });
    const lanes = [];
    for (let index = 0; index < keys.length; index += 1) {
      const first = await docs(keys[index]!, ids.slice(index, index + 1));
      const second = await docs(keys[index]!, ids.slice(index + 3, index + 4));
      lanes.push({
        lane: "key-" + (index + 1),
        first: first.rate,
        second: second.rate,
        statuses: [first.status, second.status],
      });
    }
    console.log(
      "DNA_OPEN_LAB_THROUGHPUT_PROBE=" + JSON.stringify({ batches, lanes }),
    );
    expect(batches[0]?.status).toBe(200);
    expect(
      lanes.every((lane) => lane.statuses.every((status) => status === 200)),
    ).toBe(true);
  }, 120_000);
});
