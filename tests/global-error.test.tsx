import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import GlobalError from "@/app/global-error";

describe("global application error recovery", () => {
  it("keeps root failures private and offers accessible recovery", () => {
    const error = Object.assign(new Error("SYNTHETIC_GLOBAL_ERROR_MESSAGE"), {
      digest: "SYNTHETIC_GLOBAL_DIGEST",
    });
    const markup = renderToStaticMarkup(
      <GlobalError error={error} reset={() => {}} />,
    );

    expect(markup).toContain('<html lang="en-AU">');
    expect(markup).toContain("<body>");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-labelledby="global-error-title"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("Unable to open DNA Racing Intelligence");
    expect(markup).toContain("Data freshness and coverage are unverified");
    expect(markup).toContain("Check its recorded status");
    expect(markup).toContain("before repeating that operation");
    expect(markup).toContain('type="button"');
    expect(markup).toContain("Retry application");
    expect(markup).toContain('href="/"');
    expect(markup).toContain("Return to dashboard");
    expect(markup).not.toContain(error.message);
    expect(markup).not.toContain(error.digest);
    expect(markup).not.toContain("Error:");
  });
});
