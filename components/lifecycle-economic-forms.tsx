"use client";

import { useActionState } from "react";
import {
  submitBurnCreditFormAction,
  submitCoreBurnFormAction,
  submitCoreSaleFormAction,
} from "@/app/(private)/lifecycle/actions";

export type LifecycleEconomicWriteStatus =
  "identity_not_connected" | "persistence_not_configured" | "ready";

const statusCopy: Record<
  LifecycleEconomicWriteStatus,
  Readonly<{ label: string; detail: string }>
> = {
  identity_not_connected: {
    label: "Owner verification required",
    detail:
      "Lifecycle economic evidence stays disabled until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    label: "Lifecycle writes not connected",
    detail:
      "These evidence forms are staged for review, but owner-scoped persistence is not configured. Nothing entered here can be recorded.",
  },
  ready: {
    label: "Lifecycle evidence ready",
    detail:
      "Confirmed owner-scoped sale, burn and actual BGC credit evidence can be recorded. Every submission is rechecked against accepted server-side evidence before persistence.",
  },
};

const fieldClass =
  "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2";
const buttonClass =
  "w-fit rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

function SaleFields({ disabled }: Readonly<{ disabled: boolean }>) {
  return (
    <fieldset
      aria-describedby="sale-evidence-help"
      className="grid gap-4"
      disabled={disabled}
    >
      <legend className="text-lg font-semibold">Completed core sale</legend>
      <p
        className="text-sm leading-6 text-[var(--muted)]"
        id="sale-evidence-help"
      >
        Record confirmed proceeds and selling fees in their original assets.
        When acquisition cost is missing, realised gain remains unavailable.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor="sale-core-id">
          Core ID
          <input
            className={`${fieldClass} font-mono`}
            id="sale-core-id"
            name="coreId"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="sale-occurred-at">
          Sold at
          <input
            className={fieldClass}
            id="sale-occurred-at"
            name="occurredAt"
            placeholder="2026-10-17T13:30:00+10:00"
            required
            type="text"
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="sale-asset">
          Proceeds asset
          <input
            autoCapitalize="characters"
            className={`${fieldClass} font-mono`}
            id="sale-asset"
            maxLength={16}
            name="proceedsAsset"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="sale-amount">
          Exact proceeds
          <input
            className={`${fieldClass} font-mono`}
            id="sale-amount"
            inputMode="decimal"
            name="proceedsAmount"
            pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]+)?"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="sale-fees">
          Exact selling fees
          <input
            className={`${fieldClass} font-mono`}
            id="sale-fees"
            inputMode="decimal"
            name="sellingFees"
            pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]+)?"
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="sale-cost-basis">
          Acquisition cost, if known
          <input
            className={`${fieldClass} font-mono`}
            id="sale-cost-basis"
            inputMode="decimal"
            name="acquisitionCost"
            pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]+)?"
          />
        </label>
      </div>
      <button className={buttonClass} disabled={disabled} type="submit">
        Record sale evidence
      </button>
    </fieldset>
  );
}

function BurnFields({ disabled }: Readonly<{ disabled: boolean }>) {
  return (
    <fieldset
      aria-describedby="burn-evidence-help"
      className="grid gap-4"
      disabled={disabled}
    >
      <legend className="text-lg font-semibold">Completed core burn</legend>
      <p
        className="text-sm leading-6 text-[var(--muted)]"
        id="burn-evidence-help"
      >
        Record irreversible burn evidence only after completion. Genesis cores
        cannot be burned, and this record never predicts a BGC amount.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor="burn-core-id">
          Core ID
          <input
            className={`${fieldClass} font-mono`}
            id="burn-core-id"
            name="coreId"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="burn-core-class">
          Core class
          <select
            className={fieldClass}
            id="burn-core-class"
            name="coreClass"
            required
          >
            <option value="Morphed">Morphed</option>
            <option value="Freak">Freak</option>
            <option value="X-Class">X-Class</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="burn-occurred-at">
          Burned at
          <input
            className={fieldClass}
            id="burn-occurred-at"
            name="occurredAt"
            placeholder="2026-10-17T13:30:00+10:00"
            required
            type="text"
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="burn-reason">
          Evidence reason
          <input
            className={fieldClass}
            id="burn-reason"
            name="reason"
            required
          />
        </label>
      </div>
      <button className={buttonClass} disabled={disabled} type="submit">
        Record burn evidence
      </button>
    </fieldset>
  );
}

function BurnCreditFields({ disabled }: Readonly<{ disabled: boolean }>) {
  return (
    <fieldset
      aria-describedby="burn-credit-help"
      className="grid gap-4"
      disabled={disabled}
    >
      <legend className="text-lg font-semibold">
        Actual post-burn BGC credit
      </legend>
      <p
        className="text-sm leading-6 text-[var(--muted)]"
        id="burn-credit-help"
      >
        Record only the actual confirmed BGC received for a durable burn. This
        is separate from historical Race Merge BGC rows, which retain
        performance evidence but have zero race economics.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor="credit-burn-id">
          Burn ID
          <input
            className={`${fieldClass} font-mono`}
            id="credit-burn-id"
            name="burnId"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="credit-core-id">
          Core ID
          <input
            className={`${fieldClass} font-mono`}
            id="credit-core-id"
            name="coreId"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="credit-occurred-at">
          Credited at
          <input
            className={fieldClass}
            id="credit-occurred-at"
            name="occurredAt"
            placeholder="2026-10-17T13:30:00+10:00"
            required
            type="text"
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="credit-amount">
          Actual BGC amount
          <input
            className={`${fieldClass} font-mono`}
            id="credit-amount"
            inputMode="decimal"
            name="amount"
            pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]+)?"
            required
          />
        </label>
      </div>
      <button className={buttonClass} disabled={disabled} type="submit">
        Record actual BGC credit
      </button>
    </fieldset>
  );
}

export function LifecycleEconomicForms({
  status,
}: Readonly<{ status: LifecycleEconomicWriteStatus }>) {
  const copy = statusCopy[status];
  const [saleResult, saleAction, salePending] = useActionState(
    submitCoreSaleFormAction,
    null,
  );
  const [burnResult, burnAction, burnPending] = useActionState(
    submitCoreBurnFormAction,
    null,
  );
  const [creditResult, creditAction, creditPending] = useActionState(
    submitBurnCreditFormAction,
    null,
  );
  const ready = status === "ready";
  return (
    <section aria-labelledby="lifecycle-economic-evidence">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            className="text-xl font-semibold"
            id="lifecycle-economic-evidence"
          >
            Lifecycle economic evidence
          </h2>
          <p className="mt-2 max-w-4xl leading-7 text-[var(--muted)]">
            Evidence entry never sells or burns a core, changes ownership,
            initiates a wallet or game transaction, or requests signing
            credentials.
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
          action={saleAction}
          aria-label="Completed core sale evidence"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
        >
          <SaleFields disabled={!ready || salePending} />
          {saleResult === null ? null : (
            <p
              aria-live="polite"
              className="mt-4 text-sm leading-6 text-[var(--muted)]"
              role="status"
            >
              <strong>{saleResult.title}.</strong> {saleResult.detail}
            </p>
          )}
        </form>
        <form
          action={burnAction}
          aria-label="Completed core burn evidence"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
        >
          <BurnFields disabled={!ready || burnPending} />
          {burnResult === null ? null : (
            <p
              aria-live="polite"
              className="mt-4 text-sm leading-6 text-[var(--muted)]"
              role="status"
            >
              <strong>{burnResult.title}.</strong> {burnResult.detail}
            </p>
          )}
        </form>
        <form
          action={creditAction}
          aria-label="Actual post-burn BGC credit"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 xl:col-span-2"
        >
          <BurnCreditFields disabled={!ready || creditPending} />
          {creditResult === null ? null : (
            <p
              aria-live="polite"
              className="mt-4 text-sm leading-6 text-[var(--muted)]"
              role="status"
            >
              <strong>{creditResult.title}.</strong> {creditResult.detail}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
