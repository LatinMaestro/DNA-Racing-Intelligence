"use server";

import { revalidatePath } from "next/cache";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonOpenRaceWorkspaceRepositoryFromEnvironment } from "@/lib/neon-open-race-workspace-repository";

function value(formData: FormData, field: string): string {
  const supplied = formData.get(field);
  return typeof supplied === "string" ? supplied.trim() : "";
}

export async function lockOpenRaceSessionAction(formData: FormData) {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const configuredOwnerId = process.env.AUTHORIZED_CLERK_USER_ID?.trim() ?? "";
  if (authenticatedOwnerId === null || configuredOwnerId === "") {
    throw new Error("Open Race owner identity is not connected.");
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Open Race field lock access denied.");
  }
  const requestId = value(formData, "requestId");
  const selectedOwnedCoreId = value(formData, "selectedOwnedCoreId");
  const userConfirmedCommittedEntry =
    value(formData, "userConfirmedCommittedEntry") === "confirmed";
  const raceSetToRun = value(formData, "raceSetToRun") === "confirmed";
  if (
    requestId === "" ||
    selectedOwnedCoreId === "" ||
    !userConfirmedCommittedEntry ||
    !raceSetToRun
  ) {
    throw new Error("Open Race field lock confirmation is incomplete.");
  }
  const repository = neonOpenRaceWorkspaceRepositoryFromEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
    authenticatedOwnerId,
  });
  if (
    repository.status !== "ready" ||
    repository.lockSessionByOwner === undefined
  ) {
    throw new Error("Open Race workspace persistence is not configured.");
  }
  const result = await repository.lockSessionByOwner(authenticatedOwnerId, {
    requestId,
    selectedOwnedCoreId,
    lockedAt: new Date().toISOString(),
    userConfirmedCommittedEntry,
    raceSetToRun,
  });
  if (result.status === "source_changed") {
    throw new Error("Open Race evidence changed; refresh before locking.");
  }
  if (result.status === "not_found") {
    throw new Error("Open Race session is no longer available.");
  }
  revalidatePath("/open-race");
}
