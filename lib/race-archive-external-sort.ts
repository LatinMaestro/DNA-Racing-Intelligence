const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type RaceArchiveExternalSortedRunStore<T> = Readonly<{
  writeRun: (input: {
    runId: string;
    records: AsyncIterable<T>;
  }) => Promise<void>;
  readRun: (input: { runId: string }) => AsyncIterable<T>;
  deleteRun: (input: { runId: string }) => Promise<void>;
}>;

export type RaceArchiveExternalSortedResult<T> = Readonly<{
  recordCount: number;
  initialRunCount: number;
  read: () => AsyncIterable<T>;
  cleanup: () => Promise<void>;
}>;

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function safePrefix(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 256 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error("runPrefix is invalid");
  }
  return normalized;
}

function recordsFromArray<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

async function closeIterators<T>(
  iterators: readonly AsyncIterator<T>[],
): Promise<void> {
  await Promise.all(
    iterators.map(async (iterator) => {
      if (iterator.return !== undefined) await iterator.return();
    }),
  );
}

function mergedRuns<T>(input: {
  store: RaceArchiveExternalSortedRunStore<T>;
  runIds: readonly string[];
  compare: (left: T, right: T) => number;
}): AsyncIterable<T> {
  return (async function* () {
    const iterators = input.runIds.map((runId) =>
      input.store.readRun({ runId })[Symbol.asyncIterator](),
    );
    const heads: Array<IteratorResult<T> | undefined> = [];
    try {
      for (const iterator of iterators) heads.push(await iterator.next());
      while (true) {
        let selectedIndex = -1;
        for (let index = 0; index < heads.length; index += 1) {
          const head = heads[index];
          if (head === undefined || head.done) continue;
          if (selectedIndex < 0) {
            selectedIndex = index;
            continue;
          }
          const selectedHead = heads[selectedIndex];
          if (selectedHead === undefined || selectedHead.done) {
            throw new Error("Race archive external-sort merge state is invalid.");
          }
          if (input.compare(head.value, selectedHead.value) < 0) {
            selectedIndex = index;
          }
        }
        if (selectedIndex < 0) return;
        const selectedHead = heads[selectedIndex];
        if (selectedHead === undefined || selectedHead.done) {
          throw new Error("Race archive external-sort merge state is invalid.");
        }
        yield selectedHead.value;
        const iterator = iterators[selectedIndex];
        if (iterator === undefined) {
          throw new Error("Race archive external-sort iterator is unavailable.");
        }
        heads[selectedIndex] = await iterator.next();
      }
    } finally {
      await closeIterators(iterators);
    }
  })();
}

export async function spillExactSortedRaceArchiveRecords<T>(input: {
  records: AsyncIterable<T>;
  store: RaceArchiveExternalSortedRunStore<T>;
  compare: (left: T, right: T) => number;
  runPrefix: string;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumInputRecords: number;
  maximumRunObjects: number;
}): Promise<RaceArchiveExternalSortedResult<T>> {
  const runPrefix = safePrefix(input.runPrefix);
  const maximumRecordsInMemory = positiveBound(
    input.maximumRecordsInMemory,
    "maximumRecordsInMemory",
    1_000_000,
  );
  const mergeFanIn = positiveBound(input.mergeFanIn, "mergeFanIn", 256);
  if (mergeFanIn < 2) throw new Error("mergeFanIn must be at least 2");
  const maximumInputRecords = positiveBound(
    input.maximumInputRecords,
    "maximumInputRecords",
    100_000_000,
  );
  const maximumRunObjects = positiveBound(
    input.maximumRunObjects,
    "maximumRunObjects",
    1_000_000,
  );

  let sequence = 0;
  let recordCount = 0;
  let initialRunCount = 0;
  let activeRunIds: string[] = [];
  const ownedRunIds = new Set<string>();
  let cleaned = false;

  const nextRunId = (): string => {
    sequence += 1;
    if (sequence > maximumRunObjects) {
      throw new Error("Race archive external-sort run bound was exceeded.");
    }
    return `${runPrefix}/run-${String(sequence).padStart(8, "0")}`;
  };

  const deleteOwnedRun = async (runId: string): Promise<void> => {
    if (!ownedRunIds.has(runId)) return;
    await input.store.deleteRun({ runId });
    ownedRunIds.delete(runId);
  };

  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    const failures: unknown[] = [];
    for (const runId of [...ownedRunIds]) {
      try {
        await input.store.deleteRun({ runId });
        ownedRunIds.delete(runId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new Error("Race archive external-sort scratch cleanup failed.");
    }
    cleaned = true;
  };

  const writeRun = async (
    runId: string,
    records: AsyncIterable<T>,
  ): Promise<void> => {
    ownedRunIds.add(runId);
    await input.store.writeRun({ runId, records });
  };

  const writeArrayRun = async (values: readonly T[]): Promise<string> => {
    const runId = nextRunId();
    await writeRun(runId, recordsFromArray(values));
    return runId;
  };

  try {
    let chunk: T[] = [];
    for await (const record of input.records) {
      recordCount += 1;
      if (recordCount > maximumInputRecords) {
        throw new Error("Race archive external-sort input bound was exceeded.");
      }
      chunk.push(record);
      if (chunk.length === maximumRecordsInMemory) {
        chunk.sort(input.compare);
        activeRunIds.push(await writeArrayRun(chunk));
        initialRunCount += 1;
        chunk = [];
      }
    }
    if (chunk.length > 0) {
      chunk.sort(input.compare);
      activeRunIds.push(await writeArrayRun(chunk));
      initialRunCount += 1;
    }

    while (activeRunIds.length > 1) {
      const nextPass: string[] = [];
      for (let offset = 0; offset < activeRunIds.length; offset += mergeFanIn) {
        const sourceRunIds = activeRunIds.slice(offset, offset + mergeFanIn);
        if (sourceRunIds.length === 1) {
          const onlyRunId = sourceRunIds[0];
          if (onlyRunId !== undefined) nextPass.push(onlyRunId);
          continue;
        }
        const mergedRunId = nextRunId();
        await writeRun(
          mergedRunId,
          mergedRuns({
            store: input.store,
            runIds: sourceRunIds,
            compare: input.compare,
          }),
        );
        for (const sourceRunId of sourceRunIds) {
          await deleteOwnedRun(sourceRunId);
        }
        nextPass.push(mergedRunId);
      }
      activeRunIds = nextPass;
    }
  } catch (error) {
    try {
      await cleanup();
    } catch {
      throw new Error(
        "Race archive external sort failed and scratch cleanup was incomplete.",
        { cause: error },
      );
    }
    throw error;
  }

  const finalRunId = activeRunIds[0] ?? null;
  return Object.freeze({
    recordCount,
    initialRunCount,
    read() {
      if (cleaned) {
        throw new Error("Race archive external-sort result has been cleaned.");
      }
      if (finalRunId === null) {
        return (async function* () {})();
      }
      return input.store.readRun({ runId: finalRunId });
    },
    cleanup,
  });
}
