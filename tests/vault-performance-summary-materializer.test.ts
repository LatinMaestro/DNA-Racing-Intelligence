import { describe, expect, it, vi } from "vitest";
import {
  materializeVaultPerformanceSummary,
  type VaultPerformanceCanonicalSourceState,
  type VaultPerformanceSummaryPublicationResult,
  type VaultPerformanceSummaryMaterializer,
} from "@/lib/vault-performance-summary-materializer";
import { decodeVaultPerformanceSummarySnapshot } from "@/lib/vault-performance-summary-snapshot";

const owner = "11111111-1111-4111-8111-111111111111";
const sourceLedgerSha256 = "a".repeat(64);
const now = new Date("2026-10-15T03:30:00.000Z");
const source: VaultPerformanceCanonicalSourceState = {
  sourceLedgerSha256,
  records: [
    {
      transactionId: "payout",
      occurredAt: "2026-10-15T02:00:00.000Z",
      assetCode: "DEZ",
      assetKind: "crypto",
      signedAmount: "9007199254740993.000000000000000001",
      category: "open_race_payout",
      operating: true,
      aggregateStatus: "included",
      classificationStatus: "confirmed",
      reconciliationStatus: "reconciled",
    },
    {
      transactionId: "transfer",
      occurredAt: "2026-10-15T02:10:00.000Z",
      assetCode: "ETH",
      assetKind: "crypto",
      signedAmount: "1.25",
      category: "internal_transfer",
      operating: false,
      aggregateStatus: "included",
      classificationStatus: "confirmed",
      reconciliationStatus: "reconciled",
    },
    {
      transactionId: "burn",
      occurredAt: "2026-10-15T02:20:00.000Z",
      assetCode: "BGC",
      assetKind: "game_credit",
      signedAmount: "8.5",
      category: "burn_bgc_credit",
      operating: true,
      aggregateStatus: "included",
      classificationStatus: "confirmed",
      reconciliationStatus: "reconciled",
    },
  ],
  coverage: {
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-10-31T23:59:59.000Z",
    sourceCoverage: "partial",
    manualTournamentPayoutStatus: "unknown",
    dataCurrentThrough: "2026-10-15T02:20:00.000Z",
    lastImported: "2026-10-15T03:00:00.000Z",
    freshnessState: "current",
  },
};

function harness(options?: {
  source?: VaultPerformanceCanonicalSourceState | null;
  publication?: "published" | "unchanged" | "source_changed";
}) {
  const loadCanonicalSource = vi.fn<
    VaultPerformanceSummaryMaterializer["loadCanonicalSource"]
  >(async (databaseOwnerId) => {
    void databaseOwnerId;
    return options && "source" in options ? (options.source ?? null) : source;
  });
  const publishCandidate = vi.fn<
    VaultPerformanceSummaryMaterializer["publishCandidate"]
  >(async (candidate) => {
    void candidate;
    return options?.publication ?? ("published" as const);
  });
  const materializer: VaultPerformanceSummaryMaterializer = {
    loadCanonicalSource,
    publishCandidate,
  };
  return { materializer, loadCanonicalSource, publishCandidate };
}

describe("Vault Performance summary materialization guard", () => {
  it("reuses exact accounting and submits one owner/source-bound CAS candidate", async () => {
    const h = harness();
    await expect(
      materializeVaultPerformanceSummary({
        databaseOwnerId: owner,
        materializer: h.materializer,
        now: () => now,
      }),
    ).resolves.toEqual({ status: "published" });

    expect(h.loadCanonicalSource).toHaveBeenCalledOnce();
    expect(h.loadCanonicalSource).toHaveBeenCalledWith(owner);
    expect(h.publishCandidate).toHaveBeenCalledOnce();
    const candidate = h.publishCandidate.mock.calls[0]?.[0];
    expect(candidate).toMatchObject({
      databaseOwnerId: owner,
      expectedSourceLedgerSha256: sourceLedgerSha256,
      materializedAt: now.toISOString(),
    });
    if (!candidate) throw new Error("candidate was not published");
    const summary = decodeVaultPerformanceSummarySnapshot({
      json: candidate.snapshotJson,
      sha256: candidate.snapshotSha256,
      databaseOwnerId: owner,
      sourceLedgerSha256,
      now,
    });
    expect(summary.cashCryptoTotals[0]?.openRacePayouts).toBe(
      "9007199254740993.000000000000000001",
    );
    expect(summary.cashCryptoTotals[1]?.nonOperatingMovement).toBe("1.25");
    expect(summary.bgcTotals[0]?.netBgcMovement).toBe("8.5");
    expect(summary.status).toBe("partial");
    expect(summary.warnings).toEqual([
      "MANUAL_TOURNAMENT_PAYOUT_COVERAGE_UNKNOWN",
      "SOURCE_COVERAGE_INCOMPLETE",
    ]);
  });

  it("does not publish when canonical source authority is unavailable", async () => {
    const h = harness({ source: null });
    await expect(
      materializeVaultPerformanceSummary({
        databaseOwnerId: owner,
        materializer: h.materializer,
        now: () => now,
      }),
    ).resolves.toEqual({ status: "source_unavailable" });
    expect(h.publishCandidate).not.toHaveBeenCalled();
  });

  it.each(["unchanged", "source_changed"] as const)(
    "preserves the publisher's non-destructive %s result",
    async (publication) => {
      const h = harness({ publication });
      await expect(
        materializeVaultPerformanceSummary({
          databaseOwnerId: owner,
          materializer: h.materializer,
          now: () => now,
        }),
      ).resolves.toEqual({ status: publication });
      expect(h.publishCandidate).toHaveBeenCalledOnce();
    },
  );

  it.each([
    {
      databaseOwnerId: "invalid",
      sourceState: source,
      clock: now,
    },
    {
      databaseOwnerId: owner,
      sourceState: { ...source, sourceLedgerSha256: "invalid" },
      clock: now,
    },
    {
      databaseOwnerId: owner,
      sourceState: {
        ...source,
        records: [{ ...source.records[0]!, signedAmount: "not-money" }],
      },
      clock: now,
    },
    {
      databaseOwnerId: owner,
      sourceState: source,
      clock: new Date("invalid"),
    },
  ])(
    "fails closed with one sanitized error for invalid inputs %#",
    async (item) => {
      const h = harness({ source: item.sourceState });
      await expect(
        materializeVaultPerformanceSummary({
          databaseOwnerId: item.databaseOwnerId,
          materializer: h.materializer,
          now: () => item.clock,
        }),
      ).rejects.toThrow(
        "Vault Performance summary materialization unavailable.",
      );
    },
  );

  it("sanitizes canonical-source and publication failures", async () => {
    const readFailure = harness();
    readFailure.loadCanonicalSource.mockRejectedValueOnce(
      new Error("private source detail"),
    );
    await expect(
      materializeVaultPerformanceSummary({
        databaseOwnerId: owner,
        materializer: readFailure.materializer,
        now: () => now,
      }),
    ).rejects.toThrow("Vault Performance summary materialization unavailable.");

    const publishFailure = harness();
    publishFailure.publishCandidate.mockRejectedValueOnce(
      new Error("private provider detail"),
    );
    await expect(
      materializeVaultPerformanceSummary({
        databaseOwnerId: owner,
        materializer: publishFailure.materializer,
        now: () => now,
      }),
    ).rejects.toThrow("Vault Performance summary materialization unavailable.");
  });

  it("rejects an unsupported publication response", async () => {
    const h = harness();
    h.publishCandidate.mockResolvedValueOnce(
      "invalid" as VaultPerformanceSummaryPublicationResult,
    );
    await expect(
      materializeVaultPerformanceSummary({
        databaseOwnerId: owner,
        materializer: h.materializer,
        now: () => now,
      }),
    ).rejects.toThrow("Vault Performance summary materialization unavailable.");
  });
});
