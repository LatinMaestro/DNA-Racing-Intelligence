import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => null),
}));
const persistence = vi.hoisted(() => ({
  factory: vi.fn((): unknown => ({ status: "not_configured" })),
}));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: session.ownerId,
}));
vi.mock("../lib/neon-open-race-workspace-repository", () => ({
  neonOpenRaceWorkspaceRepositoryFromEnvironment: persistence.factory,
}));
vi.mock("next/cache", () => ({ revalidatePath: cache.revalidatePath }));

import {
  lockOpenRaceSessionAction,
  recordOpenRaceObservationAction,
} from "../app/(private)/open-race/actions";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function confirmedForm() {
  const formData = new FormData();
  formData.set("requestId", "request-1");
  formData.set("selectedOwnedCoreId", "owned-1");
  formData.set("userConfirmedCommittedEntry", "confirmed");
  formData.set("raceSetToRun", "confirmed");
  return formData;
}

function observationForm() {
  const formData = new FormData();
  formData.set("requestId", "request-1");
  formData.set("gold", "core:opponent-1");
  formData.set("blue", "core:owned-1");
  formData.set("starsRevealedAfterLock", "confirmed");
  formData.set("gameEventId", "event-1");
  return formData;
}

describe("Open Race field lock Server Action", () => {
  it("fails closed before persistence when owner identity is unavailable", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce(null);
    await expect(lockOpenRaceSessionAction(confirmedForm())).rejects.toThrow(
      "Open Race owner identity is not connected.",
    );
    expect(persistence.factory).not.toHaveBeenCalled();
  });

  it("requires both explicit confirmations", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");
    const formData = confirmedForm();
    formData.delete("raceSetToRun");
    await expect(lockOpenRaceSessionAction(formData)).rejects.toThrow(
      "Open Race field lock confirmation is incomplete.",
    );
    expect(persistence.factory).not.toHaveBeenCalled();
  });

  it("records only owner-confirmed evidence and refreshes the private page", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    vi.stubEnv("DATABASE_URL", "postgresql://synthetic.invalid/db");
    vi.stubEnv("DNA_DATABASE_OWNER_ID", "91340000-0000-4000-8000-000000000001");
    vi.stubEnv("DNA_DATABASE_RUNTIME_ROLE", "dna_app_runtime");
    session.ownerId.mockResolvedValueOnce("owner-1");
    const lockSessionByOwner = vi.fn(async () => ({
      status: "published" as const,
    }));
    persistence.factory.mockReturnValueOnce({
      status: "ready",
      listSessionEvidenceByOwner: vi.fn(),
      lockSessionByOwner,
    });

    await expect(
      lockOpenRaceSessionAction(confirmedForm()),
    ).resolves.toBeUndefined();
    expect(lockSessionByOwner).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({
        requestId: "request-1",
        selectedOwnedCoreId: "owned-1",
        userConfirmedCommittedEntry: true,
        raceSetToRun: true,
      }),
    );
    expect(cache.revalidatePath).toHaveBeenCalledWith("/open-race");
  });

  it("requires refresh when the accepted source changed", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");
    persistence.factory.mockReturnValueOnce({
      status: "ready",
      listSessionEvidenceByOwner: vi.fn(),
      lockSessionByOwner: vi.fn(async () => ({
        status: "source_changed" as const,
      })),
    });
    await expect(lockOpenRaceSessionAction(confirmedForm())).rejects.toThrow(
      "Open Race evidence changed; refresh before locking.",
    );
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("Open Race observation Server Action", () => {
  it("requires explicit post-lock confirmation", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");
    const formData = observationForm();
    formData.delete("starsRevealedAfterLock");
    await expect(recordOpenRaceObservationAction(formData)).rejects.toThrow(
      "Open Race star observation is incomplete.",
    );
    expect(persistence.factory).not.toHaveBeenCalled();
  });

  it("passes only bounded manual signals to owner-scoped persistence", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");
    const recordObservationByOwner = vi.fn(async () => ({
      status: "published" as const,
    }));
    persistence.factory.mockReturnValueOnce({
      status: "ready",
      listSessionEvidenceByOwner: vi.fn(),
      recordObservationByOwner,
    });
    await expect(
      recordOpenRaceObservationAction(observationForm()),
    ).resolves.toBeUndefined();
    expect(recordObservationByOwner).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({
        requestId: "request-1",
        gold: { status: "assigned", coreId: "opponent-1" },
        blue: { status: "assigned", coreId: "owned-1" },
        gameEventId: "event-1",
      }),
    );
    expect(cache.revalidatePath).toHaveBeenCalledWith("/open-race");
  });

  it("rejects unsupported signal values before persistence", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("owner-1");
    const formData = observationForm();
    formData.set("blue", "not_applicable");
    persistence.factory.mockReturnValueOnce({
      status: "ready",
      listSessionEvidenceByOwner: vi.fn(),
      recordObservationByOwner: vi.fn(),
    });
    await expect(recordOpenRaceObservationAction(formData)).rejects.toThrow(
      "Open Race star observation is incomplete.",
    );
  });
});
