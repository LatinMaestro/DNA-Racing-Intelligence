import { describe, expect, it, vi } from "vitest";

import {
  hostedImportUploadCompletionRuntime,
  type HostedImportUploadCompletionRuntimeEnvironment,
} from "../lib/hosted-import-upload-completion-runtime";

function environment(): HostedImportUploadCompletionRuntimeEnvironment {
  return {
    authorizedOwnerId: "owner-1",
    database: {
      databaseUrl: "postgresql://runtime:secret@preview.invalid/dna",
      databaseOwnerId: "11111111-1111-4111-8111-111111111111",
      runtimeRole: "dna_app_runtime",
    },
    r2: {
      accountId: "a".repeat(32),
      bucketName: "dna-private-imports",
      accessKeyId: "private-access-key",
      secretAccessKey: "private-secret-key",
    },
    cloudflareApiToken: "least-privilege-cloudflare-token",
    queueId: "b".repeat(32),
    queueName: "dna-import-preview",
    deadLetterQueueName: "dna-import-preview-dlq",
  };
}

describe("hosted upload-completion runtime", () => {
  it.each([
    [
      "owner identity",
      (value: HostedImportUploadCompletionRuntimeEnvironment) => ({
        ...value,
        authorizedOwnerId: undefined,
      }),
    ],
    [
      "R2 access key",
      (value: HostedImportUploadCompletionRuntimeEnvironment) => ({
        ...value,
        r2: { ...value.r2, accessKeyId: undefined },
      }),
    ],
    [
      "Cloudflare API token",
      (value: HostedImportUploadCompletionRuntimeEnvironment) => ({
        ...value,
        cloudflareApiToken: "token\nwith-control-character",
      }),
    ],
    [
      "queue ID",
      (value: HostedImportUploadCompletionRuntimeEnvironment) => ({
        ...value,
        queueId: "not-a-provider-id",
      }),
    ],
    [
      "queue name",
      (value: HostedImportUploadCompletionRuntimeEnvironment) => ({
        ...value,
        queueName: undefined,
      }),
    ],
    [
      "dead-letter queue name",
      (value: HostedImportUploadCompletionRuntimeEnvironment) => ({
        ...value,
        deadLetterQueueName: undefined,
      }),
    ],
  ])("fails closed when %s is unusable", (_label, alter) => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    const neonSessionFactory = vi.fn(async () => {
      throw new Error("Neon must remain lazy");
    });

    expect(
      hostedImportUploadCompletionRuntime({
        environment: alter(environment()),
        dependencies: { fetch: fetcher, neonSessionFactory },
      }),
    ).toEqual({ status: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(neonSessionFactory).not.toHaveBeenCalled();
  });

  it("assembles all owner-bound dependencies without provider access", () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    const neonSessionFactory = vi.fn(async () => {
      throw new Error("Neon must remain lazy");
    });

    const result = hostedImportUploadCompletionRuntime({
      environment: environment(),
      dependencies: {
        now: () => new Date("2026-08-14T00:00:00.000Z"),
        fetch: fetcher,
        neonSessionFactory,
      },
    });

    expect(result.status).toBe("ready");
    expect(fetcher).not.toHaveBeenCalled();
    expect(neonSessionFactory).not.toHaveBeenCalled();
  });

  it("rejects a self-referential dead-letter queue before provider access", () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    expect(
      hostedImportUploadCompletionRuntime({
        environment: {
          ...environment(),
          deadLetterQueueName: environment().queueName,
        },
        dependencies: { fetch: fetcher },
      }),
    ).toEqual({ status: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("inherits fail-closed Neon runtime identity validation", () => {
    expect(
      hostedImportUploadCompletionRuntime({
        environment: {
          ...environment(),
          database: {
            ...environment().database,
            runtimeRole: "neondb_owner; SET ROLE",
          },
        },
      }),
    ).toEqual({ status: "not_configured" });
  });
});
