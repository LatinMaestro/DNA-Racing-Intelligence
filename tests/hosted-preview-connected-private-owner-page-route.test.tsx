import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({
  authenticatedOwnerId: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("@/lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: clerk.authenticatedOwnerId,
}));

import SearchCorePage from "@/app/(private)/search-core/page";
import VaultPage from "@/app/(private)/vault/page";

const connected =
  process.env.CORE_INTELLIGENCE_COMMISSIONING_VERIFICATION === "1";
const describeConnected = connected ? describe : describe.skip;
const selectedCoreId = "10457";

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

function captures(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((match) => match[1]!);
}

describeConnected("connected private owner page routes", () => {
  let ownerId: string;

  beforeEach(() => {
    ownerId = requiredEnvironment("AUTHORIZED_CLERK_USER_ID");
    expect(requiredEnvironment("DNA_DATABASE_RUNTIME_ROLE")).toBe(
      "dna_app_runtime",
    );
    clerk.authenticatedOwnerId.mockReset();
    clerk.authenticatedOwnerId.mockResolvedValue(ownerId);
  });

  it("renders real bounded Vault and Search Core evidence for owned Core 10457", async () => {
    const vaultHtml = renderToStaticMarkup(
      await VaultPage({
        searchParams: Promise.resolve({
          q: selectedCoreId,
          coreId: selectedCoreId,
        }),
      }),
    );
    const searchHtml = renderToStaticMarkup(
      await SearchCorePage({
        searchParams: Promise.resolve({
          q: selectedCoreId,
          coreId: selectedCoreId,
          mode: "bike",
        }),
      }),
    );

    for (const html of [vaultHtml, searchHtml]) {
      expect(html).toContain("Core ID 10457");
      expect(html).toContain("Salsa");
      expect(html).toContain("Bike");
      expect(html).toContain("normal");
      expect(html).toContain("Accepted analytical cell");
      expect(html).toContain("Unavailable: unsupported format");
      expect(html).toContain("Unavailable: unpublished analytical cell");
      expect(html).toMatch(/Row SHA-256 [a-f0-9]{64}/u);
    }
    expect(vaultHtml).toContain("214 current owner Cores");
    expect(searchHtml).toContain("214 owner Cores");

    const vaultHistoryCount = vaultHtml.match(
      /Showing 100 of ([1-9][0-9]*) matching rows \(first 100 shown\)\./u,
    );
    const searchHistoryCount = searchHtml.match(
      /Showing 100 of ([1-9][0-9]*) matching rows \(first 100 shown\)\./u,
    );
    expect(vaultHistoryCount).not.toBeNull();
    expect(searchHistoryCount).not.toBeNull();
    const vaultAcceptedHistoryRowCount = Number(vaultHistoryCount![1]);
    const searchAcceptedHistoryRowCount = Number(searchHistoryCount![1]);
    expect(vaultAcceptedHistoryRowCount).toBeGreaterThan(100);
    expect(vaultAcceptedHistoryRowCount).toBeLessThanOrEqual(1_000);
    expect(searchAcceptedHistoryRowCount).toBeGreaterThan(100);
    expect(searchAcceptedHistoryRowCount).toBeLessThanOrEqual(
      vaultAcceptedHistoryRowCount,
    );

    const distances = captures(
      vaultHtml,
      /Distance<\/dt><dd class="font-semibold">([0-9,]+) m<\/dd>/gu,
    ).map((value) => Number(value.replaceAll(",", "")));
    const gates = captures(
      vaultHtml,
      /Gates<\/dt><dd class="font-semibold">([0-9]+)<\/dd>/gu,
    ).map(Number);
    const formats = captures(
      vaultHtml,
      /Format<\/dt><dd class="font-semibold">([^<]+)<\/dd>/gu,
    );
    const elapsedTimes = captures(
      vaultHtml,
      /Finish \/ time<\/dt><dd class="font-semibold">[0-9]+ · ([0-9]+\.[0-9]{3} s)<\/dd>/gu,
    );
    const rowSha256 = captures(vaultHtml, /Row SHA-256 ([a-f0-9]{64})/gu);
    expect(distances).toHaveLength(100);
    expect(gates).toHaveLength(100);
    expect(formats).toHaveLength(100);
    expect(elapsedTimes).toHaveLength(100);
    expect(rowSha256).toHaveLength(100);
    expect(new Set(rowSha256).size).toBe(100);
    expect(vaultHtml).toContain("Accepted race history — Salsa (Core 10457)");
    expect(searchHtml).toContain("Salsa");
    expect(searchHtml).toContain("Accepted API race history");
    expect(clerk.authenticatedOwnerId).toHaveBeenCalledTimes(2);

    console.log(
      JSON.stringify({
        status: "connected_preview_db",
        selectedCoreId,
        ownerCoreCount: 214,
        vaultAcceptedHistoryRowCount,
        searchAcceptedHistoryRowCount,
        renderedHistoryRowCount: rowSha256.length,
        modes: ["bike"],
        distancesMetres: [...new Set(distances)].sort((a, b) => a - b),
        gates: [...new Set(gates)].sort((a, b) => a - b),
        formats: [...new Set(formats)].sort(),
        elapsedTimeSamples: elapsedTimes,
        publishedCellStatuses: [
          "accepted",
          "unsupported_format",
          "unpublished_cell",
        ],
        routes: ["/vault", "/search-core"],
        clerkBoundary: "simulated_owner_session",
        databaseRepositories: "real_environment_backed",
        persistentWritePerformed: false,
        exactCodeHeadSha: process.env.GITHUB_SHA ?? null,
      }),
    );
  }, 30_000);

  it("rejects a wrong-owner identity before either private route can render", async () => {
    clerk.authenticatedOwnerId.mockResolvedValue(`${ownerId}-wrong`);

    await expect(
      VaultPage({
        searchParams: Promise.resolve({
          q: selectedCoreId,
          coreId: selectedCoreId,
        }),
      }),
    ).rejects.toThrow("Vault catalogue access denied.");
    await expect(
      SearchCorePage({
        searchParams: Promise.resolve({
          q: selectedCoreId,
          coreId: selectedCoreId,
          mode: "bike",
        }),
      }),
    ).rejects.toThrow("Search Core access denied.");
  });
});
