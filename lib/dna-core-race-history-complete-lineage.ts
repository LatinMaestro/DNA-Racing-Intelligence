import {
  DNA_CORE_RACE_HISTORY_MAXIMUM_ATTEMPTS,
  validateDnaCoreRaceHistoryAcquisitionCycle,
  type DnaCoreRaceHistoryAcquisitionRepository,
  type StoredDnaCoreRaceHistoryAcquisitionCycle,
} from "./dna-core-race-history-acquisition-cycle";

export const DNA_CORE_RACE_HISTORY_MAXIMUM_LINEAGE_CYCLES = 4_096;

function lineageError(message: string): never {
  throw new Error(`DNA Core race history complete lineage: ${message}`);
}

async function loadCompleteCycle(
  repository: DnaCoreRaceHistoryAcquisitionRepository,
  cycleId: string,
): Promise<StoredDnaCoreRaceHistoryAcquisitionCycle> {
  for (
    let attemptNumber = DNA_CORE_RACE_HISTORY_MAXIMUM_ATTEMPTS;
    attemptNumber >= 1;
    attemptNumber -= 1
  ) {
    const stored = await repository.loadAttempt({ cycleId, attemptNumber });
    if (stored === null) continue;
    const cycle = validateDnaCoreRaceHistoryAcquisitionCycle(stored.cycle);
    if (cycle.cycleId !== cycleId) {
      lineageError("attempt cycle identity drifted");
    }
    if (cycle.status === "complete") return Object.freeze({ ...stored, cycle });
  }
  return lineageError("completed predecessor is unavailable");
}

/**
 * Loads the immutable complete Core-history cycle chain from root to latest.
 * The repository already constrains each cycle to one predecessor. This helper
 * additionally proves that every predecessor has a complete attempt, the chain
 * is acyclic, evaluation time is monotonic, and the bounded lineage terminates
 * at the unique root.
 */
export async function loadDnaCoreRaceHistoryCompleteLineage(
  repository: DnaCoreRaceHistoryAcquisitionRepository,
): Promise<readonly StoredDnaCoreRaceHistoryAcquisitionCycle[]> {
  const latest = await repository.loadLatestComplete();
  if (latest === null) return Object.freeze([]);

  const newestToOldest: StoredDnaCoreRaceHistoryAcquisitionCycle[] = [];
  const seen = new Set<string>();
  let current = Object.freeze({
    ...latest,
    cycle: validateDnaCoreRaceHistoryAcquisitionCycle(latest.cycle),
  });

  for (
    let index = 0;
    index < DNA_CORE_RACE_HISTORY_MAXIMUM_LINEAGE_CYCLES;
    index += 1
  ) {
    if (current.cycle.status !== "complete") {
      lineageError("lineage contains a non-complete cycle");
    }
    if (seen.has(current.cycle.cycleId)) {
      lineageError("lineage contains a cycle");
    }
    seen.add(current.cycle.cycleId);
    newestToOldest.push(current);

    const previousCycleId = current.cycle.previousCompletedCycleId;
    if (previousCycleId === null) {
      return Object.freeze([...newestToOldest].reverse());
    }

    const predecessor = await loadCompleteCycle(repository, previousCycleId);
    if (
      predecessor.cycle.cycleId !== previousCycleId ||
      Date.parse(predecessor.cycle.evaluatedAt) >
        Date.parse(current.cycle.evaluatedAt)
    ) {
      lineageError("predecessor authority is inconsistent");
    }
    current = predecessor;
  }

  return lineageError("lineage exceeds its bounded cycle capacity");
}

export function dnaCoreRaceHistoryLineageCoreIds(
  lineage: readonly StoredDnaCoreRaceHistoryAcquisitionCycle[],
): readonly number[] {
  const coreIds = new Set<number>();
  for (const stored of lineage) {
    const cycle = validateDnaCoreRaceHistoryAcquisitionCycle(stored.cycle);
    if (cycle.status !== "complete") {
      lineageError("lineage contains a non-complete cycle");
    }
    for (const coreId of cycle.coreIds) coreIds.add(coreId);
  }
  return Object.freeze([...coreIds].sort((left, right) => left - right));
}
