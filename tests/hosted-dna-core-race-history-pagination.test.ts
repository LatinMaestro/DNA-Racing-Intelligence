import { createHash } from "node:crypto";

import { describe, it } from "vitest";

import { createDnaCoreRaceHistoryClient } from "../lib/dna-core-race-history-client";
import {
  createDnaOpenLabRequestBudget,
  DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
} from "../lib/dna-open-lab-request-budget";
import { createDnaOpenLabV1Client } from "../lib/dna-open-lab-v1-client";

const enabled = process.env.DNA_CORE_RACE_HISTORY_PAGINATION_PROBE === "1";
const describeConnected = enabled ? describe : describe.skip;
const API_KEY_PATTERN = /^dna_[A-Za-z0-9_-]{43}$/u;
const OBSERVED_PROVIDER_PAGE_SIZE = 50;

type HistoryPage = Awaited<
  ReturnType<ReturnType<typeof createDnaCoreRaceHistoryClient>["page"]>
>["result"];

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.trim() !== value ||
    value.length > 4_096
  ) {
    throw new Error(`${name} is missing, padded, or unexpectedly large`);
  }
  return value;
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function privatePageChecksum(page: HistoryPage): string {
  return createHash("sha256").update(JSON.stringify(page)).digest("hex");
}

describeConnected("hosted DNA Core race history pagination", () => {
  it(
    "proves replay-stable pages and an explicit empty terminal page without logging private values",
    async () => {
      const apiKeys = [
        requiredEnvironment("DNA_OPEN_LAB_API_KEY_1"),
        requiredEnvironment("DNA_OPEN_LAB_API_KEY_2"),
        requiredEnvironment("DNA_OPEN_LAB_API_KEY_3"),
      ] as const;
      invariant(
        apiKeys.every((apiKey) => API_KEY_PATTERN.test(apiKey)),
        "DNA Core history pagination probe key shape is invalid",
      );
      invariant(
        new Set(apiKeys).size === apiKeys.length,
        "DNA Core history pagination probe requires three distinct keys",
      );
      const vault = requiredEnvironment("DNA_OPEN_LAB_VAULT");
      const budget = createDnaOpenLabRequestBudget({
        initialRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        maximumRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      });
      const vaultClient = createDnaOpenLabV1Client({ apiKey: apiKeys[0] });
      const historyClient = createDnaCoreRaceHistoryClient();
      const ownedResponse = await budget.execute(() =>
        vaultClient.vaultCores(vault),
      );
      const ownedCoreIds = [...new Set(ownedResponse.result)]
        .filter((value) => Number.isSafeInteger(value) && value > 0)
        .sort((left, right) => left - right);
      invariant(
        ownedCoreIds.length > 0,
        "DNA Core history pagination probe found no owned Cores",
      );

      let fullSample:
        Readonly<{ coreId: number; page: HistoryPage }> | undefined;
      let shortSample:
        Readonly<{ coreId: number; page: HistoryPage }> | undefined;
      let probedCoreCount = 0;
      for (const coreId of ownedCoreIds) {
        const page = (
          await budget.execute(() => historyClient.page({ coreId, page: 1 }))
        ).result;
        probedCoreCount += 1;
        invariant(
          page.length <= OBSERVED_PROVIDER_PAGE_SIZE,
          "DNA Core history pagination exceeded the observed page-size boundary",
        );
        if (page.length === OBSERVED_PROVIDER_PAGE_SIZE && !fullSample) {
          fullSample = Object.freeze({ coreId, page });
        }
        if (page.length > 0 && page.length < OBSERVED_PROVIDER_PAGE_SIZE) {
          shortSample = Object.freeze({ coreId, page });
        }
        if (fullSample && shortSample) break;
      }
      invariant(
        fullSample !== undefined,
        "DNA Core history pagination probe found no full page",
      );
      invariant(
        shortSample !== undefined,
        "DNA Core history pagination probe found no short terminal candidate",
      );

      const fullPageReplay = (
        await budget.execute(() =>
          historyClient.page({ coreId: fullSample.coreId, page: 1 }),
        )
      ).result;
      invariant(
        privatePageChecksum(fullSample.page) ===
          privatePageChecksum(fullPageReplay),
        "DNA Core history full-page replay changed during the bounded probe",
      );
      const afterShort = (
        await budget.execute(() =>
          historyClient.page({ coreId: shortSample.coreId, page: 2 }),
        )
      ).result;
      invariant(
        afterShort.length === 0,
        "DNA Core history short page was not followed by an empty page",
      );
      const emptyReplay = (
        await budget.execute(() =>
          historyClient.page({ coreId: shortSample.coreId, page: 2 }),
        )
      ).result;
      invariant(
        privatePageChecksum(afterShort) === privatePageChecksum(emptyReplay),
        "DNA Core history empty terminal page was not replay-stable",
      );
      const afterEmpty = (
        await budget.execute(() =>
          historyClient.page({ coreId: shortSample.coreId, page: 3 }),
        )
      ).result;
      invariant(
        afterEmpty.length === 0,
        "DNA Core history returned rows after an empty terminal page",
      );

      const report = Object.freeze({
        version: 1,
        policy: Object.freeze({
          readOnly: true,
          persisted: false,
          aggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
        }),
        coverage: Object.freeze({
          ownedCoreCount: ownedCoreIds.length,
          probedCoreCount,
          observedFullPageSize: OBSERVED_PROVIDER_PAGE_SIZE,
          observedShortPage: true,
          fullPageReplayStable: true,
          shortPageFollowedByEmptyPage: true,
          emptyPageReplayStable: true,
          laterPageRemainedEmpty: true,
        }),
      });
      const serialized = JSON.stringify(report);
      for (const apiKey of apiKeys)
        invariant(!serialized.includes(apiKey), "Redaction failed");
      invariant(!serialized.includes(vault), "Redaction failed");
      console.log(`DNA_CORE_RACE_HISTORY_PAGINATION=${serialized}`);
    },
    14 * 60 * 1_000,
  );
});
