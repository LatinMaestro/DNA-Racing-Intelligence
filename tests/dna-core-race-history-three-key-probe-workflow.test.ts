import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-core-race-history-three-key-probe.yml";
const connectedPath =
  "tests/hosted-dna-core-race-history-three-key-probe.test.ts";

describe("legacy Core-history read-only three-key workflow", () => {
  it("keeps probe explicit, serialized with acquisition, private and non-writing", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const connected = readFileSync(connectedPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("refs/heads/main");
    expect(workflow).toContain("git rev-parse origin/main");
    expect(workflow).toContain(
      "group: dna-population-core-outcome-gap-acquisition-bootstrap",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("environment: preview");
    for (const key of [
      "DNA_OPEN_LAB_API_KEY_1",
      "DNA_OPEN_LAB_API_KEY_2",
      "DNA_OPEN_LAB_API_KEY_3",
      "DNA_OPEN_LAB_VAULT",
    ]) {
      expect(workflow).toContain(key);
    }
    expect(workflow).toContain(connectedPath);
    expect(workflow).not.toContain("DATABASE_URL");
    expect(workflow).not.toContain("DNA_R2_ACCESS_KEY_ID");
    expect(workflow).not.toContain("NEON_API_KEY");
    expect(workflow).not.toContain("actions: write");

    expect(connected).toContain("/fbike/i/hraces");
    expect(connected).toContain("/fbike/pub/v1/llm.txt");
    expect(connected).toContain("AbortSignal.timeout");
    expect(connected).toContain("approvedAggregateRequestsPerMinute: 30");
    expect(connected).toContain("rateIncreaseEnabled: false");
    expect(connected).toContain("persistentWritePerformed: false");
    expect(connected).toContain("paidUsageAllowed: false");
    expect(connected).toContain('"anonymous"');
    expect(connected).toContain('"key-1"');
    expect(connected).toContain('"key-2"');
    expect(connected).toContain('"key-3"');
    expect(connected).not.toContain("console.log(payload");
  });
});
