export const importPersistenceOperationKinds = [
  "upload_batch",
  "upload_completion",
  "preview_dispatch",
  "import_activation",
  "import_recovery",
  "aggregate_refresh_retry",
] as const;

export type ImportPersistenceOperationKind =
  (typeof importPersistenceOperationKinds)[number];

export type ImportPersistenceOperationReservation = Readonly<{
  disposition: "created" | "existing";
  operationId: string;
}>;

export type ImportPersistenceTransaction = Readonly<{
  setLocalOwnerScope: (input: {
    databaseOwnerId: string;
  }) => Promise<Readonly<{ ownerScope: string }>>;
  verifyOwnerIsolation: (input: {
    databaseOwnerId: string;
    authenticatedOwnerId: string;
  }) => Promise<Readonly<{
    databaseOwnerId: string;
    authenticatedOwnerId: string;
    rowSecurityEnabled: boolean;
    forceRowSecurityEnabled: boolean;
  }> | null>;
  reserveOperation: (input: {
    databaseOwnerId: string;
    operationKind: ImportPersistenceOperationKind;
    idempotencyKey: string;
    requestFingerprintSha256: string;
    requestedAt: string;
  }) => Promise<
    Readonly<{
      disposition: "created" | "existing";
      operationId: string;
      requestFingerprintSha256: string;
    }>
  >;
}>;

export type ImportPersistenceDriver = Readonly<{
  transaction: <Result>(
    operation: (transaction: ImportPersistenceTransaction) => Promise<Result>,
  ) => Promise<Result>;
}>;

export type ImportPersistenceDriverFactory = () =>
  ImportPersistenceDriver | Promise<ImportPersistenceDriver>;

export type OwnerScopedImportPersistenceOperationAdapter = Readonly<{
  reserveOperation: (input: {
    operationKind: ImportPersistenceOperationKind;
    idempotencyKey: string;
    requestFingerprintSha256: string;
    now: Date;
  }) => Promise<ImportPersistenceOperationReservation>;
}>;

const DATABASE_OWNER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

function normalizedOwnerIdentity(value: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("authenticatedOwnerId is invalid");
  }
  return normalized;
}

function requireSafeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function canonicalTimestamp(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new Error("now must be valid");
  }
  return value.toISOString();
}

function requireDriver(value: unknown): ImportPersistenceDriver {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { transaction?: unknown }).transaction !== "function"
  ) {
    throw new Error("Import persistence initialization failed.");
  }
  return value as ImportPersistenceDriver;
}

function validateIsolation(
  value: Awaited<
    ReturnType<ImportPersistenceTransaction["verifyOwnerIsolation"]>
  >,
  databaseOwnerId: string,
  authenticatedOwnerId: string,
): void {
  if (
    value === null ||
    value.databaseOwnerId !== databaseOwnerId ||
    value.authenticatedOwnerId !== authenticatedOwnerId
  ) {
    throw new Error("Import persistence owner scope denied.");
  }
  if (!value.rowSecurityEnabled || !value.forceRowSecurityEnabled) {
    throw new Error("Import persistence forced owner RLS is required.");
  }
}

export function createOwnerScopedImportPersistenceOperationAdapter(input: {
  databaseOwnerId: string;
  authenticatedOwnerId: string;
  driverFactory: ImportPersistenceDriverFactory;
}): OwnerScopedImportPersistenceOperationAdapter {
  const databaseOwnerId = input.databaseOwnerId.trim();
  if (!DATABASE_OWNER_ID_PATTERN.test(databaseOwnerId)) {
    throw new Error("databaseOwnerId must be a UUID");
  }
  const authenticatedOwnerId = normalizedOwnerIdentity(
    input.authenticatedOwnerId,
  );
  let driver: Promise<ImportPersistenceDriver> | null = null;

  function getDriver(): Promise<ImportPersistenceDriver> {
    if (driver === null) {
      driver = Promise.resolve(input.driverFactory()).then(requireDriver);
    }
    return driver;
  }

  return Object.freeze({
    async reserveOperation(operationInput) {
      if (
        !importPersistenceOperationKinds.includes(operationInput.operationKind)
      ) {
        throw new Error("operationKind is unsupported");
      }
      const idempotencyKey = requireSafeIdentifier(
        operationInput.idempotencyKey,
        "idempotencyKey",
      );
      if (!SHA_256_PATTERN.test(operationInput.requestFingerprintSha256)) {
        throw new Error("requestFingerprintSha256 is invalid");
      }
      const requestedAt = canonicalTimestamp(operationInput.now);
      const persistence = await getDriver();

      return persistence.transaction(async (transaction) => {
        const scope = await transaction.setLocalOwnerScope({
          databaseOwnerId,
        });
        if (scope.ownerScope !== databaseOwnerId) {
          throw new Error("Import persistence owner scope denied.");
        }

        const isolation = await transaction.verifyOwnerIsolation({
          databaseOwnerId,
          authenticatedOwnerId,
        });
        validateIsolation(isolation, databaseOwnerId, authenticatedOwnerId);

        const reservation = await transaction.reserveOperation({
          databaseOwnerId,
          operationKind: operationInput.operationKind,
          idempotencyKey,
          requestFingerprintSha256: operationInput.requestFingerprintSha256,
          requestedAt,
        });
        const operationId = requireSafeIdentifier(
          reservation.operationId,
          "operationId",
        );
        if (
          reservation.disposition !== "created" &&
          reservation.disposition !== "existing"
        ) {
          throw new Error("Import persistence disposition is invalid.");
        }
        if (
          reservation.requestFingerprintSha256 !==
          operationInput.requestFingerprintSha256
        ) {
          throw new Error("Import persistence idempotency conflict.");
        }

        return {
          disposition: reservation.disposition,
          operationId,
        };
      });
    },
  });
}
