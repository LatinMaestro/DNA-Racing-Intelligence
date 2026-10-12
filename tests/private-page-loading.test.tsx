import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivatePageLoading from "@/app/(private)/loading";

describe("private page loading status", () => {
  it("announces pending content without claiming freshness or coverage", () => {
    const markup = renderToStaticMarkup(<PrivatePageLoading />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-labelledby="private-page-loading-title"');
    expect(markup).toContain("Loading private page");
    expect(markup).toContain("latest available private snapshot");
    expect(markup).toContain(
      "Data freshness and coverage will be shown when the page is ready.",
    );
    expect(markup).not.toContain("live data");
    expect(markup).not.toContain("up to date");
  });
});
