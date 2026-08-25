import type { BoundedAggregateRefresher } from "./import-aggregate-refresh-service";
import type {
  AggregateRefreshTargetSource,
  RaceArchiveAggregateRefreshControl,
} from "./neon-race-archive-aggregate-refresh-control";

export type AggregateRefreshTargetSourceReader = Pick<
  RaceArchiveAggregateRefreshControl,
  "targetSource"
>;

export function createSourceAwareProLeagueAggregateRefresher(input: {
  targetSourceReader: AggregateRefreshTargetSourceReader;
  raceArchiveRefresher: BoundedAggregateRefresher;
  currentStateRefresher: BoundedAggregateRefresher;
}): BoundedAggregateRefresher {
  return Object.freeze({
    async prepare(request) {
      const source: AggregateRefreshTargetSource =
        await input.targetSourceReader.targetSource(request);
      if (source === "race_merge") {
        return input.raceArchiveRefresher.prepare(request);
      }
      return input.currentStateRefresher.prepare(request);
    },
  });
}
