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
  try {
    const body = (await response.json()) as {
      status?: unknown;
      result?: unknown;
    };
    if (body.status === "success" && Array.isArray(body.result))
      resultCount = body.result.length;
  } catch {}
  return {
    status: response.status,
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
    const seed = await createDnaOpenLabV1Client({
      apiKey: keys[0]!,
    }).racesFinished({ limit: 100 });
    const ids = seed.result
      .map((race) => race.rid)
      .filter((rid) => typeof rid === "string" || typeof rid === "number")
      .slice(0, 100);
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
