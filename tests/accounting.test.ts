import { describe, expect, it } from "vitest";
import {
  operatingCashflowByAsset,
  type LedgerTransaction,
} from "@/domain/accounting";

const transactions: LedgerTransaction[] = [
  {
    id: "synthetic-dez-income",
    assetCode: "DEZ",
    amountMinor: 250n,
    category: "income",
    operating: true,
  },
  {
    id: "synthetic-dez-fee",
    assetCode: "DEZ",
    amountMinor: -100n,
    category: "expense",
    operating: true,
  },
  {
    id: "synthetic-bgc-credit",
    assetCode: "BGC",
    amountMinor: 500n,
    category: "income",
    operating: true,
  },
  {
    id: "synthetic-transfer",
    assetCode: "DEZ",
    amountMinor: 10_000n,
    category: "transfer",
    operating: false,
  },
];

describe("economic ledger invariants", () => {
  it("uses exact integer values and never combines assets", () => {
    const totals = operatingCashflowByAsset(transactions);
    expect(totals.get("DEZ")).toBe(150n);
    expect(totals.get("BGC")).toBe(500n);
  });

  it("excludes transfers from operating P/L", () => {
    expect(operatingCashflowByAsset(transactions).get("DEZ")).not.toBe(10_150n);
  });
});
