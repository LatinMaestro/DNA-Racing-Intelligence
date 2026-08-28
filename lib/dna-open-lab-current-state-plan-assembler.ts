import {
  adaptDnaActiveRace,
  adaptDnaSpliceArenaPage,
  adaptDnaVaultCore,
  type CanonicalSpliceArenaPageSnapshot,
  type DnaOpenLabEvidence,
} from "./dna-open-lab-v1-adapters";
import {
  createDnaCurrentStateSyncPlan,
  DNA_CURRENT_STATE_MAXIMUM_SCHEDULED_REQUESTS,
  type DnaCurrentStateRequest,
  type DnaCurrentStateSyncPlan,
  type DnaSpliceArenaPagesByMode,
} from "./dna-open-lab-current-state-sync-plan";
import type {
  DnaActiveRace,
  DnaOpenLabResponse,
  DnaRaceMode,
  DnaSpliceArenaResult,
  DnaVaultCore,
} from "./dna-open-lab-v1-client";

const MAXIMUM_ARENA_PAGES_PER_MODE = 512;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type DnaCurrentStateIdentityObservation = Readonly<{
  request: DnaCurrentStateRequest;
  response: DnaOpenLabResponse<unknown>;
  observedAt: string;
}>;

export type DnaCurrentStatePlanAssembly = Readonly<{
  status: "needs_continuation" | "ready";
  ownedCoreIds: readonly number[];
  activeRaceIds: readonly string[];
  arenaPageNumbersByMode: DnaSpliceArenaPagesByMode;
  continuationRequests: readonly DnaCurrentStateRequest[];
  plan: DnaCurrentStateSyncPlan | null;
}>;

function assemblyError(message: string): never {
  throw new Error(`DNA Open Lab current-state plan assembly: ${message}`);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
    CONTROL_PATTERN.test(normalized)
  ) {
    assemblyError(`${field} is invalid`);
  }
  return normalized;
}

function modes(values: readonly DnaRaceMode[]): readonly DnaRaceMode[] {
  const allowed = new Set<DnaRaceMode>(["bike", "car", "horse"]);
  const seen = new Set<DnaRaceMode>();
  const result: DnaRaceMode[] = [];
  for (const value of values) {
    if (!allowed.has(value)) assemblyError("Arena mode is unsupported");
    if (seen.has(value)) assemblyError("Arena modes must be unique");
    seen.add(value);
    result.push(value);
  }
  return Object.freeze(result);
}

function arenaRequest(mode: DnaRaceMode, page: number): DnaCurrentStateRequest {
  return Object.freeze({
    scope: "splice",
    endpoint: "splice.arena",
    payload: Object.freeze({
      filter: Object.freeze({ rvmode: mode }),
      page,
    }),
  });
}

function requestArenaIdentity(request: DnaCurrentStateRequest): {
  mode: DnaRaceMode;
  page: number;
} {
  if (request.scope !== "splice" || request.endpoint !== "splice.arena") {
    return assemblyError("Arena observation request authority is invalid");
  }
  const filter = request.payload.filter;
  if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
    return assemblyError("Arena observation filter is invalid");
  }
  const mode = (filter as Record<string, unknown>).rvmode;
  if (
    Object.keys(filter).length !== 1 ||
    (mode !== "bike" && mode !== "car" && mode !== "horse")
  ) {
    return assemblyError("Arena observation mode is invalid");
  }
  const page = request.payload.page;
  if (
    Object.keys(request.payload).sort().join(",") !== "filter,page" ||
    !Number.isSafeInteger(page) ||
    Number(page) < 1
  ) {
    return assemblyError("Arena observation page is invalid");
  }
  return { mode, page: Number(page) };
}

function arrayResult<T>(
  observation: DnaCurrentStateIdentityObservation,
  field: string,
): readonly T[] {
  if (!Array.isArray(observation.response.result)) {
    assemblyError(`${field} result must be an array`);
  }
  return observation.response.result as readonly T[];
}

function uniqueObservation(
  observations: readonly DnaCurrentStateIdentityObservation[],
  endpoint: "vault.cores_full" | "races.active",
): DnaCurrentStateIdentityObservation {
  const matches = observations.filter(
    (observation) => observation.request.endpoint === endpoint,
  );
  if (matches.length !== 1) {
    assemblyError(`${endpoint} requires exactly one observation`);
  }
  return matches[0]!;
}

/**
 * Derives dynamic owned-Core/race hydration and complete Arena page coverage
 * from already persisted bootstrap observations. The function is pure: it
 * makes no network or storage calls. If an Arena mode remains non-terminal it
 * returns exactly the next page request and withholds the final immutable plan.
 */
export function assembleDnaCurrentStateSyncPlan(input: {
  vault: string;
  observations: readonly DnaCurrentStateIdentityObservation[];
  spliceModes?: readonly DnaRaceMode[];
}): DnaCurrentStatePlanAssembly {
  const vault = requiredText(input.vault, "vault");
  const spliceModes = modes(input.spliceModes ?? ["bike", "car", "horse"]);
  const allowedEndpoints = new Set([
    "vault.cores_full",
    "races.active",
    "splice.arena",
  ]);
  if (
    input.observations.some(
      (observation) => !allowedEndpoints.has(observation.request.endpoint),
    )
  ) {
    assemblyError("observation endpoint is outside identity assembly");
  }

  const ownership = uniqueObservation(input.observations, "vault.cores_full");
  if (
    ownership.request.scope !== "vault" ||
    Object.keys(ownership.request.payload).join(",") !== "vault" ||
    ownership.request.payload.vault !== vault
  ) {
    assemblyError("vault.cores_full request authority is invalid");
  }
  const ownedCoreIds = arrayResult<DnaVaultCore>(ownership, "vault.cores_full")
    .map((raw) =>
      Number(
        adaptDnaVaultCore({ raw, observedAt: ownership.observedAt }).canonical
          .sourceCoreId,
      ),
    )
    .sort((left, right) => left - right);
  if (new Set(ownedCoreIds).size !== ownedCoreIds.length) {
    assemblyError("vault.cores_full repeats an owned Core identity");
  }

  const active = uniqueObservation(input.observations, "races.active");
  if (
    active.request.scope !== "races" ||
    Object.keys(active.request.payload).length !== 0
  ) {
    assemblyError("races.active request authority is invalid");
  }
  const activeRaceIds = arrayResult<DnaActiveRace>(active, "races.active")
    .map(
      (raw) =>
        adaptDnaActiveRace({ raw, observedAt: active.observedAt }).canonical
          .sourceRaceId,
    )
    .sort((left, right) => left.localeCompare(right));
  if (new Set(activeRaceIds).size !== activeRaceIds.length) {
    assemblyError("races.active repeats a race identity");
  }

  const expectedModes = new Set(spliceModes);
  const fixedPlan = createDnaCurrentStateSyncPlan({
    vault,
    ownedCoreIds,
    activeRaceIds,
    spliceModes: [],
  });
  const maximumArenaPageCount =
    DNA_CURRENT_STATE_MAXIMUM_SCHEDULED_REQUESTS -
    fixedPlan.bootstrap.length -
    fixedPlan.hydrate.length;
  const pagesByMode = new Map<
    DnaRaceMode,
    DnaOpenLabEvidence<CanonicalSpliceArenaPageSnapshot>[]
  >();
  for (const observation of input.observations.filter(
    (candidate) => candidate.request.endpoint === "splice.arena",
  )) {
    const identity = requestArenaIdentity(observation.request);
    if (!expectedModes.has(identity.mode)) {
      assemblyError("Arena observation contains an unexpected mode");
    }
    if (
      typeof observation.response.result !== "object" ||
      observation.response.result === null ||
      Array.isArray(observation.response.result) ||
      !Array.isArray(
        (observation.response.result as Record<string, unknown>).cores,
      )
    ) {
      assemblyError("splice.arena result is invalid");
    }
    const evidence = adaptDnaSpliceArenaPage({
      raw: observation.response.result as DnaSpliceArenaResult,
      mode: identity.mode,
      observedAt: observation.observedAt,
    });
    if (evidence.canonical.page !== identity.page) {
      assemblyError("Arena response page does not match its request");
    }
    const pages = pagesByMode.get(identity.mode) ?? [];
    if (pages.some((page) => page.canonical.page === identity.page)) {
      assemblyError("Arena observation repeats a mode/page identity");
    }
    pages.push(evidence);
    pagesByMode.set(identity.mode, pages);
  }

  const continuationRequests: DnaCurrentStateRequest[] = [];
  const arenaPageNumbersByMode: Partial<
    Record<DnaRaceMode, readonly number[]>
  > = {};
  for (const mode of spliceModes) {
    const pages = [...(pagesByMode.get(mode) ?? [])].sort(
      (left, right) => left.canonical.page - right.canonical.page,
    );
    if (pages.length === 0) {
      continuationRequests.push(arenaRequest(mode, 1));
      continue;
    }
    const listingIds = new Set<string>();
    const expectedLimit = pages[0]!.canonical.pageSizeLimit;
    for (const [index, page] of pages.entries()) {
      if (page.canonical.page !== index + 1) {
        assemblyError(
          `Arena mode ${mode} pages must be contiguous from page 1`,
        );
      }
      if (page.canonical.pageSizeLimit !== expectedLimit) {
        assemblyError(
          `Arena mode ${mode} page limit changed during acquisition`,
        );
      }
      if (index < pages.length - 1 && !page.canonical.hasMore) {
        assemblyError(
          `Arena mode ${mode} contains a page after its terminal page`,
        );
      }
      for (const listing of page.canonical.listings) {
        if (listingIds.has(listing.sourceCoreId)) {
          assemblyError(`Arena mode ${mode} repeats a Core across pages`);
        }
        listingIds.add(listing.sourceCoreId);
      }
    }
    const pageNumbers = Object.freeze(pages.map((page) => page.canonical.page));
    arenaPageNumbersByMode[mode] = pageNumbers;
    const last = pages.at(-1)!;
    if (last.canonical.hasMore) {
      if (last.canonical.page >= MAXIMUM_ARENA_PAGES_PER_MODE) {
        assemblyError(`Arena mode ${mode} exceeded its bounded page capacity`);
      }
      continuationRequests.push(arenaRequest(mode, last.canonical.page + 1));
    }
  }

  const observedArenaPageCount = [...pagesByMode.values()].reduce(
    (total, pages) => total + pages.length,
    0,
  );
  if (
    observedArenaPageCount + continuationRequests.length >
    maximumArenaPageCount
  ) {
    assemblyError("Arena continuation exceeds the durable cycle capacity");
  }

  const continuations = Object.freeze(continuationRequests);
  const completePages = Object.freeze({ ...arenaPageNumbersByMode });
  if (continuations.length > 0) {
    return Object.freeze({
      status: "needs_continuation",
      ownedCoreIds: Object.freeze(ownedCoreIds),
      activeRaceIds: Object.freeze(activeRaceIds),
      arenaPageNumbersByMode: completePages,
      continuationRequests: continuations,
      plan: null,
    });
  }
  return Object.freeze({
    status: "ready",
    ownedCoreIds: Object.freeze(ownedCoreIds),
    activeRaceIds: Object.freeze(activeRaceIds),
    arenaPageNumbersByMode: completePages,
    continuationRequests: continuations,
    plan: createDnaCurrentStateSyncPlan({
      vault,
      ownedCoreIds,
      activeRaceIds,
      spliceModes,
      spliceArenaPagesByMode: completePages,
    }),
  });
}
