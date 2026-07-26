import { describe, expect, it, vi } from "vitest";

import {
  createImportProviderCapacityGateForOwner,
  importCapacityResources,
  importProviderCapacityConfigurationFromEnvironment,
  type ImportCapacityProjection,
  type ImportProviderCapacityPort,
} from "../lib/import-provider-capacity-adapter";

const OWNER_ID = "owner-1";
const NOW = new Date("2026-07-26T02:00:00.000Z");

function projection(
  overrides: Partial<ImportCapacityProjection> = {},
): ImportCapacityProjection {
  return {
    evidenceSource: "provider_api",
    measuredAt: "2026-07-26T01:59:00.000Z",
    resources: importCapacityResources.map((resource) => ({
      resource,
      currentUsage: 100,
      projectedIncrement: 50,
      approvedLimit: 1_000,
    })),
    ...overrides,
  };
}

function readyGate() {
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

  it("fails closed when projected usage crosses reserved headroom", async () => {
    const ready = readyGate();
    ready.measureActivationProjection.mockResolvedValueOnce(
      projection({
        resources: importCapacityResources.map((resource) => ({
          resource,
          currentUsage: 850,
          projectedIncrement: resource === "r2_storage_bytes" ? 51 : 10,
          approvedLimit: 1_000,
        })),
      }),
    );
    await expect(
      ready.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        previewId: "preview-1",
      }),
    ).rejects.toThrow("r2_storage_bytes");
  });

  it("rejects stale or future provider measurements", async () => {
    const ready = readyGate();
    ready.measureActivationProjection.mockResolvedValueOnce(
      projection({ measuredAt: "2026-07-26T01:50:00.000Z" }),
    );
    await expect(
      ready.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        previewId: "preview-1",
      }),
    ).rejects.toThrow("stale or invalid");

    const next = readyGate();
    next.measureActivationProjection.mockResolvedValueOnce(
      projection({ measuredAt: "2026-07-26T02:01:00.000Z" }),
    );
    await expect(
      next.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        previewId: "preview-1",
      }),
    ).rejects.toThrow("stale or invalid");
  });

  it("rejects missing and duplicate resource evidence", async () => {
    const missing = readyGate();
    missing.measureActivationProjection.mockResolvedValueOnce(
      projection({
        resources: projection().resources.slice(1),
      }),
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

  it("requires provider API evidence rather than a configured claim", async () => {
    const ready = readyGate();
    ready.measureActivationProjection.mockResolvedValueOnce({
      ...projection(),
      evidenceSource: "provider_api",
      resources: [
        {
          resource: "r2_storage_bytes",
          currentUsage: Number.NaN,
          projectedIncrement: 1,
          approvedLimit: 1_000,
        },
        ...projection().resources.slice(1),
      ],
    });
    await expect(
      ready.gate.assertWithinApprovedCapacity({
        ownerId: OWNER_ID,
        previewId: "preview-1",
      }),
    ).rejects.toThrow("currentUsage is invalid");
  });

  it("stays unconfigured without both guardrail settings", () => {
    const createPort = vi.fn();
    expect(
      importProviderCapacityConfigurationFromEnvironment({
        minimumHeadroomBasisPoints: undefined,
        maximumMeasurementAgeMilliseconds: "300000",
        now: () => NOW,
        createPort,
      }),
    ).toBeNull();
    expect(
      importProviderCapacityConfigurationFromEnvironment({
        minimumHeadroomBasisPoints: "1000",
        maximumMeasurementAgeMilliseconds: "invalid",
        now: () => NOW,
        createPort,
      }),
    ).toBeNull();
    expect(createPort).not.toHaveBeenCalled();
  });
});
