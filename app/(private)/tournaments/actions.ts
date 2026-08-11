"use server";

import { revalidatePath } from "next/cache";

import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonTournamentConfigurationWriteRepositoryFromEnvironment } from "@/lib/neon-tournament-configuration-write-repository";
import {
  parseTournamentConfigurationFormData,
  saveTournamentConfiguration,
} from "@/lib/tournament-configuration-write-service";

function databaseEnvironment() {
  return {
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  };
}

export async function saveTournamentConfigurationAction(
  formData: FormData,
): Promise<void> {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const configuration = parseTournamentConfigurationFormData(formData);

  await saveTournamentConfiguration({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: neonTournamentConfigurationWriteRepositoryFromEnvironment(
      databaseEnvironment(),
    ),
    configuration,
  });

  revalidatePath("/tournaments");
  revalidatePath("/discovery");
}
