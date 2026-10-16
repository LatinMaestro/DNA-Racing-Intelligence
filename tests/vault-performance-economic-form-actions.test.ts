import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => null),
}));
const persistence = vi.hoisted(() => ({
  factory: vi.fn((): unknown => ({ status: "not_configured" })),
}));

vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: session.ownerId,
}));
vi.mock("../lib/neon-manual-ledger-write-repository", () => ({
  neonManualLedgerPersistenceFromEnvironment: persistence.factory,
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

  it("records a strict owner-scoped manual ledger form through the persisted context", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    vi.stubEnv("DATABASE_URL", "postgresql://synthetic.invalid/db");
    vi.stubEnv("DNA_DATABASE_OWNER_ID", "91500000-0000-4000-8000-000000000001");
    vi.stubEnv("DNA_DATABASE_RUNTIME_ROLE", "dna_app_runtime");
    session.ownerId.mockResolvedValueOnce("owner-1");
    const saveEntryByOwner = vi.fn(async () => ({
      status: "created" as const,
      ledgerVersion: "8",
    }));
    persistence.factory.mockReturnValueOnce({
      status: "ready",
      repository: {
        status: "ready",
        loadTournamentCampaignBindingByOwner: vi.fn(async () => null),
        saveEntryByOwner,
        loadEntryByOwner: vi.fn(async () => null),
        saveReversalByOwner: vi.fn(),
      },
      loadContextByOwner: vi.fn(async () => ({
        assetRegistry: {
          status: "ready",
          version: "a".repeat(64),
          assets: [{ code: "ETH", kind: "crypto", precision: 18 }],
        },
        ledgerVersion: "7",
      })),
    });
    const formData = new FormData();
    formData.set("occurredAt", "2026-07-26T10:00:00+10:00");
    formData.set("assetCode", "ETH");
    formData.set("assetKind", "crypto");
    formData.set("amount", "1.25");
    formData.set("category", "income");
    formData.set("subcategory", "other_income");
    formData.set("accountLabel", "Owner account");

    await expect(recordManualLedgerFormAction(formData)).resolves.toMatchObject(
      { status: "recorded", submittedValuesEchoed: false },
    );
    expect(saveEntryByOwner).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({
        assetCode: "ETH",
        amount: "1.25",
        category: "income",
      }),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      "7",
    );
  });
});
