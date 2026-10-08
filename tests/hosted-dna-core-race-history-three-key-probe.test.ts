import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE } from "../lib/dna-core-race-history-acquisition-cycle";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_CORE_RACE_HISTORY_THREE_KEY_PROBE === "1";
const describeConnected = enabled ? describe : describe.skip;
const HISTORY_URL = "https://api.dnaracing.run/fbike/i/hraces";
const REFERENCE_URL = "https://api.dnaracing.run/fbike/pub/v1/llm.txt";

type Lane = "anonymous" | "key-1" | "key-2" | "key-3";
type Rate = Readonly<{
  limit: number | null;
  remaining: number | null;
  reset: number | null;
  rateClassPresent: boolean;
  retryAfterSeconds: number | null;
}>;
type Probe = Readonly<{ lane: Lane; rate: Rate; digest: string }>;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value || value.length > 4096) {
    throw new Error("required protected probe configuration is unavailable");
  }
  return value;
}

function safeInteger(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null || !/^[0-9]+$/u.test(value)) return null;
  const integer = Number(value);
  return Number.isSafeInteger(integer) ? integer : null;
}

function readRate(headers: Headers): Rate {
  return Object.freeze({
    limit: safeInteger(headers, "X-RateLimit-Limit"),
    remaining: safeInteger(headers, "X-RateLimit-Remaining"),
    reset: safeInteger(headers, "X-RateLimit-Reset"),
    rateClassPresent: headers.has("X-RateLimit-Class"),
    retryAfterSeconds: safeInteger(headers, "Retry-After"),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function inspectUpstreamReference(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(REFERENCE_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("upstream API reference is unavailable");
  }
  if (!response.ok) {
    throw new Error("upstream API reference is unavailable");
  }
  const reference = await response.text();
  if (
    !reference.includes("/races/finished") ||
    !reference.includes("/races/docs") ||
    !reference.includes("X-RateLimit-Limit")
  ) {
    throw new Error("upstream API authority drift requires review");
  }
}

async function probePage(input: {
  lane: Lane;
  apiKey: string | null;
  coreId: number;
}): Promise<Probe> {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  if (input.apiKey !== null) {
    headers.set("Authorization", `Bearer ${input.apiKey}`);
  }
  let response: Response;
  try {
    response = await fetch(HISTORY_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ hid: input.coreId, page: 1 }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Core-history probe transport failed");
  }

  const rate = readRate(response.headers);
  // A 429 or ambiguous provider response ends the probe; do not retry.
  if (!response.ok || rate.retryAfterSeconds !== null) {
    throw new Error("Core-history probe was rejected or rate-limited");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Core-history probe envelope was malformed");
  }
  if (
    !isRecord(payload) ||
    payload.status !== "success" ||
    !Array.isArray(payload.result) ||
    payload.result.length > DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE ||
    !payload.result.every(isRecord)
  ) {
    throw new Error("Core-history probe envelope was invalid");
  }

  // Compare in memory only; never print Core/Race identities or payloads.
  const digest = createHash("sha256")
    .update(JSON.stringify(payload.result))
    .digest("hex");
  return Object.freeze({ lane: input.lane, rate, digest });
}

function remainingDrop(
  readings: readonly Probe[],
  lane: Lane,
): number | null {
  const matches = readings.filter((entry) => entry.lane === lane);
  if (matches.length !== 2) return null;
  const first = matches[0]!.rate;
  const second = matches[1]!.rate;
  if (
    first.remaining === null ||
    second.remaining === null ||
    first.reset === null ||
    second.reset === null ||
    first.limit === null ||
    second.limit === null ||
    first.limit !== second.limit ||
    Math.abs(first.reset - second.reset) > 60
  ) {
    return null;
  }
  return first.remaining - second.remaining;
}

describeConnected("legacy Core-history three-key read-only rate probe", () => {
  it("compares three keyed counters with an anonymous baseline without permitting a rate increase", async () => {
    const expectedSha = required("GITHUB_SHA");
    if (!/^[a-f0-9]{40}$/u.test(expectedSha)) {
      throw new Error("exact main commit is unavailable");
    }
    await inspectUpstreamReference();

    const keys = [
      required("DNA_OPEN_LAB_API_KEY_1"),
      required("DNA_OPEN_LAB_API_KEY_2"),
      required("DNA_OPEN_LAB_API_KEY_3"),
    ] as const;
    if (
      keys.some((value) => !/^dna_[A-Za-z0-9_-]{43}$/u.test(value)) ||
      new Set(keys).size !== 3
    ) {
      throw new Error("the three owner API keys are unavailable or duplicated");
    }

    // One official keyed read selects a genuine owned Core without disclosing
    // its identifier. The legacy history request itself uses no vault scope.
    const vault = required("DNA_OPEN_LAB_VAULT");
    const vaultClient = createDnaOpenLabV1Client({ apiKey: keys[0] });
    const owned = await vaultClient.vaultCores(vault);
    const coreId = owned.result.find(
      (value) => Number.isSafeInteger(value) && value > 0,
    );
    if (coreId === undefined) {
      throw new Error("an owned Core is unavailable for the read-only probe");
    }

    const order: readonly Lane[] = [
      "anonymous",
      "key-1",
      "key-2",
      "key-3",
      "key-1",
      "key-2",
      "key-3",
      "anonymous",
    ];
    const keyForLane: Record<Lane, string | null> = {
      anonymous: null,
      "key-1": keys[0],
      "key-2": keys[1],
      "key-3": keys[2],
    };
    const readings: Probe[] = [];
    for (const lane of order) {
      readings.push(await probePage({ lane, apiKey: keyForLane[lane], coreId }));
    }

    const sameOutcome = readings.every(
      (entry) => entry.digest === readings[0]!.digest,
    );
    if (!sameOutcome) {
      throw new Error("Core-history outcome changed across read-only lanes");
    }

    const lanes = ["anonymous", "key-1", "key-2", "key-3"] as const;
    const drops = lanes.map((lane) => remainingDrop(readings, lane));
    const headersComplete = readings.every(
      (entry) =>
        entry.rate.limit !== null &&
        entry.rate.remaining !== null &&
        entry.rate.reset !== null &&
        entry.rate.rateClassPresent,
    );
    const independentCandidate =
      headersComplete && drops.every((drop) => drop === 1);
    const sharedCandidate =
      headersComplete &&
      drops[0] !== null &&
      drops[0] >= 7 &&
      drops.slice(1).every((drop) => drop !== null && drop >= 3);
    const verdict = independentCandidate
      ? "independent_counter_candidate_requires_provider_review"
      : sharedCandidate
        ? "shared_or_unkeyed_counter_observed"
        : "inconclusive_keep_30_aggregate";

    const report = Object.freeze({
      version: 1,
      endpoint: "legacy_core_history",
      readOnly: true,
      providerRequestCount: order.length + 1,
      responseEnvelopeStable: sameOutcome,
      rateHeadersComplete: headersComplete,
      perLaneRemainingDrops: drops,
      verdict,
      observedIndependentKeysNotYetAuthorized: true,
      approvedAggregateRequestsPerMinute: 30,
      rateIncreaseEnabled: false,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
    const serialized = JSON.stringify(report);
    for (const secret of [...keys, vault]) {
      if (serialized.includes(secret)) {
        throw new Error("redaction invariant failed");
      }
    }
    if (serialized.includes('"coreId"') || serialized.includes('"hid"')) {
      throw new Error("private Core identity must not be logged");
    }
    console.log("DNA_CORE_HISTORY_THREE_KEY_PROBE=" + serialized);
    expect(sameOutcome).toBe(true);
    expect(readings).toHaveLength(8);
  }, 120_000);
});
