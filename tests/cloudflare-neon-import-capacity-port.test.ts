import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareNeonImportCapacityPort,
  HostedImportCapacityMeasurementError,
} from "../lib/cloudflare-neon-import-capacity-port";

const accountId = "a".repeat(32);
const now = new Date("2026-08-10T02:30:00.000Z");

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function r2Data(actionType = "PutObject") {
  return {
    data: {
      viewer: {
        accounts: [
          {
            r2OperationsAdaptiveGroups: [
              { sum: { requests: 11 }, dimensions: { actionType } },
              {
                sum: { requests: 7 },
                dimensions: { actionType: "HeadObject" },
              },
              {
                sum: { requests: 3 },
                dimensions: { actionType: "DeleteObject" },
              },
            ],
            r2StorageAdaptiveGroups: [
              { max: { payloadSize: 4096, metadataSize: 128 } },
            ],
          },
        ],
      },
    },
  };
}

function ready() {
  const fetcher = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(response(r2Data()))
    .mockResolvedValueOnce(response(r2Data()))
    .mockResolvedValueOnce(
      response({ success: true, result: { backlog_count: 4 } }),
    );
  const readNeonStorageBytes = vi.fn(async () => 8192);
  const port = createCloudflareNeonImportCapacityPort({
    authorizedOwnerId: "owner-1",
    cloudflareAccountId: accountId,
    cloudflareApiToken: "operational-token",
    cloudflareAnalyticsApiToken: "analytics-token",
    r2BucketName: "dna-private-imports",
    queueId: "queue-1",
    now: () => now,
    fetch: fetcher,
    readNeonStorageBytes,
  });
  return { port, fetcher, readNeonStorageBytes };
}

describe("Cloudflare and Neon import capacity port", () => {
  it("measures current hosted usage and projects the bounded upload path", async () => {
    const { port, fetcher, readNeonStorageBytes } = ready();
    await expect(
      port.measureUploadProjection({
        ownerId: "owner-1",
        fileCount: 2,
        totalByteLength: 2048,
        sourceFamilies: ["race_merge"],
      }),
    ).resolves.toEqual({
      evidenceSource: "provider_api",
      measuredAt: now.toISOString(),
      resources: [
        {
          resource: "r2_storage_bytes",
          currentUsage: 4224,
          projectedIncrement: 2048,
        },
        {
          resource: "r2_class_a_operations",
          currentUsage: 11,
          projectedIncrement: 2,
        },
        {
          resource: "r2_class_b_operations",
          currentUsage: 7,
          projectedIncrement: 4,
        },
        {
          resource: "neon_storage_bytes",
          currentUsage: 8192,
          projectedIncrement: 4096,
        },
        {
          resource: "queue_backlog_messages",
          currentUsage: 4,
          projectedIncrement: 1,
        },
      ],
    });
    expect(readNeonStorageBytes).toHaveBeenCalledExactlyOnceWith({
      ownerId: "owner-1",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const operationsCall = fetcher.mock.calls[0]!;
    const storageCall = fetcher.mock.calls[1]!;
    expect(operationsCall[0]).toBe(
      "https://api.cloudflare.com/client/v4/graphql",
    );
    expect(storageCall[0]).toBe(
      "https://api.cloudflare.com/client/v4/graphql",
    );
    for (const graphqlCall of [operationsCall, storageCall]) {
      expect(graphqlCall[1]).toMatchObject({
        method: "POST",
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer analytics-token",
        }),
      });
      const body = JSON.parse(String(graphqlCall[1]?.body)) as {
        query: string;
        variables: Record<string, string>;
      };
      expect(body.variables).toEqual({
        accountTag: accountId,
        startDate: "2026-08-01T00:00:00.000Z",
        endDate: now.toISOString(),
        bucketName: "dna-private-imports",
      });
    }
    expect(
      JSON.parse(String(operationsCall[1]?.body)).query,
    ).toContain("DnaImportCapacityOperations");
    expect(
      JSON.parse(String(storageCall[1]?.body)).query,
    ).toContain("DnaImportCapacityStorage");
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/queue-1/metrics`,
    );
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      method: "GET",
      cache: "no-store",
      headers: expect.objectContaining({
        Authorization: "Bearer operational-token",
      }),
    });
  });

  it("denies another owner before any provider access", async () => {
    const { port, fetcher, readNeonStorageBytes } = ready();
    await expect(
      port.measureUploadProjection({
        ownerId: "other-owner",
        fileCount: 1,
        totalByteLength: 1,
        sourceFamilies: ["core_details"],
      }),
    ).rejects.toThrow("access denied");
    expect(fetcher).not.toHaveBeenCalled();
    expect(readNeonStorageBytes).not.toHaveBeenCalled();
  });

  it("keeps activation fail-closed until persisted preview evidence is bound", async () => {
    const { port, fetcher, readNeonStorageBytes } = ready();
    await expect(
      port.measureActivationProjection({
        ownerId: "owner-1",
        previewId: "preview-1",
      }),
    ).rejects.toThrow("activation capacity measurement is not configured");
    expect(fetcher).not.toHaveBeenCalled();
    expect(readNeonStorageBytes).not.toHaveBeenCalled();
  });

  it("conservatively charges unknown R2 actions against both operation guards", async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(r2Data("FutureBillableAction")))
      .mockResolvedValueOnce(response(r2Data()))
      .mockResolvedValueOnce(
        response({ success: true, result: { backlog_count: 0 } }),
      );
    const port = createCloudflareNeonImportCapacityPort({
      authorizedOwnerId: "owner-1",
      cloudflareAccountId: accountId,
      cloudflareApiToken: "operational-token",
      cloudflareAnalyticsApiToken: "analytics-token",
      r2BucketName: "dna-private-imports",
      queueId: "queue-1",
      now: () => now,
      fetch: fetcher,
      readNeonStorageBytes: async () => 0,
    });

    await expect(
      port.measureUploadProjection({
        ownerId: "owner-1",
        fileCount: 1,
        totalByteLength: 1,
        sourceFamilies: ["core_details"],
      }),
    ).resolves.toMatchObject({
      resources: expect.arrayContaining([
        {
          resource: "r2_class_a_operations",
          currentUsage: 11,
          projectedIncrement: 1,
        },
        {
          resource: "r2_class_b_operations",
          currentUsage: 18,
          projectedIncrement: 2,
        },
      ]),
    });
  });

  it("classifies split R2 operations transport failure without exposing provider detail", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input).endsWith("/client/v4/graphql")) {
        const body = JSON.parse(String(init?.body)) as { query: string };
        if (body.query.includes("DnaImportCapacityOperations")) {
          throw new Error("private provider detail");
        }
        return response(r2Data());
      }
      return response({ success: true, result: { backlog_count: 0 } });
    });
    const port = createCloudflareNeonImportCapacityPort({
      authorizedOwnerId: "owner-1",
      cloudflareAccountId: accountId,
      cloudflareApiToken: "operational-token",
      cloudflareAnalyticsApiToken: "analytics-token",
      r2BucketName: "dna-private-imports",
      queueId: "queue-1",
      now: () => now,
      fetch: fetcher,
      readNeonStorageBytes: async () => 0,
    });

    await expect(
      port.measureUploadProjection({
        ownerId: "owner-1",
        fileCount: 1,
        totalByteLength: 1,
        sourceFamilies: ["current_arena"],
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<HostedImportCapacityMeasurementError>>({
        code: "capacity_r2_operations_transport_failed",
      }),
    );
  });

  it("classifies split R2 storage response failure separately", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input).endsWith("/client/v4/graphql")) {
        const body = JSON.parse(String(init?.body)) as { query: string };
        return body.query.includes("DnaImportCapacityStorage")
          ? response({ data: { viewer: { accounts: [] } } })
          : response(r2Data());
      }
      return response({ success: true, result: { backlog_count: 0 } });
    });
    const port = createCloudflareNeonImportCapacityPort({
      authorizedOwnerId: "owner-1",
      cloudflareAccountId: accountId,
      cloudflareApiToken: "operational-token",
      cloudflareAnalyticsApiToken: "analytics-token",
      r2BucketName: "dna-private-imports",
      queueId: "queue-1",
      now: () => now,
      fetch: fetcher,
      readNeonStorageBytes: async () => 0,
    });

    await expect(
      port.measureUploadProjection({
        ownerId: "owner-1",
        fileCount: 1,
        totalByteLength: 1,
        sourceFamilies: ["race_merge"],
      }),
    ).rejects.toMatchObject({
      code: "capacity_r2_storage_response_invalid",
    });
  });

  it("classifies Queue metrics rejection separately", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (String(input).endsWith("/client/v4/graphql")) {
        return response(r2Data());
      }
      return response({ success: false, errors: [] }, 403);
    });
    const port = createCloudflareNeonImportCapacityPort({
      authorizedOwnerId: "owner-1",
      cloudflareAccountId: accountId,
      cloudflareApiToken: "operational-token",
      cloudflareAnalyticsApiToken: "analytics-token",
      r2BucketName: "dna-private-imports",
      queueId: "queue-1",
      now: () => now,
      fetch: fetcher,
      readNeonStorageBytes: async () => 0,
    });

    await expect(
      port.measureUploadProjection({
        ownerId: "owner-1",
        fileCount: 1,
        totalByteLength: 1,
        sourceFamilies: ["race_merge"],
      }),
    ).rejects.toMatchObject({
      code: "capacity_queue_metrics_http_rejected",
    });
  });

  it("classifies Neon runtime storage measurement failure separately", async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(r2Data()))
      .mockResolvedValueOnce(response(r2Data()))
      .mockResolvedValueOnce(
        response({ success: true, result: { backlog_count: 0 } }),
      );
    const port = createCloudflareNeonImportCapacityPort({
      authorizedOwnerId: "owner-1",
      cloudflareAccountId: accountId,
      cloudflareApiToken: "operational-token",
      cloudflareAnalyticsApiToken: "analytics-token",
      r2BucketName: "dna-private-imports",
      queueId: "queue-1",
      now: () => now,
      fetch: fetcher,
      readNeonStorageBytes: async () => {
        throw new Error("private database detail");
      },
    });

    await expect(
      port.measureUploadProjection({
        ownerId: "owner-1",
        fileCount: 1,
        totalByteLength: 1,
        sourceFamilies: ["race_merge"],
      }),
    ).rejects.toMatchObject({
      code: "capacity_neon_storage_failed",
    });
  });

  it("rejects malformed configuration before provider access", () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    expect(() =>
      createCloudflareNeonImportCapacityPort({
        authorizedOwnerId: "owner-1",
        cloudflareAccountId: "invalid",
        cloudflareApiToken: "operational-token",
        cloudflareAnalyticsApiToken: "analytics-token",
        r2BucketName: "dna-private-imports",
        queueId: "queue-1",
        fetch: fetcher,
        readNeonStorageBytes: async () => 0,
      }),
    ).toThrow("cloudflareAccountId is invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
