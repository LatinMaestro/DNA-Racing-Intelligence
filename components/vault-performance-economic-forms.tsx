"use client";

import { useActionState } from "react";
import { submitManualLedgerFormAction } from "@/app/(private)/vault-performance/actions";

export type VaultPerformanceEconomicWriteStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "manual_ledger_ready";

const statusCopy: Record<
  VaultPerformanceEconomicWriteStatus,
  Readonly<{ label: string; detail: string }>
> = {
  identity_not_connected: {
    label: "Owner verification required",
    detail:
      "Manual economic evidence stays disabled until the signed-in owner is verified against the server-side allowlist.",
  },
  persistence_not_configured: {
    label: "Economic writes not connected",
    detail:
      "The forms are staged for review, but owner-scoped persistence is not configured. Nothing entered here can be recorded yet.",
  },
  manual_ledger_ready: {
    label: "Manual ledger ready",
    detail:
      "Owner-scoped manual ledger evidence can be recorded. Tournament payout entry remains disabled until its imported-candidate reconciliation source is connected.",
  },
};

function ManualLedgerFields({ disabled }: Readonly<{ disabled: boolean }>) {
  return (
    <fieldset className="grid gap-4" disabled={disabled}>
      <legend className="text-lg font-semibold">Manual ledger entry</legend>
      <p
        className="text-sm leading-6 text-[var(--muted)]"
        id="manual-ledger-help"
      >
        Record historical income, expense or non-operating movement in its
        original asset. Deposits, withdrawals and transfers never become
        operating profit.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor="ledger-occurred-at">
          Occurred at
          <input
            aria-describedby="manual-ledger-help"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="ledger-occurred-at"
            name="occurredAt"
            required
            placeholder="2026-10-16T10:30:00+10:00"
            type="text"
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="ledger-asset-code">
          Asset code
          <input
            autoCapitalize="characters"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono"
            id="ledger-asset-code"
            maxLength={16}
            name="assetCode"
            placeholder="ETH, DEZ, USD or BGC"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="ledger-asset-kind">
          Asset kind
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="ledger-asset-kind"
            name="assetKind"
            required
          >
            <option value="crypto">Crypto</option>
            <option value="fiat">Fiat</option>
            <option value="game_credit">BGC game credit</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="ledger-amount">
          Exact amount
          <input
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono"
            id="ledger-amount"
            inputMode="decimal"
            name="amount"
            pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]+)?"
            placeholder="0.00"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="ledger-category">
          Category
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="ledger-category"
            name="category"
            required
          >
            <option value="income">Income</option>
            <option value="expense">Expense</option>
            <option value="deposit">Deposit</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="transfer">Transfer</option>
            <option value="opening_balance">Opening balance</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="ledger-subcategory">
          Subcategory
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="ledger-subcategory"
            name="subcategory"
            required
          >
            <option value="other_income">Other income</option>
            <option value="breeding_fee_earned">Breeding fee earned</option>
            <option value="core_sale">Core sale</option>
            <option value="burn_bgc_credit">Burn BGC credit</option>
            <option value="refund">Refund</option>
            <option value="other_expense">Other expense</option>
            <option value="breeding_fee_paid">Breeding fee paid</option>
            <option value="dna_base_fee">DNA base fee</option>
            <option value="arena_owner_fee">Arena owner fee</option>
            <option value="arena_fee_bgc">Arena fee (BGC)</option>
            <option value="core_purchase">Core purchase</option>
            <option value="marketplace_fee">Marketplace fee</option>
            <option value="deposit">Deposit</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="internal_transfer">Internal transfer</option>
            <option value="opening_balance">Opening balance</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="ledger-direction">
          Direction (adjustments only)
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="ledger-direction"
            name="direction"
          >
            <option value="">Use category direction</option>
            <option value="credit">Credit</option>
            <option value="debit">Debit</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="ledger-account-label">
          Account label
          <input
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="ledger-account-label"
            name="accountLabel"
            placeholder="Owner account"
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="ledger-from-account">
          Transfer from (transfers only)
          <input
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="ledger-from-account"
            name="fromAccountLabel"
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="ledger-to-account">
          Transfer to (transfers only)
          <input
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="ledger-to-account"
            name="toAccountLabel"
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="ledger-tournament-id">
          Tournament ID (optional)
          <input
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono"
            id="ledger-tournament-id"
            name="tournamentId"
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="ledger-core-id">
          Core ID (optional)
          <input
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono"
            id="ledger-core-id"
            name="coreId"
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="ledger-cost-basis">
          Cost basis
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="ledger-cost-basis"
            name="costBasisStatus"
          >
            <option value="">Not supplied</option>
            <option value="known">Known</option>
            <option value="missing">Missing</option>
            <option value="not_applicable">Not applicable</option>
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm" htmlFor="ledger-reference">
        External reference
        <input
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          id="ledger-reference"
          name="externalReference"
        />
      </label>
      <label className="grid gap-2 text-sm" htmlFor="ledger-note">
        Evidence note
        <textarea
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          id="ledger-note"
          maxLength={1000}
          name="note"
          rows={3}
        />
      </label>
      <button
        className="w-fit rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        type="submit"
      >
        Record ledger entry
      </button>
    </fieldset>
  );
}

function TournamentPayoutFields({ disabled }: Readonly<{ disabled: boolean }>) {
  return (
    <fieldset className="grid gap-4" disabled={disabled}>
      <legend className="text-lg font-semibold">
        Manual tournament payout
      </legend>
      <p
        className="text-sm leading-6 text-[var(--muted)]"
        id="tournament-payout-help"
      >
        Record a completed owner payout received outside Race Merge. Every
        payout remains reviewable against later imported evidence before it
        enters aggregates.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor="payout-occurred-at">
          Occurred at
          <input
            aria-describedby="tournament-payout-help"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="payout-occurred-at"
            name="occurredAt"
            required
            type="datetime-local"
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="payout-tournament-id">
          Tournament ID
          <input
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono"
            id="payout-tournament-id"
            name="tournamentId"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="payout-stage">
          Stage
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="payout-stage"
            name="stage"
            required
          >
            <option value="qualification">Qualification</option>
            <option value="round">Round</option>
            <option value="final">Final</option>
            <option value="overall_prize">Overall prize</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="payout-asset-code">
          Asset code
          <input
            autoCapitalize="characters"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono"
            id="payout-asset-code"
            maxLength={16}
            name="assetCode"
            placeholder="ETH, DEZ or USD"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="payout-amount">
          Exact amount
          <input
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono"
            id="payout-amount"
            inputMode="decimal"
            name="amount"
            pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]+)?"
            placeholder="0.00"
            required
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="payout-allocation">
          Allocation
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            id="payout-allocation"
            name="allocationMethod"
            required
          >
            <option value="vault_unallocated">Vault-level, unallocated</option>
            <option value="single_core">Single core</option>
            <option value="equal">Equal across selected cores</option>
            <option value="manual_amounts">Manual exact amounts</option>
            <option value="manual_percentages">Manual percentages</option>
            <option value="documented_points">Documented points</option>
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm" htmlFor="payout-reference">
        External reference
        <input
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          id="payout-reference"
          name="externalReference"
        />
      </label>
      <button
        className="w-fit rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        type="submit"
      >
        Record tournament payout
      </button>
    </fieldset>
  );
}

export function VaultPerformanceEconomicForms({
  status,
}: Readonly<{ status: VaultPerformanceEconomicWriteStatus }>) {
  const copy = statusCopy[status];
  const [manualLedgerResult, manualLedgerAction, manualLedgerPending] =
    useActionState(submitManualLedgerFormAction, null);
  const manualLedgerReady = status === "manual_ledger_ready";

  return (
    <section aria-labelledby="economic-evidence-entry">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold" id="economic-evidence-entry">
            Manual economic evidence
          </h2>
          <p className="mt-2 max-w-4xl leading-7 text-[var(--muted)]">
            These forms never initiate a wallet or game transaction and never
            request a private key, seed phrase or signing credential.
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
          action={manualLedgerAction}
          aria-label="Manual ledger entry"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
        >
          <ManualLedgerFields
            disabled={!manualLedgerReady || manualLedgerPending}
          />
          {manualLedgerResult === null ? null : (
            <p
              aria-live="polite"
              className="mt-4 text-sm leading-6 text-[var(--muted)]"
              role="status"
            >
              <strong>{manualLedgerResult.title}.</strong>{" "}
              {manualLedgerResult.detail}
            </p>
          )}
        </form>
        <form
          aria-label="Manual tournament payout"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
        >
          <TournamentPayoutFields disabled />
        </form>
      </div>
    </section>
  );
}
