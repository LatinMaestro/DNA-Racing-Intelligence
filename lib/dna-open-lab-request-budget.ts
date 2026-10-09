import {
  DnaOpenLabApiError,
  type DnaOpenLabRateLimit,
  type DnaOpenLabResponse,
} from "./dna-open-lab-v1-client";

const WINDOW_MILLISECONDS = 60_000;
const TOKEN_BUCKET_CAPACITY = 1;
export const DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE = 30 as const;
const DEFAULT_INITIAL_REQUESTS_PER_MINUTE =
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE;
export const DNA_OPEN_LAB_SERVER_LIMIT_CEILING = 10_000 as const;
const DEFAULT_MAXIMUM_REQUESTS_PER_MINUTE = DNA_OPEN_LAB_SERVER_LIMIT_CEILING;

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
  reduceEffectiveRequestsPerMinute: (requestsPerMinute: number) => void;
  snapshot: () => DnaOpenLabRequestBudgetSnapshot;
}>;

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

/**
 * Creates a local request gate starting at DNA's base 30 requests/minute
 * allowance. Existing callers retain the conservative sliding-window gate;
 * throughput-sensitive collectors may explicitly select a one-request token
 * bucket that continuously refills at the effective rate, so concurrent callers
 * approach the approved rate without a burst at the start of a provider minute.
 * Authenticated server-advertised rate limits are authoritative and may raise
 * or lower the effective lane allowance. The high implementation ceiling
 * exists only as a sanity bound; it is not an owner RPM policy.
 *
 * The gate deliberately does not retry failed requests. A 429 is surfaced to
 * the caller unchanged, while Retry-After/reset metadata blocks later requests
 * from starting too early.
 */
export function createDnaOpenLabRequestBudget(
  input: {
    nowMilliseconds?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    initialRequestsPerMinute?: number;
    maximumRequestsPerMinute?: number;
    scheduling?: "sliding_window" | "token_bucket";
  } = {},
): DnaOpenLabRequestBudget {
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
  const scheduling = input.scheduling ?? "sliding_window";

  let effectiveRequestsPerMinute = initialRequestsPerMinute;
  let blockedUntilMilliseconds = 0;
  let permitTail: Promise<void> = Promise.resolve();
  const requestStarts: number[] = [];
  let availableTokens = TOKEN_BUCKET_CAPACITY;
  let lastRefillMilliseconds = nowMilliseconds();

  const prune = (now: number) => {
    while (
      requestStarts.length > 0 &&
      requestStarts[0] !== undefined &&
      requestStarts[0] <= now - WINDOW_MILLISECONDS
    ) {
      requestStarts.shift();
    }
  };

  const refill = (now: number) => {
    if (now < lastRefillMilliseconds) {
      throw new Error("nowMilliseconds must be monotonic");
    }
    const elapsed = now - lastRefillMilliseconds;
    availableTokens = Math.min(
      TOKEN_BUCKET_CAPACITY,
      availableTokens +
        (elapsed * effectiveRequestsPerMinute) / WINDOW_MILLISECONDS,
    );
    lastRefillMilliseconds = now;
  };

  const observeRateLimit = (rateLimit: DnaOpenLabRateLimit) => {
    const now = nowMilliseconds();
    refill(now);
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

  const reduceEffectiveRequestsPerMinute = (requestsPerMinute: number) => {
    refill(nowMilliseconds());
    effectiveRequestsPerMinute = Math.min(
      effectiveRequestsPerMinute,
      positiveSafeInteger(requestsPerMinute, "requestsPerMinute"),
    );
  };

  const waitForPermit = async () => {
    while (true) {
      const now = nowMilliseconds();
      prune(now);
      refill(now);

      const serverWait = Math.max(0, blockedUntilMilliseconds - now);
      const oldest = requestStarts[0];
      const localWait =
        scheduling === "token_bucket"
          ? Math.ceil(
              (Math.max(0, 1 - availableTokens) * WINDOW_MILLISECONDS) /
                effectiveRequestsPerMinute,
            )
          : requestStarts.length >= effectiveRequestsPerMinute &&
              oldest !== undefined
            ? Math.max(0, oldest + WINDOW_MILLISECONDS - now)
            : 0;
      const waitMilliseconds = Math.max(serverWait, localWait);

      if (waitMilliseconds <= 0) {
        if (scheduling === "token_bucket") {
          availableTokens = Math.max(0, availableTokens - 1);
        }
        requestStarts.push(now);
        return;
      }
      await sleep(waitMilliseconds);
    }
  };

  const startWithPermit = async <T>(
    request: () => Promise<DnaOpenLabResponse<T>>,
  ): Promise<DnaOpenLabResponse<T>> => {
    const previous = permitTail;
    let release: (() => void) | undefined;
    permitTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    let pending: Promise<DnaOpenLabResponse<T>>;
    try {
      await waitForPermit();
      // Invoke the request before releasing the next permit waiter. This keeps
      // request starts ordered even when a test or runtime sleep resolves in a
      // microtask, while responses remain free to overlap.
      pending = request();
    } finally {
      release?.();
    }
    return pending;
  };

  const execute = async <T>(
    request: () => Promise<DnaOpenLabResponse<T>>,
  ): Promise<DnaOpenLabResponse<T>> => {
    try {
      const response = await startWithPermit(request);
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
    refill(now);
    return Object.freeze({
      effectiveRequestsPerMinute,
      requestsInCurrentWindow: requestStarts.length,
      blockedUntilMilliseconds:
        blockedUntilMilliseconds > now ? blockedUntilMilliseconds : null,
    });
  };

  return Object.freeze({
    execute,
    observeRateLimit,
    reduceEffectiveRequestsPerMinute,
    snapshot,
  });
}
