"use server";

import { revalidatePath } from "next/cache";

import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonOwnerVaultMutationRepositoryFromEnvironment } from "@/lib/neon-owner-vault-repository";
import { updateOwnerVaultCore } from "@/lib/owner-vault-action-service";
import { parseOwnerVaultMutationFormData } from "@/lib/owner-vault-form";

function repository() {
  return neonOwnerVaultMutationRepositoryFromEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  });
}

function dependencies() {
  return {
    resolveAuthenticatedOwnerId: () =>
      authenticatedClerkOwnerId({
        environment: {
          publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
          secretKey: process.env.CLERK_SECRET_KEY,
        },
      }),
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: repository(),
    now: () => new Date(),
  } as const;
}

export async function updateVaultCoreAction(
  input: Readonly<{
    sourceCoreId: string;
    inMyVault: boolean;
    meEligible: boolean;
    expectedVersion: number;
    idempotencyKey: string;
  }>,
) {
  return updateOwnerVaultCore(input, dependencies());
}

export async function updateVaultCoreFormAction(formData: FormData) {
  let input;
  try {
    input = parseOwnerVaultMutationFormData(formData);
  } catch {
    return { status: "invalid_request" as const };
  }

  const result = await updateOwnerVaultCore(input, dependencies());
  if (result.status === "updated") {
    revalidatePath("/vault");
  }
  return result;
}
