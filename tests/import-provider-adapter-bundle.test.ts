import { describe, expect, it, vi } from "vitest";
import {
  importProviderAdapterNames,
  prepareImportProviderAdapterBundle,
  unavailableImportProviderAdapterConfiguration,
  type ImportProviderAdapterConfiguration,
  type ImportProviderAdapterServices,
} from "../lib/import-provider-adapter-bundle";

type SyntheticServices = Readonly<{
  persistence: Readonly<{ kind: "persistence" }>;
  private_object_storage: Readonly<{ kind: "private_object_storage" }>;
  preview_queue: Readonly<{ kind: "preview_queue" }>;
  background_queue: Readonly<{ kind: "background_queue" }>;
  capacity_gate: Readonly<{ kind: "capacity_gate" }>;
}> &
  ImportProviderAdapterServices;

function readyConfiguration() {
  const factories = {
    persistence: vi.fn(({ ownerId }: { ownerId: string }) => ({
      kind: "persistence" as const,
      ownerId,
    })),
    private_object_storage: vi.fn(({ ownerId }: { ownerId: string }) => ({
      kind: "private_object_storage" as const,
      ownerId,
    })),
    preview_queue: vi.fn(({ ownerId }: { ownerId: string }) => ({
      kind: "preview_queue" as const,
      ownerId,
    })),
    background_queue: vi.fn(({ ownerId }: { ownerId: string }) => ({
      kind: "background_queue" as const,
      ownerId,
    })),
    capacity_gate: vi.fn(({ ownerId }: { ownerId: string }) => ({
      kind: "capacity_gate" as const,
      ownerId,
    })),
  };

  const configuration = {
    persistence: {
      status: "configured",
      createForOwner: factories.persistence,
    },
    private_object_storage: {
      status: "configured",
      createForOwner: factories.private_object_storage,
    },
    preview_queue: {
      status: "configured",
      createForOwner: factories.preview_queue,
    },
    background_queue: {
      status: "configured",
      createForOwner: factories.background_queue,
    },
    capacity_gate: {
      status: "configured",
      createForOwner: factories.capacity_gate,
    },
  } as const satisfies ImportProviderAdapterConfiguration<SyntheticServices>;

  return { factories, configuration };
}

describe("owner-scoped import provider adapter bundle", () => {
  it("reports every unavailable adapter in deterministic order", () => {
    expect(
      prepareImportProviderAdapterBundle({
        authenticatedOwnerId: "owner-1",
        configuredOwnerId: "owner-1",
        configuration: unavailableImportProviderAdapterConfiguration,
      }),
    ).toEqual({
      status: "not_configured",
      missingAdapters: importProviderAdapterNames,
    });
  });

  it("denies a non-owner before any adapter factory can run", () => {
    const { factories, configuration } = readyConfiguration();

    expect(
      prepareImportProviderAdapterBundle({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner-1",
        configuration,
      }),
    ).toEqual({ status: "access_denied" });
    expect(
      Object.values(factories).every(
        (factory) => factory.mock.calls.length === 0,
      ),
    ).toBe(true);
  });

  it("does not initialize configured adapters while another is unavailable", () => {
    const { factories, configuration } = readyConfiguration();
    const partial: ImportProviderAdapterConfiguration<SyntheticServices> = {
      ...configuration,
      background_queue: { status: "not_configured" },
    };

    expect(
      prepareImportProviderAdapterBundle({
        authenticatedOwnerId: "owner-1",
        configuredOwnerId: "owner-1",
        configuration: partial,
      }),
    ).toEqual({
      status: "not_configured",
      missingAdapters: ["background_queue"],
    });
    expect(
      Object.values(factories).every(
        (factory) => factory.mock.calls.length === 0,
      ),
    ).toBe(true);
  });

  it("binds every lazy factory to the verified owner and initializes once", async () => {
    const { factories, configuration } = readyConfiguration();
    const result = prepareImportProviderAdapterBundle({
      authenticatedOwnerId: " owner-1 ",
      configuredOwnerId: "owner-1",
      configuration,
    });

    expect(result.status).toBe("ready");
    expect(
      Object.values(factories).every(
        (factory) => factory.mock.calls.length === 0,
      ),
    ).toBe(true);
    if (result.status !== "ready") throw new Error("Expected ready bundle.");

    const [first, second] = await Promise.all([
      result.bundle.adapters.persistence.get(),
      result.bundle.adapters.persistence.get(),
    ]);

    expect(first).toBe(second);
    expect(factories.persistence).toHaveBeenCalledTimes(1);
    expect(factories.persistence).toHaveBeenCalledWith({ ownerId: "owner-1" });
    expect(
      Object.entries(factories)
        .filter(([name]) => name !== "persistence")
        .every(([, factory]) => factory.mock.calls.length === 0),
    ).toBe(true);
  });

  it("reuses a sanitized failed initialization without retrying implicitly", async () => {
    const { factories, configuration } = readyConfiguration();
    factories.preview_queue.mockImplementation(() => undefined as never);
    const result = prepareImportProviderAdapterBundle({
      authenticatedOwnerId: "owner-1",
      configuredOwnerId: "owner-1",
      configuration,
    });
    if (result.status !== "ready") throw new Error("Expected ready bundle.");

    await expect(result.bundle.adapters.preview_queue.get()).rejects.toThrow(
      "Import provider adapter initialization failed.",
    );
    await expect(result.bundle.adapters.preview_queue.get()).rejects.toThrow(
      "Import provider adapter initialization failed.",
    );
    expect(factories.preview_queue).toHaveBeenCalledTimes(1);
  });
});
