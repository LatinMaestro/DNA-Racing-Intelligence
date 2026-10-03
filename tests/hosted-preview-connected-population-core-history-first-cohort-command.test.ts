import { describe, expect, it } from "vitest";

import {
  DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_INTENT,
  DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_VERSION,
  verifyDnaPopulationCoreHistoryFirstCohort,
} from "@/lib/dna-population-core-history-first-cohort-command";
import { dnaPopulationCoreHistoryFirstCohortCommandFromEnvironment } from "@/lib/dna-population-core-history-first-cohort-environment";
import { createNeonDnaCoreRaceHistoryAcquisitionRepository } from "@/lib/neon-dna-core-race-history-acquisition";
import { loadHostedPreviewPopulationCoreHistoryReadiness } from "@/tests/hosted-preview-connected-population-core-history-readiness.test";

const connected =
  process.env.DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND === "1";
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
    throw new Error("required private configuration is unavailable");
  }
  return value;
}

describeConnected(
  "hosted Preview population Core-history first-cohort command",
  () => {
    it(
      "collects and independently verifies exactly one deterministic population Core without publication",
      async () => {
        const evaluatedAt = requiredEnvironment(
          "DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_OBSERVED_AT",
        );
        const observed = new Date(evaluatedAt);
        if (
          Number.isNaN(observed.getTime()) ||
          observed.toISOString() !== evaluatedAt ||
          observed.getTime() > Date.now()
        ) {
          throw new Error("first-cohort observation time is invalid");
        }

        const context = await loadHostedPreviewPopulationCoreHistoryReadiness();
        const expectedMain = requiredEnvironment(
          "DNA_POPULATION_CORE_HISTORY_EXPECTED_MAIN_SHA",
        ).toLowerCase();
        if (
          expectedMain !== context.authority.exactCodeHeadSha ||
          expectedMain !== requiredEnvironment("GITHUB_SHA").toLowerCase()
        ) {
          throw new Error("first-cohort exact-main authority drifted");
        }

        const adapter =
          dnaPopulationCoreHistoryFirstCohortCommandFromEnvironment(
            context.environment,
            context.authority,
          );
        if (adapter.status !== "ready") {
          throw new Error("first-cohort connected command is unavailable");
        }
        const commandReceipt = await adapter.command.execute({
          commandVersion:
            DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_VERSION,
          intent: DNA_POPULATION_CORE_HISTORY_FIRST_COHORT_COMMAND_INTENT,
          allowPersistentWrite: true,
          exactCodeHeadSha: context.authority.exactCodeHeadSha,
          evaluatedAt,
          maximumSteps: 101,
          populationCoreSetSha256: context.authority.populationCoreSetSha256,
          persistedPerformanceCoreSetSha256:
            context.authority.persistedPerformanceCoreSetSha256,
          acquisitionCoreSetSha256: context.authority.acquisitionCoreSetSha256,
          selectedCoreSetSha256: context.authority.selectedCoreSetSha256,
          measurementSliceSha256: context.authority.measurementSliceSha256,
        });
        expect(commandReceipt).toMatchObject({
          status: "complete",
          terminalKind: "collection:collection_complete",
          collectionOnly: true,
          publicationPerformed: false,
          providerWritePerformed: false,
          paidUsageAllowed: false,
          preserveLastGood: true,
          previewOnly: true,
        });

        const repository = createNeonDnaCoreRaceHistoryAcquisitionRepository({
          databaseUrl: context.environment.databaseUrl,
          databaseOwnerId: context.environment.databaseOwnerId,
          ownerId: context.environment.ownerId,
          runtimeRole: context.environment.runtimeRole,
        });
        const verification = await verifyDnaPopulationCoreHistoryFirstCohort({
          authority: context.authority,
          commandReceipt,
          repository,
        });
        expect(verification).toMatchObject({
          status: "pass",
          exactCodeHeadSha: expectedMain,
          persistedCoreCountBefore:
            context.authority.persistedPerformanceCoreCount,
          persistedCoreCountAfter:
            context.authority.persistedPerformanceCoreCount + 1,
          selectedCoreSetSha256: context.authority.selectedCoreSetSha256,
          measurementSliceSha256: context.authority.measurementSliceSha256,
          collectionComplete: true,
          publicationPerformed: false,
          paidUsageAllowed: false,
          preserveLastGood: true,
          previewOnly: true,
        });

        const report = Object.freeze({
          version: 1,
          command: commandReceipt,
          verification,
        });
        const serialized = JSON.stringify(report);
        for (const secret of Object.values(context.environment)) {
          expect(serialized).not.toContain(secret);
        }
        console.log("DNA_POPULATION_CORE_HISTORY_FIRST_COHORT=" + serialized);
      },
      50 * 60_000,
    );
  },
);
