import { describe, expect, it, vi } from "vitest";
import {
  runVaultPerformancePrivateMaterialization,
  validVaultPerformancePrivateReservation,
  type PrivateWebsiteOperationResources,
  type VaultPerformancePrivateMaterializationReservation,
} from "@/lib/vault-performance-private-materialization-runner";
import type { VaultPerformanceSummaryMaterializer } from "@/lib/vault-performance-summary-materializer";

const owner = "11111111-1111-4111-8111-111111111111";
const identity = "clerk_test_owner";
const mainSha = "a".repeat(40);
const now = new Date("2026-11-02T00:00:00.000Z");

const empty: PrivateWebsiteOperationResources = {
  neonTransferBytes: 0,
  neonStorageBytes: 0,
  neonComputeMilliCuHours: 0,
  r2StorageBytes: 0,
  r2ClassAOperations: 0,
  r2ClassBOperations: 0,
};

const reservation: VaultPerformancePrivateMaterializationReservation = {
  status: "reserved",
  reservationId: "vault-summary-00001",
  databaseOwnerId: owner,
  authenticatedOwnerId: identity,
  exactMainSha: mainSha,
  issuedAt: "2026-11-01T23:59:45.000Z",
  validUntil: "2026-11-02T00:01:00.000Z",
  neonWindowEndAt: "2026-12-01T00:00:00.000Z",
  r2WindowEndAt: "2026-12-01T00:00:00.000Z",
  evidenceSource: "provider_api",
  atomicallyReserved: true,
  freePlansVerified: true,
  vercelFreeHeadroomVerified: true,
  zeroPaidUsageVerified: true,
  current: {
    ...empty,
    neonTransferBytes: 100_000_000,
    r2StorageBytes: 300_000_000,
  },
  otherReservations: { ...empty, neonTransferBytes: 50_000_000 },
  operation: {
    ...empty,
    neonTransferBytes: 2_000_000,
    neonComputeMilliCuHours: 100,
  },
  remainingMonthForecast: {
    ...empty,
    neonTransferBytes: 200_000_000,
    r2ClassAOperations: 1000,
    r2ClassBOperations: 2000,
  },
  websiteRecoveryReserve: {
    ...empty,
    neonTransferBytes: 250_000_000,
    neonStorageBytes: 10_000_000,
    neonComputeMilliCuHours: 1000,
    r2StorageBytes: 100_000_000,
    r2ClassAOperations: 1000,
    r2ClassBOperations: 2000,
  },
};

const request = {
  databaseOwnerId: owner,
  authenticatedOwnerId: identity,
  exactMainSha: mainSha,
  intendedWorstCaseNeonTransferBytes: 2_000_000,
};

function harness() {
  const inspect = vi.fn(async () => ({
    mainSha,
    validatePassed: true,
    migrationPassed: true,
  }));
  const reserve = vi.fn(async () => reservation);
  const settle = vi.fn(async () => undefined);
  const loadCanonicalSource = vi.fn(async () => ({
    sourceLedgerSha256: "b".repeat(64),
    records: [
      {
        transactionId: "fixture",
        occurredAt: "2026-11-01T23:00:00.000Z",
        assetCode: "DEZ",
        assetKind: "crypto" as const,
        signedAmount: "9007199254740993.000000000000000001",
        category: "open_race_payout" as const,
        operating: true,
        aggregateStatus: "included" as const,
        classificationStatus: "confirmed" as const,
        reconciliationStatus: "reconciled" as const,
      },
    ],
    coverage: {
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2026-11-01T23:59:59.000Z",
      sourceCoverage: "partial" as const,
      manualTournamentPayoutStatus: "unknown" as const,
      dataCurrentThrough: "2026-11-01T23:00:00.000Z",
      lastImported: "2026-11-01T23:30:00.000Z",
      freshnessState: "current" as const,
    },
  }));
  const publishCandidate = vi.fn<
    VaultPerformanceSummaryMaterializer["publishCandidate"]
  >(async (candidate) => {
    void candidate;
    return "published";
  });
  const materializer: VaultPerformanceSummaryMaterializer = {
    loadCanonicalSource,
    publishCandidate,
  };
  const input = {
    databaseOwnerId: owner,
    authenticatedOwnerId: identity,
    configuredOwnerId: identity,
    exactMainSha: mainSha,
    intendedWorstCaseNeonTransferBytes: 2_000_000,
    main: { inspect },
    capacity: { reserve, settle },
    materializer,
    now: () => now,
  };
  return {
    input,
    inspect,
    reserve,
    settle,
    loadCanonicalSource,
    publishCandidate,
  };
}

describe("Vault Performance guarded private materialization", () => {
  it("accepts only a fresh atomic free-tier reservation with remaining-month headroom", () => {
    expect(
      validVaultPerformancePrivateReservation(reservation, request, now),
    ).toBe(true);
  });

  it("executes exactly once after two exact-main checks and settles the reservation", async () => {
    const h = harness();
    await expect(
      runVaultPerformancePrivateMaterialization(h.input),
    ).resolves.toEqual({
      status: "published",
      paidUsageAllowed: false,
      connectedAcceptanceProven: false,
    });
    expect(h.inspect).toHaveBeenCalledTimes(2);
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.reserve).toHaveBeenCalledWith(request);
    expect(h.loadCanonicalSource).toHaveBeenCalledOnce();
    expect(h.publishCandidate).toHaveBeenCalledOnce();
    expect(h.publishCandidate.mock.calls[0]?.[0]).toMatchObject({
      databaseOwnerId: owner,
      expectedSourceLedgerSha256: "b".repeat(64),
    });
    expect(h.settle).toHaveBeenCalledOnce();
    expect(h.settle).toHaveBeenCalledWith(
      reservation.reservationId,
      "published",
    );
  });

  it("denies missing owner, cross-owner and invalid head before the reservation", async () => {
    for (const mutation of [
      { authenticatedOwnerId: "another_clerk_user" },
      { databaseOwnerId: "not-a-uuid" },
      { exactMainSha: "not-a-head" },
      { intendedWorstCaseNeonTransferBytes: 0 },
    ]) {
      const h = harness();
      await expect(
        runVaultPerformancePrivateMaterialization({
          ...h.input,
          ...mutation,
        }),
      ).resolves.toMatchObject({ status: "held" });
      expect(h.inspect).not.toHaveBeenCalled();
      expect(h.reserve).not.toHaveBeenCalled();
      expect(h.loadCanonicalSource).not.toHaveBeenCalled();
    }
  });

  it("denies unreviewed main or held capacity without reading canonical records", async () => {
    const badMain = harness();
    badMain.inspect.mockResolvedValueOnce({
      mainSha: "c".repeat(40),
      validatePassed: false,
      migrationPassed: true,
    });
    await expect(
      runVaultPerformancePrivateMaterialization(badMain.input),
    ).resolves.toMatchObject({ status: "held" });
    expect(badMain.reserve).not.toHaveBeenCalled();

    const noHeadroom = harness();
    noHeadroom.reserve.mockResolvedValueOnce({
      status: "held",
    } as unknown as VaultPerformancePrivateMaterializationReservation);
    await expect(
      runVaultPerformancePrivateMaterialization(noHeadroom.input),
    ).resolves.toMatchObject({ status: "held" });
    expect(noHeadroom.loadCanonicalSource).not.toHaveBeenCalled();
    expect(noHeadroom.settle).not.toHaveBeenCalled();
  });

  it("rejects missing forecasts, oversubscribed transfer, bad scope, stale evidence and unsafe cost", () => {
    const badReceipts: VaultPerformancePrivateMaterializationReservation[] = [
      {
        ...reservation,
        remainingMonthForecast: {
          ...reservation.remainingMonthForecast,
          neonTransferBytes: undefined as unknown as number,
        },
      },
      {
        ...reservation,
        current: {
          ...reservation.current,
          neonTransferBytes: 4_700_000_000,
        },
      },
      { ...reservation, authenticatedOwnerId: "wrong_owner" },
      { ...reservation, issuedAt: "2026-10-31T00:00:00.000Z" },
      { ...reservation, validUntil: "2026-11-02T00:30:00.000Z" },
      { ...reservation, atomicallyReserved: false as true },
      { ...reservation, zeroPaidUsageVerified: false as true },
      {
        ...reservation,
        operation: { ...reservation.operation, r2ClassBOperations: 1 },
      },
      {
        ...reservation,
        websiteRecoveryReserve: {
          ...reservation.websiteRecoveryReserve,
          neonTransferBytes: 0,
        },
      },
      {
        ...reservation,
        r2WindowEndAt: "2026-11-01T00:00:00.000Z",
      },
    ];
    for (const item of badReceipts) {
      expect(validVaultPerformancePrivateReservation(item, request, now)).toBe(
        false,
      );
    }
  });

  it("settles rejected reservations without touching data or leaking errors", async () => {
    const h = harness();
    h.reserve.mockResolvedValueOnce({
      ...reservation,
      current: {
        ...reservation.current,
        neonTransferBytes: 4_700_000_000,
      },
    });
    await expect(
      runVaultPerformancePrivateMaterialization(h.input),
    ).resolves.toMatchObject({ status: "held" });
    expect(h.loadCanonicalSource).not.toHaveBeenCalled();
    expect(h.settle).toHaveBeenCalledWith(reservation.reservationId, "held");
  });

  it("holds a reservation when main changes before materialization", async () => {
    const h = harness();
    h.inspect
      .mockResolvedValueOnce({
        mainSha,
        validatePassed: true,
        migrationPassed: true,
      })
      .mockResolvedValueOnce({
        mainSha: "c".repeat(40),
        validatePassed: true,
        migrationPassed: true,
      });
    await expect(
      runVaultPerformancePrivateMaterialization(h.input),
    ).resolves.toMatchObject({ status: "held" });
    expect(h.loadCanonicalSource).not.toHaveBeenCalled();
    expect(h.settle).toHaveBeenCalledWith(reservation.reservationId, "held");
  });

  it("does not turn unknown source or provider errors into successful publication", async () => {
    const unavailable = harness();
    unavailable.loadCanonicalSource.mockResolvedValueOnce(null as never);
    await expect(
      runVaultPerformancePrivateMaterialization(unavailable.input),
    ).resolves.toMatchObject({ status: "source_unavailable" });
    expect(unavailable.publishCandidate).not.toHaveBeenCalled();
    expect(unavailable.settle).toHaveBeenCalledWith(
      reservation.reservationId,
      "source_unavailable",
    );

    const failure = harness();
    failure.loadCanonicalSource.mockRejectedValueOnce(
      new Error("private financial records and connection string"),
    );
    await expect(
      runVaultPerformancePrivateMaterialization(failure.input),
    ).resolves.toEqual({
      status: "held",
      paidUsageAllowed: false,
      connectedAcceptanceProven: false,
    });
    expect(failure.settle).toHaveBeenCalledWith(
      reservation.reservationId,
      "uncertain",
    );
  });

  it("does not claim success when reservation reconciliation fails", async () => {
    const h = harness();
    h.settle.mockRejectedValueOnce(new Error("private provider detail"));
    await expect(
      runVaultPerformancePrivateMaterialization(h.input),
    ).resolves.toMatchObject({ status: "held" });
    expect(h.publishCandidate).toHaveBeenCalledOnce();
  });
});
