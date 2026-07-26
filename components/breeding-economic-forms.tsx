export type BreedingEconomicWriteStatus =
  "identity_not_connected" | "persistence_not_configured";

const statusCopy: Record<
  BreedingEconomicWriteStatus,
  Readonly<{ label: string; detail: string }>
> = {
  identity_not_connected: {
    label: "Owner verification required",
    detail:
      "Breeding economic evidence stays disabled until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    label: "Breeding writes not connected",
    detail:
      "These evidence forms are staged for review, but owner-scoped persistence is not configured. Nothing entered here can be recorded.",
  },
};

const fieldClass =
  "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2";

function BreedingEvidenceFields() {
  return (
    <fieldset className="grid gap-4" disabled>
      <legend className="text-lg font-semibold">
        Completed or refunded breeding
      </legend>
      <p className="text-sm leading-6 text-[var(--muted)]">
        Record only completed transaction evidence or a confirmed refund. An
        Arena listing is availability evidence and cannot create income or
        expense.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor="breeding-event-id">
          Breeding event ID
          <input
            className={`${fieldClass} font-mono`}
            id="breeding-event-id"
            name="breedingEventId"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="breeding-occurred-at">
          Occurred at
          <input
            className={fieldClass}
            id="breeding-occurred-at"
            name="occurredAt"
            required
            type="datetime-local"
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="breeding-lifecycle">
          Evidence state
          <select
            className={fieldClass}
            id="breeding-lifecycle"
            name="lifecycle"
            required
          >
            <option value="completed">Completed breeding</option>
            <option value="refunded">Confirmed refund</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="breeding-transaction-id">
          Transaction ID
          <input
            className={`${fieldClass} font-mono`}
            id="breeding-transaction-id"
            name="transactionId"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="breeding-parent-a">
          Parent Core ID 1
          <input
            className={`${fieldClass} font-mono`}
            id="breeding-parent-a"
            name="parentCoreIdA"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="breeding-parent-b">
          Parent Core ID 2
          <input
            className={`${fieldClass} font-mono`}
            id="breeding-parent-b"
            name="parentCoreIdB"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="breeding-asset-code">
          Original asset
          <input
            autoCapitalize="characters"
            className={`${fieldClass} font-mono`}
            id="breeding-asset-code"
            maxLength={16}
            name="assetCode"
            placeholder="ETH, DEZ, USD or BGC"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="breeding-amount">
          Exact amount
          <input
            className={`${fieldClass} font-mono`}
            id="breeding-amount"
            inputMode="decimal"
            name="amount"
            pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]+)?"
            required
          />
        </label>
      </div>
      <label className="grid gap-2 text-sm" htmlFor="breeding-evidence-note">
        Audit note
        <textarea
          className={fieldClass}
          id="breeding-evidence-note"
          name="evidenceNote"
          required
          rows={3}
        />
      </label>
      <button
        className="w-fit rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        disabled
        type="submit"
      >
        Record breeding evidence
      </button>
    </fieldset>
  );
}

function CostBasisFields() {
  return (
    <fieldset className="grid gap-4" disabled>
      <legend className="text-lg font-semibold">
        Offspring cost-basis review
      </legend>
      <p className="text-sm leading-6 text-[var(--muted)]">
        Assign confirmed actual pairing costs only to confirmed owned offspring.
        Original assets remain separate and no market value or realised gain is
        inferred.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor="cost-basis-offspring">
          Offspring Core ID
          <input
            className={`${fieldClass} font-mono`}
            id="cost-basis-offspring"
            name="offspringCoreId"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="cost-basis-event">
          Breeding event ID
          <input
            className={`${fieldClass} font-mono`}
            id="cost-basis-event"
            name="breedingEventId"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="cost-basis-transaction">
          Cost transaction ID
          <input
            className={`${fieldClass} font-mono`}
            id="cost-basis-transaction"
            name="transactionId"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="cost-basis-category">
          Cost category
          <select
            className={fieldClass}
            id="cost-basis-category"
            name="category"
            required
          >
            <option value="dna_base_fee">DNA base fee</option>
            <option value="external_arena_fee">External Arena fee</option>
            <option value="arena_fee_bgc">Arena fee paid in BGC</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="cost-basis-asset">
          Original asset
          <input
            autoCapitalize="characters"
            className={`${fieldClass} font-mono`}
            id="cost-basis-asset"
            maxLength={16}
            name="assetCode"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="cost-basis-amount">
          Exact actual cost
          <input
            className={`${fieldClass} font-mono`}
            id="cost-basis-amount"
            inputMode="decimal"
            name="amount"
            pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]+)?"
            required
          />
        </label>
      </div>
      <button
        className="w-fit rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        disabled
        type="submit"
      >
        Review offspring cost basis
      </button>
    </fieldset>
  );
}

export function BreedingEconomicForms({
  status,
}: Readonly<{ status: BreedingEconomicWriteStatus }>) {
  const copy = statusCopy[status];

  return (
    <section aria-labelledby="breeding-economic-evidence">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold" id="breeding-economic-evidence">
            Breeding economic evidence
          </h2>
          <p className="mt-2 max-w-4xl leading-7 text-[var(--muted)]">
            Evidence entry never initiates a splice, wallet or game transaction
            and never requests a private key, seed phrase or signing credential.
          </p>
        </div>
        <span
          className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--warning)]"
          role="status"
        >
          {copy.label}
        </span>
      </div>
      <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--muted)]">
        {copy.detail}
      </p>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <form
          aria-label="Completed or refunded breeding evidence"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
        >
          <BreedingEvidenceFields />
        </form>
        <form
          aria-label="Offspring cost-basis review"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
        >
          <CostBasisFields />
        </form>
      </div>
    </section>
  );
}
