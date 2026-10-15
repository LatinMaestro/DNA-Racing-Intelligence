import { encodeMaidenAllocationEvidenceSnapshot } from "@/lib/maiden-allocation-evidence-snapshot";
import type { MaidenAllocationEvidence } from "@/lib/maiden-workspace-service";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const ERROR = "Maiden accepted evidence materialization unavailable.";

export type MaidenAcceptedGenerationCoverage = Readonly<{
  /**
   * These must be measured by a trusted canonical owner-scoped source reader.
   * Caller-supplied counts or flags are NOT proof of accepted authority.
   */
  state: "accepted" | "partial" | "unknown";
  generationIntegrityVerified: boolean;
  ownerStrategyCorrectionsVerified: boolean;
  crossModeGenerationVerified: boolean;
  expectedOwnerMaidenEligibleCores: number;
  verifiedOwnerMaidenEligibleCores: number;
  expectedBrackets: number;
  verifiedBrackets: number;
  unsupportedSourceRows: number;
}>;

export type MaidenAcceptedGenerationSource = Readonly<{
  databaseOwnerId: string;
  /** Source and relevant owner/method/correction versions, not snapshot-body digest. */
  sourceEvidenceSha256: string;
  coverage: MaidenAcceptedGenerationCoverage;
  evidence: MaidenAllocationEvidence;
}>;

export type MaidenEvidencePublicationCandidate = Readonly<{
  databaseOwnerId: string;
  expectedSourceEvidenceSha256: string;
  materializedAt: string;
  snapshotJson: string;
  snapshotSha256: string;
}>;

export type MaidenEvidencePublicationOutcome =
  | "published"
  | "unchanged"
  | "source_changed";

export type MaidenEvidenceMaterializationOutcome =
  | Readonly<{ status: "source_unavailable" | "source_incomplete" }>
  | Readonly<{ status: MaidenEvidencePublicationOutcome }>;

export type MaidenEvidenceMaterializationBoundary = Readonly<{
  /**
   * Only an accepted owner-scoped persisted source adapter may implement this.
   * It must prove global generation integrity, versions, strategy, corrections
   * and full candidate-input coverage before marking coverage accepted.
   */
  loadCanonicalSource: (
    ownerId: string,
  ) => Promise<MaidenAcceptedGenerationSource | null>;
  /** A bounded read of the current independently accepted source identity. */
  readAcceptedSourceIdentity: (ownerId: string) => Promise<string | null>;
  /**
   * Must perform a DB-side source-identity compare-and-swap in the SAME
   * transaction as publication. On mismatch, preserve last-good and return
   * source_changed. No direct table write or unguarded runner is authorised.
   */
  publishCandidate: (
    candidate: MaidenEvidencePublicationCandidate,
  ) => Promise<MaidenEvidencePublicationOutcome>;
}>;

function fail(): never {
  // Do not disclose owner, provider, roster, strategy or race evidence.
  throw new Error(ERROR);
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function complete(
  coverage: MaidenAcceptedGenerationCoverage,
  evidence: MaidenAllocationEvidence,
): boolean {
  if (
    !coverage ||
    !count(coverage.expectedOwnerMaidenEligibleCores) ||
    !count(coverage.verifiedOwnerMaidenEligibleCores) ||
    !count(coverage.expectedBrackets) ||
    !count(coverage.verifiedBrackets) ||
    !count(coverage.unsupportedSourceRows) ||
    !Array.isArray(evidence?.brackets) ||
    !Array.isArray(evidence?.candidates)
  )
    fail();

  return (
    coverage.state === "accepted" &&
    coverage.generationIntegrityVerified === true &&
    coverage.ownerStrategyCorrectionsVerified === true &&
    coverage.crossModeGenerationVerified === true &&
    coverage.expectedOwnerMaidenEligibleCores ===
      coverage.verifiedOwnerMaidenEligibleCores &&
    coverage.expectedBrackets === coverage.verifiedBrackets &&
    coverage.verifiedBrackets === evidence.brackets.length &&
    coverage.unsupportedSourceRows === 0
  );
}

/**
 * Fixture-only composition contract. It has NO provider wiring or invocation
 * path. The future private runner must first prove exact-green main, owner
 * authentication and a durable conservative A$0 full-operation reservation.
 *
 * A second source-identity read prevents obvious drift; it does not replace
 * the publisher's required atomic DB-side comparison.
 */
export async function materializeAcceptedMaidenEvidence(
  input: Readonly<{
    databaseOwnerId: string;
    boundary: MaidenEvidenceMaterializationBoundary;
    now?: () => Date;
  }>,
): Promise<MaidenEvidenceMaterializationOutcome> {
  try {
    if (
      !UUID.test(input.databaseOwnerId) ||
      typeof input.boundary?.loadCanonicalSource !== "function" ||
      typeof input.boundary?.readAcceptedSourceIdentity !== "function" ||
      typeof input.boundary?.publishCandidate !== "function"
    )
      fail();
    const now = (input.now ?? (() => new Date()))();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail();

    const source = await input.boundary.loadCanonicalSource(
      input.databaseOwnerId,
    );
    if (source === null) return { status: "source_unavailable" };
    if (
      source.databaseOwnerId !== input.databaseOwnerId ||
      !HASH.test(source.sourceEvidenceSha256)
    )
      fail();

    if (!complete(source.coverage, source.evidence))
      return { status: "source_incomplete" };

    // The existing codec validates exact candidate/bracket versions, import
    // chronology, 512-KiB limit and invokes the unchanged approved allocator.
    const materializedAt = now.toISOString();
    const snapshot = encodeMaidenAllocationEvidenceSnapshot({
      databaseOwnerId: input.databaseOwnerId,
      sourceEvidenceSha256: source.sourceEvidenceSha256,
      materializedAt,
      evidence: source.evidence,
      now,
    });

    const acceptedSource = await input.boundary.readAcceptedSourceIdentity(
      input.databaseOwnerId,
    );
    if (acceptedSource !== source.sourceEvidenceSha256)
      return { status: "source_changed" };

    const status = await input.boundary.publishCandidate({
      databaseOwnerId: input.databaseOwnerId,
      expectedSourceEvidenceSha256: source.sourceEvidenceSha256,
      materializedAt,
      snapshotJson: snapshot.json,
      snapshotSha256: snapshot.sha256,
    });
    if (
      status !== "published" &&
      status !== "unchanged" &&
      status !== "source_changed"
    )
      fail();
    return { status };
  } catch {
    return fail();
  }
}
