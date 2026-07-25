import { describe, expect, it, vi } from "vitest";
import type { ValidatedManualLedgerEntry } from "@/domain/manual-ledger";
import {
  recordManualLedgerEntry,
  reverseManualLedgerEntry,
  unavailableManualLedgerWriteRepository,
  type ManualLedgerWriteRepository,
} from "@/lib/manual-ledger-write-service";

const entryInput = {
  entryId: "synthetic-entry",
  occurredAt: "2026-07-20T00:00:00.000Z",
  assetCode: "eth",
  assetKind: "crypto" as const,
  amount: "1.25",
  category: "income" as const,
  subcategory: "other_income",
  accountLabel: "Synthetic account",
  note: "Synthetic evidence.",
};

function readyRepository(
  overrides: Partial<
    Extract<ManualLedgerWriteRepository, { status: "ready" }>
  > = {},
): Extract<ManualLedgerWriteRepository, { status: "ready" }> {
  return {
    status: "ready",
    saveEntryByOwner: async () => ({ status: "created" }),
    loadEntryByOwner: async () => null,
    saveReversalByOwner: async () => ({ status: "created" }),
    ...overrides,
  };
}

describe("Manual ledger write service", () => {
  it("returns fail-closed states before validation or persistence", async () => {
    await expect(
      recordManualLedgerEntry({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableManualLedgerWriteRepository,
        entry: entryInput,
      }),
    ).resolves.toEqual({ status: "identity_not_connected" });
    await expect(
      recordManualLedgerEntry({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableManualLedgerWriteRepository,
        entry: entryInput,
      }),
    ).resolves.toEqual({ status: "persistence_not_configured" });
  });

  it("denies a different owner before persistence", async () => {
    const saveEntryByOwner = vi.fn(async () => ({
      status: "created" as const,
    }));
    await expect(
      recordManualLedgerEntry({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: readyRepository({ saveEntryByOwner }),
        entry: entryInput,
      }),
    ).rejects.toThrow("access denied");
    expect(saveEntryByOwner).not.toHaveBeenCalled();
  });

  it("records exact validated evidence and replays only the same fingerprint", async () => {
    let fingerprint = "";
    const repository = readyRepository({
      saveEntryByOwner: async (ownerId, entry, suppliedFingerprint) => {
        expect(ownerId).toBe("owner");
        expect(entry).toMatchObject({
          entryId: "synthetic-entry",
          assetCode: "ETH",
          amount: "1.25",
        });
        fingerprint = suppliedFingerprint;
        return { status: "created" };
      },
    });
    const recorded = await recordManualLedgerEntry({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository,
      entry: entryInput,
    });
    expect(recorded).toMatchObject({
      status: "recorded",
      entryId: "synthetic-entry",
      completeness: "complete",
    });
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      recordManualLedgerEntry({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          saveEntryByOwner: async () => ({
            status: "already_exists",
            fingerprint,
          }),
        }),
        entry: entryInput,
      }),
    ).resolves.toMatchObject({ status: "replayed", fingerprint });
  });

  it("rejects durable-ID conflicts", async () => {
    await expect(
      recordManualLedgerEntry({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          saveEntryByOwner: async () => ({
            status: "conflict",
            fingerprint: "b".repeat(64),
          }),
        }),
        entry: entryInput,
      }),
    ).rejects.toThrow("conflicts");
  });

  it("creates an auditable exact reversal without mutating source facts", async () => {
    const original: ValidatedManualLedgerEntry = {
      entryId: "synthetic-entry",
      occurredAt: "2026-07-20T00:00:00.000Z",
      assetCode: "BGC",
      assetKind: "game_credit",
      amount: "5",
      category: "income",
      subcategory: "burn_bgc_credit",
      tournamentId: null,
      coreIds: ["synthetic-core"],
      externalReference: null,
      note: null,
      postings: [
        {
          postingId: "synthetic-entry:primary",
          accountLabel: "BGC",
          assetCode: "BGC",
          assetKind: "game_credit",
          signedAmount: "5",
          category: "income",
          subcategory: "burn_bgc_credit",
          operating: true,
        },
      ],
      warnings: [],
      completeness: "complete",
    };
    let saved = false;
    const result = await reverseManualLedgerEntry({
      authenticatedOwnerId: "owner",
      configuredOwnerId: "owner",
      repository: readyRepository({
        loadEntryByOwner: async () => original,
        saveReversalByOwner: async (ownerId, reversal, fingerprint) => {
          expect(ownerId).toBe("owner");
          expect(reversal).toMatchObject({
            reversalId: "synthetic-reversal",
            originalEntryId: "synthetic-entry",
            assetCode: "BGC",
            assetKind: "game_credit",
            sourceFactsMutated: false,
            postings: [
              {
                originalPostingId: "synthetic-entry:primary",
                signedAmount: "-5",
                operating: true,
              },
            ],
          });
          expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
          saved = true;
          return { status: "created" };
        },
      }),
      reversalId: "synthetic-reversal",
      originalEntryId: "synthetic-entry",
      reversedAt: "2026-07-21T00:00:00.000Z",
      reason: "Synthetic correction.",
    });
    expect(saved).toBe(true);
    expect(result).toMatchObject({
      status: "recorded",
      reversalId: "synthetic-reversal",
      originalEntryId: "synthetic-entry",
    });
  });

  it("rejects missing and chronologically invalid reversal targets", async () => {
    await expect(
      reverseManualLedgerEntry({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository(),
        reversalId: "synthetic-reversal",
        originalEntryId: "missing",
        reversedAt: "2026-07-21T00:00:00.000Z",
        reason: "Synthetic correction.",
      }),
    ).rejects.toThrow("not found");

    const captured: ValidatedManualLedgerEntry = {
      ...(await (async () => {
        let value: ValidatedManualLedgerEntry | null = null;
        await recordManualLedgerEntry({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: readyRepository({
            saveEntryByOwner: async (_ownerId, entry) => {
              value = entry;
              return { status: "created" };
            },
          }),
          entry: entryInput,
        });
        return value!;
      })()),
    };
    await expect(
      reverseManualLedgerEntry({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: readyRepository({
          loadEntryByOwner: async () => captured,
        }),
        reversalId: "synthetic-reversal",
        originalEntryId: captured.entryId,
        reversedAt: "2026-07-19T00:00:00.000Z",
        reason: "Synthetic correction.",
      }),
    ).rejects.toThrow("predate");
  });
});
