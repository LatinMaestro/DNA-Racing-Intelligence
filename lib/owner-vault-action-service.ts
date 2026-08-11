import { createHash } from "node:crypto";

export type OwnerVaultMutationFailureStatus =
  | "conflict"
  | "core_unavailable"
  | "idempotency_conflict"
  | "invalid_state";

export type OwnerVaultMutationResult =
  | Readonly<{
      status: "applied" | "replayed";
      sourceCoreId: string;
      inMyVault: boolean;
      meEligible: boolean;
      version: number;
      updatedAt: string;
    }>
  | Readonly<{ status: OwnerVaultMutationFailureStatus }>;

export type OwnerVaultMutationRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      setCoreState: (input: Readonly<{
        ownerId: string;
        sourceCoreId: string;
        inMyVault: boolean;
        meEligible: boolean;
        expectedVersion: number;
        idempotencyKey: string;
        requestFingerprintSha256: string;
        requestedAt: string;
      }>) => Promise<OwnerVaultMutationResult>;
    }>;

export type OwnerVaultActionResult =
  | Readonly<{
      status: "updated";
      state: Extract<OwnerVaultMutationResult, { status: "applied" | "replayed" }>;
    }>
  | Readonly<{
      status:
        | "identity_not_connected"
        | "persistence_not_configured"
        | "invalid_request"
        | "conflict"
        | "core_unavailable"
        | "idempotency_conflict"
        | "persistence_unavailable";
    }>;

export type OwnerVaultActionDependencies = Readonly<{
  resolveAuthenticatedOwnerId: () => Promise<string | null>;
  configuredOwnerId: string | null;
  repository: OwnerVaultMutationRepository;
  now: () => Date;
}>;

const SAFE_IDEMPOTENCY_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function sourceCoreId(value: unknown): string {
  if (typeof value !== "string") throw new Error("sourceCoreId is required");
  const normalized = value.trim();
  if (normalized === "" || normalized.length > 256) {
    throw new Error("sourceCoreId is invalid");
  }
  return normalized;
}

function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("expectedVersion is invalid");
  }
  return value as number;
}

function idempotencyKey(value: unknown): string {
  if (typeof value !== "string") throw new Error("idempotencyKey is required");
  const normalized = value.trim();
  if (!SAFE_IDEMPOTENCY_KEY.test(normalized)) {
    throw new Error("idempotencyKey is invalid");
  }
  return normalized;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} is invalid`);
  return value;
}

function canonicalNow(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("now is invalid");
  }
  return value.toISOString();
}

function fingerprint(
  input: Readonly<{
    sourceCoreId: string;
    inMyVault: boolean;
    meEligible: boolean;
    expectedVersion: number;
  }>,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.sourceCoreId,
        input.inMyVault,
        input.meEligible,
        input.expectedVersion,
      ]),
    )
    .digest("hex");
}

export async function updateOwnerVaultCore(
  input: Readonly<{
    sourceCoreId: string;
    inMyVault: boolean;
    meEligible: boolean;
    expectedVersion: number;
    idempotencyKey: string;
  }>,
  dependencies: OwnerVaultActionDependencies,
): Promise<OwnerVaultActionResult> {
  const authenticatedOwnerId = normalizedIdentity(
    await dependencies.resolveAuthenticatedOwnerId(),
  );
  const configuredOwnerId = normalizedIdentity(dependencies.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { status: "identity_not_connected" };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    return { status: "identity_not_connected" };
  }
  if (dependencies.repository.status === "not_configured") {
    return { status: "persistence_not_configured" };
  }

  let normalized: {
    sourceCoreId: string;
    inMyVault: boolean;
    meEligible: boolean;
    expectedVersion: number;
    idempotencyKey: string;
  };
  try {
    normalized = {
      sourceCoreId: sourceCoreId(input.sourceCoreId),
      inMyVault: boolean(input.inMyVault, "inMyVault"),
      meEligible: boolean(input.meEligible, "meEligible"),
      expectedVersion: expectedVersion(input.expectedVersion),
      idempotencyKey: idempotencyKey(input.idempotencyKey),
    };
    if (!normalized.inMyVault && normalized.meEligible) {
      return { status: "invalid_request" };
    }
  } catch {
    return { status: "invalid_request" };
  }

  try {
    const state = await dependencies.repository.setCoreState({
      ownerId: authenticatedOwnerId,
      ...normalized,
      requestFingerprintSha256: fingerprint(normalized),
      requestedAt: canonicalNow(dependencies.now()),
    });

    if (state.status === "conflict") return { status: "conflict" };
    if (state.status === "core_unavailable") {
      return { status: "core_unavailable" };
    }
    if (state.status === "idempotency_conflict") {
      return { status: "idempotency_conflict" };
    }
    if (state.status === "invalid_state") {
      return { status: "invalid_request" };
    }
    return { status: "updated", state };
  } catch {
    return { status: "persistence_unavailable" };
  }
}
