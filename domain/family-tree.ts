import type { CoreClass } from "@/domain/game-rules";

export type FamilyTreeCore = Readonly<{
  coreId: string;
  displayName: string | null;
  coreClass: CoreClass | null;
  parentCoreIds: readonly string[];
}>;

export type FamilyTreeRelationship =
  | "root"
  | "parent"
  | "grandparent"
  | "ancestor"
  | "child"
  | "grandchild"
  | "descendant"
  | "full_sibling"
  | "half_sibling"
  | "sibling_candidate";

export type FamilyTreeIssueCode =
  | "root_not_found"
  | "duplicate_core_id"
  | "duplicate_parent_reference"
  | "self_parent"
  | "missing_parent_core"
  | "missing_core_class"
  | "genesis_has_parent"
  | "non_genesis_parent_count"
  | "cycle";

export type FamilyTreeNode = Readonly<{
  coreId: string;
  displayName: string | null;
  coreClass: CoreClass | null;
  isResolved: boolean;
  relationships: readonly FamilyTreeRelationship[];
  ancestorDepth: number | null;
  descendantDepth: number | null;
}>;

export type FamilyTreeEdge = Readonly<{
  childCoreId: string;
  parentCoreId: string;
  isResolved: boolean;
}>;

export type FamilyTreeIssue = Readonly<{
  code: FamilyTreeIssueCode;
  coreIds: readonly string[];
}>;

export type FamilyTreeProjection = Readonly<{
  rootCoreId: string;
  status: "ready" | "review_required";
  nodes: readonly FamilyTreeNode[];
  edges: readonly FamilyTreeEdge[];
  issues: readonly FamilyTreeIssue[];
}>;

type MutableNode = {
  coreId: string;
  displayName: string | null;
  coreClass: CoreClass | null;
  isResolved: boolean;
  relationships: Set<FamilyTreeRelationship>;
  ancestorDepth: number | null;
  descendantDepth: number | null;
};

const relationshipOrder: readonly FamilyTreeRelationship[] = [
  "root",
  "parent",
  "grandparent",
  "ancestor",
  "child",
  "grandchild",
  "descendant",
  "full_sibling",
  "half_sibling",
  "sibling_candidate",
];

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function issueKey(
  code: FamilyTreeIssueCode,
  coreIds: readonly string[],
): string {
  return `${code}:${sortedUnique(coreIds).join(":")}`;
}

function addIssue(
  issues: Map<string, FamilyTreeIssue>,
  code: FamilyTreeIssueCode,
  coreIds: readonly string[],
): void {
  const normalized = sortedUnique(coreIds.filter(Boolean));
  issues.set(issueKey(code, normalized), { code, coreIds: normalized });
}

function depthRelationship(
  direction: "ancestor" | "descendant",
  depth: number,
): FamilyTreeRelationship {
  if (direction === "ancestor") {
    if (depth === 1) return "parent";
    if (depth === 2) return "grandparent";
    return "ancestor";
  }

  if (depth === 1) return "child";
  if (depth === 2) return "grandchild";
  return "descendant";
}

export function buildFamilyTreeProjection(
  cores: readonly FamilyTreeCore[],
  rootCoreId: string,
): FamilyTreeProjection {
  const issues = new Map<string, FamilyTreeIssue>();
  const coreById = new Map<string, FamilyTreeCore>();

  for (const core of cores) {
    if (!core.coreId || coreById.has(core.coreId)) {
      addIssue(issues, "duplicate_core_id", [core.coreId]);
      continue;
    }
    coreById.set(core.coreId, core);
  }

  if (!coreById.has(rootCoreId)) {
    addIssue(issues, "root_not_found", [rootCoreId]);
    return {
      rootCoreId,
      status: "review_required",
      nodes: [],
      edges: [],
      issues: [...issues.values()],
    };
  }

  const parentsByChild = new Map<string, readonly string[]>();
  const childrenByParent = new Map<string, Set<string>>();
  const edgeByKey = new Map<string, FamilyTreeEdge>();

  for (const core of coreById.values()) {
    const parentIds = sortedUnique(core.parentCoreIds.filter(Boolean));
    parentsByChild.set(core.coreId, parentIds);

    if (parentIds.length !== core.parentCoreIds.length) {
      addIssue(issues, "duplicate_parent_reference", [
        core.coreId,
        ...core.parentCoreIds,
      ]);
    }
    if (parentIds.includes(core.coreId)) {
      addIssue(issues, "self_parent", [core.coreId]);
    }
    if (core.coreClass === null) {
      addIssue(issues, "missing_core_class", [core.coreId]);
    } else if (core.coreClass === "Genesis" && parentIds.length > 0) {
      addIssue(issues, "genesis_has_parent", [core.coreId, ...parentIds]);
    } else if (core.coreClass !== "Genesis" && parentIds.length !== 2) {
      addIssue(issues, "non_genesis_parent_count", [core.coreId, ...parentIds]);
    }

    for (const parentId of parentIds) {
      const parent = coreById.get(parentId);
      if (!parent) {
        addIssue(issues, "missing_parent_core", [core.coreId, parentId]);
      }
      const children = childrenByParent.get(parentId) ?? new Set<string>();
      children.add(core.coreId);
      childrenByParent.set(parentId, children);
      edgeByKey.set(`${core.coreId}:${parentId}`, {
        childCoreId: core.coreId,
        parentCoreId: parentId,
        isResolved: parent !== undefined,
      });
    }
  }

  const nodes = new Map<string, MutableNode>();
  const ensureNode = (coreId: string): MutableNode => {
    const existing = nodes.get(coreId);
    if (existing) return existing;

    const core = coreById.get(coreId);
    const created: MutableNode = {
      coreId,
      displayName: core?.displayName ?? null,
      coreClass: core?.coreClass ?? null,
      isResolved: core !== undefined,
      relationships: new Set<FamilyTreeRelationship>(),
      ancestorDepth: null,
      descendantDepth: null,
    };
    nodes.set(coreId, created);
    return created;
  };

  const root = ensureNode(rootCoreId);
  root.relationships.add("root");
  root.ancestorDepth = 0;
  root.descendantDepth = 0;

  const ancestorDistances = new Map<string, number>();
  const ancestorPath = new Set<string>();
  const visitAncestors = (coreId: string, depth: number): void => {
    if (ancestorPath.has(coreId)) {
      addIssue(issues, "cycle", [...ancestorPath, coreId]);
      return;
    }

    ancestorPath.add(coreId);
    for (const parentId of parentsByChild.get(coreId) ?? []) {
      const nextDepth = depth + 1;
      const prior = ancestorDistances.get(parentId);
      const isShorterPath = prior === undefined || nextDepth < prior;
      if (isShorterPath) {
        ancestorDistances.set(parentId, nextDepth);
      }

      if (ancestorPath.has(parentId)) {
        addIssue(issues, "cycle", [...ancestorPath, parentId]);
        continue;
      }

      const node = ensureNode(parentId);
      node.relationships.add(depthRelationship("ancestor", nextDepth));
      node.ancestorDepth =
        node.ancestorDepth === null
          ? nextDepth
          : Math.min(node.ancestorDepth, nextDepth);

      if (coreById.has(parentId) && isShorterPath) {
        visitAncestors(parentId, nextDepth);
      }
    }
    ancestorPath.delete(coreId);
  };
  visitAncestors(rootCoreId, 0);

  const descendantDistances = new Map<string, number>();
  const descendantPath = new Set<string>();
  const visitDescendants = (coreId: string, depth: number): void => {
    if (descendantPath.has(coreId)) {
      addIssue(issues, "cycle", [...descendantPath, coreId]);
      return;
    }

    descendantPath.add(coreId);
    for (const childId of childrenByParent.get(coreId) ?? []) {
      const nextDepth = depth + 1;
      const prior = descendantDistances.get(childId);
      const isShorterPath = prior === undefined || nextDepth < prior;
      if (isShorterPath) {
        descendantDistances.set(childId, nextDepth);
      }

      if (descendantPath.has(childId)) {
        addIssue(issues, "cycle", [...descendantPath, childId]);
        continue;
      }

      const node = ensureNode(childId);
      node.relationships.add(depthRelationship("descendant", nextDepth));
      node.descendantDepth =
        node.descendantDepth === null
          ? nextDepth
          : Math.min(node.descendantDepth, nextDepth);
      if (isShorterPath) visitDescendants(childId, nextDepth);
    }
    descendantPath.delete(coreId);
  };
  visitDescendants(rootCoreId, 0);

  const rootParents = new Set(parentsByChild.get(rootCoreId) ?? []);
  if (rootParents.size > 0) {
    for (const candidate of coreById.values()) {
      if (candidate.coreId === rootCoreId) continue;
      const candidateParents = new Set(
        parentsByChild.get(candidate.coreId) ?? [],
      );
      const shared = [...rootParents].filter((parentId) =>
        candidateParents.has(parentId),
      );
      if (shared.length === 0) continue;

      const node = ensureNode(candidate.coreId);
      node.relationships.add(
        rootParents.size === 2 &&
          candidateParents.size === 2 &&
          shared.length === 2
          ? "full_sibling"
          : rootParents.size === 2 &&
              candidateParents.size === 2 &&
              shared.length === 1
            ? "half_sibling"
            : "sibling_candidate",
      );
    }
  }

  const includedIds = new Set(nodes.keys());
  const edges = [...edgeByKey.values()]
    .filter(
      (edge) =>
        includedIds.has(edge.childCoreId) && includedIds.has(edge.parentCoreId),
    )
    .sort(
      (a, b) =>
        a.childCoreId.localeCompare(b.childCoreId) ||
        a.parentCoreId.localeCompare(b.parentCoreId),
    );

  const projectedNodes = [...nodes.values()]
    .map((node): FamilyTreeNode => ({
      coreId: node.coreId,
      displayName: node.displayName,
      coreClass: node.coreClass,
      isResolved: node.isResolved,
      relationships: [...node.relationships].sort(
        (a, b) => relationshipOrder.indexOf(a) - relationshipOrder.indexOf(b),
      ),
      ancestorDepth: node.ancestorDepth,
      descendantDepth: node.descendantDepth,
    }))
    .sort((a, b) => a.coreId.localeCompare(b.coreId));

  const projectedIssues = [...issues.values()]
    .filter((issue) => issue.coreIds.some((coreId) => includedIds.has(coreId)))
    .sort(
      (a, b) =>
        a.code.localeCompare(b.code) ||
        a.coreIds.join(":").localeCompare(b.coreIds.join(":")),
    );

  return {
    rootCoreId,
    status: projectedIssues.length === 0 ? "ready" : "review_required",
    nodes: projectedNodes,
    edges,
    issues: projectedIssues,
  };
}
