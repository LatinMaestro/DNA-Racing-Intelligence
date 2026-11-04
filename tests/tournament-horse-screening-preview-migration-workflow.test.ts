import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath =
  ".github/workflows/tournament-horse-screening-preview-migration.yml";

describe("Tournament Horse screening Preview migration workflow", () => {
  it(
    "is exact-main, Preview-only, reversible and does not publish Horse data",
    async () => {
      const workflow = await readFile(workflowPath, "utf8");

      expect(workflow).toContain("workflow_dispatch:");
      expect(workflow).toContain("exact_main_sha:");
      expect(workflow).toContain("apply_private_preview_migration:");
      expect(workflow).toContain('[[ "$EXPECTED_MAIN_SHA" == "$GITHUB_SHA" ]]');
      expect(workflow).toContain("environment: preview");
      expect(workflow).toContain("fancy-bar-26534950");
      expect(workflow).toContain("br-floral-haze-a7bvs9lu");
      expect(workflow).toContain("ep-misty-paper-a796pgn0");
      expect(workflow).toContain("database !== \"neondb\"");
      expect(workflow).toContain(
        "0143_tournament_horse_screening_snapshot.up.sql",
      );
      expect(workflow).toContain(
        "0143_tournament_horse_screening_snapshot.smoke.sql",
      );
      expect(workflow).toContain(
        "0143_tournament_horse_screening_snapshot.down.sql",
      );
      expect(workflow).toContain(
        "0143_tournament_horse_screening_snapshot.removal.sql",
      );
      expect(workflow).toContain(
        "dna.tournament_horse_screening_snapshot_active",
      );
      expect(workflow).toContain(
        "dna.read_active_tournament_horse_screening_snapshot(uuid)",
      );
      expect(workflow).toContain(
        "dna.publish_tournament_horse_screening_snapshot(uuid,text,text,text,timestamptz)",
      );
      expect(workflow).toContain("DNA_MIGRATION_DATABASE_URL=");
      expect(workflow).not.toMatch(/production/iu);
      expect(workflow).not.toContain(
        "tournament-horse-screening-private-publication.yml",
      );
    },
  );
});
