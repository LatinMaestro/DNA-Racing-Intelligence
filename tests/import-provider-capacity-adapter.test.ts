import { describe, expect, it, vi } from "vitest";

import {
  createImportProviderCapacityGateForOwner,
  importCapacityResources,
  importProviderCapacityConfigurationFromEnvironment,
  type ImportCapacityApprovedLimits,
  type ImportCapacityProjection,
  type ImportProviderCapacityPort,
} from "../lib/import-provider-capacity-adapter";

const OWNER_ID = "owner-1";
const NOW = new Date("2026-08-09T00:00:00.000Z");
const APPROVED_LIMITS = Object.freeze(
  Object.fromEntries(
    importCapacityResources.map((resource) => [resource, 1_000]),
  ) as ImportCapacityApprovedLimits,
);

function projection(
  overrides: Partial<ImportCapacityProjection> = {},
): ImportCapacityProjection {
  return {
    evidenceSource: "provider_api",
    measuredAt: "2026-08-08T23:59:00.000Z",
    resources: importCapacityResources.map((resource) => ({
      resource,
      currentUsage: 100,
      projectedIncrement: 50,
    })),
    ...overrides,
  };
}

function readyGate(
  approvedLimits: ImportCapacityApprovedLimits = APPROVED_LIMITS,
) {
  const measureUploadProjection = vi.fn(async () => projection());
  const measureActivationProjection = vi.fn(async () => projection());
  const port: ImportProviderCapacityPort = {
    measureUploadProjection,
    measureActivationProjection,
  };
  const createPort = vi.fn(async () => port);
  const gate = createImportProviderCapacityGateForOwner({
    ownerId: OWNER_ID,
    configuration: {
      approvedLimits,
      minimumHeadroomBasisPoints: 1_000,
      maximumMeasurementAgeMilliseconds: 5 * 60 * 1_000,
      now: () => NOW,
      createPort,
    },
  });
  return {
    gate,
    createPort,
    measureUploadProjection,
    measureActivationProjection,
  };
}

describe("import provider capacity adapter", () => {
  it("denies another owner before provider initialization", async () => {
    const ready = readyGate();
    await expect(
      ready.gate.assertWithinApprovedCapacity({
        ownerId: "other-owner",
        previewId: "preview-1",
      }),
    ).rejects.toThrow("access denied");
    expect(ready.createPort).not.toHaveBeenCalled();
  });

  it("measures a valid upload projection with normalized source families", async () => {
    const ready = readyGate();
    await expect(
      ready.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        fileCount: 2,
        totalByteLength: 2_048,
        sourceFamilies: ["race_merge", "core_details"],
      }),
    ).resolves.toBeUndefined();
    expect(ready.measureUploadProjection).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      fileCount: 2,
      totalByteLength: 2_048,
      sourceFamilies: ["race_merge", "core_details"],
    });
  });

  it("accepts the current nine-file layout and normalizes repeated Race Merge families", async () => {
    const ready = readyGate();
    await expect(
      ready.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        fileCount: 9,
        totalByteLength: 392_487_223,
        sourceFamilies: [
          "race_merge",
          "race_merge",
          "race_merge",
          "race_merge",
          "race_merge",
          "race_merge",
          "race_merge",
          "core_details",
          "current_arena",
        ],
      }),
    ).resolves.toBeUndefined();
    expect(ready.measureUploadProjection).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      fileCount: 9,
      totalByteLength: 392_487_223,
      sourceFamilies: ["race_merge", "core_details", "current_arena"],
    });
  });

  it("rechecks capacity from the persisted preview before activation", async () => {
    const ready = readyGate();
    await expect(
      ready.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        previewId: "preview-1",
      }),
    ).resolves.toBeUndefined();
    expect(ready.measureActivationProjection).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      previewId: "preview-1",
    });
  });

  it("uses reviewed limits rather than a provider-reported entitlement", async () => {
    const ready = readyGate();
    ready.measureActivationProjection.mockResolvedValueOnce(
      projection({
        resources: importCapacityResources.map((resource) => ({
          resource,
          currentUsage: 850,
          projectedIncrement: resource === "r2_storage_bytes" ? 51 : 10,
          approvedLimit: 1_000_000,
        })) as unknown as ImportCapacityProjection["resources"],
      }),
    );
    await expect(
      ready.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        previewId: "preview-1",
      }),
    ).rejects.toThrow("r2_storage_bytes");
  });

  it("calculates headroom exactly at the safe-integer boundary", async () => {
    const exactLimits = Object.freeze(
      Object.fromEntries(
        importCapacityResources.map((resource) => [
          resource,
          Number.MAX_SAFE_INTEGER,
        ]),
      ) as ImportCapacityApprovedLimits,
    );
    const usable = Number((BigInt(Number.MAX_SAFE_INTEGER) * 9_000n) / 10_000n);
    const ready = readyGate(exactLimits);
    ready.measureActivationProjection.mockResolvedValueOnce(
      projection({
        resources: importCapacityResources.map((resource) => ({
          resource,
          currentUsage: usable - 1,
          projectedIncrement: 1,
        })),
      }),
    );
    await expect(
      ready.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        previewId: "preview-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects stale, future, or excessively permissive measurement windows", async () => {
    const stale = readyGate();
    stale.measureActivationProjection.mockResolvedValueOnce(
      projection({ measuredAt: "2026-08-08T23:50:00.000Z" }),
    );
    await expect(
      stale.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        previewId: "preview-1",
      }),
    ).rejects.toThrow("stale or invalid");

    const future = readyGate();
    future.measureActivationProjection.mockResolvedValueOnce(
      projection({ measuredAt: "2026-08-09T00:01:00.000Z" }),
    );
    await expect(
      future.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        previewId: "preview-1",
      }),
    ).rejects.toThrow("stale or invalid");

    expect(() =>
      createImportProviderCapacityGateForOwner({
        ownerId: OWNER_ID,
        configuration: {
          approvedLimits: APPROVED_LIMITS,
          minimumHeadroomBasisPoints: 1_000,
          maximumMeasurementAgeMilliseconds: 15 * 60 * 1_000 + 1,
          now: () => NOW,
          createPort: vi.fn(),
        },
      }),
    ).toThrow("too large");
  });

  it("rejects missing and duplicate resource evidence", async () => {
    const missing = readyGate();
    missing.measureActivationProjection.mockResolvedValueOnce(
      projection({ resources: projection().resources.slice(1) }),
    );
    await expect(
      missing.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        previewId: "preview-1",
      }),
    ).rejects.toThrow("incomplete");

    const duplicate = readyGate();
    duplicate.measureActivationProjection.mockResolvedValueOnce(
      projection({
        resources: [...projection().resources, projection().resources[0]!],
      }),
    );
    await expect(
      duplicate.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        previewId: "preview-1",
      }),
    ).rejects.toThrow("resource set is invalid");
  });

  it("stays unconfigured without every reviewed guardrail", () => {
    const createPort = vi.fn();
    const approvedLimits = Object.fromEntries(
      importCapacityResources.map((resource) => [resource, "1000"]),
    );
    expect(
      importProviderCapacityConfigurationFromEnvironment({
        approvedLimits: { ...approvedLimits, neon_storage_bytes: undefined },
        minimumHeadroomBasisPoints: "1000",
        maximumMeasurementAgeMilliseconds: "300000",
        now: () => NOW,
        createPort,
      }),
    ).toBeNull();
    expect(
      importProviderCapacityConfigurationFromEnvironment({
        approvedLimits,
        minimumHeadroomBasisPoints: "1000",
        maximumMeasurementAgeMilliseconds: "invalid",
        now: () => NOW,
        createPort,
      }),
    ).toBeNull();
    expect(createPort).not.toHaveBeenCalled();
  });
});
