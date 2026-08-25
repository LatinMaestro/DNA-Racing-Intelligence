export type RaceArchiveExactSortedStatistics = Readonly<{
  count: number;
  best: number;
  p25: number;
  median: number;
  p75: number;
  mean: number;
  trimmedMean: number;
  populationStandardDeviation: number;
  interquartileRange: number;
}>;

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function percentilePosition(
  count: number,
  fraction: number,
): Readonly<{
  lowerIndex: number;
  upperIndex: number;
  fractionAboveLower: number;
}> {
  const position = (count - 1) * fraction;
  return Object.freeze({
    lowerIndex: Math.floor(position),
    upperIndex: Math.ceil(position),
    fractionAboveLower: position - Math.floor(position),
  });
}

function percentileFromCaptured(input: {
  position: ReturnType<typeof percentilePosition>;
  valuesByIndex: ReadonlyMap<number, number>;
}): number {
  const lower = input.valuesByIndex.get(input.position.lowerIndex);
  const upper = input.valuesByIndex.get(input.position.upperIndex);
  if (lower === undefined || upper === undefined) {
    throw new Error("Race archive exact percentile index is unavailable.");
  }
  if (input.position.lowerIndex === input.position.upperIndex) return lower;
  return lower + (upper - lower) * input.position.fractionAboveLower;
}

async function scanSortedValues(input: {
  values: AsyncIterable<number>;
  expectedCount: number;
  captureIndices?: ReadonlySet<number>;
  trimStartIndex?: number;
  trimEndIndexExclusive?: number;
}): Promise<
  Readonly<{
    count: number;
    sum: number;
    trimmedSum: number;
    best: number;
    last: number;
    captured: ReadonlyMap<number, number>;
  }>
> {
  let count = 0;
  let sum = 0;
  let trimmedSum = 0;
  let best: number | undefined;
  let previous: number | undefined;
  const captured = new Map<number, number>();

  for await (const rawValue of input.values) {
    if (count >= input.expectedCount) {
      throw new Error(
        "Race archive exact statistics count exceeded its expectation.",
      );
    }
    const value = positiveSafeInteger(rawValue, "value");
    if (previous !== undefined && value < previous) {
      throw new Error("Race archive exact statistics values are not sorted.");
    }
    if (best === undefined) best = value;
    if (input.captureIndices?.has(count) === true) captured.set(count, value);
    if (
      input.trimStartIndex !== undefined &&
      input.trimEndIndexExclusive !== undefined &&
      count >= input.trimStartIndex &&
      count < input.trimEndIndexExclusive
    ) {
      trimmedSum += value;
    }
    sum += value;
    previous = value;
    count += 1;
  }

  if (
    count !== input.expectedCount ||
    best === undefined ||
    previous === undefined
  ) {
    throw new Error("Race archive exact statistics count changed.");
  }

  return Object.freeze({
    count,
    sum,
    trimmedSum,
    best,
    last: previous,
    captured: new Map(captured),
  });
}

export async function exactSortedRaceArchiveStatistics(input: {
  readValues: () => AsyncIterable<number>;
  expectedCount: number;
  maximumValues: number;
}): Promise<RaceArchiveExactSortedStatistics> {
  const maximumValues = positiveBound(
    input.maximumValues,
    "maximumValues",
    100_000_000,
  );
  const expectedCount = positiveBound(
    input.expectedCount,
    "expectedCount",
    maximumValues,
  );
  const p25Position = percentilePosition(expectedCount, 0.25);
  const medianPosition = percentilePosition(expectedCount, 0.5);
  const p75Position = percentilePosition(expectedCount, 0.75);
  const captureIndices = new Set<number>([
    p25Position.lowerIndex,
    p25Position.upperIndex,
    medianPosition.lowerIndex,
    medianPosition.upperIndex,
    p75Position.lowerIndex,
    p75Position.upperIndex,
  ]);
  const trimCount = expectedCount < 10 ? 0 : Math.floor(expectedCount * 0.1);
  const trimStartIndex = trimCount;
  const trimEndIndexExclusive = expectedCount - trimCount;
  const trimmedCount = trimEndIndexExclusive - trimStartIndex;
  if (trimmedCount < 1) {
    throw new Error("Race archive exact statistics trimmed count is invalid.");
  }

  const firstPass = await scanSortedValues({
    values: input.readValues(),
    expectedCount,
    captureIndices,
    trimStartIndex,
    trimEndIndexExclusive,
  });
  const mean = firstPass.sum / expectedCount;
  const trimmedMean = firstPass.trimmedSum / trimmedCount;
  const p25 = percentileFromCaptured({
    position: p25Position,
    valuesByIndex: firstPass.captured,
  });
  const median = percentileFromCaptured({
    position: medianPosition,
    valuesByIndex: firstPass.captured,
  });
  const p75 = percentileFromCaptured({
    position: p75Position,
    valuesByIndex: firstPass.captured,
  });

  let replayCount = 0;
  let replaySum = 0;
  let replayBest: number | undefined;
  let replayLast: number | undefined;
  let varianceTotal = 0;
  for await (const rawValue of input.readValues()) {
    if (replayCount >= expectedCount) {
      throw new Error(
        "Race archive exact statistics replay count exceeded its expectation.",
      );
    }
    const value = positiveSafeInteger(rawValue, "replayValue");
    if (replayLast !== undefined && value < replayLast) {
      throw new Error(
        "Race archive exact statistics replay values are not sorted.",
      );
    }
    if (replayBest === undefined) replayBest = value;
    replaySum += value;
    varianceTotal += (value - mean) ** 2;
    replayLast = value;
    replayCount += 1;
  }
  if (
    replayCount !== expectedCount ||
    replayBest !== firstPass.best ||
    replayLast !== firstPass.last ||
    replaySum !== firstPass.sum
  ) {
    throw new Error("Race archive exact statistics replay changed.");
  }

  return Object.freeze({
    count: expectedCount,
    best: firstPass.best,
    p25,
    median,
    p75,
    mean,
    trimmedMean,
    populationStandardDeviation: Math.sqrt(varianceTotal / expectedCount),
    interquartileRange: p75 - p25,
  });
}
