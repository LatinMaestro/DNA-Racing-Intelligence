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

  it("omits Genesis from the burn-class choices and distinguishes signed-out state", () => {
    const html = renderToStaticMarkup(
      <LifecycleEconomicForms status="identity_not_connected" />,
    );

    expect(html).toContain("Owner verification required");
    expect(html).not.toContain('value="Genesis"');
    expect(html).toContain("disabled");
  });
});
