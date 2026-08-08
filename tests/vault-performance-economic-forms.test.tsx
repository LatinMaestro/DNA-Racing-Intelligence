import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VaultPerformanceEconomicForms } from "../components/vault-performance-economic-forms";

describe("Vault Performance economic forms", () => {
  it("renders semantic ledger and tournament forms without wallet inputs", () => {
    const html = renderToStaticMarkup(
      <VaultPerformanceEconomicForms status="persistence_not_configured" />,
    );

    expect(html).toContain('aria-label="Manual ledger entry"');
    expect(html).toContain('aria-label="Manual tournament payout"');
    expect(html).toContain("Exact amount");
    expect(html).toContain("BGC game credit");
    expect(html).toContain("never initiate a wallet or game transaction");
    expect(html).not.toMatch(
      /name="(?:privateKey|seedPhrase|signingCredential)"/i,
    );
  });

  it("keeps every field and submit button disabled before persistence exists", () => {
    const html = renderToStaticMarkup(
      <VaultPerformanceEconomicForms status="persistence_not_configured" />,
    );

    expect(html).toContain("Economic writes not connected");
    expect(html.match(/<fieldset[^>]*disabled/g)).toHaveLength(2);
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(2);
  });

  it("distinguishes the signed-out capability state", () => {
    const identityHtml = renderToStaticMarkup(
      <VaultPerformanceEconomicForms status="identity_not_connected" />,
    );

    expect(identityHtml).toContain("Owner verification required");
    expect(identityHtml).toContain("<fieldset");
    expect(identityHtml).toContain("disabled");
  });
});
