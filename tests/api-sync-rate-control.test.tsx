import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiSyncRateControl } from "@/components/api-sync-rate-control";
import { createDnaOpenLabSyncRatePolicy } from "@/domain/dna-open-lab-sync-rate-policy";

describe("API Sync rate control", () => {
  it("shows owner rate choices, expiry and the automatic fallback", () => {
    const elevated = createDnaOpenLabSyncRatePolicy({
      requestedRequestsPerMinute: 150,
      elevatedUntil: "2026-09-08T10:00:00Z",
      now: "2026-09-07T10:00:00Z",
    });
    const html = renderToStaticMarkup(
      <ApiSyncRateControl
        state={{
          connectionStatus: "connected",
          expectedVersion: 1,
          policy: {
            ...elevated,
            effectiveRequestsPerMinute: 30,
            fallbackReason: "provider_limit_reduced",
            lastProviderLimit: 30,
          },
        }}
      />,
    );
    expect(html).toContain("API Sync");
    expect(html).toContain("150 rpm");
    expect(html).toContain("30 rpm effective");
    expect(html).toContain("Automatic fallback active");
    expect(html).toContain("Save rate policy");
    expect(html).toContain('min="30"');
    expect(html).toContain('max="150"');
    expect(html).not.toContain("Bearer");
  });
});
