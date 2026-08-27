import {
  DnaOpenLabApiError,
  type DnaOpenLabRateLimit,
  type DnaOpenLabResponse,
} from "./dna-open-lab-v1-client";

const WINDOW_MILLISECONDS = 60_000;
const DEFAULT_INITIAL_REQUESTS_PER_MINUTE = 30;
const DEFAULT_MAXIMUM_REQUESTS_PER_MINUTE = 150;

export type DnaOpenLabRequestBudgetSnapshot = Readonly<{
  effectiveRequestsPerMinute: number;
  requestsInCurrentWindow: number;
  blockedUntilMilliseconds: number | null;
}>;

export type DnaOpenLabRequestBudget = Readonly<{
  execute: <T>(
    request: () => Promise<DnaOpenLabResponse<T>>,
  ) => Promise<DnaOpenLabResponse<T>>;
  observeRateLimit: (rateLimit: DnaOpenLabRateLimit) => void;
  snapshot: () => DnaOpenLabRequestBudgetSnapshot;
}>;

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

/**
 * Creates a local sliding-window request gate that is safe at DNA's minimum
 * eligible 30 requests/minute tier and can increase its local allowance only
 * after the API explicitly advertises a higher limit.
 *
 * The gate deliberately does not retry failed requests. A 429 is surfaced to
 * the caller unchanged, while Retry-After/reset metadata blocks later requests
 * from starting too early.
 */
export function createDnaOpenLabRequestBudget(input: {
  nowMilliseconds?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  initialRequestsPerMinute?: number;
  maximumRequestsPerMinute?: number;
} = {}): DnaOpenLabRequestBudget {
  const nowMilliseconds = input.nowMilliseconds ?? Date.now;
  const sleep =
    input.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const initialRequestsPerMinute = positiveSafeInteger(
    input.initialRequestsPerMinute ?? DEFAULT_INITIAL_REQUESTS_PER_MINUTE,
    "initialRequestsPerMinute",
  );
  const maximumRequestsPerMinute = positiveSafeInteger(
    input.maximumRequestsPerMinute ?? DEFAULT_MAXIMUM_REQUESTS_PER_MINUTE,
    "maximumRequestsPerMinute",
  );
  if (initialRequestsPerMinute > maximumRequestsPerMinute) {
    throw new Error(
      "initialRequestsPerMinute cannot exceed maximumRequestsPerMinute",
    );
  }

  let effectiveRequestsPerMinute = initialRequestsPerMinute;
  let blockedUntilMilliseconds = 0;
  let permitTail: Promise<void> = Promise.resolve();
  const requestStarts: number[] = [];

  const prune = (now: number) => {
    while (
      requestStarts.length > 0 &&
      requestStarts[0] !== undefined &&
      requestStarts[0] <= now - WINDOW_MILLISECONDS
    ) {
      requestStarts.shift();
    }
  };

  const observeRateLimit = (rateLimit: DnaOpenLabRateLimit) => {
    if (
      rateLimit.limit !== null &&
      Number.isSafeInteger(rateLimit.limit) &&
      rateLimit.limit > 0
    ) {
      effectiveRequestsPerMinute = Math.min(
        rateLimit.limit,
        maximumRequestsPerMinute,
      );
    }

    const now = nowMilliseconds();
    if (
      rateLimit.retryAfterSeconds !== null &&
      Number.isSafeInteger(rateLimit.retryAfterSeconds) &&
      rateLimit.retryAfterSeconds > 0
    ) {
      blockedUntilMilliseconds = Math.max(
        blockedUntilMilliseconds,
        now + rateLimit.retryAfterSeconds * 1_000,
      );
    }

    if (
      rateLimit.remaining === 0 &&
      rateLimit.resetSeconds !== null &&
      Number.isSafeInteger(rateLimit.resetSeconds) &&
      rateLimit.resetSeconds > 0
    ) {
      blockedUntilMilliseconds = Math.max(
        blockedUntilMilliseconds,
        now + rateLimit.resetSeconds * 1_000,
      );
    }
  };

  const waitForPermit = async () => {
    while (true) {
      const now = nowMilliseconds();
      prune(now);

      const serverWait = Math.max(0, blockedUntilMilliseconds - now);
      const oldest = requestStarts[0];
      const localWait =
        requestStarts.length >= effectiveRequestsPerMinute &&
        oldest !== undefined
          ? Math.max(0, oldest + WINDOW_MILLISECONDS - now)
          : 0;
      const waitMilliseconds = Math.max(serverWait, localWait);

      if (waitMilliseconds <= 0) {
        requestStarts.push(now);
        return;
      }
      await sleep(waitMilliseconds);
    }
  };

  const acquirePermit = async () => {
    const previous = permitTail;
    let release: (() => void) | undefined;
    permitTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await waitForPermit();
    } finally {
      release?.();
    }
  };

  const execute = async <T>(
    request: () => Promise<DnaOpenLabResponse<T>>,
  ): Promise<DnaOpenLabResponse<T>> => {
    await acquirePermit();
    try {
      const response = await request();
      observeRateLimit(response.rateLimit);
      return response;
    } catch (error) {
      if (error instanceof DnaOpenLabApiError && error.rateLimit !== null) {
        observeRateLimit(error.rateLimit);
      }
      throw error;
    }
  };

  const snapshot = (): DnaOpenLabRequestBudgetSnapshot => {
    const now = nowMilliseconds();
    prune(now);
    return Object.freeze({
      effectiveRequestsPerMinute,
      requestsInCurrentWindow: requestStarts.length,
      blockedUntilMilliseconds:
        blockedUntilMilliseconds > now ? blockedUntilMilliseconds : null,
    });
  };

  return Object.freeze({ execute, observeRateLimit, snapshot });
}
