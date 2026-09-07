"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { updateDnaOpenLabSyncRatePolicy } from "@/lib/dna-open-lab-sync-rate-policy-service";
import { neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-sync-rate-policy-repository";

function integer(formData: FormData, name: string): number {
  const value = formData.get(name);
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return Number.NaN;
  return Number(value);
}

export async function updateApiSyncRateAction(
  formData: FormData,
): Promise<void> {
  const requestedRequestsPerMinute = integer(formData, "requestsPerMinute");
  const elevationHours = integer(formData, "elevationHours");
  const expectedVersion = integer(formData, "expectedVersion");
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const result = await updateDnaOpenLabSyncRatePolicy({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment({
      databaseUrl: process.env.DATABASE_URL,
      databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
      runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
    }),
    requestedRequestsPerMinute,
    elevationHours: requestedRequestsPerMinute > 30 ? elevationHours : null,
    expectedVersion,
    now: new Date(),
  });
  revalidatePath("/api-sync");
  redirect(`/api-sync?result=${result}`);
}
