export const importProviderAdapterNames = [
  "persistence",
  "private_object_storage",
  "preview_queue",
  "background_queue",
  "capacity_gate",
] as const;

export type ImportProviderAdapterName =
  (typeof importProviderAdapterNames)[number];

export type ImportProviderAdapterServices = Readonly<
  Record<ImportProviderAdapterName, unknown>
>;

export type ImportProviderAdapterFactory<Service> =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "configured";
      createForOwner: (
        context: Readonly<{ ownerId: string }>,
      ) => Service | Promise<Service>;
    }>;

export type ImportProviderAdapterConfiguration<
  Services extends ImportProviderAdapterServices,
> = Readonly<{
  [Name in ImportProviderAdapterName]: ImportProviderAdapterFactory<
    Services[Name]
  >;
}>;

export type LazyOwnerScopedImportProviderAdapter<Service> = Readonly<{
  get: () => Promise<Service>;
}>;

export type OwnerScopedImportProviderAdapterBundle<
  Services extends ImportProviderAdapterServices,
> = Readonly<{
  ownerId: string;
  adapters: Readonly<{
    [Name in ImportProviderAdapterName]: LazyOwnerScopedImportProviderAdapter<
      Services[Name]
    >;
  }>;
}>;

export type ImportProviderAdapterBundleResult<
  Services extends ImportProviderAdapterServices,
> =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "access_denied" }>
  | Readonly<{
      status: "not_configured";
      missingAdapters: readonly ImportProviderAdapterName[];
    }>
  | Readonly<{
      status: "ready";
      bundle: OwnerScopedImportProviderAdapterBundle<Services>;
    }>;

function normalizedIdentity(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function lazyOwnerAdapter<Service>(
  ownerId: string,
  factory: Extract<
    ImportProviderAdapterFactory<Service>,
    { status: "configured" }
  >,
): LazyOwnerScopedImportProviderAdapter<Service> {
  let service: Promise<Service> | null = null;

  return Object.freeze({
    get(): Promise<Service> {
      if (service === null) {
        service = Promise.resolve(factory.createForOwner({ ownerId })).then(
          (created) => {
            if (
              created === null ||
              created === undefined ||
              (typeof created !== "object" && typeof created !== "function")
            ) {
              throw new Error("Import provider adapter initialization failed.");
            }
            return created;
          },
        );
      }
      return service;
    },
  });
}

export function prepareImportProviderAdapterBundle<
  Services extends ImportProviderAdapterServices,
>(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  configuration: ImportProviderAdapterConfiguration<Services>;
}): ImportProviderAdapterBundleResult<Services> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { status: "identity_not_connected" };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    return { status: "access_denied" };
  }

  const missingAdapters = importProviderAdapterNames.filter(
    (name) => input.configuration[name].status === "not_configured",
  );
  if (missingAdapters.length > 0) {
    return { status: "not_configured", missingAdapters };
  }

  const configuration = input.configuration as {
    [Name in ImportProviderAdapterName]: Extract<
      ImportProviderAdapterConfiguration<Services>[Name],
      { status: "configured" }
    >;
  };

  return {
    status: "ready",
    bundle: Object.freeze({
      ownerId: authenticatedOwnerId,
      adapters: Object.freeze({
        persistence: lazyOwnerAdapter(
          authenticatedOwnerId,
          configuration.persistence,
        ),
        private_object_storage: lazyOwnerAdapter(
          authenticatedOwnerId,
          configuration.private_object_storage,
        ),
        preview_queue: lazyOwnerAdapter(
          authenticatedOwnerId,
          configuration.preview_queue,
        ),
        background_queue: lazyOwnerAdapter(
          authenticatedOwnerId,
          configuration.background_queue,
        ),
        capacity_gate: lazyOwnerAdapter(
          authenticatedOwnerId,
          configuration.capacity_gate,
        ),
      }),
    }),
  };
}

export const unavailableImportProviderAdapterConfiguration: ImportProviderAdapterConfiguration<ImportProviderAdapterServices> =
  Object.freeze({
    persistence: Object.freeze({ status: "not_configured" }),
    private_object_storage: Object.freeze({ status: "not_configured" }),
    preview_queue: Object.freeze({ status: "not_configured" }),
    background_queue: Object.freeze({ status: "not_configured" }),
    capacity_gate: Object.freeze({ status: "not_configured" }),
  });
