import { describe, expect, it, vi } from "vitest";

import {
  hostedImportUploadIntakeRuntime,
  type HostedImportUploadIntakeRuntimeEnvironment,
} from "../lib/hosted-import-upload-intake-runtime";
import { importCapacityResources } from "../lib/import-provider-capacity-adapter";

const approvedLimits = Object.fromEntries(
  importCapacityResources.map((resource) => [resource, "1000000"]),
);

function environment(): HostedImportUploadIntakeRuntimeEnvironment {
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
    cloudflareApiToken: "read-only-cloudflare-token",
    queueId: "dna-import-preview",
    capacity: {
      approvedLimits,
      minimumHeadroomBasisPoints: "1000",
      maximumMeasurementAgeMilliseconds: "300000",
    },
  };
}

describe("hosted upload-intake runtime", () => {
  it.each([
    [
      "R2 access key",
      (value: HostedImportUploadIntakeRuntimeEnvironment) => ({
        ...value,
        r2: { ...value.r2, accessKeyId: undefined },
      }),
    ],
    [
      "R2 secret key",
      (value: HostedImportUploadIntakeRuntimeEnvironment) => ({
        ...value,
        r2: { ...value.r2, secretAccessKey: " " },
      }),
    ],
    [
      "Cloudflare API token",
      (value: HostedImportUploadIntakeRuntimeEnvironment) => ({
        ...value,
        cloudflareApiToken: "token\nwith-control-character",
      }),
    ],
    [
      "queue ID",
      (value: HostedImportUploadIntakeRuntimeEnvironment) => ({
        ...value,
        queueId: "unsafe queue/id",
      }),
    ],
  ])(
    "fails closed before provider access when %s is unusable",
    (_label, alter) => {
      const fetcher = vi.fn<typeof globalThis.fetch>();
      const neonSessionFactory = vi.fn(async () => {
        throw new Error("Neon must remain lazy");
      });

      expect(
        hostedImportUploadIntakeRuntime({
          environment: alter(environment()),
          dependencies: { fetch: fetcher, neonSessionFactory },
        }),
      ).toEqual({ status: "not_configured" });
      expect(fetcher).not.toHaveBeenCalled();
      expect(neonSessionFactory).not.toHaveBeenCalled();
    },
  );

  it("assembles the concrete hosted runtime without contacting providers", () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    const neonSessionFactory = vi.fn(async () => {
      throw new Error("Neon must remain lazy");
    });

    const result = hostedImportUploadIntakeRuntime({
      environment: environment(),
      dependencies: {
        now: () => new Date("2026-08-10T00:00:00.000Z"),
        fetch: fetcher,
        neonSessionFactory,
      },
    });

    expect(result.status).toBe("ready");
    expect(fetcher).not.toHaveBeenCalled();
    expect(neonSessionFactory).not.toHaveBeenCalled();
  });

  it("inherits fail-closed validation from the owner-bound capability assembly", () => {
    expect(
      hostedImportUploadIntakeRuntime({
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
