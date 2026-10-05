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
    type HeapEntry = Readonly<{ iteratorIndex: number; value: T }>;

    const iterators = input.runIds.map((runId) =>
      input.store.readRun({ runId })[Symbol.asyncIterator](),
    );
    const heap: HeapEntry[] = [];
    const precedes = (left: HeapEntry, right: HeapEntry): boolean => {
      const comparison = input.compare(left.value, right.value);
      return (
        comparison < 0 ||
        (comparison === 0 && left.iteratorIndex < right.iteratorIndex)
      );
    };
    const push = (entry: HeapEntry): void => {
      let index = heap.length;
      heap.push(entry);
      while (index > 0) {
        const parentIndex = Math.floor((index - 1) / 2);
        const parent = heap[parentIndex];
        if (parent === undefined || !precedes(entry, parent)) break;
        heap[index] = parent;
        index = parentIndex;
      }
      heap[index] = entry;
    };
    const pop = (): HeapEntry => {
      const root = heap[0];
      const tail = heap.pop();
      if (root === undefined || tail === undefined) {
        throw new Error("Race archive external-sort merge heap is empty.");
      }
      if (heap.length === 0) return root;

      let index = 0;
      while (true) {
        const leftIndex = index * 2 + 1;
        if (leftIndex >= heap.length) break;
        const rightIndex = leftIndex + 1;
        const left = heap[leftIndex];
        const right = heap[rightIndex];
        if (left === undefined) {
          throw new Error("Race archive external-sort merge heap is invalid.");
        }
        const childIndex =
          right !== undefined && precedes(right, left) ? rightIndex : leftIndex;
        const child = heap[childIndex];
        if (child === undefined || !precedes(child, tail)) break;
        heap[index] = child;
        index = childIndex;
      }
      heap[index] = tail;
      return root;
    };

    try {
      const heads = await Promise.all(
        iterators.map((iterator) => iterator.next()),
      );
      for (let iteratorIndex = 0; iteratorIndex < heads.length; iteratorIndex += 1) {
        const head = heads[iteratorIndex];
        if (head !== undefined && !head.done) {
          push(Object.freeze({ iteratorIndex, value: head.value }));
        }
      }

      while (heap.length > 0) {
        const selected = pop();
        yield selected.value;
        const iterator = iterators[selected.iteratorIndex];
        if (iterator === undefined) {
          throw new Error(
            "Race archive external-sort iterator is unavailable.",
          );
        }
        const next = await iterator.next();
        if (!next.done) {
          push(
            Object.freeze({
              iteratorIndex: selected.iteratorIndex,
              value: next.value,
            }),
          );
        }
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