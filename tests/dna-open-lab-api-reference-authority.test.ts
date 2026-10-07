import { describe, expect, it } from "vitest";

import {
  DNA_OPEN_LAB_LLM_REFERENCE_URL,
  DNA_OPEN_LAB_MAX_ACTIVE_KEYS_PER_VAULT,
  DNA_OPEN_LAB_REFERENCE_ENDPOINTS,
  DNA_OPEN_LAB_REFERENCE_LIMITS,
  DNA_OPEN_LAB_REFERENCE_RATE_HEADERS,
  DNA_OPEN_LAB_REFERENCE_RATE_TIERS,
  DNA_OPEN_LAB_V1_REFERENCE_BASE_URL,
} from "../lib/dna-open-lab-api-reference";
import {
  createDnaOpenLabV1Client,
  DNA_OPEN_LAB_V1_BASE_URL,
  DnaOpenLabApiError,
} from "../lib/dna-open-lab-v1-client";
import { createDnaOpenLabV1TelemetryClient } from "../lib/dna-open-lab-v1-telemetry-client";

const KEY = `dna_${"a".repeat(43)}`;

describe("DNA Open Lab API reference authority", () => {
  it("pins the upstream llm reference, base URL, rate ladder and key ceiling", () => {
    expect(DNA_OPEN_LAB_LLM_REFERENCE_URL).toBe(
      "https://api.dnaracing.run/fbike/pub/v1/llm.txt",
    );
    expect(DNA_OPEN_LAB_V1_REFERENCE_BASE_URL).toBe(DNA_OPEN_LAB_V1_BASE_URL);
    expect(DNA_OPEN_LAB_MAX_ACTIVE_KEYS_PER_VAULT).toBe(3);
    expect(DNA_OPEN_LAB_REFERENCE_RATE_TIERS).toEqual([
      { minimumTierScore: 2.5, requestsPerMinute: 150 },
      { minimumTierScore: 2, requestsPerMinute: 80 },
      { minimumTierScore: 1, requestsPerMinute: 30 },
    ]);
    expect(DNA_OPEN_LAB_REFERENCE_RATE_HEADERS).toEqual([
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
      "X-RateLimit-Class",
      "Retry-After",
    ]);
  });

  it("keeps a unique complete endpoint inventory including the 19-live Core surface", () => {
    const ids = DNA_OPEN_LAB_REFERENCE_ENDPOINTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("races.finished");
    expect(ids).toContain("races.docs");
    expect(ids).toContain("races.fills");
    expect(ids).toContain("cores.telemetry");
    expect(ids).toContain("cores.telemetry_bulk");
    expect(ids).toContain("cores.telemetry_benchmark");
    expect(ids).toContain("splice.pair_validate");

    const coreOperations = DNA_OPEN_LAB_REFERENCE_ENDPOINTS.filter(
      (entry) => entry.scope === "cores",
    );
    expect(coreOperations).toHaveLength(19);
  });

  it("retains the published bulk bounds rather than observed permissive behaviour", async () => {
    expect(DNA_OPEN_LAB_REFERENCE_LIMITS).toEqual({
      vaultInfoBulk: 100,
      vaultSearch: 50,
      vaultSearchMinimumQueryLength: 2,
      finishedRaces: 200,
      raceDocs: 20,
      raceFills: 20,
      coreBulk: 20,
    });

    const transport = async () =>
      new Response(JSON.stringify({ status: "success", result: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const client = createDnaOpenLabV1Client({ apiKey: KEY, transport });
    const telemetry = createDnaOpenLabV1TelemetryClient({
      apiKey: KEY,
      transport,
    });

    const invalid = async (request: () => Promise<unknown>) => {
      try {
        await request();
        throw new Error("request unexpectedly accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(DnaOpenLabApiError);
        expect((error as DnaOpenLabApiError).kind).toBe("invalid_request");
      }
    };

    await invalid(() => client.vaultInfoBulk(Array(101).fill("vault")));
    await invalid(() => client.vaultSearch({ query: "ok", limit: 51 }));
    await invalid(() => client.racesFinished({ limit: 201 }));
    await invalid(() => client.raceDocs(Array(21).fill(1)));
    await invalid(() => client.raceFills(Array(21).fill(1)));
    await invalid(() => client.coreInfoBulk(Array(21).fill(1)));
    await invalid(() => telemetry.coreTelemetryBulk(Array(21).fill(1)));
  });
});
