import type {
  CurrentVaultRegistry,
  MaidenState,
} from "@/domain/vault-registry";
import type { VaultWorkspaceConnectionStatus } from "@/lib/vault-workspace-service";

const connectionCopy: Record<
  VaultWorkspaceConnectionStatus,
  Readonly<{ heading: string; detail: string; action: string }>
> = {
  identity_not_connected: {
    heading: "Owner identity not connected",
    detail:
      "The private Vault remains unavailable until the signed-in owner is verified against the server-side allowlist.",
    action: "Vault edits unavailable",
  },
  persistence_not_configured: {
    heading: "Private Vault storage not connected",
    detail:
      "Owner verification is available, but the Preview-only Vault repository is not configured. No ownership or Maiden state can be changed.",
    action: "Vault edits unavailable",
  },
  read_model_connected: {
    heading: "Historical Vault snapshot connected",
    detail:
      "The current accepted owner-scoped snapshot and auditable manual overlays are available. Imported ownership remains historical, not live game state.",
    action: "Vault edits pending",
  },
};

const maidenLabels: Record<MaidenState, string> = {
  eligible: "ME eligible",
  not_eligible: "Not ME eligible",
  unknown: "ME unknown",
  invalid: "ME evidence invalid",
};

const timestampFormatter = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function Timestamp({ value }: Readonly<{ value: string | null }>) {
  if (value === null) return <>Not available</>;
  return (
    <time dateTime={value}>
      {timestampFormatter.format(new Date(value))} UTC
    </time>
  );
}

function totalByMaiden(
  registry: CurrentVaultRegistry,
  maidenState: MaidenState,
): number {
  return registry.cores.filter((core) => core.maidenState === maidenState)
    .length;
}

export function VaultWorkspace({
  registry,
  connectionStatus,
}: Readonly<{
  registry: CurrentVaultRegistry;
  connectionStatus: VaultWorkspaceConnectionStatus;
}>) {
  const connection = connectionCopy[connectionStatus];
  const missingProfileCount = registry.cores.filter(
    ({ profileStatus }) => profileStatus === "missing_core_details",
  ).length;
  const summaries = [
    ["Active owned cores", registry.cores.length.toLocaleString("en-AU")],
    [
      "ME eligible",
      totalByMaiden(registry, "eligible").toLocaleString("en-AU"),
    ],
    [
      "Identity review",
      registry.unresolvedIdentityCount.toLocaleString("en-AU"),
    ],
    ["Missing Core Details", missingProfileCount.toLocaleString("en-AU")],
  ] as const;

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Phase 2 Vault control
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Current Vault
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Confirmed durable-ID ownership, separate Maiden eligibility and
          historical snapshot freshness. Proposed identity matches never create
          personal profiles, economics or recommendations.
        </p>
      </header>

      <section
        aria-labelledby="vault-connection"
        className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="vault-connection">
          {connection.heading}
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          {connection.detail}
        </p>
        <button
          className="mt-5 cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
          disabled
          type="button"
        >
          {connection.action}
        </button>
      </section>

      <section aria-labelledby="vault-summary">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="vault-summary">
              Historical Vault summary
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Data current through{" "}
              <Timestamp value={registry.dataCurrentThrough} /> · Last imported{" "}
              <Timestamp value={registry.lastImportedAt} /> ·{" "}
              {registry.freshness}
            </p>
          </div>
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaries.map(([label, value]) => (
            <div
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
              key={label}
            >
              <dt className="text-sm text-[var(--muted)]">{label}</dt>
              <dd className="mt-2 text-2xl font-semibold tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-labelledby="owned-core-registry"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-lg font-semibold" id="owned-core-registry">
          Owned-core registry
        </h2>
        {registry.cores.length === 0 ? (
          <p className="mt-4 leading-7 text-[var(--muted)]">
            No accepted Current Vault evidence is connected. Missing ownership
            is unavailable evidence, not a zero-value Vault or a negative core
            assessment.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {registry.cores.map((core) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 py-4"
                key={core.coreId}
              >
                <div>
                  <p className="font-mono text-sm font-medium">{core.coreId}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {core.ownershipSource} ownership · {core.maidenSource}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium">
                    {maidenLabels[core.maidenState]}
                  </p>
                  <p className="mt-1 text-[var(--muted)]">
                    {core.profileStatus.replaceAll("_", " ")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm leading-6 text-[var(--muted)]">
        Maiden eligibility is a one-use strategic state. This workspace does not
        recommend committing a core to a Maiden, and imported Vault evidence
        does not represent live game availability.
      </p>
    </div>
  );
}
