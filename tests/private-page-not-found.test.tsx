import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivateNotFound from "@/app/(private)/not-found";

describe("private page not-found state", () => {
  it("offers accessible recovery without disclosing the requested path", () => {
    const privatePath = "/private/synthetic-core-id";
    const markup = renderToStaticMarkup(<PrivateNotFound />);

    expect(markup).toContain('aria-labelledby="private-not-found-title"');
    expect(markup).toContain("Private page not found");
    expect(markup).toContain("No private data is shown here.");
    expect(markup).toContain("does not confirm whether");
    expect(markup).toContain("Check its recorded status");
    expect(markup).toContain("before repeating that operation");
    expect(markup).toContain('href="/"');
    expect(markup).toContain("Return to dashboard");
    expect(markup).not.toContain(privatePath);
    expect(markup).not.toContain("live data");
    expect(markup).not.toContain("up to date");
  });
});
