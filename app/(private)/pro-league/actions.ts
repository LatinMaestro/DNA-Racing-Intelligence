"use server";

import { revalidatePath } from "next/cache";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  createHostedProLeagueLineupWriteRepository,
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
  const lineup = commissioning.lineup?.lineup ?? null;
  const generationId = commissioning.evidence?.generationId ?? null;
  if (
    commissioning.connectionStatus !== "read_model_connected" ||
    roster === null ||
    lineup === null ||
    lineup.rosterVersionId !== roster.rosterVersionId ||
    lineup.maps.length !== 4 ||
    lineup.maps.flatMap(({ entries }) => entries).length !== 168 ||
    ownerPlan === undefined ||
    ownerPlan.roster.length !== 25 ||
    ownerPlan.allSlotsFilled !== true ||
    ownerPlan.requiredCoreEntries !== ownerPlan.assignedCoreEntries ||
    ownerPlan.requiredCoreEntries !== 1_021 ||
    generationId === null ||
    value(formData, "expectedGenerationId") !== generationId ||
    value(formData, "expectedRosterVersionId") !== roster.rosterVersionId ||
    value(formData, "expectedLineupVersionId") !== lineup.lineupVersionId
  ) {
    throw new Error(
      "Pro League accepted evidence changed before confirmation.",
    );
  }
  const rosterRepository =
    createHostedProLeagueRosterWriteRepository(hostedEnvironment);
  const lineupRepository =
    createHostedProLeagueLineupWriteRepository(hostedEnvironment);
  await rosterRepository.saveVersion(authenticatedOwnerId, roster);
  await lineupRepository.saveLineup(authenticatedOwnerId, lineup);
  await lineupRepository.saveFullGatePlan(
    authenticatedOwnerId,
    lineup.lineupVersionId,
    roster.rosterVersionId,
    ownerPlan,
  );
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
