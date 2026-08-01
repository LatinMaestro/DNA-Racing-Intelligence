import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ValidatedManualLedgerEntry } from "@/domain/manual-ledger";
import {
  recordManualLedgerEntry,
  reverseManualLedgerEntry,
  unavailableManualLedgerAssetRegistry,
  unavailableManualLedgerWriteRepository,
  type ManualLedgerWriteRepository,
} from "@/lib/manual-ledger-write-service";

const assetRegistry = {
  status: "ready" as const,
  version: "assets-v1",
  assets: [
    { code: "ETH", kind: "crypto" as const, precision: 18 },
    { code: "BGC", kind: "game_credit" as const, precision: 0 },
  ],
};
const entryInput = {
  entryId: "synthetic-entry",
  occurredAt: "2026-07-20T00:00:00Z",
  assetCode: "eth",
  assetKind: "crypto" as const,
  amount: "1.25",
  category: "income" as const,
  subcategory: "other_income" as const,
  accountLabel: "Synthetic account",
};
const common = {
  authenticatedOwnerId: "owner",
  configuredOwnerId: "owner",
  assetRegistry,
  expectedAssetRegistryVersion: "assets-v1",
  expectedLedgerVersion: "ledger-v1",
  serverNow: "2026-07-21T00:00:00Z",
};

function readyRepository(
  overrides: Partial<
    Extract<ManualLedgerWriteRepository, { status: "ready" }>
  > = {},
): Extract<ManualLedgerWriteRepository, { status: "ready" }> {
  return {
    status: "ready",
    loadTournamentCampaignBindingByOwner: async () => null,
    saveEntryByOwner: async () => ({
      status: "created",
      ledgerVersion: "ledger-v2",
    }),
    loadEntryByOwner: async () => null,
    saveReversalByOwner: async () => ({
      status: "created",
      ledgerVersion: "ledger-v2",
    }),
    ...overrides,
  };
}
function hash(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("manual ledger write service", () => {
  it("fails closed before validation when identity, persistence or registry is unavailable", async () => {
    await expect(
      recordManualLedgerEntry({
        ...common,
        authenticatedOwnerId: null,
        repository: unavailableManualLedgerWriteRepository,
        entry: entryInput,
      }),
    ).resolves.toEqual({ status: "identity_not_connected" });
    await expect(
      recordManualLedgerEntry({
        ...common,
        repository: unavailableManualLedgerWriteRepository,
        entry: entryInput,
      }),
    ).resolves.toEqual({ status: "persistence_not_configured" });
    await expect(
      recordManualLedgerEntry({
        ...common,
        repository: readyRepository(),
        assetRegistry: unavailableManualLedgerAssetRegistry,
        entry: entryInput,
      }),
    ).resolves.toEqual({ status: "asset_registry_not_configured" });
  });

  it("denies another owner before any repository access", async () => {
    const saveEntryByOwner = vi.fn(async () => ({
      status: "created" as const,
      ledgerVersion: "ledger-v2",
    }));
    await expect(
      recordManualLedgerEntry({
        ...common,
        authenticatedOwnerId: "other",
        repository: readyRepository({ saveEntryByOwner }),
        entry: entryInput,
      }),
    ).rejects.toThrow("access denied");
    expect(saveEntryByOwner).not.toHaveBeenCalled();
  });

  it("binds entry persistence to registry and optimistic ledger versions", async () => {
    const saveEntryByOwner = vi.fn(
      async (
        _owner: string,
        entry: ValidatedManualLedgerEntry,
        suppliedFingerprint: string,
        expectedVersion: string,
      ) => {
        expect(entry).toMatchObject({
          assetCode: "ETH",
          assetKind: "crypto",
          assetRegistryVersion: "assets-v1",
          assetPrecision: 18,
        });
        expect(suppliedFingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(expectedVersion).toBe("ledger-v1");
        return { status: "created" as const, ledgerVersion: "ledger-v2" };
      },
    );
    await expect(
      recordManualLedgerEntry({
        ...common,
        repository: readyRepository({ saveEntryByOwner }),
        entry: entryInput,
      }),
    ).resolves.toMatchObject({
      status: "recorded",
      ledgerVersion: "ledger-v2",
      completeness: "complete",
    });
    expect(saveEntryByOwner).toHaveBeenCalledOnce();

    await expect(
      recordManualLedgerEntry({
        ...common,
        expectedAssetRegistryVersion: "assets-old",
        repository: readyRepository(),
        entry: entryInput,
      }),
    ).rejects.toThrow("registry changed");
    await expect(
      recordManualLedgerEntry({
        ...common,
        repository: readyRepository({
          saveEntryByOwner: async () => ({
            status: "version_conflict",
            ledgerVersion: "ledger-v3",
          }),
        }),
        entry: entryInput,
      }),
    ).rejects.toThrow("refresh");
  });

  it("replays only an exact durable fingerprint and rejects conflicting reuse", async () => {
    let storedFingerprint = "";
    const recorded = await recordManualLedgerEntry({
      ...common,
      repository: readyRepository({
        saveEntryByOwner: async (_owner, _entry, fingerprint) => {
          storedFingerprint = fingerprint;
          return { status: "created", ledgerVersion: "ledger-v2" };
        },
      }),
      entry: entryInput,
    });
    await expect(
      recordManualLedgerEntry({
        ...common,
        repository: readyRepository({
          saveEntryByOwner: async () => ({
            status: "already_exists",
            fingerprint: storedFingerprint,
            ledgerVersion: "ledger-v2",
          }),
        }),
        entry: entryInput,
      }),
    ).resolves.toMatchObject({
      status: "replayed",
      fingerprint: recorded.status === "recorded" ? recorded.fingerprint : "",
    });
    await expect(
      recordManualLedgerEntry({
        ...common,
        repository: readyRepository({
          saveEntryByOwner: async () => ({
            status: "conflict",
            fingerprint: "b".repeat(64),
            ledgerVersion: "ledger-v2",
          }),
        }),
        entry: entryInput,
      }),
    ).rejects.toThrow("conflicts");
  });

  it("requires persisted owner acknowledgement and exact campaign/config evidence for tournament totals", async () => {
    const binding = {
      tournamentId: "synthetic-tournament",
      evidenceId: "evidence-v1",
      configurationVersion: "config-v1",
      ownerAcknowledgedAt: "2026-07-19T00:00:00Z",
    };
    const tournamentEntry = {
      ...entryInput,
      subcategory: "manual_tournament_payout" as const,
      tournamentId: "synthetic-tournament",
    };
    await expect(
      recordManualLedgerEntry({
        ...common,
        repository: readyRepository(),
        entry: tournamentEntry,
      }),
    ).resolves.toMatchObject({
      status: "recorded",
      tournamentAggregationEligible: false,
      completeness: "partial",
    });
    await expect(
      recordManualLedgerEntry({
        ...common,
        repository: readyRepository({
          loadTournamentCampaignBindingByOwner: async () => binding,
        }),
        expectedTournamentEvidenceId: "evidence-v1",
        expectedTournamentConfigurationVersion: "config-v1",
        entry: tournamentEntry,
      }),
    ).resolves.toMatchObject({
      status: "recorded",
      tournamentAggregationEligible: true,
    });
    await expect(
      recordManualLedgerEntry({
        ...common,
        repository: readyRepository({
          loadTournamentCampaignBindingByOwner: async () => binding,
        }),
        expectedTournamentEvidenceId: "stale",
        expectedTournamentConfigurationVersion: "config-v1",
        entry: tournamentEntry,
      }),
    ).rejects.toThrow("binding changed");
  });

  it("creates one exact registry-bound reversal and makes the repository enforce single reversal", async () => {
    let original: ValidatedManualLedgerEntry | null = null;
    let originalFingerprint = "";
    await recordManualLedgerEntry({
      ...common,
      repository: readyRepository({
        saveEntryByOwner: async (_owner, entry, fingerprint) => {
          original = entry;
          originalFingerprint = fingerprint;
          return { status: "created", ledgerVersion: "ledger-v2" };
        },
      }),
      entry: {
        ...entryInput,
        assetCode: "BGC",
        assetKind: "game_credit",
        amount: "5",
        subcategory: "burn_bgc_credit",
        coreIds: ["synthetic-core"],
      },
    });
    expect(hash(original!)).toBe(originalFingerprint);
    const saveReversalByOwner = vi.fn(
      async (
        _owner: string,
        reversal: Parameters<
          Extract<
            ManualLedgerWriteRepository,
            { status: "ready" }
          >["saveReversalByOwner"]
        >[1],
        _fingerprint: string,
        expectedVersion: string,
        expectedOriginal: string,
      ) => {
        expect(reversal).toMatchObject({
          assetCode: "BGC",
          assetKind: "game_credit",
          assetRegistryVersion: "assets-v1",
          postings: [{ signedAmount: "-5" }],
          sourceFactsMutated: false,
        });
        expect(expectedVersion).toBe("ledger-v2");
        expect(expectedOriginal).toBe(originalFingerprint);
        return { status: "created" as const, ledgerVersion: "ledger-v3" };
      },
    );
    await expect(
      reverseManualLedgerEntry({
        ...common,
        expectedLedgerVersion: "ledger-v2",
        repository: readyRepository({
          loadEntryByOwner: async () => ({
            entry: original!,
            fingerprint: originalFingerprint,
          }),
          saveReversalByOwner,
        }),
        reversalId: "synthetic-reversal",
        originalEntryId: "synthetic-entry",
        reversedAt: "2026-07-21T00:00:00Z",
        reason: "Synthetic correction",
      }),
    ).resolves.toMatchObject({
      status: "recorded",
      ledgerVersion: "ledger-v3",
    });
    await expect(
      reverseManualLedgerEntry({
        ...common,
        expectedLedgerVersion: "ledger-v2",
        repository: readyRepository({
          loadEntryByOwner: async () => ({
            entry: original!,
            fingerprint: originalFingerprint,
          }),
          saveReversalByOwner: async () => ({
            status: "original_already_reversed",
            reversalId: "prior-reversal",
            ledgerVersion: "ledger-v3",
          }),
        }),
        reversalId: "different-reversal",
        originalEntryId: "synthetic-entry",
        reversedAt: "2026-07-21T00:00:00Z",
        reason: "Duplicate correction",
      }),
    ).rejects.toThrow("already reversed");
  });

  it("rejects future, pre-original and fingerprint-invalid reversals", async () => {
    let original: ValidatedManualLedgerEntry | null = null;
    await recordManualLedgerEntry({
      ...common,
      repository: readyRepository({
        saveEntryByOwner: async (_owner, entry) => {
          original = entry;
          return { status: "created", ledgerVersion: "ledger-v2" };
        },
      }),
      entry: entryInput,
    });
    const validFingerprint = hash(original!);
    const base = {
      ...common,
      expectedLedgerVersion: "ledger-v2",
      repository: readyRepository({
        loadEntryByOwner: async () => ({
          entry: original!,
          fingerprint: validFingerprint,
        }),
      }),
      reversalId: "synthetic-reversal",
      originalEntryId: "synthetic-entry",
      reason: "Synthetic correction",
    };
    await expect(
      reverseManualLedgerEntry({ ...base, reversedAt: "2026-07-22T00:00:00Z" }),
    ).rejects.toThrow("future");
    await expect(
      reverseManualLedgerEntry({ ...base, reversedAt: "2026-07-19T00:00:00Z" }),
    ).rejects.toThrow("predate");
    await expect(
      reverseManualLedgerEntry({
        ...base,
        repository: readyRepository({
          loadEntryByOwner: async () => ({
            entry: original!,
            fingerprint: "f".repeat(64),
          }),
        }),
        reversedAt: "2026-07-21T00:00:00Z",
      }),
    ).rejects.toThrow("fingerprint");
  });
});
