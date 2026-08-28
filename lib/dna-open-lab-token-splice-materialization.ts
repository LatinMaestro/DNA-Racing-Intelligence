import {
  inspectDnaCurrentStateCandidate,
  type DnaCurrentStateCandidate,
} from "./dna-open-lab-last-good-publication";
import type {
  CanonicalSpliceArenaListing,
  CanonicalSpliceArenaPageSnapshot,
  CanonicalTokenPricesSnapshot,
  DnaOpenLabEvidence,
} from "./dna-open-lab-v1-adapters";
import type { DnaRaceMode } from "./dna-open-lab-v1-client";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MODE_ORDER: Readonly<Record<DnaRaceMode, number>> = Object.freeze({
  bike: 0,
  car: 1,
  horse: 2,
});

export type DnaTokenPricesMaterializationRow = Readonly<{
  observedAt: string;
  rawEvidenceSha256: string;
  canonical: CanonicalTokenPricesSnapshot;
}>;

export type DnaSpliceArenaPageMaterializationRow = Readonly<{
  mode: DnaRaceMode;
  page: number;
  observedAt: string;
  rawEvidenceSha256: string;
  canonical: CanonicalSpliceArenaPageSnapshot;
}>;

export type DnaSpliceArenaListingMaterializationRow = Readonly<{
  mode: DnaRaceMode;
  sourceCoreId: string;
  page: number;
  pageObservedAt: string;
  pageRawEvidenceSha256: string;
  canonical: CanonicalSpliceArenaListing;
}>;

export type DnaTokenSpliceMaterialization = Readonly<{
  generationId: string;
  generationObservedAt: string;
  tokenPrices: DnaTokenPricesMaterializationRow;
  arenaModes: readonly DnaRaceMode[];
  arenaPages: readonly DnaSpliceArenaPageMaterializationRow[];
  arenaListings: readonly DnaSpliceArenaListingMaterializationRow[];
}>;

function materializationError(message: string): never {
  throw new Error(`DNA Open Lab Token/Splice materialization: ${message}`);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 512) {
    materializationError(`${field} is invalid`);
  }
  return normalized;
}

function timestamp(value: string, field: string): string {
  const normalized = requiredText(value, field);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    )
  ) {
    materializationError(`${field} must be timezone-qualified`);
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    materializationError(`${field} is invalid`);
  }
  return parsed.toISOString();
}

function checksum(value: string, field: string): string {
  if (!SHA256_PATTERN.test(value)) {
    materializationError(`${field} must be a lowercase SHA-256 value`);
  }
  return value;
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    materializationError(`${field} must be a positive safe integer`);
  }
  return value;
}

function positiveSafeIntegerText(value: string, field: string): string {
  const normalized = requiredText(value, field);
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    String(parsed) !== normalized
  ) {
    materializationError(`${field} must be a canonical positive integer`);
  }
  return normalized;
}

function modes(values: readonly DnaRaceMode[]): readonly DnaRaceMode[] {
  if (values.length < 1)
    materializationError("at least one Arena mode is required");
  const seen = new Set<DnaRaceMode>();
  for (const value of values) {
    if (!Object.prototype.hasOwnProperty.call(MODE_ORDER, value))
      materializationError("Arena mode is unsupported");
    if (seen.has(value)) materializationError("Arena modes must be unique");
    seen.add(value);
  }
  return Object.freeze(
    [...seen].sort((left, right) => MODE_ORDER[left] - MODE_ORDER[right]),
  );
}

function tokenRow(input: {
  evidence: DnaOpenLabEvidence<CanonicalTokenPricesSnapshot>;
  generationObservedAt: string;
  receiptCount: number;
}): DnaTokenPricesMaterializationRow {
  if (input.receiptCount !== 1) {
    materializationError(
      "Token family receipt must contain exactly one snapshot",
    );
  }
  const entry = input.evidence;
  if (
    entry.source !== "dna_open_lab" ||
    entry.sourceVersion !== "v1" ||
    entry.scope !== "tokens" ||
    entry.endpoint !== "tokens.prices" ||
    entry.entityKey !== "token-prices:current" ||
    entry.canonical.sourceType !== "token_prices_snapshot" ||
    entry.canonical.valuationUse !== "current_reference_only"
  ) {
    materializationError("Token evidence authority is invalid");
  }
  const observedAt = timestamp(entry.observedAt, "tokenPrices.observedAt");
  if (Date.parse(observedAt) > Date.parse(input.generationObservedAt)) {
    materializationError("Token observation cannot follow its generation");
  }
  return Object.freeze({
    observedAt,
    rawEvidenceSha256: checksum(
      entry.rawEvidenceSha256,
      "tokenPrices.rawEvidenceSha256",
    ),
    canonical: entry.canonical,
  });
}

function arenaRows(input: {
  evidence: readonly DnaOpenLabEvidence<CanonicalSpliceArenaPageSnapshot>[];
  expectedModes: readonly DnaRaceMode[];
  generationObservedAt: string;
  receiptCount: number;
}): Readonly<{
  pages: readonly DnaSpliceArenaPageMaterializationRow[];
  listings: readonly DnaSpliceArenaListingMaterializationRow[];
}> {
  const pages = input.evidence
    .map((entry) => {
      const canonical = entry.canonical;
      const page = positiveSafeInteger(canonical.page, "arenaPage.page");
      const pageSizeLimit = positiveSafeInteger(
        canonical.pageSizeLimit,
        "arenaPage.pageSizeLimit",
      );
      if (canonical.listings.length > pageSizeLimit) {
        materializationError(
          "Arena page listing count cannot exceed its page limit",
        );
      }
      if (
        entry.source !== "dna_open_lab" ||
        entry.sourceVersion !== "v1" ||
        entry.scope !== "splice" ||
        entry.endpoint !== "splice.arena" ||
        canonical.sourceType !== "splice_arena_page_snapshot" ||
        entry.entityKey !==
          `splice-arena:${canonical.mode}:page:${String(page)}`
      ) {
        materializationError("Arena page evidence authority is invalid");
      }
      const observedAt = timestamp(entry.observedAt, "arenaPage.observedAt");
      if (Date.parse(observedAt) > Date.parse(input.generationObservedAt)) {
        materializationError(
          "Arena page observation cannot follow its generation",
        );
      }
      return Object.freeze({
        mode: canonical.mode,
        page,
        observedAt,
        rawEvidenceSha256: checksum(
          entry.rawEvidenceSha256,
          "arenaPage.rawEvidenceSha256",
        ),
        canonical,
      });
    })
    .sort(
      (left, right) =>
        MODE_ORDER[left.mode] - MODE_ORDER[right.mode] ||
        left.page - right.page,
    );

  const expectedModeSet = new Set(input.expectedModes);
  for (const page of pages) {
    if (!expectedModeSet.has(page.mode)) {
      materializationError("Arena page contains an unexpected mode");
    }
  }

  const listings: DnaSpliceArenaListingMaterializationRow[] = [];
  for (const mode of input.expectedModes) {
    const modePages = pages.filter((page) => page.mode === mode);
    if (modePages.length < 1) {
      materializationError(`Arena mode ${mode} has no page evidence`);
    }
    const seenCoreIds = new Set<string>();
    for (const [index, page] of modePages.entries()) {
      const expectedPage = index + 1;
      if (page.page !== expectedPage) {
        materializationError(
          `Arena mode ${mode} pages must be contiguous from page 1`,
        );
      }
      const isLast = index === modePages.length - 1;
      if (page.canonical.hasMore === isLast) {
        materializationError(
          `Arena mode ${mode} pagination must end at exactly one terminal page`,
        );
      }
      for (const listing of page.canonical.listings) {
        const sourceCoreId = positiveSafeIntegerText(
          listing.sourceCoreId,
          "arenaListing.sourceCoreId",
        );
        if (seenCoreIds.has(sourceCoreId)) {
          materializationError(
            `Arena mode ${mode} cannot repeat a Core across pages`,
          );
        }
        seenCoreIds.add(sourceCoreId);
        listings.push(
          Object.freeze({
            mode,
            sourceCoreId,
            page: page.page,
            pageObservedAt: page.observedAt,
            pageRawEvidenceSha256: page.rawEvidenceSha256,
            canonical: listing,
          }),
        );
      }
    }
  }

  if (listings.length !== input.receiptCount) {
    materializationError(
      "Arena listing count must match the complete Splice Arena family receipt",
    );
  }
  listings.sort(
    (left, right) =>
      MODE_ORDER[left.mode] - MODE_ORDER[right.mode] ||
      Number(left.sourceCoreId) - Number(right.sourceCoreId),
  );

  return Object.freeze({
    pages: Object.freeze(pages),
    listings: Object.freeze(listings),
  });
}

/**
 * Binds current token prices and every requested Arena page to one complete
 * last-good generation. Each Arena mode must have an unbroken page chain and a
 * terminal `hasMore: false` page; partial crawls therefore cannot publish.
 */
export function createDnaTokenSpliceMaterialization(input: {
  candidate: DnaCurrentStateCandidate;
  tokenPrices: DnaOpenLabEvidence<CanonicalTokenPricesSnapshot>;
  arenaModes: readonly DnaRaceMode[];
  arenaPages: readonly DnaOpenLabEvidence<CanonicalSpliceArenaPageSnapshot>[];
}): DnaTokenSpliceMaterialization {
  const readiness = inspectDnaCurrentStateCandidate(input.candidate);
  if (!readiness.ready) {
    materializationError(
      `generation is incomplete: ${readiness.incompleteFamilies.join(", ")}`,
    );
  }
  const generationId = requiredText(
    input.candidate.generationId,
    "generationId",
  );
  const generationObservedAt = timestamp(
    input.candidate.observedAt,
    "generationObservedAt",
  );
  const arenaModes = modes(input.arenaModes);
  const tokenPrices = tokenRow({
    evidence: input.tokenPrices,
    generationObservedAt,
    receiptCount: input.candidate.families.tokens.itemCount,
  });
  const arena = arenaRows({
    evidence: input.arenaPages,
    expectedModes: arenaModes,
    generationObservedAt,
    receiptCount: input.candidate.families.splice_arena.itemCount,
  });

  return Object.freeze({
    generationId,
    generationObservedAt,
    tokenPrices,
    arenaModes,
    arenaPages: arena.pages,
    arenaListings: arena.listings,
  });
}
