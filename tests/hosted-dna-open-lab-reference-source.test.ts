import { describe, expect, it } from "vitest";

import {
  DNA_OPEN_LAB_LLM_REFERENCE_URL,
  DNA_OPEN_LAB_V1_REFERENCE_BASE_URL,
} from "../lib/dna-open-lab-api-reference";

const connected = process.env.DNA_OPEN_LAB_CONNECTED_DISCOVERY === "1";
const describeConnected = connected ? describe : describe.skip;

describeConnected("hosted DNA Open Lab public reference source", () => {
  it("proves llm.txt and the open test endpoint remain reachable without exposing content", async () => {
    const reference = await fetch(DNA_OPEN_LAB_LLM_REFERENCE_URL, {
      cache: "no-store",
    });
    expect(reference.status).toBe(200);
    const text = await reference.text();
    expect(text.length).toBeGreaterThan(2_000);
    expect(text.length).toBeLessThan(1_000_000);
    for (const marker of [
      "/vault/info_bulk",
      "/races/finished",
      "/races/docs",
      "/races/fills",
      "/cores/info_bulk",
      "/cores/telemetry",
      "/cores/telemetry_bulk",
      "/cores/telemetry_benchmark",
      "/tokens/prices",
      "/splice/pair_validate",
      "150",
      "80",
      "30",
      "X-RateLimit-Limit",
      "Retry-After",
    ]) {
      expect(text).toContain(marker);
    }

    const ping = await fetch(`${DNA_OPEN_LAB_V1_REFERENCE_BASE_URL}/test`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    expect(ping.status).toBe(200);
    const envelope = (await ping.json()) as {
      status?: unknown;
      result?: { pong?: unknown; version?: unknown };
    };
    expect(envelope.status).toBe("success");
    expect(envelope.result?.pong).toBe(true);
    expect(envelope.result?.version).toBe(1);

    console.log(
      "DNA_OPEN_LAB_REFERENCE_SOURCE=PASS llm_and_open_test_contract",
    );
  }, 60_000);
});
