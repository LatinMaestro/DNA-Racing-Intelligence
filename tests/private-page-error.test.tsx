import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivatePageError from "@/app/(private)/error";

describe("private page error recovery", () => {
  it("offers accessible navigation and retry without assuming a save failed", () => {
    const error = Object.assign(new Error("SYNTHETIC_PRIVATE_ERROR_MESSAGE"), {
      digest: "SYNTHETIC_PRIVATE_DIGEST",
    });
    const markup = renderToStaticMarkup(
      <PrivatePageError error={error} reset={() => {}} />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-labelledby="private-page-error-title"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("Unable to display this private page");
    expect(markup).toContain("data freshness and coverage are");
    expect(markup).toContain("unverified");
    expect(markup).toContain("Check its recorded status");
    expect(markup).toContain("before repeating that operation");
    expect(markup).toContain('type="button"');
    expect(markup).toContain("Retry page");
    expect(markup).toContain('href="/"');
    expect(markup).toContain("Return to dashboard");
    expect(markup).not.toContain(error.message);
    expect(markup).not.toContain(error.digest);
    expect(markup).not.toContain("Error:");
  });
});
