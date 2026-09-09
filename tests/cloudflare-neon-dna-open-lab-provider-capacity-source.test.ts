import { describe, expect, it, vi } from "vitest";

import {
  cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment,
  createCloudflareNeonDnaOpenLabProviderCapacitySource,
} from "@/lib/cloudflare-neon-dna-open-lab-provider-capacity-source";
import { DnaOpenLabProviderCapacityMeasurementError } from "@/lib/dna-open-lab-provider-capacity-preflight";

const accountId = "a".repeat(32);
const measuredAt = new Date("2026-09-09T01:12:34.000Z");

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function cloudflareData(actionType = "PutObject") {
  return {
    errors: null,
    data: {
      viewer: {
        accounts: [
          {
            r2OperationsAdaptiveGroups: [
              { sum: { requests: 35_000 }, dimensions: { actionType } },
              {
                sum: { requests: 105_000 },
                dimensions: { actionType: "GetObject" },
              },
              {
                sum: { requests: 4 },
                dimensions: { actionType: "DeleteObject" },
              },
            ],
            r2StorageAdaptiveGroups: [
              {
                max: {
                  payloadSize: 874_000_000,
                  metadataSize: 370_990,
                },
              },
            ],
          },
        ],
      },
    },
  };
}

function neonData(overrides: Record<string, unknown> = {}) {
  return {
    project: {
      id: "project-1",
      consumption_period_start: "2026-09-05T00:00:00.000Z",
      consumption_period_end: "2026-10-05T00:00:00.000Z",
      synthetic_storage_size: 28_082_176,
      compute_time_seconds: 18_001,
      owner_id: "private-provider-identifier",
      ...overrides,
    },
  };
}

function source(
  input: {
    fetch?: typeof globalThis.fetch;
    now?: () => Date;
    storageClass?: string;
  } = {},
) {
  const fetcher =
    input.fetch ??
    vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(cloudflareData()))
      .mockResolvedValueOnce(response(neonData()));
  return {
    fetcher,
    value: createCloudflareNeonDnaOpenLabProviderCapacitySource({
      authorizedOwnerId: "owner-1",
      cloudflareAccountId: accountId,
      cloudflareAnalyticsApiToken: "cloudflare-analytics-read-token",
      r2BucketName: "dna-private-evidence",
      r2StorageClass: input.storageClass ?? "Standard",
      neonApiKey: "neon-read-token",
      neonProjectId: "project-1",
      now: input.now ?? (() => measuredAt),
      fetch: fetcher,
    }),
  };
}

describe("Cloudflare and Neon DNA Open Lab provider capacity source", () => {
  it("returns only owner-safe normalized provider totals and exact windows", async () => {
    const fixture = source();
    if (fixture.value.status !== "ready") throw new Error("expected source");

    const result = await fixture.value.measure({ ownerId: "owner-1" });
    expect(result).toEqual({
      evidenceSource: "provider_api",
      r2StorageClass: "Standard",
      measuredAt: measuredAt.toISOString(),
      billingWindowStartAt: "2026-09-01T00:00:00.000Z",
      billingWindowEndAt: "2026-10-01T00:00:00.000Z",
      currentR2Usage: {
        storageBytes: 874_370_990,
        classAOperations: 35_000,
        classBOperations: 105_000,
      },
      neonMeasuredAt: measuredAt.toISOString(),
      neonBillingWindowStartAt: "2026-09-05T00:00:00.000Z",
      neonBillingWindowEndAt: "2026-10-05T00:00:00.000Z",
      currentNeonUsage: {
        storageBytes: 28_082_176,
        computeMilliCuHours: 5_001,
      },
    });
    expect(fixture.fetcher).toHaveBeenCalledTimes(2);
    const cloudflareCall = vi.mocked(fixture.fetcher).mock.calls[0]!;
    expect(cloudflareCall[0]).toBe(
      "https://api.cloudflare.com/client/v4/graphql",
    );
    const cloudflareRequest = cloudflareCall[1]!;
    expect(cloudflareRequest).toMatchObject({
      method: "POST",
      cache: "no-store",
    });
    expect(JSON.parse(String(cloudflareRequest.body)).variables).toEqual({
      accountTag: accountId,
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: measuredAt.toISOString(),
      bucketName: "dna-private-evidence",
    });
    expect(vi.mocked(fixture.fetcher).mock.calls[1]?.[0]).toBe(
      "https://console.neon.tech/api/v2/projects/project-1",
    );
    expect(JSON.stringify(result)).not.toMatch(
      /cloudflare-analytics-read-token|neon-read-token|private-provider-identifier/u,
    );
  });

  it("denies another owner before either provider is contacted", async () => {
    const fixture = source();
    if (fixture.value.status !== "ready") throw new Error("expected source");
    await expect(fixture.value.measure({ ownerId: "owner-2" })).rejects.toThrow(
      "owner scope denied",
    );
    expect(fixture.fetcher).not.toHaveBeenCalled();
  });

  it("reports the configured storage class so the projection can block it", async () => {
    const fixture = source({ storageClass: "InfrequentAccess" });
    if (fixture.value.status !== "ready") throw new Error("expected source");
    await expect(
      fixture.value.measure({ ownerId: "owner-1" }),
    ).resolves.toMatchObject({ r2StorageClass: "InfrequentAccess" });
  });

  it("accepts an empty GraphQL errors array only with valid provider data", async () => {
    const cloudflare = { ...cloudflareData(), errors: [] };
    const valid = source({
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response(cloudflare))
        .mockResolvedValueOnce(response(neonData())),
    });
    if (valid.value.status !== "ready") throw new Error("expected source");
    await expect(
      valid.value.measure({ ownerId: "owner-1" }),
    ).resolves.toMatchObject({
      currentR2Usage: { storageBytes: 874_370_990 },
    });

    const missingData = source({
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response({ errors: [] }))
        .mockResolvedValueOnce(response(neonData())),
    });
    if (missingData.value.status !== "ready")
      throw new Error("expected source");
    await expect(
      missingData.value.measure({ ownerId: "owner-1" }),
    ).rejects.toMatchObject({ failureId: "cloudflare_graphql_rejected" });
  });

  it.each([
    [
      "unknown R2 action",
      cloudflareData("UnknownAction"),
      neonData(),
      "cloudflare_usage_invalid",
    ],
    [
      "duplicate R2 action",
      {
        data: {
          viewer: {
            accounts: [
              {
                r2OperationsAdaptiveGroups: [
                  {
                    sum: { requests: 1 },
                    dimensions: { actionType: "PutObject" },
                  },
                  {
                    sum: { requests: 2 },
                    dimensions: { actionType: "PutObject" },
                  },
                ],
                r2StorageAdaptiveGroups: [],
              },
            ],
          },
        },
      },
      neonData(),
      "cloudflare_usage_invalid",
    ],
    [
      "project drift",
      cloudflareData(),
      neonData({ id: "project-2" }),
      "neon_usage_invalid",
    ],
    [
      "missing project storage",
      cloudflareData(),
      neonData({ synthetic_storage_size: undefined }),
      "neon_usage_invalid",
    ],
    [
      "invalid Neon window",
      cloudflareData(),
      neonData({
        consumption_period_end: "2026-09-05T00:00:00.000Z",
      }),
      "neon_usage_invalid",
    ],
  ])("fails closed on %s", async (_label, cloudflare, neon, failureId) => {
    const fixture = source({
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response(cloudflare))
        .mockResolvedValueOnce(response(neon)),
    });
    if (fixture.value.status !== "ready") throw new Error("expected source");
    await expect(
      fixture.value.measure({ ownerId: "owner-1" }),
    ).rejects.toMatchObject({
      message: "Provider capacity measurement failed.",
      failureId,
    });
  });

  it("sanitizes and classifies provider errors and non-success responses", async () => {
    const fixture = source({
      fetch: vi.fn(async () => {
        throw new Error("secret provider URL and token detail");
      }),
    });
    if (fixture.value.status !== "ready") throw new Error("expected source");
    const transportFailure = await fixture.value
      .measure({ ownerId: "owner-1" })
      .catch((error: unknown) => error);
    expect(transportFailure).toBeInstanceOf(
      DnaOpenLabProviderCapacityMeasurementError,
    );
    expect(transportFailure).toMatchObject({
      failureId: "cloudflare_transport_failed",
    });
    expect(String(transportFailure)).not.toMatch(
      /secret provider URL|token detail/u,
    );

    const rejected = source({
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response({ error: "private" }, 403))
        .mockResolvedValueOnce(response(neonData())),
    });
    if (rejected.value.status !== "ready") throw new Error("expected source");
    await expect(
      rejected.value.measure({ ownerId: "owner-1" }),
    ).rejects.toMatchObject({ failureId: "cloudflare_http_rejected" });

    const graphqlCases = [
      [
        "not authorized for that account",
        "cloudflare_graphql_authorization_rejected",
      ],
      [
        "unknown field privateProviderField",
        "cloudflare_graphql_query_rejected",
      ],
      [
        "query time range is too large for private plan",
        "cloudflare_graphql_dataset_limit_rejected",
      ],
      [
        "rate limiter budget depleted, try again later",
        "cloudflare_graphql_rate_limited",
      ],
      [
        "unable to execute query, please try again later",
        "cloudflare_graphql_unavailable",
      ],
      [
        "access denied by private provider scope",
        "cloudflare_graphql_authorization_rejected",
      ],
      [
        "private dataset time window rejected",
        "cloudflare_graphql_dataset_limit_rejected",
      ],
      [
        "private variable validation failed",
        "cloudflare_graphql_query_rejected",
      ],
      ["private request throttled", "cloudflare_graphql_rate_limited"],
      [
        "private provider temporarily unavailable",
        "cloudflare_graphql_unavailable",
      ],
      ["private provider diagnostic", "cloudflare_graphql_rejected"],
    ] as const;
    for (const [privateMessage, failureId] of graphqlCases) {
      const graphqlRejected = source({
        fetch: vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValueOnce(
            response({ data: null, errors: [{ message: privateMessage }] }),
          )
          .mockResolvedValueOnce(response(neonData())),
      });
      if (graphqlRejected.value.status !== "ready") {
        throw new Error("expected source");
      }
      const graphqlFailure = await graphqlRejected.value
        .measure({ ownerId: "owner-1" })
        .catch((error: unknown) => error);
      expect(graphqlFailure).toMatchObject({ failureId });
      expect(String(graphqlFailure)).not.toContain(privateMessage);
    }
  });

  it("rejects malformed configuration and time before provider access", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    expect(() =>
      createCloudflareNeonDnaOpenLabProviderCapacitySource({
        authorizedOwnerId: "owner-1",
        cloudflareAccountId: "invalid",
        cloudflareAnalyticsApiToken: "token",
        r2BucketName: "bucket",
        r2StorageClass: "Standard",
        neonApiKey: "token",
        neonProjectId: "project-1",
        fetch: fetcher,
      }),
    ).toThrow("cloudflareAccountId is invalid");
    expect(fetcher).not.toHaveBeenCalled();

    const invalidTime = source({ now: () => new Date("invalid") });
    if (invalidTime.value.status !== "ready") {
      throw new Error("expected source");
    }
    await expect(
      invalidTime.value.measure({ ownerId: "owner-1" }),
    ).rejects.toThrow("measurement failed");
    expect(invalidTime.fetcher).not.toHaveBeenCalled();
  });

  it("fails closed without a complete server environment", () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    expect(
      cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment(
        {
          authorizedOwnerId: "owner-1",
          cloudflareAccountId: accountId,
          cloudflareAnalyticsApiToken: "cloudflare-analytics-read-token",
          r2BucketName: "dna-private-evidence",
          r2StorageClass: "Standard",
          neonApiKey: "neon-read-token",
        },
        { fetch: fetcher },
      ),
    ).toEqual({ status: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("composes the strict source from a complete server environment", async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(cloudflareData()))
      .mockResolvedValueOnce(response(neonData()));
    const value = cloudflareNeonDnaOpenLabProviderCapacitySourceFromEnvironment(
      {
        authorizedOwnerId: "owner-1",
        cloudflareAccountId: accountId,
        cloudflareAnalyticsApiToken: "cloudflare-analytics-read-token",
        r2BucketName: "dna-private-evidence",
        r2StorageClass: "Standard",
        neonApiKey: "neon-read-token",
        neonProjectId: "project-1",
      },
      { fetch: fetcher, now: () => measuredAt },
    );
    if (value.status !== "ready") throw new Error("expected source");
    await expect(value.measure({ ownerId: "owner-1" })).resolves.toMatchObject({
      evidenceSource: "provider_api",
      r2StorageClass: "Standard",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
