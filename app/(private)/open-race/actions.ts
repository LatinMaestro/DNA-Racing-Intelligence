"use server";

import { revalidatePath } from "next/cache";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonOpenRaceWorkspaceRepositoryFromEnvironment } from "@/lib/neon-open-race-workspace-repository";

function value(formData: FormData, field: string): string {
  const supplied = formData.get(field);
  return typeof supplied === "string" ? supplied.trim() : "";
}

function optionalValue(formData: FormData, field: string): string | null {
  const supplied = value(formData, field);
  return supplied === "" ? null : supplied;
}

function observationSignal(
  supplied: string,
  gold: true,
):
  | Readonly<{ status: "assigned"; coreId: string }>
  | Readonly<{
      status: "not_assigned" | "not_observed" | "not_applicable";
    }>;
function observationSignal(
  supplied: string,
  gold: false,
):
  | Readonly<{ status: "assigned"; coreId: string }>
  | Readonly<{ status: "not_assigned" | "not_observed" }>;
function observationSignal(supplied: string, gold: boolean) {
  if (supplied.startsWith("core:") && supplied.length > 5) {
    return { status: "assigned", coreId: supplied.slice(5) };
  }
  if (supplied === "not_assigned" || supplied === "not_observed") {
    return { status: supplied };
  }
  if (gold && supplied === "not_applicable") {
    return { status: "not_applicable" };
  }
  throw new Error("Open Race star observation is incomplete.");
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

export async function recordOpenRaceObservationAction(formData: FormData) {
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
    throw new Error("Open Race observation access denied.");
  }
  const requestId = value(formData, "requestId");
  const confirmed = value(formData, "starsRevealedAfterLock") === "confirmed";
  const gameEventId = optionalValue(formData, "gameEventId");
  const note = optionalValue(formData, "note");
  if (
    requestId === "" ||
    !confirmed ||
    (gameEventId !== null && gameEventId.length > 128) ||
    (note !== null && note.length > 500)
  ) {
    throw new Error("Open Race star observation is incomplete.");
  }
  const repository = neonOpenRaceWorkspaceRepositoryFromEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
    authenticatedOwnerId,
  });
  if (
    repository.status !== "ready" ||
    repository.recordObservationByOwner === undefined
  ) {
    throw new Error("Open Race workspace persistence is not configured.");
  }
  const result = await repository.recordObservationByOwner(
    authenticatedOwnerId,
    {
      requestId,
      observedAt: new Date().toISOString(),
      gameEventId,
      gold: observationSignal(value(formData, "gold"), true),
      blue: observationSignal(value(formData, "blue"), false),
      note,
    },
  );
  if (result.status === "source_changed") {
    throw new Error("Open Race evidence changed; refresh before recording.");
  }
  if (result.status === "not_found") {
    throw new Error("Open Race session is no longer available.");
  }
  revalidatePath("/open-race");
}

/** Form adapters retain server-side owner checks and never expose provider errors. */
export async function lockOpenRaceSessionFormAction(
  _previousState: "idle" | "confirmed" | "unconfirmed",
  formData: FormData,
): Promise<"confirmed" | "unconfirmed"> {
  try {
    await lockOpenRaceSessionAction(formData);
    return "confirmed";
  } catch {
    // A persistence or revalidation failure can occur after commit. Do not retry.
    return "unconfirmed";
  }
}

export async function recordOpenRaceObservationFormAction(
  _previousState: "idle" | "confirmed" | "unconfirmed",
  formData: FormData,
): Promise<"confirmed" | "unconfirmed"> {
  try {
    await recordOpenRaceObservationAction(formData);
    return "confirmed";
  } catch {
    return "unconfirmed";
  }
}
