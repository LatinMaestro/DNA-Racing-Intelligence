import {
  createDnaOpenLabClientPool,
  type DnaOpenLabClientPool,
  type DnaOpenLabClientPoolLaneInput,
} from "./dna-open-lab-client-pool";
import {
  loadDnaOpenLabSyncRateRuntimePolicy,
  type DnaOpenLabSyncRatePolicyRepository,
} from "./dna-open-lab-sync-rate-policy-service";

export type DnaOpenLabPolicyControlledClientPool = Readonly<{
  pool: DnaOpenLabClientPool;
  effectiveRequestsPerMinute: number;
}>;

/**
 * Constructs the shared website pool from the owner policy at each worker
 * boundary. Callers cannot bypass the aggregate gate or enable independent
 * buckets. A 429 lowers the live pool immediately and persists only sanitized
 * rate-limit evidence so normal requests do not create database-write volume.
 */
export async function createDnaOpenLabPolicyControlledClientPool(input: {
  ownerId: string;
  repository: DnaOpenLabSyncRatePolicyRepository;
  lanes: readonly DnaOpenLabClientPoolLaneInput[];
  now: () => Date;
  nowMilliseconds?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<DnaOpenLabPolicyControlledClientPool> {
  const runtime = await loadDnaOpenLabSyncRateRuntimePolicy({
    ownerId: input.ownerId,
    repository: input.repository,
    now: input.now,
  });
  const effectiveRequestsPerMinute = runtime.effectiveRequestsPerMinute;
  const pool = createDnaOpenLabClientPool({
    lanes: input.lanes,
    aggregateRequestsPerMinute: effectiveRequestsPerMinute,
    maximumLaneRequestsPerMinute: effectiveRequestsPerMinute,
    allowIndependentRateBuckets: false,
    ...(input.nowMilliseconds === undefined
      ? {}
      : { nowMilliseconds: input.nowMilliseconds }),
    ...(input.sleep === undefined ? {} : { sleep: input.sleep }),
    onRateObservation: async (observation) => {
      if (!observation.rateLimited) return;
      await runtime.recordObservation({
        rateLimited: true,
        providerLimit: observation.providerLimit,
      });
    },
  });
  return Object.freeze({ pool, effectiveRequestsPerMinute });
}
