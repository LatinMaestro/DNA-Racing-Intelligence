import { describe, expect, it, vi } from "vitest";

import {
  hostedImportConfirmationRuntime,
  type HostedImportConfirmationRuntimeEnvironment,
} from "../lib/hosted-import-confirmation-runtime";
import { importCapacityResources } from "../lib/import-provider-capacity-adapter";

const approvedLimits = Object.fromEntries(
  importCapacityResources.map((resource) => [resource, "1000000"]),
);

function environment(): HostedImportConfirmationRuntimeEnvironment {
  return {
    authorizedOwnerId: "owner-1",
    database: {
      databaseUrl: "postgresql://runtime:secret@preview.invalid/dna",
      databaseOwnerId: "11111111-1111-4111-8111-111111111111",
      runtimeRole: "dna_app_runtime",
    },
    cloudflare: {
      accountId: "a".repeat(32),
      apiToken: "least-privilege-cloudflare-token",
      r2BucketName: "dna-private-imports",
      queueId: "b".repeat(32),
      queueName: "dna-import-preview",
      deadLetterQueueName: "dna-import-preview-dlq",
    },
    capacity: {
      approvedLimits,
      minimumHeadroomBasisPoints: "1000",
      maximumMeasurementAgeMilliseconds: "300000",
    },
  };
}

function statuses(result: ReturnType<typeof hostedImportConfirmationRuntime>) {
  return Object.values(result).map((capability) => capability.status);
}

describe("hosted import confirmation runtime", () => {
  it.each([
    [
      "owner identity",
      (value: HostedImportConfirmationRuntimeEnvironment) => ({
        ...value,
        authorizedOwnerId: undefined,
      }),
    ],
    [
      "Cloudflare account ID",
      (value: HostedImportConfirmationRuntimeEnvironment) => ({
        ...value,
        cloudflare: { ...value.cloudflare, accountId: "invalid" },
      }),
    ],
    [
      "Cloudflare API token",
      (value: HostedImportConfirmationRuntimeEnvironment) => ({
        ...value,
        cloudflare: { ...value.cloudflare, apiToken: "token\ninvalid" },
      }),
    ],
    [
      "queue ID",
      (value: HostedImportConfirmationRuntimeEnvironment) => ({
        ...value,
        cloudflare: { ...value.cloudflare, queueId: "invalid" },
      }),
    ],
    [
      "capacity limits",
      (value: HostedImportConfirmationRuntimeEnvironment) => ({
        ...value,
        capacity: { ...value.capacity, approvedLimits: {} },
      }),
    ],
  ])("fails closed when %s is unusable", (_label, alter) => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    const neonSessionFactory = vi.fn(async () => {
      throw new Error("Neon must remain lazy");
    });

    const result = hostedImportConfirmationRuntime({
      environment: alter(environment()),
      dependencies: { fetch: fetcher, neonSessionFactory },
    });

    expect(statuses(result)).toEqual([
      "not_configured",
      "not_configured",
      "not_configured",
      "not_configured",
    ]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(neonSessionFactory).not.toHaveBeenCalled();
  });

  it("assembles exact owner-bound confirmation capabilities lazily", () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    const neonSessionFactory = vi.fn(async () => {
      throw new Error("Neon must remain lazy");
    });

    const result = hostedImportConfirmationRuntime({
      environment: environment(),
      dependencies: {
        now: () => new Date("2026-08-21T01:00:00.000Z"),
        fetch: fetcher,
        neonSessionFactory,
      },
    });

    expect(statuses(result)).toEqual(["ready", "ready", "ready", "ready"]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(neonSessionFactory).not.toHaveBeenCalled();
  });

  it("rejects a self-referential dead-letter queue", () => {
    const value = environment();
    const result = hostedImportConfirmationRuntime({
      environment: {
        ...value,
        cloudflare: {
          ...value.cloudflare,
          deadLetterQueueName: value.cloudflare.queueName,
        },
      },
    });
    expect(statuses(result)).toEqual([
      "not_configured",
      "not_configured",
      "not_configured",
      "not_configured",
    ]);
  });

  it("inherits least-privilege Neon role validation", () => {
    const value = environment();
    const result = hostedImportConfirmationRuntime({
      environment: {
        ...value,
        database: {
          ...value.database,
          runtimeRole: "neondb_owner; SET ROLE",
        },
      },
    });
    expect(statuses(result)).toEqual([
      "not_configured",
      "not_configured",
      "not_configured",
      "not_configured",
    ]);
  });
});
