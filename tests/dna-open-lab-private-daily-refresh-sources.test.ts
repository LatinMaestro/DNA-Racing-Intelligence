import { describe, expect, it, vi } from "vitest";

import type { DnaOpenLabProviderCapacityMeasurementSource } from "@/lib/dna-open-lab-provider-capacity-preflight";
import {
  createMeteredDnaOpenLabR2EvidenceStorage,
  dnaOpenLabPrivateDailyRefreshSourcesFromEnvironment,
  type DnaOpenLabPrivateDailyRefreshSourceEnvironment,
} from "@/lib/dna-open-lab-private-daily-refresh-sources";
import type { DnaOpenLabResponse } from "@/lib/dna-open-lab-v1-client";
import type { createCloudflareR2DatasetEvidencePort } from "@/lib/cloudflare-r2-dataset-evidence-port";

type EvidenceStorage = ReturnType<typeof createCloudflareR2DatasetEvidencePort>;

function environment(): Required<DnaOpenLabPrivateDailyRefreshSourceEnvironment> {
  return {
    authorizedOwnerId: "private-owner",
    cloudflareAccountId: "a".repeat(32),
    cloudflareApiToken: "private-cloudflare-token",
    cloudflareAnalyticsApiToken: "private-analytics-token",
    dnaOpenLabApiKey1: `dna_${"a".repeat(43)}`,
    dnaOpenLabApiKey2: `dna_${"b".repeat(43)}`,
    dnaOpenLabApiKey3: `dna_${"c".repeat(43)}`,
    neonApiKey: "private-neon-token",
    neonProjectId: "quiet-test-12345678",
    r2AccessKeyId: "private-r2-access-key",
    r2BucketName: "dna-racing-import-preview",
    r2SecretAccessKey: "private-r2-secret-key",
    r2StorageClass: "Standard",
  };
}

function storage() {
  return {
    readBucketPrivacy: vi.fn(async () => ({
      publicAccessDisabled: true,
      r2DevDisabled: true,
      customDomainCount: 0,
    })),
    putObjectIfAbsent: vi.fn(async () => ({ status: "created" as const })),
    headObject: vi.fn(),
    getObject: vi.fn(),
    deleteObject: vi.fn(),
  } as unknown as EvidenceStorage;
}

function measurementSource(): Extract<
  DnaOpenLabProviderCapacityMeasurementSource,
  { status: "ready" }
> {
  return {
    status: "ready",
    measure: vi.fn(),
  };
}

function response<T>(result: T): DnaOpenLabResponse<T> {
  return Object.freeze({
    result,
    httpStatus: 200,
    rateLimit: {
      limit: 150,
      remaining: 149,
      resetSeconds: 1,
      rateClass: "api_key",
      retryAfterSeconds: null,
    },
  });
}

describe("DNA Open Lab private daily refresh hosted sources", () => {
  it("stays unavailable until every hosted credential and identity exists", () => {
    expect(dnaOpenLabPrivateDailyRefreshSourcesFromEnvironment({})).toEqual({
      status: "not_configured",
    });
    const missingNeonProject = Object.fromEntries(
      Object.entries(environment()).filter(
        ([name]) => name !== "neonProjectId",
      ),
    ) as DnaOpenLabPrivateDailyRefreshSourceEnvironment;
    expect(
      dnaOpenLabPrivateDailyRefreshSourcesFromEnvironment(missingNeonProject, {
        storage: storage(),
        providerCapacityMeasurementSource: measurementSource(),
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("rejects duplicate API keys before creating a usable runtime", () => {
    const configured = environment();
    expect(() =>
      dnaOpenLabPrivateDailyRefreshSourcesFromEnvironment(
        {
          ...configured,
          dnaOpenLabApiKey3: configured.dnaOpenLabApiKey2,
        },
        {
          storage: storage(),
          providerCapacityMeasurementSource: measurementSource(),
        },
      ),
    ).toThrow("requires three distinct API keys");
  });

  it("composes without network or provider writes and fixes every API family to one aggregate 30-rpm pool", async () => {
    const evidenceStorage = storage();
    const providerMeasurement = measurementSource();
    const transport = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "success", result: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const runtime = dnaOpenLabPrivateDailyRefreshSourcesFromEnvironment(
      environment(),
      {
        storage: evidenceStorage,
        providerCapacityMeasurementSource: providerMeasurement,
        transport,
      },
    );
    expect(runtime.status).toBe("ready");
    if (runtime.status !== "ready") throw new Error("expected ready runtime");
    expect(transport).not.toHaveBeenCalled();
    expect(providerMeasurement.measure).not.toHaveBeenCalled();
    expect(evidenceStorage.putObjectIfAbsent).not.toHaveBeenCalled();
    expect(runtime.sources.currentStatePool.snapshot()).toMatchObject({
      independentRateBucketsEnabled: false,
      aggregateBudget: { effectiveRequestsPerMinute: 30 },
      lanes: [
        { id: "key-1", budget: { effectiveRequestsPerMinute: 30 } },
        { id: "key-2", budget: { effectiveRequestsPerMinute: 30 } },
        { id: "key-3", budget: { effectiveRequestsPerMinute: 30 } },
      ],
    });
    expect(runtime.sources.requestBudget.snapshot()).toMatchObject({
      effectiveRequestsPerMinute: 30,
    });

    await runtime.sources.finishedHistoryClient.racesFinished({ limit: 1 });
    await runtime.sources.currentStatePool.execute({
      scope: "vault",
      request: async () => response({ name: "private" }),
    });
    const pool = runtime.sources.currentStatePool.snapshot();
    expect(pool.aggregateBudget?.requestsInCurrentWindow).toBe(2);
    expect(
      pool.lanes.reduce((total, lane) => total + lane.requestCount, 0),
    ).toBe(2);
  });

  it("meters attempted R2 operations conservatively and counts only newly retained bytes", async () => {
    const base = storage();
    vi.mocked(base.putObjectIfAbsent)
      .mockResolvedValueOnce({ status: "created" })
      .mockResolvedValueOnce({ status: "existing" });
    vi.mocked(base.headObject).mockRejectedValueOnce(new Error("synthetic"));
    vi.mocked(base.getObject).mockResolvedValueOnce({
      status: "missing",
    });
    const metered = createMeteredDnaOpenLabR2EvidenceStorage(base);
    const put = {
      bucketName: "private-bucket",
      key: "private-object",
      body: (async function* () {
        yield new Uint8Array([1, 2, 3]);
      })(),
      contentType: "application/json",
      byteLength: 3,
      checksumSha256: "a".repeat(64),
      metadata: {},
    };
    await metered.storage.putObjectIfAbsent(put);
    await metered.storage.putObjectIfAbsent(put);
    await expect(
      metered.storage.headObject({
        bucketName: "private-bucket",
        key: "private-object",
      }),
    ).rejects.toThrow("synthetic");
    await metered.storage.getObject({
      bucketName: "private-bucket",
      key: "private-object",
    });
    expect(metered.measure()).toEqual({
      storageBytes: 3,
      classAOperations: 2,
      classBOperations: 2,
    });
  });
});
