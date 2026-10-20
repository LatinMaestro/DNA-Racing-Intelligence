import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TournamentConfigurationForm } from "@/components/tournament-configuration-form";
import { TournamentWorkspace } from "@/components/tournament-workspace";
import { neonTournamentConfigurationRepositoryFromEnvironment } from "@/lib/neon-tournament-configuration-repository";
import { loadTournamentWorkspacePageState } from "@/lib/tournament-workspace-service";

const connected =
  process.env.TOURNAMENT_WORKSPACE_COMMISSIONING_VERIFICATION === "1";
const describeConnected = connected ? describe : describe.skip;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.trim() !== value ||
    value.length > 4_096 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

describeConnected("hosted Preview Tournament workspace commissioning", () => {
  it(
    "reads the owner Tournament snapshot and renders its honest configuration state without writes",
    async () => {
      const ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
      const verifiedAt = requiredEnvironment(
        "TOURNAMENT_WORKSPACE_COMMISSIONING_VERIFIED_AT",
      );
      const now = new Date(verifiedAt);
      if (
        Number.isNaN(now.getTime()) ||
        now.toISOString() !== verifiedAt ||
        now.getTime() > Date.now()
      ) {
        throw new Error("Tournament workspace verification time is invalid");
      }

      const repository = neonTournamentConfigurationRepositoryFromEnvironment({
        databaseUrl: requiredEnvironment("DATABASE_URL"),
        databaseOwnerId: requiredEnvironment("DNA_DATABASE_OWNER_ID"),
        runtimeRole: "dna_app_runtime",
      });
      expect(repository.status).toBe("ready");

      const state = await loadTournamentWorkspacePageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository,
        now,
      });
      expect(state.connectionStatus).toBe("read_model_connected");

      await expect(
        loadTournamentWorkspacePageState({
          authenticatedOwnerId: `${ownerId}-wrong-owner`,
          configuredOwnerId: ownerId,
          repository,
          now,
        }),
      ).rejects.toThrow("Tournament workspace access denied.");

      const workspaceMarkup = renderToStaticMarkup(
        createElement(TournamentWorkspace, state),
      );
      const saveAction = vi.fn(async () => undefined);
      const editorMarkup = renderToStaticMarkup(
        createElement(TournamentConfigurationForm, {
          brackets: state.brackets,
          connectionStatus: state.connectionStatus,
          saveAction,
        }),
      );
      expect(workspaceMarkup).toContain(
        "Historical tournament evidence connected",
      );
      expect(workspaceMarkup).toContain("Tournament entry unavailable");
      expect(workspaceMarkup).toContain(
        "Calibrated tournament optimiser not commissioned",
      );
      expect(editorMarkup).toContain("New bike split");
      expect(editorMarkup).toContain("New car split");
      expect(editorMarkup).toContain("New horse split");
      expect(saveAction).not.toHaveBeenCalled();

      if (state.brackets.length === 0) {
        expect(workspaceMarkup).toContain("No accepted tournament evidence");
      } else {
        for (const bracket of state.brackets) {
          expect(workspaceMarkup).toContain(bracket.tournamentLabel);
          expect(workspaceMarkup).toContain(bracket.splitLabel);
          expect(bracket.ruleConfiguration).toBeDefined();
          expect(bracket.leaderboardGroups).toBeDefined();
        }
      }

      const modeCounts = state.brackets.reduce<Record<string, number>>(
        (counts, bracket) => ({
          ...counts,
          [bracket.mode]: (counts[bracket.mode] ?? 0) + 1,
        }),
        { bike: 0, car: 0, horse: 0 },
      );
      const candidateCount = state.brackets.reduce(
        (total, bracket) =>
          total +
          bracket.leaderboardGroups.reduce(
            (groupTotal, group) => groupTotal + group.candidates.length,
            0,
          ),
        0,
      );

      console.log(
        JSON.stringify({
          status: state.connectionStatus,
          savedSplitCount: state.brackets.length,
          modeCounts,
          candidateCount,
          lastImportedAt: state.lastImportedAt,
          ownerMismatchRejected: true,
          renderedWorkspace: true,
          renderedConfigurationEditor: true,
          automaticTournamentEntryAllowed: false,
          persistentWritePerformed: false,
          exactCodeHeadSha: requiredEnvironment("GITHUB_SHA").toLowerCase(),
          verifiedAt,
        }),
      );
    },
    10 * 60_000,
  );
});
