import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  DNA_OPEN_LAB_P5_CAPACITY_INVOCATION_AUTHORITY,
  invokeDnaOpenLabP5PrivatePreviewCapacityMeasurement,
} from "@/lib/dna-open-lab-p5-capacity-invocation";
import { DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES } from "@/lib/neon-dna-open-lab-p5-capacity-port";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "@/lib/neon-import-persistence-driver";

const codeHeadSha = "a".repeat(40);
const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "private-owner-do-not-emit";
const databaseUrl =
  "postgresql://runtime:database-secret@preview.invalid/private-database";
const bucketName = "private-bucket-do-not-emit";
const measurementAuthorityRef = "private-measurement-authority-do-not-emit";
const priceAuthorityRef = "private-price-authority-do-not-emit";
const objectKeySuffix = "private-object-key-do-not-emit.json";

function fixture(input: { failDatabaseRead?: boolean } = {}) {
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
      if (input.failDatabaseRead) throw new Error(databaseUrl);
      const storageBytes = databaseSizes.shift();
      if (storageBytes === undefined) throw new Error("no size remains");
      return { rows: [{ storage_bytes: String(storageBytes) }] };
    }
    if (statement.includes("pg_catalog.pg_class")) {
      return {
        rows: [
          {
            relation_count: String(DNA_OPEN_LAB_P5_OWNER_RELATION_NAMES.length),
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
    async () => ({ client: { query }, close }),
  );

  const ownerPrefix = createHash("sha256")
    .update(`dna-open-lab-owner\u0000${ownerId}`, "utf8")
    .digest("hex");
  const list = vi.fn(async () => ({
    objects: [
      {
        key: `dna-open-lab/v1/${ownerPrefix}/${objectKeySuffix}`,
        version: "private-version-do-not-emit",
        etag: "private-etag-do-not-emit",
        size: 1_000_000,
        customMetadata: { checksum: "b".repeat(64) },
      },
    ],
    truncated: false as const,
  }));
  const cleanupSyntheticEvidence = vi.fn(async () => ({
    persistentOwnerDataWriteCount: 0,
    residueObjectCount: 0,
    rawPayloadIncluded: false,
    secretMaterialIncluded: false,
  }));
  const emitEvidence = vi.fn(async (canonicalJson: string) => {
    if (typeof canonicalJson !== "string") throw new Error("invalid evidence");
  });
  const configuration = {
    codeHeadSha,
    planChecksum: "c".repeat(64),
    measurementAuthorityRef,
    measuredAt: "2026-08-28T20:00:00.000Z",
    neon: {
      authorizedOwnerId: ownerId,
      databaseOwnerId,
      databaseUrl,
      runtimeRole: "dna_app_runtime",
      sessionFactory,
    },
    r2: {
      ownerId,
      bucketName,
      bucket: { list },
      readBucketPrivacy: async () => ({
        publicAccessDisabled: true,
        r2DevDisabled: true,
        customDomainCount: 0,
      }),
    },
    runSyntheticCycle: async ({
      captureTransientSample,
    }: {
      captureTransientSample: () => Promise<number>;
    }) => {
      await captureTransientSample();
    },
    cleanupSyntheticEvidence,
    projectedMonthlyClassAOperations: 100,
    projectedMonthlyClassBOperations: 200,
    priceAuthorityRef,
    priceEffectiveAt: "2026-08-28T00:00:00.000Z",
    bytesPerBillableGb: 1_000_000_000,
    storageMicroUsdPerGbMonth: 15_000,
    classAMicroUsdPerMillion: 4_500_000,
    classBMicroUsdPerMillion: 360_000,
  } as const;
  return {
    configuration,
    emitEvidence,
    sessionFactory,
    list,
    cleanupSyntheticEvidence,
  };
}

describe("DNA Open Lab P5 connected capacity invocation", () => {
  it("emits one bounded hash-addressed whitelist record", async () => {
    const test = fixture();

    const evidence = await invokeDnaOpenLabP5PrivatePreviewCapacityMeasurement({
      authority: DNA_OPEN_LAB_P5_CAPACITY_INVOCATION_AUTHORITY,
      expectedCodeHeadSha: codeHeadSha,
      configuration: test.configuration,
      emitEvidence: test.emitEvidence,
    });

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      evidenceKind: "dna_open_lab_p5_private_preview_capacity",
      codeHeadSha,
      providerScope: "private_preview",
      connectedCapacityEvidenceComplete: true,
      readyToUpdateP5CapacityRows: true,
      firstPersistentPrivatePreviewSyncAllowed: false,
      productionChangesAllowed: false,
    });
    expect(evidence.evidenceSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(evidence.measurementAuthoritySha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(evidence.r2.priceAuthoritySha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(test.emitEvidence).toHaveBeenCalledOnce();
    const emitted = test.emitEvidence.mock.calls[0]?.[0] ?? "";
    expect(Buffer.byteLength(emitted, "utf8")).toBeLessThanOrEqual(16_384);
    expect(JSON.parse(emitted)).toEqual(evidence);
    const { evidenceSha256, ...evidenceWithoutChecksum } = evidence;
    expect(evidenceSha256).toBe(
      createHash("sha256")
        .update(JSON.stringify(evidenceWithoutChecksum), "utf8")
        .digest("hex"),
    );
    for (const forbidden of [
      ownerId,
      databaseOwnerId,
      databaseUrl,
      bucketName,
      measurementAuthorityRef,
      priceAuthorityRef,
      objectKeySuffix,
      "private-version-do-not-emit",
      "private-etag-do-not-emit",
    ]) {
      expect(emitted).not.toContain(forbidden);
    }
  });

  it("fails before provider access when authority or exact head is wrong", async () => {
    const test = fixture();
    await expect(
      invokeDnaOpenLabP5PrivatePreviewCapacityMeasurement({
        authority:
          "wrong" as typeof DNA_OPEN_LAB_P5_CAPACITY_INVOCATION_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        configuration: test.configuration,
        emitEvidence: test.emitEvidence,
      }),
    ).rejects.toThrow("capacity invocation failed");
    await expect(
      invokeDnaOpenLabP5PrivatePreviewCapacityMeasurement({
        authority: DNA_OPEN_LAB_P5_CAPACITY_INVOCATION_AUTHORITY,
        expectedCodeHeadSha: "d".repeat(40),
        configuration: test.configuration,
        emitEvidence: test.emitEvidence,
      }),
    ).rejects.toThrow("capacity invocation failed");
    expect(test.sessionFactory).not.toHaveBeenCalled();
    expect(test.list).not.toHaveBeenCalled();
    expect(test.cleanupSyntheticEvidence).not.toHaveBeenCalled();
    expect(test.emitEvidence).not.toHaveBeenCalled();
  });

  it("sanitizes provider and emitter failures", async () => {
    const providerFailure = fixture({ failDatabaseRead: true });
    await expect(
      invokeDnaOpenLabP5PrivatePreviewCapacityMeasurement({
        authority: DNA_OPEN_LAB_P5_CAPACITY_INVOCATION_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        configuration: providerFailure.configuration,
        emitEvidence: providerFailure.emitEvidence,
      }),
    ).rejects.toThrow(
      "DNA Open Lab P5 private Preview capacity invocation failed.",
    );
    expect(providerFailure.cleanupSyntheticEvidence).toHaveBeenCalledOnce();
    expect(providerFailure.emitEvidence).not.toHaveBeenCalled();

    const emitterFailure = fixture();
    emitterFailure.emitEvidence.mockRejectedValueOnce(new Error(databaseUrl));
    await expect(
      invokeDnaOpenLabP5PrivatePreviewCapacityMeasurement({
        authority: DNA_OPEN_LAB_P5_CAPACITY_INVOCATION_AUTHORITY,
        expectedCodeHeadSha: codeHeadSha,
        configuration: emitterFailure.configuration,
        emitEvidence: emitterFailure.emitEvidence,
      }),
    ).rejects.toThrow(
      "DNA Open Lab P5 private Preview capacity invocation failed.",
    );
    expect(emitterFailure.emitEvidence).toHaveBeenCalledOnce();
  });
});
