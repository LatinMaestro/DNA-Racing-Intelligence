import { describe, expect, it, vi } from "vitest";

import { resolveVaultPerformanceEconomicWriteStatus } from "@/lib/vault-performance-economic-write-status-service";

const owner = "user_owner";
const context = Object.freeze({
  assetRegistry: Object.freeze({
    status: "ready" as const,
    version: "a".repeat(64),
    assets: Object.freeze([
      Object.freeze({ code: "DEZ", kind: "crypto" as const, precision: 18 }),
    ]),
  }),
  ledgerVersion: "ledger-1",
});

describe("Vault Performance economic write capability", () => {
  it("fails closed when the accepted asset registry is unavailable", async () => {
    const status = await resolveVaultPerformanceEconomicWriteStatus({
      authenticatedOwnerId: owner,
      configuredOwnerId: owner,
      manualLedgerPersistence: {
        status: "ready",
        repository: { status: "ready" } as never,
        loadContextByOwner: vi.fn(async () => {
          throw new Error("empty accepted registry");
        }),
      },
      tournamentPayoutPersistence: {
        status: "ready",
        repository: { status: "ready" } as never,
        loadContextByOwner: vi.fn(async () => context),
      },
    });

    expect(status).toBe("asset_registry_unavailable");
  });

  it("enables payout writes only when both accepted contexts agree", async () => {
    const status = await resolveVaultPerformanceEconomicWriteStatus({
      authenticatedOwnerId: owner,
      configuredOwnerId: owner,
      manualLedgerPersistence: {
        status: "ready",
        repository: { status: "ready" } as never,
        loadContextByOwner: vi.fn(async () => context),
      },
      tournamentPayoutPersistence: {
        status: "ready",
        repository: { status: "ready" } as never,
        loadContextByOwner: vi.fn(async () => context),
      },
    });

    expect(status).toBe("tournament_payout_ready");
  });

  it("rejects an authenticated owner outside the configured allowlist", async () => {
    await expect(
      resolveVaultPerformanceEconomicWriteStatus({
        authenticatedOwnerId: "user_wrong",
        configuredOwnerId: owner,
        manualLedgerPersistence: { status: "not_configured" },
        tournamentPayoutPersistence: { status: "not_configured" },
      }),
    ).rejects.toThrow("access denied");
  });
});
