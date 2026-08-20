import {
  proLeagueAnnouncementRules,
  type ProLeagueRosterAudit,
} from "@/domain/pro-league-roster";

const elements = ["Metal", "Fire", "Earth", "Water"] as const;

export function ProLeagueWorkspace({
  audit,
}: Readonly<{ audit: ProLeagueRosterAudit }>) {
  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Provisional owner preparation
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Pro League
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Prepare an owned 25-core bike roster from the published community
          announcement. This planner supports selection, Discovery and breeding
          review only. It cannot enter a team, race, mint, trade or guarantee a
          breeding outcome.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--surface-raised)] p-6">
        <h2 className="text-lg font-semibold">Provisional rule authority</h2>
        <p className="mt-3 max-w-4xl leading-7 text-[var(--muted)]">
          Source: {proLeagueAnnouncementRules.sourceLabel}, received{" "}
          {proLeagueAnnouncementRules.receivedAt}. Public access was estimated
          for {proLeagueAnnouncementRules.publicAccessEstimate}; launch timing,
          maps, distances, scoring and performance selection rules remain
          unconfirmed.
        </p>
      </section>

      <section aria-labelledby="roster-rules">
        <h2 className="text-xl font-semibold" id="roster-rules">
          Published roster boundaries
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Roster", "Exactly 25 owned cores"],
            ["Elements", "At least 5 Metal, Fire, Earth and Water"],
            ["Genesis cap", "Maximum 2 Genesis per element"],
            ["Female cores", "At least 8"],
            ["F15+ cores", "At least 5"],
            ["Current focus", "Bike mode"],
          ].map(([heading, detail]) => (
            <article
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
              key={heading}
            >
              <h3 className="font-semibold">{heading}</h3>
              <p className="mt-2 text-sm text-[var(--muted)]">{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="roster-audit"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold" id="roster-audit">
              My Vault roster audit
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              The owner-maintained My Vault registry remains the only ownership
              authority.
            </p>
          </div>
          <span className="rounded-full border border-[var(--warning)]/50 px-3 py-1 text-xs font-semibold text-[var(--warning)]">
            {audit.readiness === "compliant"
              ? "Provisional rules met"
              : "Preparation incomplete"}
          </span>
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {elements.map((element) => (
            <div
              className="rounded-xl border border-[var(--border)] p-4"
              key={element}
            >
              <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">
                {element}
              </dt>
              <dd className="mt-1 font-semibold">
                {audit.elementCounts[element]} total ·{" "}
                {audit.genesisCounts[element]} Genesis
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-[var(--muted)]">
          {audit.selectedCoreCount}/25 selected · {audit.femaleCount}/8 females
          · {audit.f15PlusCount}/5 F15+
        </p>
        {audit.issues.length === 0 ? (
          <p className="mt-4 text-sm">
            The selected roster meets every currently published boundary.
          </p>
        ) : (
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[var(--muted)]">
            {audit.issues.map((issue, index) => (
              <li key={issue.code + "-" + index}>{issue.detail}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="preparation-priorities">
        <h2 className="text-xl font-semibold" id="preparation-priorities">
          Breeding and Discovery preparation
        </h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
            <h3 className="font-semibold">Breeding-first gap closure</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              No additional Genesis minting is part of this plan. Use existing
              owned cores first, then review breeding pairs against remaining
              element, female and F15+ gaps. Published roster requirements do
              not prove inheritance outcomes.
            </p>
            {audit.breedingPriorities.length === 0 ? (
              <p className="mt-4 text-sm">
                No structural breeding gap detected.
              </p>
            ) : (
              <ul className="mt-4 space-y-3 text-sm text-[var(--muted)]">
                {audit.breedingPriorities.map((priority) => (
                  <li key={priority.priorityId}>
                    <span className="font-semibold text-[var(--foreground)]">
                      {priority.remaining} needed
                    </span>{" "}
                    · {priority.guidance}
                  </li>
                ))}
              </ul>
            )}
          </article>
          <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
            <h3 className="font-semibold">
              Bike evidence before final selection
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Within a structurally compliant roster, use accepted Bike
              evidence, sample sizes, confidence and freshness to identify
              testing priorities. Exact map and distance requirements are not
              published, so Discovery must not manufacture them or claim a final
              competitive ranking.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
