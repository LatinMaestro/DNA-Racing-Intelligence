import type { BoundedAggregateRefresher } from "./import-aggregate-refresh-service";
import type { AggregateRefreshTargetSourceReader } from "./neon-aggregate-refresh-target-source";

export function createAggregateRefreshSourceRouter(input: {
  targetSourceReader: AggregateRefreshTargetSourceReader;
  raceRefresher: BoundedAggregateRefresher;
  currentStateRefresher: BoundedAggregateRefresher;
}): BoundedAggregateRefresher {
  return Object.freeze({
    async prepare(request) {
      const sourceType = await input.targetSourceReader.targetSourceType(request);
      if (sourceType === "race_merge") {
        return input.raceRefresher.prepare(request);
      }
      return input.currentStateRefresher.prepare(request);
    },
  });
}
