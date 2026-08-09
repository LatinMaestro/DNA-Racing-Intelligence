import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: session.ownerId,
}));

import {
  recordManualLedgerFormAction,
  recordManualTournamentPayoutFormAction,
} from "../app/(private)/vault-performance/actions";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Vault Performance economic FormData Server Actions", () => {
  it("resolves owner identity inside each request and fails closed when signed out", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce(null);

    await expect(
      recordManualLedgerFormAction(new FormData()),
    ).resolves.toMatchObject({
      status: "identity_not_connected",
      title: "Owner verification required",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
    expect(session.ownerId).toHaveBeenCalledWith({
      environment: { publishableKey: undefined, secretKey: undefined },
    });
  });

  it("denies a signed-in non-owner without parsing submitted values", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValueOnce("other-owner");
    const formData = new FormData();
    formData.set("unknown_private_field", "private synthetic value");

    const action = await recordManualLedgerFormAction(formData);

    expect(action).toMatchObject({
      status: "identity_not_connected",
      submittedValuesEchoed: false,
      rawErrorEchoed: false,
    });
    expect(JSON.stringify(action)).not.toContain("unknown_private_field");
    expect(JSON.stringify(action)).not.toContain("private synthetic value");
  });

  it("keeps both strict parsers unreachable until persistence is connected", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    session.ownerId.mockResolvedValue("owner-1");
    const intentionallyInvalid = new FormData();
    intentionallyInvalid.set(
      "unknown_private_field",
      "private synthetic value",
    );

    await expect(
      recordManualLedgerFormAction(intentionallyInvalid),
    ).resolves.toMatchObject({
      status: "persistence_not_configured",
      title: "Evidence recording is unavailable",
    });
    await expect(
      recordManualTournamentPayoutFormAction(intentionallyInvalid),
    ).resolves.toMatchObject({
      status: "persistence_not_configured",
      title: "Evidence recording is unavailable",
    });
    expect(session.ownerId).toHaveBeenCalledTimes(2);
  });
});
