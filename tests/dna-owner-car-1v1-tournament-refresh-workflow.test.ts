import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/dna-owner-car-1v1-tournament-refresh.yml";
const connectedPath =
  "tests/hosted-owner-car-1v1-tournament-refresh.test.ts";

describe("owner Car 1v1 tournament refresh workflow", () => {
  it("is exact-main, Preview-only, read-only and does not expose raw race evidence", async () => {
    const [workflow, connected] = await Promise.all([
      readFile(workflowPath, "utf8"),
      readFile(connectedPath, "utf8"),
    ]);

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("expected_main_sha:");
    expect(workflow).toContain("execute_read_only_tournament_refresh:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain(
      "group: dna-population-core-outcome-gap-acquisition-bootstrap",
    );
    expect(workflow).toContain("DNA_OPEN_LAB_API_KEY_1");
    expect(workflow).toContain("DNA_OPEN_LAB_VAULT");
    expect(workflow).toContain(connectedPath);
    expect(workflow).toContain("retention-days: 1");
    expect(workflow).not.toContain("DATABASE_URL");
    expect(workflow).not.toContain("NEON_API_KEY");
    expect(workflow).not.toContain("DNA_R2_ACCESS_KEY_ID");
    expect(workflow).not.toContain("actions: write");

    expect(connected).toContain('const CUTOFF_EXCLUSIVE = "2026-05-23T18:12:51.787Z"');
    expect(connected).toContain("MAXIMUM_LEGACY_REQUESTS = 700");
    expect(connected).toContain("MINIMUM_REQUEST_INTERVAL_MS = 2_050");
    expect(connected).toContain("aggregateRequestsPerMinuteCeiling: 30");
    expect(connected).toContain("persistentProviderWrite: false");
    expect(connected).toContain("rawRaceIdentitiesIncluded: false");
    expect(connected).toContain("rawProviderPayloadsIncluded: false");
    expect(connected).not.toContain("console.log(pageRows");
    expect(connected).not.toContain("console.log(row");
  });
});
