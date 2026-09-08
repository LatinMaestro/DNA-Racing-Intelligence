import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";
import type {
  DnaOpenLabP5FirstBackfillLedgerState,
  DnaOpenLabP5FirstBackfillStatusReadRepository,
} from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";

const SAFE_OWNER_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const TERMINAL_REQUEST_COUNT = 17_464;
const TERMINAL_FINISHED_RACE_RECEIPT_COUNT = 17_369;
const TERMINAL_RETAINED_R2_BYTES = 874_370_990;
const TERMINAL_OMISSION_COUNT = 1;

export type ProLeagueHistoryCoverageState = Readonly<{
  connectionStatus:
    "connected" | "persistence_not_configured" | "invalid_state";
  baselineStatus: "not_started" | "in_progress" | "complete";
  dataCurrentThrough: string | null;
  versionFingerprint: string | null;
  sourceRecordUpperBound: number;
  receiptCount: number;
  finishedRaceReceiptCount: number | null;
  retainedR2Bytes: number;
  omittedIdentityObservationCount: number;
  incrementalRefreshStatus: "not_connected";
  readOnly: true;
  refreshTriggered: false;
}>;

function unavailable(
  connectionStatus: "persistence_not_configured" | "invalid_state",
): ProLeagueHistoryCoverageState {
  return Object.freeze({
    connectionStatus,
    baselineStatus: "not_started",
    dataCurrentThrough: null,
    versionFingerprint: null,
    sourceRecordUpperBound: 0,
    receiptCount: 0,
    finishedRaceReceiptCount: null,
    retainedR2Bytes: 0,
    omittedIdentityObservationCount: 0,
    incrementalRefreshStatus: "not_connected",
    readOnly: true,
    refreshTriggered: false,
  });
}

export function invalidProLeagueHistoryCoverageState(): ProLeagueHistoryCoverageState {
  return unavailable("invalid_state");
}

function ownerId(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized === "") return null;
  if (normalized !== value || !SAFE_OWNER_ID.test(normalized)) {
    throw new Error("Pro League history coverage owner identity is invalid.");
  }
  return normalized;
}

function validateLedgerState(
  state: DnaOpenLabP5FirstBackfillLedgerState,
  now: Date,
): ProLeagueHistoryCoverageState {
  const measured =
    DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET.measuredUpperBound;
  if (measured === null) {
    throw new Error("Pro League history coverage authority is unavailable.");
  }
  const dataCurrentThrough = new Date(measured.authorityCutoffAt);
  if (
    Number.isNaN(dataCurrentThrough.getTime()) ||
    dataCurrentThrough.getTime() > now.getTime()
  ) {
    throw new Error("Pro League history coverage cutoff is invalid.");
  }

  if (state.status === "complete") {
    if (
      state.logicalRequestCount !== TERMINAL_REQUEST_COUNT ||
      state.nextRequestOrdinal !== TERMINAL_REQUEST_COUNT + 1 ||
      state.retainedR2Bytes !== TERMINAL_RETAINED_R2_BYTES ||
      state.omittedIdentityObservationCount !== TERMINAL_OMISSION_COUNT ||
      state.completionSha256 === null
    ) {
      throw new Error(
        "Pro League history coverage completion does not match terminal authority.",
      );
    }
    return Object.freeze({
      connectionStatus: "connected",
      baselineStatus: "complete",
      dataCurrentThrough: dataCurrentThrough.toISOString(),
      versionFingerprint: dnaOpenLabRawEvidenceSha256({
        completionSha256: state.completionSha256,
        dataCurrentThrough: dataCurrentThrough.toISOString(),
        receiptCount: state.logicalRequestCount,
      }).slice(0, 12),
      sourceRecordUpperBound: measured.sourceRecordUpperBound,
      receiptCount: state.logicalRequestCount,
      finishedRaceReceiptCount: TERMINAL_FINISHED_RACE_RECEIPT_COUNT,
      retainedR2Bytes: state.retainedR2Bytes,
      omittedIdentityObservationCount: state.omittedIdentityObservationCount,
      incrementalRefreshStatus: "not_connected",
      readOnly: true,
      refreshTriggered: false,
    });
  }

  if (state.completionSha256 !== null) {
    throw new Error(
      "Pro League history coverage in-progress checkpoint is inconsistent.",
    );
  }
  return Object.freeze({
    connectionStatus: "connected",
    baselineStatus:
      state.logicalRequestCount === 0 ? "not_started" : "in_progress",
    dataCurrentThrough: null,
    versionFingerprint: null,
    sourceRecordUpperBound: measured.sourceRecordUpperBound,
    receiptCount: state.logicalRequestCount,
    finishedRaceReceiptCount: null,
    retainedR2Bytes: state.retainedR2Bytes,
    omittedIdentityObservationCount: state.omittedIdentityObservationCount,
    incrementalRefreshStatus: "not_connected",
    readOnly: true,
    refreshTriggered: false,
  });
}

export async function loadProLeagueHistoryCoverageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: DnaOpenLabP5FirstBackfillStatusReadRepository | null;
    now?: Date;
  }>,
): Promise<ProLeagueHistoryCoverageState> {
  const authenticatedOwnerId = ownerId(input.authenticatedOwnerId);
  const configuredOwnerId = ownerId(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return unavailable("persistence_not_configured");
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Pro League history coverage access denied.");
  }
  if (input.repository === null) {
    return unavailable("persistence_not_configured");
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Pro League history coverage time is invalid.");
  }
  const state = await input.repository.load();
  if (state === null) {
    const measured =
      DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET.measuredUpperBound;
    return Object.freeze({
      ...unavailable("persistence_not_configured"),
      connectionStatus: "connected",
      sourceRecordUpperBound: measured?.sourceRecordUpperBound ?? 0,
    });
  }
  return validateLedgerState(state, now);
}
