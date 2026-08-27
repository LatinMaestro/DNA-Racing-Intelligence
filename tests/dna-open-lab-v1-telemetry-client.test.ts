import { describe, expect, it, vi } from "vitest";

import {
  createDnaOpenLabV1TelemetryClient,
  type DnaOpenLabTelemetryClient,
} from "../lib/dna-open-lab-v1-telemetry-client";
import {
  DnaOpenLabApiError,
  type DnaOpenLabTransport,
} from "../lib/dna-open-lab-v1-client";

const API_KEY = `dna_${"t".repeat(43)}`;

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

function clientWith(response: Response): {
  client: DnaOpenLabTelemetryClient;
  transport: ReturnType<typeof vi.fn>;
} {
  const transport = vi.fn(
    async () => response,
  ) as unknown as DnaOpenLabTransport;
  const client = createDnaOpenLabV1TelemetryClient({
    apiKey: API_KEY,
    transport,
  });
  return { client, transport: transport as ReturnType<typeof vi.fn> };
}

function requestFrom(transport: ReturnType<typeof vi.fn>) {
  const call = transport.mock.calls[0];
  if (call === undefined) throw new Error("expected DNA telemetry API request");
  const [url, init] = call as [string, RequestInit];
  return { url, init };
}

function expectInvalidRequest(action: () => unknown, message: string) {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({
    name: "DnaOpenLabApiError",
    kind: "invalid_request",
    message,
  });
}

describe("DNA Open Lab v1 telemetry client", () => {
  it("maps the single telemetry endpoint without interpreting its payload", async () => {
    const rawTelemetry = {
      hid: 41,
      future_metric: { nested: [1, 2, 3] },
      unknown_unit: 12.5,
    };
    const { client, transport } = clientWith(
      jsonResponse(
        { status: "success", result: rawTelemetry },
        {
          headers: {
            "X-RateLimit-Limit": "30",
            "X-RateLimit-Remaining": "29",
            "X-RateLimit-Reset": "38",
            "X-RateLimit-Class": "api_key",
          },
        },
      ),
    );

    const response = await client.coreTelemetry(41);

    expect(response.result).toEqual(rawTelemetry);
    expect(response.rateLimit).toEqual({
      limit: 30,
      remaining: 29,
      resetSeconds: 38,
      rateClass: "api_key",
      retryAfterSeconds: null,
    });
    const request = requestFrom(transport);
    expect(request.url).toBe(
      "https://api.dnaracing.run/fbike/pub/v1/cores/41/telemetry",
    );
    expect(request.init.method).toBe("GET");
    expect(new Headers(request.init.headers).get("Authorization")).toBe(
      `Bearer ${API_KEY}`,
    );
    expect(request.url).not.toContain(API_KEY);
  });

  it("maps telemetry bulk to one bounded POST without assuming a response shape", async () => {
    const rawBulk = [{ hid: 11 }, { hid: 12, additive: true }];
    const { client, transport } = clientWith(
      jsonResponse({ status: "success", result: rawBulk }),
    );

    const response = await client.coreTelemetryBulk([11, 12]);

    expect(response.result).toEqual(rawBulk);
    const request = requestFrom(transport);
    expect(request.url).toBe(
      "https://api.dnaracing.run/fbike/pub/v1/cores/telemetry_bulk",
    );
    expect(request.init.method).toBe("POST");
    expect(JSON.parse(String(request.init.body))).toEqual({ hids: [11, 12] });
  });

  it("maps the telemetry benchmark endpoint without inventing semantics", async () => {
    const benchmark = { cohort: "unknown", values: { p50: 1.23 } };
    const { client, transport } = clientWith(
      jsonResponse({ status: "success", result: benchmark }),
    );

    const response = await client.coreTelemetryBenchmark(99);

    expect(response.result).toEqual(benchmark);
    expect(requestFrom(transport).url).toBe(
      "https://api.dnaracing.run/fbike/pub/v1/cores/99/telemetry_benchmark",
    );
  });

  it("fails before transport for invalid core IDs and bulk bounds", () => {
    const transport = vi.fn(async () =>
      jsonResponse({ status: "success", result: {} }),
    ) as unknown as DnaOpenLabTransport;
    const client = createDnaOpenLabV1TelemetryClient({
      apiKey: API_KEY,
      transport,
    });

    expectInvalidRequest(
      () => client.coreTelemetry(0),
      "hid must be a positive safe integer",
    );
    expectInvalidRequest(
      () => client.coreTelemetryBulk([]),
      "hids must contain between 1 and 20 values",
    );
    expectInvalidRequest(
      () =>
        client.coreTelemetryBulk(Array.from({ length: 21 }, (_, i) => i + 1)),
      "hids must contain between 1 and 20 values",
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("preserves authoritative API error envelopes including HTTP 305", async () => {
    const { client } = clientWith(
      jsonResponse(
        {
          status: "error",
          err: 'forbidden: api key missing required scope "cores"',
        },
        { status: 305 },
      ),
    );

    await expect(client.coreTelemetry(7)).rejects.toMatchObject({
      name: "DnaOpenLabApiError",
      kind: "api_error",
      httpStatus: 305,
      message: expect.stringContaining("missing required scope"),
    });
  });

  it("surfaces telemetry rate limiting without retrying blindly", async () => {
    const { client, transport } = clientWith(
      jsonResponse(
        { status: "error", err: "rate limit exceeded" },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": "30",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "17",
            "X-RateLimit-Class": "api_key",
            "Retry-After": "17",
          },
        },
      ),
    );

    await expect(client.coreTelemetryBenchmark(7)).rejects.toMatchObject({
      kind: "rate_limited",
      httpStatus: 429,
      rateLimit: {
        limit: 30,
        remaining: 0,
        resetSeconds: 17,
        rateClass: "api_key",
        retryAfterSeconds: 17,
      },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("validates API key configuration before any telemetry transport call", () => {
    const transport = vi.fn(async () =>
      jsonResponse({ status: "success", result: {} }),
    ) as unknown as DnaOpenLabTransport;

    expect(() =>
      createDnaOpenLabV1TelemetryClient({
        apiKey: "dna_invalid",
        transport,
      }),
    ).toThrowError(DnaOpenLabApiError);
    expect(transport).not.toHaveBeenCalled();
  });
});
