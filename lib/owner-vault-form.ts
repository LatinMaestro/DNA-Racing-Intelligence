import { createHash } from "node:crypto";

export const ownerVaultOperations = [
  "add",
  "remove",
  "me_on",
  "me_off",
] as const;
export type OwnerVaultOperation = (typeof ownerVaultOperations)[number];

export type ParsedOwnerVaultMutation = Readonly<{
  sourceCoreId: string;
  inMyVault: boolean;
  meEligible: boolean;
  expectedVersion: number;
  idempotencyKey: string;
}>;

function singleString(formData: FormData, name: string): string {
  const values = formData.getAll(name);
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new Error(`Vault ${name} is invalid.`);
  }
  return values[0].trim();
}

function sourceCoreId(value: string): string {
  if (value === "" || value.length > 256) {
    throw new Error("Vault Core ID is invalid.");
  }
  return value;
}

function version(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("Vault version is invalid.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Vault version is invalid.");
  }
  return parsed;
}

function operation(value: string): OwnerVaultOperation {
  if (!ownerVaultOperations.includes(value as OwnerVaultOperation)) {
    throw new Error("Vault operation is invalid.");
  }
  return value as OwnerVaultOperation;
}

function desiredState(value: OwnerVaultOperation): Readonly<{
  inMyVault: boolean;
  meEligible: boolean;
}> {
  switch (value) {
    case "add":
      return { inMyVault: true, meEligible: false };
    case "remove":
      return { inMyVault: false, meEligible: false };
    case "me_on":
      return { inMyVault: true, meEligible: true };
    case "me_off":
      return { inMyVault: true, meEligible: false };
  }
}

export function parseOwnerVaultMutationFormData(
  formData: FormData,
): ParsedOwnerVaultMutation {
  const coreId = sourceCoreId(singleString(formData, "sourceCoreId"));
  const expectedVersion = version(singleString(formData, "expectedVersion"));
  const selectedOperation = operation(singleString(formData, "operation"));
  const desired = desiredState(selectedOperation);
  const fingerprint = JSON.stringify([
    coreId,
    expectedVersion,
    selectedOperation,
    desired.inMyVault,
    desired.meEligible,
  ]);
  const digest = createHash("sha256").update(fingerprint).digest("hex");

  return {
    sourceCoreId: coreId,
    ...desired,
    expectedVersion,
    idempotencyKey: `vault:${digest}`,
  };
}
