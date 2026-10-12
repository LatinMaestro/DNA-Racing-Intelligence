import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";

vi.mock("@/components/primary-navigation", () => ({
  PrimaryNavigation: () => <nav aria-label="Primary" />,
}));

describe("private app shell responsive containment", () => {
  it("constrains wide evidence tables to the content column while retaining inner scrolling", () => {
    const html = renderToStaticMarkup(
      <AppShell>
        <section aria-label="Synthetic Pro League roster">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  {[
                    "Core",
                    "Element",
                    "1000 m",
                    "1200 m",
                    "1400 m",
                    "1600 m",
                    "1800 m",
                    "2000 m",
                    "2200 m",
                  ].map((heading) => (
                    <th key={heading}>{heading}</th>
                  ))}
                </tr>
              </thead>
            </table>
          </div>
        </section>
      </AppShell>,
    );

    expect(html).toContain(
      'class="mx-auto grid min-h-screen max-w-[1600px] grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)]"',
    );
    expect(html).toContain('<aside class="min-w-0 ');
    expect(html).toContain(
      '<main class="min-w-0 p-5 sm:p-8 lg:p-12" id="main-content">',
    );
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('class="overflow-x-auto"');
    expect(html).toContain('class="min-w-full"');
    expect(html).toContain("2200 m");
  });
});
