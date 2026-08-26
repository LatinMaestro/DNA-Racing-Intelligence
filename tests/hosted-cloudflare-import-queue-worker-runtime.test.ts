import { describe, expect, it, vi } from "vitest";

import {
  hostedCloudflareImportQueueWorkerRuntime,
  type HostedCloudflareImportQueueWorkerBindings,
} from "../lib/hosted-cloudflare-import-queue-worker-runtime";

const databaseOwnerId = "11111111-1111-4111-8111-111111111111";

function bindings(
  overrides: Partial<HostedCloudflareImportQueueWorkerBindings> = {},
): HostedCloudflareImportQueueWorkerBindings {
  return {
    AUTHORIZED_CLERK_USER_ID: "owner-1",
    DATABASE_URL: "postgresql://private.example/dna",
    DNA_DATABASE_OWNER_ID: databaseOwnerId,
    DNA_DATABASE_RUNTIME_ROLE: "dna_app_runtime",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_API_TOKEN: "least-privilege-provider-token",
    DNA_R2_BUCKET_NAME: "dna-private-imports",
    DNA_R2_ACCESS_KEY_ID: "r2-access",
    DNA_R2_SECRET_ACCESS_KEY: "r2-secret",
    DNA_IMPORT_QUEUE_ID: "b".repeat(32),
    DNA_IMPORT_QUEUE_NAME: "dna-import-preview",
    DNA_IMPORT_DEAD_LETTER_QUEUE_NAME: "dna-import-preview-dlq",
    DNA_IMPORT_WORKER_ID: "import-worker-1",
    DNA_IMPORT_LEASE_DURATION_MILLISECONDS: "300000",
    DNA_IMPORT_MAXIMUM_BATCH_BYTES: "1073741824",
    DNA_IMPORT_MAXIMUM_OBJECT_BYTES: "536870912",
    DNA_IMPORT_MAXIMUM_CHUNK_BYTES: "1048576",
    DNA_IMPORT_MAXIMUM_SOURCE_VERSIONS: "24",
    DNA_IMPORT_MAXIMUM_QUARANTINED_RECORDS: "1000000",
    DNA_IMPORT_QUEUE: {
      send: vi.fn(async () => undefined),
    },
    ...overrides,
  };
}

function dependencies() {
  return {
    queueEvidencePort: {
      readQueueEvidence: vi.fn(async () => ({
        paused: false,
        consumerConfigured: true,
        maxRetries: 3,
        deadLetterQueueName: "dna-import-preview-dlq",
      })),
    },
  };
}

describe("hosted Cloudflare import queue worker runtime", () => {
  it("composes Preview, activation, aggregate, R2, Neon, and native queue settings", () => {
    expect(
      hostedCloudflareImportQueueWorkerRuntime({
        bindings: bindings(),
        dependencies: dependencies(),
      }).status,
    ).toBe("ready");
  });

  it("fails closed without the native queue binding or owner identity", () => {
    expect(
      hostedCloudflareImportQueueWorkerRuntime({
        bindings: bindings({ DNA_IMPORT_QUEUE: undefined }),
        dependencies: dependencies(),
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      hostedCloudflareImportQueueWorkerRuntime({
        bindings: bindings({ AUTHORIZED_CLERK_USER_ID: undefined }),
        dependencies: dependencies(),
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("fails closed on shared database drift without letting family-local bounds brick the queue", () => {
    expect(
      hostedCloudflareImportQueueWorkerRuntime({
        bindings: bindings({ DATABASE_URL: undefined }),
        dependencies: dependencies(),
      }),
    ).toEqual({ status: "not_configured" });

    expect(
      hostedCloudflareImportQueueWorkerRuntime({
        bindings: bindings({
          DNA_IMPORT_MAXIMUM_SOURCE_VERSIONS: "25",
        }),
        dependencies: dependencies(),
      }).status,
    ).toBe("ready");
    expect(
      hostedCloudflareImportQueueWorkerRuntime({
        bindings: bindings({
          DNA_IMPORT_MAXIMUM_CHUNK_BYTES: "536870913",
        }),
        dependencies: dependencies(),
      }).status,
    ).toBe("ready");
  });
});
