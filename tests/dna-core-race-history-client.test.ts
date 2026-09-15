import { describe, expect, it, vi } from "vitest";

import {
  createDnaCoreRaceHistoryClient,
  DNA_CORE_RACE_HISTORY_URL,
  type DnaCoreRaceHistoryTransport,
} from "../lib/dna-core-race-history-client";

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
  const transport = vi.fn(
    async () => response,
  ) as unknown as DnaCoreRaceHistoryTransport;
  const client = createDnaCoreRaceHistoryClient({ transport });
  return { client, transport: transport as ReturnType<typeof vi.fn> };
}

describe("DNA Core race history client", () => {
  it("requests one explicit Core page without sending credentials and preserves future fields", async () => {
    const { client, transport } = clientWith(
      jsonResponse(
        {
          status: "success",
          result: [
            {
              hid: 42,
              rid: "race-1",
              rvmode: "bike",
              cb: 12,
              time: 65.125,
              pos: 2,
              future_field: { retained: true },
            },
          ],
        },
        {
          headers: {
            "X-RateLimit-Limit": "30",
            "X-RateLimit-Remaining": "29",
            "Retry-After": "4",
          },
        },
      ),
    );

    const response = await client.page({ coreId: 42, page: 3 });

    expect(response.result).toEqual([
      expect.objectContaining({
        hid: 42,
        rid: "race-1",
        future_field: { retained: true },
      }),
    ]);
    expect(response.rateLimit).toMatchObject({
      limit: 30,
      remaining: 29,
      retryAfterSeconds: 4,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    const call = transport.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe(DNA_CORE_RACE_HISTORY_URL);
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(String(init.body))).toEqual({ hid: 42, page: 3 });
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
  });

  it("treats an error body as authoritative even with an unusual HTTP success code", async () => {
    const { client } = clientWith(
      jsonResponse(
        { status: "error", err: "private provider detail" },
        { status: 305 },
      ),
    );

    await expect(client.page({ coreId: 1, page: 1 })).rejects.toMatchObject({
      kind: "api_error",
      httpStatus: 305,
      message: "DNA Core race history returned an API error",
    });
  });

  it("honours HTTP 429 and exposes retry metadata without retrying", async () => {
    const { client, transport } = clientWith(
      jsonResponse(
        { status: "success", result: [] },
        { status: 429, headers: { "Retry-After": "21" } },
      ),
    );

    await expect(client.page({ coreId: 1, page: 1 })).rejects.toMatchObject({
      kind: "rate_limited",
      httpStatus: 429,
      rateLimit: { retryAfterSeconds: 21 },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("fails closed on non-JSON, invalid envelopes and non-record rows", async () => {
    const nonJsonTransport = vi.fn(async () => new Response("not json"));
    const nonJson = createDnaCoreRaceHistoryClient({
      transport: nonJsonTransport,
    });
    await expect(nonJson.page({ coreId: 1, page: 1 })).rejects.toMatchObject({
      kind: "malformed_response",
    });

    const malformed = clientWith(jsonResponse({ status: "success" }));
    await expect(
      malformed.client.page({ coreId: 1, page: 1 }),
    ).rejects.toMatchObject({ kind: "malformed_response" });

    const badRow = clientWith(
      jsonResponse({ status: "success", result: ["not-a-record"] }),
    );
    await expect(
      badRow.client.page({ coreId: 1, page: 1 }),
    ).rejects.toMatchObject({ kind: "malformed_response" });
  });

  it("validates HTTPS and positive request identities before transport", async () => {
    expect(() =>
      createDnaCoreRaceHistoryClient({ endpointUrl: "http://example.test" }),
    ).toThrowError(expect.objectContaining({ kind: "invalid_configuration" }));

    const { client, transport } = clientWith(
      jsonResponse({ status: "success", result: [] }),
    );
    await expect(client.page({ coreId: 0, page: 1 })).rejects.toMatchObject({
      kind: "invalid_request",
    });
    await expect(client.page({ coreId: 1, page: 0 })).rejects.toMatchObject({
      kind: "invalid_request",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("replaces transport failures with a content-free error", async () => {
    const client = createDnaCoreRaceHistoryClient({
      transport: vi.fn(async () => {
        throw new Error("private network detail");
      }),
    });

    await expect(client.page({ coreId: 1, page: 1 })).rejects.toMatchObject({
      kind: "transport_error",
      message: "DNA Core race history transport is unavailable",
    });
  });
});
