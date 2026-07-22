import type { CoreClass } from "@/domain/game-rules";

export type LineageCore = Readonly<{
  coreId: string;
  coreClass: CoreClass | null;
  parentCoreIds: readonly string[];
}>;

export type FamilyPairStatus = "eligible" | "ineligible" | "review_required";

export type FamilyPairRelation =
  | "parent"
  | "grandparent"
  | "full_sibling"
  | "half_sibling_allowed"
  | "distant_descendant_allowed"
  | "unrelated_or_other_allowed"
  | "same_core"
  | "unknown_core"
  | "incomplete_lineage"
  | "invalid_lineage";

export type FamilyPairDecision = Readonly<{
  status: FamilyPairStatus;
  relation: FamilyPairRelation;
  evidenceCoreIds: readonly string[];
}>;

type LineageIndex = Readonly<{
  cores: ReadonlyMap<string, LineageCore>;
  parentSets: ReadonlyMap<string, ReadonlySet<string>>;
}>;

function decision(
  status: FamilyPairStatus,
  relation: FamilyPairRelation,
  evidenceCoreIds: readonly string[],
): FamilyPairDecision {
  return {
    status,
    relation,
    evidenceCoreIds: [...new Set(evidenceCoreIds)].sort(),
  };
}

function buildIndex(cores: readonly LineageCore[]): LineageIndex | null {
  const byId = new Map<string, LineageCore>();
  const parentSets = new Map<string, ReadonlySet<string>>();

  for (const core of cores) {
    if (!core.coreId || byId.has(core.coreId)) {
      return null;
    }

    byId.set(core.coreId, core);
    parentSets.set(core.coreId, new Set(core.parentCoreIds));
  }

  return { cores: byId, parentSets };
}

function lineageIssue(
  coreId: string,
  index: LineageIndex,
): readonly string[] | null {
  const core = index.cores.get(coreId);
  const parents = index.parentSets.get(coreId);

  if (!core || !parents) {
    return [coreId];
  }

  if (parents.size !== core.parentCoreIds.length || parents.has(coreId)) {
    return [coreId, ...parents];
  }

  if (core.coreClass === "Genesis") {
    return parents.size === 0 ? null : [coreId, ...parents];
  }

  if (core.coreClass === null || parents.size !== 2) {
    return [coreId, ...parents];
  }

  for (const parentId of parents) {
    if (!index.cores.has(parentId)) {
      return [coreId, parentId];
    }
  }

  return null;
}

function ancestorDistances(
  coreId: string,
  index: LineageIndex,
): ReadonlyMap<string, number> | null {
  const distances = new Map<string, number>();
  const visiting = new Set<string>();

  const visit = (currentId: string, depth: number): boolean => {
    if (visiting.has(currentId)) {
      return false;
    }

    const parents = index.parentSets.get(currentId);
    if (!parents) {
      return false;
    }

    visiting.add(currentId);

    for (const parentId of parents) {
      if (!index.cores.has(parentId)) {
        visiting.delete(currentId);
        return false;
      }

      const nextDepth = depth + 1;
      const priorDepth = distances.get(parentId);
      if (priorDepth === undefined || nextDepth < priorDepth) {
        distances.set(parentId, nextDepth);
      }

      if (!visit(parentId, nextDepth)) {
        visiting.delete(currentId);
        return false;
      }
    }

    visiting.delete(currentId);
    return true;
  };

  return visit(coreId, 0) ? distances : null;
}

function sharedParents(
  coreAId: string,
  coreBId: string,
  index: LineageIndex,
): readonly string[] {
  const parentsA = index.parentSets.get(coreAId) ?? new Set<string>();
  const parentsB = index.parentSets.get(coreBId) ?? new Set<string>();
  return [...parentsA].filter((parentId) => parentsB.has(parentId)).sort();
}

export function evaluateFamilyPair(
  cores: readonly LineageCore[],
  coreAId: string,
  coreBId: string,
): FamilyPairDecision {
  const index = buildIndex(cores);
  if (!index) {
    return decision("review_required", "invalid_lineage", []);
  }

  if (!index.cores.has(coreAId) || !index.cores.has(coreBId)) {
    return decision("review_required", "unknown_core", [coreAId, coreBId]);
  }

  if (coreAId === coreBId) {
    return decision("review_required", "same_core", [coreAId]);
  }

  const ancestorsA = ancestorDistances(coreAId, index);
  const ancestorsB = ancestorDistances(coreBId, index);
  if (!ancestorsA || !ancestorsB) {
    return decision("review_required", "invalid_lineage", [coreAId, coreBId]);
  }

  const aToB = ancestorsA.get(coreBId);
  const bToA = ancestorsB.get(coreAId);
  if (aToB === 1 || bToA === 1) {
    return decision("ineligible", "parent", [coreAId, coreBId]);
  }

  if (aToB === 2 || bToA === 2) {
    return decision("ineligible", "grandparent", [coreAId, coreBId]);
  }

  const shared = sharedParents(coreAId, coreBId, index);
  const parentsA = index.parentSets.get(coreAId);
  const parentsB = index.parentSets.get(coreBId);
  if (parentsA?.size === 2 && parentsB?.size === 2 && shared.length === 2) {
    return decision("ineligible", "full_sibling", shared);
  }

  const issueA = lineageIssue(coreAId, index);
  const issueB = lineageIssue(coreBId, index);
  if (issueA || issueB) {
    return decision("review_required", "incomplete_lineage", [
      ...(issueA ?? []),
      ...(issueB ?? []),
    ]);
  }

  if (shared.length === 1) {
    return decision("eligible", "half_sibling_allowed", shared);
  }

  const distantDistance = [aToB, bToA].find(
    (distance): distance is number => distance !== undefined && distance > 2,
  );
  if (distantDistance !== undefined) {
    return decision("eligible", "distant_descendant_allowed", [
      coreAId,
      coreBId,
    ]);
  }

  return decision("eligible", "unrelated_or_other_allowed", []);
}
