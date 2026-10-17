import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LifecycleEconomicForms } from "../components/lifecycle-economic-forms";

describe("lifecycle economic forms", () => {
  it("renders separate semantic sale, burn and actual-credit forms", () => {
    const html = renderToStaticMarkup(
      <LifecycleEconomicForms status="persistence_not_configured" />,
    );
    expect(html).toContain('aria-label="Completed core sale evidence"');
    expect(html).toContain('aria-label="Completed core burn evidence"');
    expect(html).toContain('aria-label="Actual post-burn BGC credit"');
    expect(html).toContain('aria-describedby="sale-evidence-help"');
    expect(html).toContain('aria-describedby="burn-evidence-help"');
    expect(html).toContain('aria-describedby="burn-credit-help"');
    expect(html).toContain("realised gain remains unavailable");
    expect(html).toContain("Genesis cores");
    expect(html).toContain("zero race economics");
  });

  it("keeps all fields and submit buttons disabled without credential inputs", () => {
    const html = renderToStaticMarkup(
      <LifecycleEconomicForms status="persistence_not_configured" />,
    );
    expect(html).toContain("Lifecycle writes not connected");
    expect(html.match(/<fieldset[^>]*disabled/g)).toHaveLength(3);
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(3);
    expect(html).not.toMatch(
      /name="(?:privateKey|seedPhrase|signingCredential)"/i,
    );
  });

  it("omits Genesis from burn choices and distinguishes signed-out state", () => {
    const html = renderToStaticMarkup(
      <LifecycleEconomicForms status="identity_not_connected" />,
    );
    expect(html).toContain("Owner verification required");
    expect(html).not.toContain('value="Genesis"');
    expect(html).toContain("disabled");
  });

  it("enables the three evidence forms only at the ready boundary", () => {
    const html = renderToStaticMarkup(
      <LifecycleEconomicForms status="ready" />,
    );
    expect(html).toContain("Lifecycle evidence ready");
    expect(html.match(/<fieldset/g)).toHaveLength(3);
    expect(html).not.toMatch(/<fieldset[^>]*disabled/);
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
    expect(html.match(/<form[^>]*action=/g)).toHaveLength(3);
    expect(html).toContain("2026-10-17T13:30:00+10:00");
  });
});
