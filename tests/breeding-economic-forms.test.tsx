import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BreedingEconomicForms } from "../components/breeding-economic-forms";

describe("breeding economic forms", () => {
  it("renders separate semantic evidence and cost-basis forms", () => {
    const html = renderToStaticMarkup(
      <BreedingEconomicForms status="persistence_not_configured" />,
    );

    expect(html).toContain(
      'aria-label="Completed or refunded breeding evidence"',
    );
    expect(html).toContain('aria-label="Offspring cost-basis review"');
    expect(html).toContain("Arena listing");
    expect(html).toContain("Original assets remain separate");
    expect(html).not.toMatch(
      /name="(?:privateKey|seedPhrase|signingCredential)"/i,
    );
  });

  it("keeps every field and submit button disabled", () => {
    const html = renderToStaticMarkup(
      <BreedingEconomicForms status="persistence_not_configured" />,
    );

    expect(html).toContain("Breeding writes not connected");
    expect(html.match(/<fieldset[^>]*disabled/g)).toHaveLength(2);
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(2);
  });

  it("distinguishes the signed-out capability state", () => {
    const html = renderToStaticMarkup(
      <BreedingEconomicForms status="identity_not_connected" />,
    );

    expect(html).toContain("Owner verification required");
    expect(html).toContain("disabled");
  });
});
