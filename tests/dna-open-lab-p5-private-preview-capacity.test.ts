import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { runDnaOpenLabP5PrivatePreviewCapacityMeasurement } from "@/lib/dna-open-lab-p5-private-preview-capacity";
import { DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES } from "@/lib/neon-dna-open-lab-p5-capacity-port";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";
import { createP5SyntheticCycleFixture } from "./helpers/dna-open-lab-p5-synthetic-cycle-fixture";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "owner-1";
const bucketName = "dna-private-preview";

function fixture(input: { relationCount?: number } = {}) {
  const databaseSizes = [20_000_000, 120_000_000, 80_000_000];
  const query = vi.fn<NeonImportPersistenceClient["query"]>();
  query.mockImplementation(async (statement) => {
    if (statement.includes("BEGIN")) return { rows: [] };
    if (statement.includes("set_config")) {
      return { rows: [{ owner_scope: databaseOwnerId }] };
    }
    if (statement.includes("FROM dna.app_owner")) {
      return {
        rows: [
          {
            database_owner_id: databaseOwnerId,
            authenticated_owner_id: ownerId,
            session_user_name: "dna_app_runtime",
            current_user_name: "dna_app_runtime",
            runtime_is_superuser: false,
            runtime_bypasses_rls: false,
            runtime_can_create_roles: false,
            runtime_can_create_databases: false,
            runtime_can_create_in_database: false,
            runtime_can_create_in_schema: false,
            runtime_is_neon_superuser_member: false,
          },
        ],
      };
    }
    if (statement.includes("server_version_num")) {
      return { rows: [{ server_version_num: "180001" }] };
    }
    if (statement.includes("pg_database_size")) {
      const storage_bytes = databaseSizes.shift();
      if (storage_bytes === undefined) throw new Error("no size remains");
      return { rows: [{ storage_bytes: String(storage_bytes) }] };
    }
    if (statement.includes("pg_catalog.pg_class")) {
      return {
        rows: [
          {
            relation_count: String(
              input.relationCount ??
                DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES.length,
            ),
            heap_bytes: "45000000",
            index_bytes: "20000000",
            toast_bytes: "5000000",
          },
        ],
      };
    }
    if (statement === "COMMIT" || statement === "ROLLBACK") return { rows: [] };
    throw new Error("unexpected query");
  });
  const close = vi.fn(async () => undefined);
  const sessionFactory = vi.fn<NeonImportPersistenceSessionFactory>(
    async () => ({
      client: { query },
      close,
    }),
  );

  const ownerPrefix = createHash("sha256")
    .update(`dna-open-lab-owner\u0000${ownerId}`, "utf8")
    .digest("hex");
  const list = vi.fn(async () => ({
    objects: [
      {
        key: `dna-open-lab/v1/${ownerPrefix}/current-state/cycle.json`,
        version: "version-1",
        etag: "etag-1",
        size: 1_000_000,
        customMetadata: { checksum: "a".repeat(64) },
      },
    ],
    truncated: false as const,
  }));
  const readBucketPrivacy = vi.fn(async () => ({
    publicAccessDisabled: true,
    r2DevDisabled: true,
    customDomainCount: 0,
  }));
  const synthetic = createP5SyntheticCycleFixture({
    codeHeadSha: "a".repeat(40),
    measuredAt: "2026-08-28T20:00:00.000Z",
    ownerId,
    databaseOwnerId,
    databaseUrl: "postgresql://runtime:secret@preview.invalid/dna",
    runtimeRole: "dna_app_runtime",
    bucketName,
  });
  let connectedSessionCount = 0;
  const connectedSessionFactory = vi.fn<NeonImportPersistenceSessionFactory>(
    async (url) => {
      connectedSessionCount += 1;
      return connectedSessionCount === 3 || connectedSessionCount === 7
        ? synthetic.configuration.sessionFactory!(url)
        : sessionFactory(url);
    },
  );

  const configuration = {
    codeHeadSha: "a".repeat(40),
    planChecksum: "b".repeat(64),
    measurementAuthorityRef: "private-preview:capacity/1",
    measuredAt: "2026-08-28T20:00:00.000Z",
    neon: {
      authorizedOwnerId: ownerId,
      databaseOwnerId,
      databaseUrl: "postgresql://runtime:secret@preview.invalid/dna",
      runtimeRole: "dna_app_runtime",
      sessionFactory: connectedSessionFactory,
    },
    r2: {
      ownerId,
      bucketName,
      bucket: { list },
      readBucketPrivacy,
    },
    syntheticR2Storage: synthetic.configuration.r2Storage,
    projectedMonthlyClassAOperations: 100,
    projectedMonthlyClassBOperations: 200,
    priceAuthorityRef: "provider-price-snapshot-2026-08-28",
    priceEffectiveAt: "2026-08-28T00:00:00.000Z",
    bytesPerBillableGb: 1_000_000_000,
    storageMicroUsdPerGbMonth: 15_000,
    classAMicroUsdPerMillion: 4_500_000,
    classBMicroUsdPerMillion: 360_000,
  } as const;
  return {
    configuration,
    query,
    close,
    sessionFactory,
    list,
    readBucketPrivacy,
    synthetic,
  };
}

describe("DNA Open Lab P5 private Preview capacity composition", () => {
  it("fixes connected scope and composes only guarded provider adapters", async () => {
    const test = fixture();

    await expect(
      runDnaOpenLabP5PrivatePreviewCapacityMeasurement(test.configuration),
    ).resolves.toMatchObject({
      providerScope: "private_preview",
      postgresMajorVersion: 18,
      postgres: {
        baselineDatabaseBytes: 20_000_000,
        peakDatabaseBytes: 120_000_000,
        settledDatabaseBytes: 80_000_000,
        ownerPhysicalBytes: 70_000_000,
        positivePeakHeadroom: true,
      },
      r2: {
        retainedObjectCount: 1,
        retainedPayloadBytes: 1_000_000,
      },
      connectedCapacityEvidenceComplete: true,
      readyToUpdateP5CapacityRows: true,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
    });

    expect(test.sessionFactory).toHaveBeenCalledTimes(5);
    expect(test.close).toHaveBeenCalledTimes(5);
    const relationQuery = test.query.mock.calls.find(([sql]) =>
      sql.includes("pg_catalog.pg_class"),
    );
    expect(relationQuery?.[1]).toEqual([DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES]);
    expect(test.readBucketPrivacy).toHaveBeenCalledExactlyOnceWith({
      bucketName,
    });
    expect(test.list).toHaveBeenCalledOnce();
    expect(test.synthetic.putObjectIfAbsent).toHaveBeenCalledOnce();
    expect(test.synthetic.deleteObject).toHaveBeenCalledOnce();
    expect(
      test.synthetic.query.mock.calls.some(([sql]) => sql === "ROLLBACK"),
    ).toBe(true);
  });

  it("rejects incomplete canonical relation coverage and still cleans", async () => {
    const test = fixture({
      relationCount: DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES.length - 1,
    });

    await expect(
      runDnaOpenLabP5PrivatePreviewCapacityMeasurement(test.configuration),
    ).rejects.toThrow("measurement failed");
    expect(test.synthetic.deleteObject).toHaveBeenCalledOnce();
    expect(test.list).not.toHaveBeenCalled();
  });
});
