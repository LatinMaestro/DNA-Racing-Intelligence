import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import type { RaceArchiveExternalSortedRunStore } from "./race-archive-external-sort";
import {
  createPrivateR2ExternalSortedRunStore,
  type PrivateR2ExternalSortedRunStoragePort,
} from "./private-r2-external-sorted-run-store";
import {
  decodeRaceArchiveAnalyticalObservationLine,
  encodeRaceArchiveAnalyticalObservation,
} from "./race-archive-observation-codec";

export type PrivateR2RaceArchiveScratchStoragePort =
  PrivateR2ExternalSortedRunStoragePort;

export function createPrivateR2RaceArchiveScratchRunStore(input: {
  ownerId: string;
  sessionId: string;
  bucketName: string;
  storage: PrivateR2RaceArchiveScratchStoragePort;
  maximumPartBytes: number;
  maximumPartsPerRun: number;
  maximumManifestBytes?: number;
}): RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation> {
  return createPrivateR2ExternalSortedRunStore({
    ...input,
    encodeRecord: encodeRaceArchiveAnalyticalObservation,
    decodeRecordLine: decodeRaceArchiveAnalyticalObservationLine,
  });
}
