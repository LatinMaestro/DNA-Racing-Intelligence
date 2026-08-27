import { describe, expect, it } from "vitest";

import {
  createDnaOpenLabV1SpliceDocumentPostClient,
  type DnaOpenLabSpliceDocumentPostClient,
} from "../lib/dna-open-lab-v1-splice-doc-post-client";
import type { DnaOpenLabTransport } from "../lib/dna-open-lab-v1-client";

const API_KEY = `dna_${"a".repeat(43)}`;

function response(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function createClient(
  transport: DnaOpenLabTransport,
): DnaOpenLabSpliceDocumentPostClient {
  return createDnaOpenLabV1SpliceDocumentPostClient({
    apiKey: API_KEY,
    transport,
  });
}

describe("DNA Open Lab splice document POST client", () => {
  it("posts reqid with Bearer auth to the documented endpoint", async () => {
    let observedUrl = "";
    let observedInit: RequestInit | undefined;
    const client = createClient(async (url, init) => {
      observedUrl = url;
      observedInit = init;
      return response(
        {
          status: "success",
          result: {
            reqid: "request-1",
            hid: null,
            minted: false,
            minted_at: null,
            requested_at: "2026-08-27T00:00:00Z",
            payment_tx: null,
            found_payment_tx: null,
            info: {},
            request: {},
            alw_list: [],
            transfers: [],
            errmsg: null,
            retry: null,
            next_retry: null,
            future_optional_field: true,
          },
        },
        200,
        {
          "X-RateLimit-Limit": "30",
          "X-RateLimit-Remaining": "29",
          "X-RateLimit-Reset": "15",
          "X-RateLimit-Class": "api_key",
        },
      );
    });

    const result = await client.spliceDocumentPost("request-1");
    expect(observedUrl).toBe(
      "https://api.dnaracing.run/fbike/pub/v1/splice/doc",
    );
    expect(observedInit?.method).toBe("POST");
    expect(new Headers(observedInit?.headers).get("Authorization")).toBe(
      `Bearer ${API_KEY}`,
    );
    expect(observedInit?.body).toBe(JSON.stringify({ reqid: "request-1" }));
    expect(result.result.reqid).toBe("request-1");
    expect(result.rateLimit).toMatchObject({
      limit: 30,
      remaining: 29,
      rateClass: "api_key",
    });
  });

  it("treats the DNA body error envelope as authoritative even on HTTP 305", async () => {
    const client = createClient(async () =>
      response({ status: "error", err: "forbidden" }, 305, {
        "X-RateLimit-Limit": "30",
      }),
    );

    await expect(client.spliceDocumentPost("request-1")).rejects.toMatchObject({
      name: "DnaOpenLabApiError",
      kind: "api_error",
      httpStatus: 305,
    });
  });

  it("surfaces 429 rate metadata without retrying", async () => {
    let calls = 0;
    const client = createClient(async () => {
      calls += 1;
      return response({ status: "error", err: "rate limited" }, 429, {
        "Retry-After": "22",
        "X-RateLimit-Remaining": "0",
      });
    });

    await expect(client.spliceDocumentPost("request-1")).rejects.toMatchObject({
      kind: "rate_limited",
      httpStatus: 429,
      rateLimit: expect.objectContaining({
        remaining: 0,
        retryAfterSeconds: 22,
      }),
    });
    expect(calls).toBe(1);
  });

  it("rejects unsafe request ids and key configuration before transport", async () => {
    let calls = 0;
    const client = createClient(async () => {
      calls += 1;
      return response({ status: "success", result: {} });
    });

    await expect(client.spliceDocumentPost("   ")).rejects.toMatchObject({
      kind: "invalid_request",
    });
    expect(calls).toBe(0);

    expect(() =>
      createDnaOpenLabV1SpliceDocumentPostClient({
        apiKey: "not-a-key",
        transport: async () => response({ status: "success", result: {} }),
      }),
    ).toThrow("API key format");
  });
});
