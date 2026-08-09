import { describe, expect, it, vi } from "vitest";

import {
  hostedImportUploadIntakeCapabilities,
  type HostedImportUploadIntakeEnvironment,
} from "../lib/hosted-import-upload-intake-capabilities";
import { importCapacityResources } from "../lib/import-provider-capacity-adapter";

const approvedLimits = Object.fromEntries(
  importCapacityResources.map((resource) => [resource, "1000000"]),
);

function environment(): HostedImportUploadIntakeEnvironment {
  return {
    authorizedOwnerId: "owner-1",
    database: {
      databaseUrl: "postgresql://private.example/dna",
      databaseOwnerId: "11111111-1111-4111-8111-111111111111",
      runtimeRole: "dna_app_runtime",
    },
    r2: {
      accountId: "a".repeat(32),
      bucketName: "dna-private-imports",
    },
    capacity: {
      approvedLimits,
      minimumHeadroomBasisPoints: "1000",
      maximumMeasurementAgeMilliseconds: "300000",
    },
  };
}

function dependencies() {
  return {
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    createR2Port: vi.fn(() => {
      throw new Error("R2 must stay lazy during assembly");
    }),
    createCapacityPort: vi.fn(() => {
      throw new Error("capacity providers must stay lazy during assembly");
    }),
    neonSessionFactory: vi.fn(async () => {
      throw new Error("Neon must stay lazy during assembly");
    }),
  };
}

describe("hosted private-upload intake capabilities", () => {
  it.each([
    [
      "owner",
      (value: HostedImportUploadIntakeEnvironment) => ({
        ...value,
        authorizedOwnerId: " ",
      }),
    ],
    [
      "database",
      (value: HostedImportUploadIntakeEnvironment) => ({
        ...value,
        database: { ...value.database, databaseUrl: undefined },
      }),
    ],
    [
      "R2",
      (value: HostedImportUploadIntakeEnvironment) => ({
        ...value,
        r2: { ...value.r2, bucketName: undefined },
      }),
    ],
    [
      "capacity",
      (value: HostedImportUploadIntakeEnvironment) => ({
        ...value,
        capacity: {
          ...value.capacity,
          approvedLimits: {
            ...value.capacity.approvedLimits,
            neon_storage_bytes: undefined,
          },
        },
      }),
    ],
  ])("fails closed when %s configuration is incomplete", (_label, remove) => {
    const ports = dependencies();
    expect(
      hostedImportUploadIntakeCapabilities({
        environment: remove(environment()),
        dependencies: ports,
      }),
    ).toEqual({ status: "not_configured" });
    expect(ports.createR2Port).not.toHaveBeenCalled();
    expect(ports.createCapacityPort).not.toHaveBeenCalled();
    expect(ports.neonSessionFactory).not.toHaveBeenCalled();
  });

  it.each([
    (value: HostedImportUploadIntakeEnvironment) => ({
      ...value,
      database: { ...value.database, runtimeRole: "neondb_owner; SET ROLE" },
    }),
    (value: HostedImportUploadIntakeEnvironment) => ({
      ...value,
      r2: { ...value.r2, accountId: "not-an-account" },
    }),
    (value: HostedImportUploadIntakeEnvironment) => ({
      ...value,
      capacity: {
        ...value.capacity,
        minimumHeadroomBasisPoints: "10000",
      },
    }),
  ])("fails closed on malformed complete configuration", (malform) => {
    const ports = dependencies();
    expect(
      hostedImportUploadIntakeCapabilities({
        environment: malform(environment()),
        dependencies: ports,
      }),
    ).toEqual({ status: "not_configured" });
    expect(ports.createR2Port).not.toHaveBeenCalled();
    expect(ports.createCapacityPort).not.toHaveBeenCalled();
    expect(ports.neonSessionFactory).not.toHaveBeenCalled();
  });

  it("assembles all owner-bound capabilities without contacting providers", () => {
    const ports = dependencies();
    const result = hostedImportUploadIntakeCapabilities({
      environment: environment(),
      dependencies: ports,
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.repository).toBeDefined();
    expect(result.capacityGate).toBeDefined();
    expect(result.privateObjectStore).toBeDefined();
    expect(ports.createR2Port).not.toHaveBeenCalled();
    expect(ports.createCapacityPort).not.toHaveBeenCalled();
    expect(ports.neonSessionFactory).not.toHaveBeenCalled();
  });
});
