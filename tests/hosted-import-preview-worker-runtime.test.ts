import { describe, expect, it, vi } from "vitest";

import type { ImportPreviewStagingSink } from "../lib/bounded-import-preview-processor";
import type { CloudflareR2ImportObjectStoragePort } from "../lib/cloudflare-r2-import-object-storage";
import {
  hostedImportPreviewWorkerRuntime,
  type HostedImportPreviewWorkerEnvironment,
} from "../lib/hosted-import-preview-worker-runtime";
import type {
  NeonImportPersistenceClient,
  NeonImportPersistenceSessionFactory,
} from "../lib/neon-import-persistence-driver";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";
const ownerId = "owner-1";
const runtimeRole = "dna_app_runtime";
const uploadBatchId = "22222222-2222-4222-8222-222222222222";
const previewDispatchId = "33333333-3333-4333-8333-333333333333";
const uploadFileId = "44444444-4444-4444-8444-444444444444";
const requestFingerprint = "a".repeat(64);
const manifestFingerprint = "b".repeat(64);
const objectFingerprint =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function environment(
  overrides: Partial<HostedImportPreviewWorkerEnvironment> = {},
): HostedImportPreviewWorkerEnvironment {
  return {
    authorizedOwnerId: ownerId,
    workerId: "preview-worker-1",
    database: {
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId,
      runtimeRole,
    },
    r2: {
      accountId: "c".repeat(32),
      bucketName: "dna-private-imports",
      accessKeyId: "r2-access",
      secretAccessKey: "r2-secret",
    },
    cloudflareApiToken: "cloudflare-token",
    leaseDurationMilliseconds: "300000",
    maximumBatchBytes: "1048576",
    maximumObjectBytes: "524288",
    maximumChunkBytes: "65536",
    ...overrides,
  };
}

function isolationEvidence() {
  return {
    database_owner_id: databaseOwnerId,
    authenticated_owner_id: ownerId,
    processing_rls: true,
    processing_force_rls: true,
    prepared_rls: true,
    prepared_force_rls: true,
    session_user_name: runtimeRole,
    current_user_name: runtimeRole,
    runtime_is_superuser: false,
    runtime_bypasses_rls: false,
    runtime_can_create_roles: false,
    runtime_can_create_databases: false,
    runtime_is_neon_superuser_member: false,
  };
}

function sessionHarness(rows: readonly (readonly unknown[])[]) {
  let index = 0;
  const query = vi.fn(async (statement: string) => {
    const normalized = statement.replace(/\s+/g, " ").trim();
    if (
      normalized === "BEGIN ISOLATION LEVEL SERIALIZABLE" ||
      normalized === "COMMIT" ||
      normalized === "ROLLBACK"
    ) {
      return { rows: [] };
    }
    return { rows: rows[index++] ?? [] };
  });
  const client: NeonImportPersistenceClient = { query };
  const sessionFactory = vi.fn(async () => ({
    client,
    close: async () => undefined,
  }));
  return {
    query,
    sessionFactory: sessionFactory as NeonImportPersistenceSessionFactory,
  };
}

function objectPort(): CloudflareR2ImportObjectStoragePort {
  return {
    readBucketPrivacy: vi.fn(async () => ({
      publicAccessDisabled: true,
      r2DevDisabled: true,
      customDomainCount: 0,
    })),
    createPresignedPut: vi.fn(async () => {
      throw new Error("not used");
    }),
    headObject: vi.fn(async () => ({ status: "missing" as const })),
    getObject: vi.fn(async () => ({
      status: "ready" as const,
      advertisedByteLength: 3,
      body: (async function* () {
        yield new Uint8Array([97, 98, 99]);
      })(),
    })),
  };
}

function stagingSink(): ImportPreviewStagingSink {
  return {
    beginObject: vi.fn(async () => ({
      write: vi.fn(async () => undefined),
      commitVerified: vi.fn(async () => ({ stagedId: "stage-1" })),
      abort: vi.fn(async () => undefined),
    })),
    completePreview: vi.fn(async (input) => ({
      previewId: "preview-1",
      previewFingerprintSha256: "d".repeat(64),
      uploadManifestFingerprintSha256:
        input.uploadManifestFingerprintSha256,
      fileCount: input.objects.length,
      sourceFamilyCount: new Set(
        input.objects.map((object) => object.sourceFamily),
      ).size,
      blockingIssueCount: 0,
      confirmable: true,
    })),
    abortPreview: vi.fn(async () => undefined),
  };
}

describe("hosted import Preview worker runtime", () => {
  it("fails closed until provider, capacity, and staging dependencies are complete", () => {
    expect(
      hostedImportPreviewWorkerRuntime({ environment: environment() }),
    ).toEqual({ status: "not_configured" });
    expect(
      hostedImportPreviewWorkerRuntime({
        environment: environment({ maximumChunkBytes: "1048577" }),
        dependencies: { stagingSink: stagingSink() },
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      hostedImportPreviewWorkerRuntime({
        environment: environment({ authorizedOwnerId: undefined }),
        dependencies: { stagingSink: stagingSink() },
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("composes the queue, Neon lease, private R2 stream, bounded sink, and publication", async () => {
    const database = sessionHarness([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [{
        status: "claimed",
        authenticated_owner_id: ownerId,
        upload_batch_id: uploadBatchId,
        upload_request_fingerprint_sha256: requestFingerprint,
        upload_manifest_fingerprint_sha256: manifestFingerprint,
        retry_after: null,
        preview_id: null,
        preview_fingerprint_sha256: null,
        confirmable: null,
        files: [{
          uploadFileId,
          objectId: uploadFileId,
          sourceFamily: "race_merge",
          expectedByteLength: 3,
          expectedSha256: objectFingerprint,
        }],
      }],
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [{
        disposition: "created",
        upload_request_fingerprint_sha256: requestFingerprint,
        upload_manifest_fingerprint_sha256: manifestFingerprint,
        preview_id: "preview-1",
        preview_fingerprint_sha256: "d".repeat(64),
        confirmable: true,
      }],
    ]);
    const sink = stagingSink();
    const runtime = hostedImportPreviewWorkerRuntime({
      environment: environment(),
      dependencies: {
        neonSessionFactory: database.sessionFactory,
        r2Port: objectPort(),
        stagingSink: sink,
        now: () => new Date("2026-08-14T02:00:00.000Z"),
      },
    });
    expect(runtime.status).toBe("ready");
    if (runtime.status !== "ready") throw new Error("runtime unavailable");

    await expect(
      runtime.consume({
        body: {
          version: 1,
          kind: "preview",
          dispatchId: previewDispatchId,
          uploadRequestFingerprint: requestFingerprint,
        },
      }),
    ).resolves.toEqual({
      disposition: "acknowledge",
      reason: "completed",
    });
    expect(sink.beginObject).toHaveBeenCalledOnce();
    expect(sink.completePreview).toHaveBeenCalledOnce();
    expect(database.query).toHaveBeenCalled();
  });

  it("preserves retry disposition while another worker holds the lease", async () => {
    const database = sessionHarness([
      [{ owner_scope: databaseOwnerId }],
      [isolationEvidence()],
      [{
        status: "leased_elsewhere",
        authenticated_owner_id: null,
        upload_batch_id: uploadBatchId,
        upload_request_fingerprint_sha256: requestFingerprint,
        upload_manifest_fingerprint_sha256: manifestFingerprint,
        retry_after: "2026-08-14T02:05:00.000Z",
        preview_id: null,
        preview_fingerprint_sha256: null,
        confirmable: null,
        files: [],
      }],
    ]);
    const sink = stagingSink();
    const runtime = hostedImportPreviewWorkerRuntime({
      environment: environment(),
      dependencies: {
        neonSessionFactory: database.sessionFactory,
        r2Port: objectPort(),
        stagingSink: sink,
      },
    });
    if (runtime.status !== "ready") throw new Error("runtime unavailable");

    await expect(
      runtime.consume({
        body: {
          version: 1,
          kind: "preview",
          dispatchId: previewDispatchId,
          uploadRequestFingerprint: requestFingerprint,
        },
        now: new Date("2026-08-14T02:01:00.000Z"),
      }),
    ).resolves.toEqual({
      disposition: "retry",
      reason: "leased_elsewhere",
      retryAfter: "2026-08-14T02:05:00.000Z",
    });
    expect(sink.beginObject).not.toHaveBeenCalled();
  });
});
