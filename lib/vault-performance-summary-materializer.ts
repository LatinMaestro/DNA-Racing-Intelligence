import {
  buildVaultPerformanceSummary,
  type VaultPerformanceCoverageInput,
  type VaultPerformanceRecordInput,
} from "@/domain/vault-performance-summary";
import { encodeVaultPerformanceSummarySnapshot } from "@/lib/vault-performance-summary-snapshot";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;

export type VaultPerformanceCanonicalSourceState = Readonly<{
  /**
   * Trusted identity of the accepted ledger, classifications,
   * reconciliations, corrections, cost basis and coverage state.
   *
   * A production source adapter must obtain this value from canonical
   * owner-scoped persistence. Form, environment and snapshot-body hashes are
   * not valid source authority.
   */
  sourceLedgerSha256: string;
  records: readonly VaultPerformanceRecordInput[];
  coverage: VaultPerformanceCoverageInput;
}>;

export type VaultPerformanceSummaryPublicationCandidate = Readonly<{
  databaseOwnerId: string;
  expectedSourceLedgerSha256: string;
  materializedAt: string;
  snapshotJson: string;
  snapshotSha256: string;
}>;

export type VaultPerformanceSummaryPublicationResult =
  "published" | "unchanged" | "source_changed";

export type VaultPerformanceSummaryMaterializationResult =
  | Readonly<{ status: "source_unavailable" }>
  | Readonly<{
      status: VaultPerformanceSummaryPublicationResult;
    }>;

export type VaultPerformanceSummaryMaterializer = Readonly<{
  loadCanonicalSource: (
    databaseOwnerId: string,
  ) => Promise<VaultPerformanceCanonicalSourceState | null>;
  /**
   * The implementation must compare-and-swap against
   * expectedSourceLedgerSha256 in the same transaction that publishes the
   * candidate. A mismatch returns source_changed and must preserve last-good.
   */
  publishCandidate: (
    candidate: VaultPerformanceSummaryPublicationCandidate,
  ) => Promise<VaultPerformanceSummaryPublicationResult>;
}>;

const unavailable = "Vault Performance summary materialization unavailable.";

function fail(): never {
  // Do not include protected source, owner, financial or provider values.
  throw new Error(unavailable);
}

function validNow(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail();
  return value;
}

/**
 * Builds one compact summary from trusted canonical state and hands it to an
 * atomic compare-and-swap publication boundary. No source rows are persisted
 * here, and a failed/superseded candidate never replaces last-good.
 */
export async function materializeVaultPerformanceSummary(
  input: Readonly<{
    databaseOwnerId: string;
    materializer: VaultPerformanceSummaryMaterializer;
    now?: () => Date;
  }>,
): Promise<VaultPerformanceSummaryMaterializationResult> {
  try {
    if (
      !UUID.test(input.databaseOwnerId) ||
      typeof input.materializer?.loadCanonicalSource !== "function" ||
      typeof input.materializer?.publishCandidate !== "function"
    )
      fail();

    const now = validNow((input.now ?? (() => new Date()))());
    const source = await input.materializer.loadCanonicalSource(
      input.databaseOwnerId,
    );
    if (source === null) return Object.freeze({ status: "source_unavailable" });
    if (!HASH.test(source.sourceLedgerSha256)) fail();

    // Reuse the accepted accounting method without copying or changing any
    // category, precision, coverage, completeness or warning rule.
    const summary = buildVaultPerformanceSummary(
      source.records,
      source.coverage,
    );
    const materializedAt = now.toISOString();
    const snapshot = encodeVaultPerformanceSummarySnapshot({
      databaseOwnerId: input.databaseOwnerId,
      sourceLedgerSha256: source.sourceLedgerSha256,
      materializedAt,
      summary,
      now,
    });
    const status = await input.materializer.publishCandidate(
      Object.freeze({
        databaseOwnerId: input.databaseOwnerId,
        expectedSourceLedgerSha256: source.sourceLedgerSha256,
        materializedAt,
        snapshotJson: snapshot.json,
        snapshotSha256: snapshot.sha256,
      }),
    );
    if (
      !(["published", "unchanged", "source_changed"] as const).includes(status)
    )
      fail();
    return Object.freeze({ status });
  } catch {
    return fail();
  }
}
