import {
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  type DnaCurrentStateAcquisitionGroup,
} from "@/lib/dna-open-lab-current-state-acquisition-cadence";
import type {
  DnaLastGoodSyncState,
  DnaSyncInterruptionReason,
} from "@/lib/dna-open-lab-last-good-publication";
import type {
  DnaOpenLabSyncHealthReadRepository,
  DnaOpenLabServingSyncHealth,
} from "@/lib/neon-dna-open-lab-sync-publication";
import { dnaOpenLabRawEvidenceSha256 } from "@/lib/dna-open-lab-v1-adapters";

const SAFE_OWNER_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

export type ProLeagueSyncFamilyHealth = Readonly<{
  family: DnaCurrentStateAcquisitionGroup;
  dataCurrentThrough: string;
  lastCompletedAt: string;
  receiptCount: number;
}>;

export type ProLeagueSyncHealthState = Readonly<{
  connectionStatus:
    "connected" | "persistence_not_configured" | "invalid_state";
  syncStatus: DnaLastGoodSyncState["syncStatus"] | null;
  catchUpRequired: boolean;
  lastAttemptAt: string | null;
  lastInterruption: Readonly<{
    reason: DnaSyncInterruptionReason;
    at: string;
    retryAfterSeconds: number | null;
  }> | null;
  lastCatchUpCompletedAt: string | null;
  lastGood: Readonly<{
    versionFingerprint: string;
    dataCurrentThrough: string;
    publishedAt: string;
    indexedAt: string;
    receiptCount: number;
  }> | null;
  families: readonly ProLeagueSyncFamilyHealth[];
  readOnly: true;
  refreshTriggered: false;
}>;

function unavailable(
  connectionStatus: "persistence_not_configured" | "invalid_state",
): ProLeagueSyncHealthState {
  return Object.freeze({
    connectionStatus,
    syncStatus: null,
    catchUpRequired: false,
    lastAttemptAt: null,
    lastInterruption: null,
    lastCatchUpCompletedAt: null,
    lastGood: null,
    families: Object.freeze([]),
    readOnly: true,
    refreshTriggered: false,
  });
}

export function invalidProLeagueSyncHealthState(): ProLeagueSyncHealthState {
  return unavailable("invalid_state");
}

function ownerId(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized === "") return null;
  if (normalized !== value || !SAFE_OWNER_ID.test(normalized)) {
    throw new Error("Pro League sync health owner identity is invalid.");
  }
  return normalized;
}

function timestamp(value: string, field: string, now: Date): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime()) {
    throw new Error(`Pro League sync health ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function optionalTimestamp(
  value: string | null,
  field: string,
  now: Date,
): string | null {
  return value === null ? null : timestamp(value, field, now);
}

function validateState(
  value: DnaOpenLabServingSyncHealth,
  now: Date,
): ProLeagueSyncHealthState {
  const state = value.state;
  const acceptedIdentityComplete =
    state.acceptedGenerationId !== null &&
    state.acceptedObservedAt !== null &&
    state.acceptedAt !== null &&
    state.servingGenerationId !== null;
  const acceptedIdentityEmpty =
    state.acceptedGenerationId === null &&
    state.acceptedObservedAt === null &&
    state.acceptedAt === null &&
    state.servingGenerationId === null;
  if (!acceptedIdentityComplete && !acceptedIdentityEmpty) {
    throw new Error(
      "Pro League sync health last-good publication identity is incomplete.",
    );
  }
  if (
    acceptedIdentityComplete &&
    state.acceptedGenerationId !== state.servingGenerationId
  ) {
    throw new Error(
      "Pro League sync health serving generation is not the accepted last-good generation.",
    );
  }
  if (
    state.syncStatus === "current" &&
    (!acceptedIdentityComplete || state.catchUpRequired)
  ) {
    throw new Error("Pro League sync health current state is inconsistent.");
  }
  if (
    (state.syncStatus === "paused" || state.syncStatus === "catching_up") &&
    !state.catchUpRequired
  ) {
    throw new Error("Pro League sync health catch-up state is inconsistent.");
  }
  if (
    state.syncStatus === "never_synced" &&
    (!acceptedIdentityEmpty || state.catchUpRequired)
  ) {
    throw new Error("Pro League sync health never-synced state is invalid.");
  }

  const lastAttemptAt = optionalTimestamp(
    state.lastAttemptAt,
    "lastAttemptAt",
    now,
  );
  const lastCatchUpCompletedAt = optionalTimestamp(
    state.lastCatchUpCompletedAt,
    "lastCatchUpCompletedAt",
    now,
  );
  const lastInterruption =
    state.lastInterruption === null
      ? null
      : Object.freeze({
          ...state.lastInterruption,
          at: timestamp(state.lastInterruption.at, "lastInterruption.at", now),
        });

  if (acceptedIdentityEmpty) {
    if (value.evidenceIndex !== null) {
      throw new Error(
        "Pro League sync health has indexed evidence without a last-good publication.",
      );
    }
    return Object.freeze({
      connectionStatus: "connected",
      syncStatus: state.syncStatus,
      catchUpRequired: state.catchUpRequired,
      lastAttemptAt,
      lastInterruption,
      lastCatchUpCompletedAt,
      lastGood: null,
      families: Object.freeze([]),
      readOnly: true,
      refreshTriggered: false,
    });
  }

  const index = value.evidenceIndex;
  if (
    index === null ||
    index.generationId !== state.servingGenerationId ||
    index.receipts.length < 1
  ) {
    throw new Error(
      "Pro League sync health serving evidence does not match last-good publication.",
    );
  }
  const dataCurrentThrough = timestamp(
    state.acceptedObservedAt!,
    "acceptedObservedAt",
    now,
  );
  const publishedAt = timestamp(state.acceptedAt!, "acceptedAt", now);
  const indexedAt = timestamp(index.indexedAt, "indexedAt", now);
  if (
    Date.parse(dataCurrentThrough) > Date.parse(publishedAt) ||
    Date.parse(indexedAt) > Date.parse(publishedAt)
  ) {
    throw new Error(
      "Pro League sync health publication timestamps are inconsistent.",
    );
  }

  const families = DNA_CURRENT_STATE_ACQUISITION_GROUPS.map((family) => {
    const receipts = index.receipts.filter(
      (receipt) => receipt.group === family,
    );
    if (
      receipts.length < 1 ||
      new Set(receipts.map(({ cycleId }) => cycleId)).size !== 1
    ) {
      throw new Error(
        `Pro League sync health ${family} does not have one complete cycle.`,
      );
    }
    const observedAt = receipts.map((receipt) =>
      timestamp(receipt.observedAt, `${family}.observedAt`, now),
    );
    return Object.freeze({
      family,
      dataCurrentThrough: observedAt.reduce((oldest, current) =>
        Date.parse(current) < Date.parse(oldest) ? current : oldest,
      ),
      lastCompletedAt: observedAt.reduce((newest, current) =>
        Date.parse(current) > Date.parse(newest) ? current : newest,
      ),
      receiptCount: receipts.length,
    });
  });
  const versionFingerprint = dnaOpenLabRawEvidenceSha256({
    generationId: state.servingGenerationId,
    planSha256: index.planSha256,
    indexedAt,
  }).slice(0, 12);

  return Object.freeze({
    connectionStatus: "connected",
    syncStatus: state.syncStatus,
    catchUpRequired: state.catchUpRequired,
    lastAttemptAt,
    lastInterruption,
    lastCatchUpCompletedAt,
    lastGood: Object.freeze({
      versionFingerprint,
      dataCurrentThrough,
      publishedAt,
      indexedAt,
      receiptCount: index.receipts.length,
    }),
    families: Object.freeze(families),
    readOnly: true,
    refreshTriggered: false,
  });
}

export async function loadProLeagueSyncHealthState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: DnaOpenLabSyncHealthReadRepository | null;
    now?: Date;
  }>,
): Promise<ProLeagueSyncHealthState> {
  const authenticatedOwnerId = ownerId(input.authenticatedOwnerId);
  const configuredOwnerId = ownerId(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return unavailable("persistence_not_configured");
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Pro League sync health access denied.");
  }
  if (input.repository === null) {
    return unavailable("persistence_not_configured");
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Pro League sync health time is invalid.");
  }
  return validateState(
    await input.repository.readServingSyncHealth({
      ownerId: authenticatedOwnerId,
      validatedAt: now.toISOString(),
    }),
    now,
  );
}
