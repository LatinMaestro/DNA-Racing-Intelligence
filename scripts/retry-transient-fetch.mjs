const originalFetch = globalThis.fetch.bind(globalThis);

const MAX_ATTEMPTS = 5;
const DEFAULT_DELAYS_SECONDS = [2, 5, 10, 20];

function retryDelaySeconds(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter;
  return (
    DEFAULT_DELAYS_SECONDS[
      Math.min(attempt, DEFAULT_DELAYS_SECONDS.length - 1)
    ] ?? 20
  );
}

function retryableStatus(status) {
  return status >= 500 && status <= 599;
}

globalThis.fetch = async function resilientFetch(input, init) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await originalFetch(input, init);
    if (!retryableStatus(response.status) || attempt === MAX_ATTEMPTS - 1) {
      return response;
    }
    const delaySeconds = retryDelaySeconds(response, attempt);
    console.warn(
      `[connected-backfill] transient HTTP ${response.status}; retrying in ${delaySeconds}s (attempt ${attempt + 2}/${MAX_ATTEMPTS})`,
    );
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1_000));
  }
  throw new Error("unreachable transient fetch retry state");
};
