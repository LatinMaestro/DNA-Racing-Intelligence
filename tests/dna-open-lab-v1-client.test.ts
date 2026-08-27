import { describe, expect, it, vi } from "vitest";

import {
  createDnaOpenLabV1Client,
  DnaOpenLabApiError,
  type DnaOpenLabTransport,
} from "../lib/dna-open-lab-v1-client";

const API_KEY = `dna_${"a".repeat(43)}`;

function jsonResponse(
  payload: unknown,
  input: {
    status?: number;
    headers?: Readonly<Record<string, string>>;
  } = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status: input.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(input.headers ?? {}),
    },
  });
}

function clientWith(response: Response) {
  const transport = vi.fn(async () => response) as unknown as DnaOpenLabTransport;
  const client = createDnaOpenLabV1Client({ apiKey: API_KEY, transport });
  return { client, transport: transport as ReturnType<typeof vi.fn> };
}

function requestFrom(transport: ReturnType<typeof vi.fn>) {
  const call = transport.mock.calls[0];
  if (call === undefined) throw new Error("expected DNA API request");
  const [url, init] = call as [string, RequestInit];
  return { url, init };
}

describe("DNA Open Lab v1 client", () => {
  it("uses server-side bearer auth, preserves future optional fields, and exposes rate metadata", async () => {
    const { client, transport } = clientWith(
      jsonResponse(
        {
          status: "success",
          result: {
            hid: 42,
            name: "Synthetic",
            type: "freak",
            element: "water",
            color: "blue",
            hex_code: "#0000ff",
            fno: 12,
            gender: "female",
            vault: "0xabc",
            future_optional_field: { retained: true },
          },
        },
        {
          headers: {
            "X-RateLimit-Limit": "30",
            "X-RateLimit-Remaining": "29",
            "X-RateLimit-Reset": "44",
            "X-RateLimit-Class": "api_key",
          },
        },
      ),
    );

    const response = await client.coreInfo(42);

    expect(response.result).toMatchObject({
      hid: 42,
      name: "Synthetic",
      future_optional_field: { retained: true },
    });
    expect(response.rateLimit).toEqual({
      limit: 30,
      remaining: 29,
      resetSeconds: 44,
      rateClass: "api_key",
      retryAfterSeconds: null,
    });

    const request = requestFrom(transport);
    expect(request.url).toBe(
      "https://api.dnaracing.run/fbike/pub/v1/cores/42/info",
    );
    expect(request.init.method).toBe("GET");
    const headers = new Headers(request.init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
    expect(request.url).not.toContain(API_KEY);
  });

  it("treats the body error envelope as authoritative even for the documented HTTP 305 quirk", async () => {
    const { client } = clientWith(
      jsonResponse(
        {
          status: "error",
          err: 'forbidden: api key missing required scope "vault" (granted: tokens)',
        },
        { status: 305 },
      ),
    );

    await expect(client.vaultCores("0xabc")).rejects.toMatchObject({
      name: "DnaOpenLabApiError",
      kind: "api_error",
      httpStatus: 305,
      message: expect.stringContaining("missing required scope"),
    });
  });

  it("surfaces 429 retry metadata without retrying blindly", async () => {
    const { client, transport } = clientWith(
      jsonResponse(
        {
          status: "error",
          err: "rate limit exceeded — api_key bucket allows 30 req/min",
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": "30",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "21",
            "X-RateLimit-Class": "api_key",
            "Retry-After": "21",
          },
        },
      ),
    );

    await expect(client.racesActive()).rejects.toMatchObject({
      kind: "rate_limited",
      httpStatus: 429,
      rateLimit: {
        limit: 30,
        remaining: 0,
        resetSeconds: 21,
        rateClass: "api_key",
        retryAfterSeconds: 21,
      },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("fails closed on malformed response envelopes and non-JSON bodies", async () => {
    const malformed = clientWith(jsonResponse({ result: { pong: true } }));
    await expect(malformed.client.testAuth()).rejects.toMatchObject({
      kind: "malformed_response",
    });

    const transport = vi.fn(async () =>
      new Response("not json", { status: 200 }),
    ) as unknown as DnaOpenLabTransport;
    const client = createDnaOpenLabV1Client({ apiKey: API_KEY, transport });
    await expect(client.testAuth()).rejects.toMatchObject({
      kind: "malformed_response",
      message: "DNA Open Lab returned non-JSON content",
    });
  });

  it("validates key shape before any transport call", () => {
    const transport = vi.fn(async () =>
      jsonResponse({ status: "success", result: {} }),
    ) as unknown as DnaOpenLabTransport;

    expect(() =>
      createDnaOpenLabV1Client({ apiKey: "dna_not-a-real-key", transport }),
    ).toThrowError(DnaOpenLabApiError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("enforces documented bulk and finished-race request limits before transport", async () => {
    const transport = vi.fn(async () =>
      jsonResponse({ status: "success", result: [] }),
    ) as unknown as DnaOpenLabTransport;
    const client = createDnaOpenLabV1Client({ apiKey: API_KEY, transport });

    await expect(client.coreInfoBulk(Array.from({ length: 21 }, (_, i) => i + 1))).rejects.toMatchObject({
      kind: "invalid_request",
      message: "hids must contain between 1 and 20 values",
    });
    await expect(client.raceDocs(Array.from({ length: 21 }, (_, i) => i + 1))).rejects.toMatchObject({
      kind: "invalid_request",
      message: "rids must contain between 1 and 20 values",
    });
    await expect(client.vaultInfoBulk(Array.from({ length: 101 }, (_, i) => `vault-${i}`))).rejects.toMatchObject({
      kind: "invalid_request",
      message: "vaults must contain between 1 and 100 values",
    });
    await expect(client.racesFinished({ limit: 201 })).rejects.toMatchObject({
      kind: "invalid_request",
      message: "limit must be between 1 and 200",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("enforces vault-search and finished-race chronology bounds", async () => {
    const transport = vi.fn(async () =>
      jsonResponse({ status: "success", result: [] }),
    ) as unknown as DnaOpenLabTransport;
    const client = createDnaOpenLabV1Client({ apiKey: API_KEY, transport });

    await expect(client.vaultSearch({ query: "x" })).rejects.toMatchObject({
      kind: "invalid_request",
      message: "query must have at least 2 characters",
    });
    await expect(
      client.racesFinished({
        startTime: "2026-08-27T12:00:00Z",
        endTime: "2026-08-27T11:00:00Z",
      }),
    ).rejects.toMatchObject({
      kind: "invalid_request",
      message: "startTime cannot be after endTime",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("encodes legacy email vault identifiers safely in path endpoints", async () => {
    const { client, transport } = clientWith(
      jsonResponse({ status: "success", result: [1, 2] }),
    );

    await client.vaultCores("legacy@example.com");

    expect(requestFrom(transport).url).toBe(
      "https://api.dnaracing.run/fbike/pub/v1/vault/legacy%40example.com/cores",
    );
  });

  it("maps bulk core verbs to one bounded POST call", async () => {
    const verbs = [
      ["coreInfoBulk", "info_bulk"],
      ["coreRacingStatsBulk", "racing_stats_bulk"],
      ["corePowerBulk", "power_bulk"],
      ["coreListingPriceBulk", "listing_price_bulk"],
      ["coreAttachedAssetsBulk", "attached_assets_bulk"],
      ["coreOwnerBulk", "owner_bulk"],
      ["coreStaminaBulk", "stamina_bulk"],
      ["coreSplicingInfoBulk", "splicing_info_bulk"],
    ] as const;

    for (const [method, endpoint] of verbs) {
      const { client, transport } = clientWith(
        jsonResponse({ status: "success", result: [] }),
      );
      await client[method]([11, 12]);
      const request = requestFrom(transport);
      expect(request.url).toBe(
        `https://api.dnaracing.run/fbike/pub/v1/cores/${endpoint}`,
      );
      expect(request.init.method).toBe("POST");
      expect(JSON.parse(String(request.init.body))).toEqual({ hids: [11, 12] });
    }
  });

  it("maps splice pair validation and arena filters to documented request shapes", async () => {
    const pair = clientWith(
      jsonResponse({ status: "success", result: { valid: true } }),
    );
    await pair.client.splicePairValidate({
      fatherCoreId: 10,
      motherCoreId: 20,
    });
    expect(requestFrom(pair.transport).url).toBe(
      "https://api.dnaracing.run/fbike/pub/v1/splice/pair_validate?father_coreid=10&mother_coreid=20",
    );

    const arena = clientWith(
      jsonResponse({ status: "success", result: [] }),
    );
    await arena.client.spliceArena({
      filter: { rvmode: "bike", use_powerstats: true },
      search: "water",
      vault: "0xabc",
      page: 2,
    });
    const arenaRequest = requestFrom(arena.transport);
    expect(arenaRequest.url).toBe(
      "https://api.dnaracing.run/fbike/pub/v1/splice/arena",
    );
    expect(JSON.parse(String(arenaRequest.init.body))).toEqual({
      f: { rvmode: "bike", use_powerstats: true },
      search: "water",
      vault: "0xabc",
      page: 2,
    });
  });
});
