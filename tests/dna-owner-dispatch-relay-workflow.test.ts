import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/dna-owner-dispatch-relay.yml";

describe("DNA owner dispatch relay workflow", () => {
  it("is owner-only, Issue #120-only and restricts dispatch to the accepted first-cohort boundary", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("issue_comment:");
    expect(workflow).toContain("github.event.issue.number == 120");
    expect(workflow).toContain("github.actor == github.repository_owner");
    expect(workflow).toContain(
      "github.event.comment.author_association == 'OWNER'",
    );
    expect(workflow).toContain(
      "startsWith(github.event.comment.body, '/dna-dispatch ')",
    );
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain(
      "dna-population-entrant-authority-readiness.yml",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-cohort-command.yml",
    );
    expect(workflow).toContain(
      "dna-population-entrant-authority-first-cohort-verification.yml",
    );
    expect(workflow).toContain(
      "payload.execute_first_private_preview_entrant_cohort !== true",
    );
    expect(workflow).toContain("main?.sha !== payload.expected_main_sha");
    expect(workflow).not.toContain(
      "dna-population-entrant-authority-continuation-command.yml",
    );
    expect(workflow).not.toContain(
      "dna-population-entrant-authority-continuation-readiness.yml",
    );
    expect(workflow).not.toMatch(/VERCEL|production/iu);
    expect(workflow).not.toContain("secrets.");
  });
});
