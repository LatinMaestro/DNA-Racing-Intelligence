"use server";

import { revalidatePath } from "next/cache";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  createHostedProLeagueRosterWriteRepository,
  loadHostedProLeagueCommissioningState,
  type HostedProLeagueEnvironment,
} from "@/lib/hosted-pro-league-page-runtime";

function value(formData: FormData, field: string): string {
  const supplied = formData.get(field);
  return typeof supplied === "string" ? supplied.trim() : "";
}

function environment(): HostedProLeagueEnvironment {
  return {
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
  };
}

export async function confirmProLeaguePlanAction(formData: FormData) {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const hostedEnvironment = environment();
  if (
    authenticatedOwnerId === null ||
    hostedEnvironment.configuredOwnerId === null ||
    authenticatedOwnerId !== hostedEnvironment.configuredOwnerId
  ) {
    throw new Error("Pro League owner confirmation access denied.");
  }
  if (value(formData, "confirmed") !== "confirmed") {
    throw new Error("Pro League persistence confirmation is required.");
  }
  const commissioning = await loadHostedProLeagueCommissioningState({
    authenticatedOwnerId,
    environment: hostedEnvironment,
    now: new Date(),
  });
  const roster = commissioning.roster?.draftRoster ?? null;
  const ownerPlan = commissioning.ownerPlan;
  const generationId = commissioning.evidence?.generationId ?? null;
  if (
    commissioning.connectionStatus !== "read_model_connected" ||
    roster === null ||
    ownerPlan === undefined ||
    ownerPlan.roster.length !== 25 ||
    ownerPlan.allSlotsFilled !== true ||
    generationId === null ||
    value(formData, "expectedGenerationId") !== generationId ||
    value(formData, "expectedRosterVersionId") !== roster.rosterVersionId
  ) {
    throw new Error(
      "Pro League accepted evidence changed before confirmation.",
    );
  }
  const repository =
    createHostedProLeagueRosterWriteRepository(hostedEnvironment);
  await repository.saveVersion(authenticatedOwnerId, roster);
  revalidatePath("/pro-league");
}

export async function confirmProLeaguePlanFormAction(
  _previousState: "idle" | "confirmed" | "unconfirmed",
  formData: FormData,
): Promise<"confirmed" | "unconfirmed"> {
  try {
    await confirmProLeaguePlanAction(formData);
    return "confirmed";
  } catch {
    return "unconfirmed";
  }
}
