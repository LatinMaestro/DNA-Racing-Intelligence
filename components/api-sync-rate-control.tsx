import { updateApiSyncRateAction } from "@/app/(private)/api-sync/actions";
import type { DnaOpenLabSyncRatePageState } from "@/lib/dna-open-lab-sync-rate-policy-service";

const connectionCopy = {
  identity_not_connected:
    "Owner identity is not connected. Changes are disabled.",
  persistence_not_configured:
    "Private rate-policy storage is not configured. The worker remains at 30 rpm.",
  persistence_unavailable:
    "The saved policy could not be read. The worker fails closed to 30 rpm.",
  connected: "Owner-only rate control is connected.",
} as const;

const fallbackCopy = {
  elevation_expired: "The elevated-rate timer expired.",
  provider_limit_reduced: "DNA advertised a reduced provider limit.",
  rate_limit_observed:
    "DNA returned a rate-limit response while the rate was elevated.",
} as const;

function timestamp(value: string | null): string {
  if (value === null) return "Not elevated";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane",
  }).format(new Date(value));
}

export function ApiSyncRateControl({
  state,
  result = null,
}: Readonly<{
  state: DnaOpenLabSyncRatePageState;
  result?: string | null;
}>) {
  const connected = state.connectionStatus === "connected";
  const policy = state.policy;
  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Live API operations
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          API Sync
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Control the shared aggregate request rate for continuous private data
          acquisition. API keys stay server-side and all refreshes remain
          checkpointed, deduplicated and last-good safe.
        </p>
      </header>

      <section
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
        aria-labelledby="current-rate"
      >
        {result === "updated" ? (
          <p className="mb-5 rounded-xl border border-[var(--accent)]/50 bg-[var(--surface)] p-4 text-sm">
            Rate policy saved. The next worker cycle will use the effective
            value shown below.
          </p>
        ) : result !== null ? (
          <p className="mb-5 rounded-xl border border-[var(--warning)]/50 bg-[var(--surface)] p-4 text-sm">
            The rate policy was not changed. Refresh and try again; the worker
            remains fail-closed to its current effective rate.
          </p>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold" id="current-rate">
              Current rate
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {connectionCopy[state.connectionStatus]}
            </p>
          </div>
          <span className="rounded-full border border-[var(--accent)] px-3 py-1 text-sm font-semibold text-[var(--accent)]">
            {policy.effectiveRequestsPerMinute} rpm effective
          </span>
        </div>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-sm text-[var(--muted)]">Requested</dt>
            <dd className="mt-1 text-xl font-semibold">
              {policy.requestedRequestsPerMinute} rpm
            </dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--muted)]">Safe fallback</dt>
            <dd className="mt-1 text-xl font-semibold">30 rpm</dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--muted)]">Elevated until</dt>
            <dd className="mt-1 font-medium">
              {timestamp(policy.elevatedUntil)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--muted)]">Provider limit seen</dt>
            <dd className="mt-1 font-medium">
              {policy.lastProviderLimit === null
                ? "Not reported"
                : `${policy.lastProviderLimit} rpm`}
            </dd>
          </div>
        </dl>
        {policy.fallbackReason !== null ? (
          <p className="mt-5 rounded-xl border border-[var(--warning)]/50 bg-[var(--surface)] p-4 text-sm leading-6">
            <strong>Automatic fallback active.</strong>{" "}
            {fallbackCopy[policy.fallbackReason]} The system will stay at 30 rpm
            until you save a new setting.
          </p>
        ) : null}
      </section>

      <section
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
        aria-labelledby="change-rate"
      >
        <h2 className="text-lg font-semibold" id="change-rate">
          Change request rate
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          Use a rate your current DNA tier explicitly permits. Rates above 30
          automatically expire, and rate-limit evidence can lower the effective
          rate without discarding data or publication state.
        </p>
        <form
          action={updateApiSyncRateAction}
          className="mt-6 grid max-w-3xl gap-5 sm:grid-cols-2"
        >
          <input
            name="expectedVersion"
            type="hidden"
            value={state.expectedVersion}
          />
          <label className="text-sm font-medium">
            Aggregate requests per minute
            <input
              className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
              defaultValue={policy.requestedRequestsPerMinute}
              disabled={!connected}
              list="api-sync-rate-presets"
              max={150}
              min={30}
              name="requestsPerMinute"
              step={1}
              type="number"
            />
            <datalist id="api-sync-rate-presets">
              {[30, 60, 90, 120, 150].map((rate) => (
                <option key={rate} value={rate} />
              ))}
            </datalist>
            <span className="mt-2 block text-xs text-[var(--muted)]">
              Enter any whole-number limit from 30 to 150 rpm.
            </span>
          </label>
          <label className="text-sm font-medium">
            Elevated-rate expiry
            <select
              className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
              defaultValue="24"
              disabled={!connected}
              name="elevationHours"
            >
              <option value="1">1 hour</option>
              <option value="24">24 hours</option>
              <option value="168">7 days</option>
              <option value="744">31 days</option>
            </select>
          </label>
          <div className="sm:col-span-2">
            <button
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!connected}
              type="submit"
            >
              Save rate policy
            </button>
          </div>
        </form>
      </section>

      <section
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
        aria-labelledby="safety-behaviour"
      >
        <h2 className="text-lg font-semibold" id="safety-behaviour">
          Automatic safety behaviour
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--muted)]">
          <li>
            A provider-advertised limit of 30 rpm or lower switches the shared
            pool to 30 immediately.
          </li>
          <li>
            Any rate-limit response while elevated switches the shared pool to
            30, even when no trustworthy limit is supplied.
          </li>
          <li>
            Expired elevation and fallback never auto-raise; you deliberately
            re-enable a higher rate.
          </li>
          <li>
            Retry-After, API response-body status, per-key health, checkpoints
            and last-good publication remain authoritative.
          </li>
        </ul>
      </section>
    </div>
  );
}
