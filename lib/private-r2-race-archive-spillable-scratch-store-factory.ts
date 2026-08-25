import { createHash } from "node:crypto";

import type { CoreStarProfile } from "@/domain/star-signals";
import {
  createPrivateR2ExternalSortedRunStore,
  type PrivateR2ExternalSortedRunStoragePort,
} from "./private-r2-external-sorted-run-store";
import { createPrivateR2RaceArchiveScratchRunStore } from "./private-r2-race-archive-scratch-run-store";
import type { RaceArchiveSpillableScratchStoreFactory } from "./race-archive-spillable-aggregate-refresher";
import {
  decodeRaceArchiveStarProfileContributionLine,
  encodeRaceArchiveStarProfileContribution,
} from "./race-archive-spillable-star-profile-reducer";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const BUCKET_NAME_PATTERN =
  /^(?!.*\.\.)(?!.*--)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;

function safeText(value: string, field: string, maximumLength = 512): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function sourceHash(value: string): string {
  const normalized = safeText(value, "sourceVersionSetSha256", 64);
  if (!SHA_256_PATTERN.test(normalized)) {
    throw new Error(
      "sourceVersionSetSha256 must be a lowercase SHA-256 digest",
    );
  }
  return normalized;
}

function scratchSession(input: {
  ownerId: string;
  updateSessionId: string;
  refreshId: string;
  sourceVersionSetSha256: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.ownerId,
        input.updateSessionId,
        input.refreshId,
        input.sourceVersionSetSha256,
      ]),
    )
    .digest("hex");
}

export type PrivateR2RaceArchiveSpillableScratchStoreFactoryConfiguration =
  Readonly<{
    bucketName: string;
    storage: PrivateR2ExternalSortedRunStoragePort;
    maximumPartBytes: number;
    maximumPartsPerRun: number;
    maximumManifestBytes?: number;
  }>;

export function createPrivateR2RaceArchiveSpillableScratchStoreFactory(
  input: PrivateR2RaceArchiveSpillableScratchStoreFactoryConfiguration,
): RaceArchiveSpillableScratchStoreFactory {
  const bucketName = input.bucketName.trim();
  if (!BUCKET_NAME_PATTERN.test(bucketName)) {
    throw new Error("bucketName is invalid");
  }
  const maximumPartBytes = positiveBound(
    input.maximumPartBytes,
    "maximumPartBytes",
    64 * 1024 * 1024,
  );
  const maximumPartsPerRun = positiveBound(
    input.maximumPartsPerRun,
    "maximumPartsPerRun",
    10_000,
  );
  const maximumManifestBytes = positiveBound(
    input.maximumManifestBytes ?? maximumPartBytes,
    "maximumManifestBytes",
    64 * 1024 * 1024,
  );

  return Object.freeze({
    async create(request) {
      const ownerId = safeText(request.ownerId, "ownerId");
      const updateSessionId = safeText(
        request.updateSessionId,
        "updateSessionId",
        256,
      );
      const refreshId = safeText(request.refreshId, "refreshId", 256);
      const sourceVersionSetSha256 = sourceHash(request.sourceVersionSetSha256);
      const sessionId = scratchSession({
        ownerId,
        updateSessionId,
        refreshId,
        sourceVersionSetSha256,
      });
      const common = {
        ownerId,
        bucketName,
        storage: input.storage,
        maximumPartBytes,
        maximumPartsPerRun,
        maximumManifestBytes,
      } as const;

      return Object.freeze({
        observationStore: createPrivateR2RaceArchiveScratchRunStore({
          ...common,
          sessionId: `${sessionId}:observations`,
        }),
        starProfileStore:
          createPrivateR2ExternalSortedRunStore<CoreStarProfile>({
            ...common,
            sessionId: `${sessionId}:star-profiles`,
            encodeRecord: encodeRaceArchiveStarProfileContribution,
            decodeRecordLine: decodeRaceArchiveStarProfileContributionLine,
          }),
      });
    },
  });
}
