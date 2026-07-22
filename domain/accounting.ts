export type LedgerTransaction = {
  id: string;
  assetCode: string;
  amountMinor: bigint;
  category:
    | "income"
    | "expense"
    | "deposit"
    | "withdrawal"
    | "transfer"
    | "opening_balance"
    | "adjustment";
  operating: boolean;
};

export function operatingCashflowByAsset(
  transactions: readonly LedgerTransaction[],
): Map<string, bigint> {
  const totals = new Map<string, bigint>();

  for (const transaction of transactions) {
    if (!transaction.operating) continue;
    if (
      ["deposit", "withdrawal", "transfer", "opening_balance"].includes(
        transaction.category,
      )
    )
      continue;
    totals.set(
      transaction.assetCode,
      (totals.get(transaction.assetCode) ?? 0n) + transaction.amountMinor,
    );
  }

  return totals;
}
