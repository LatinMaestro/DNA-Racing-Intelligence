export const modules = [
  { href: "/", label: "Dashboard", shortDescription: "Private vault overview" },
  {
    href: "/imports",
    label: "Imports",
    shortDescription: "Snapshot provenance and freshness",
  },
  {
    href: "/vault",
    label: "Vault",
    shortDescription: "Owned cores and lineage",
  },
  {
    href: "/search-core",
    label: "Search Core",
    shortDescription: "Game-wide core research",
  },
  {
    href: "/core-intelligence",
    label: "Core Intelligence",
    shortDescription: "Mode and distance evidence",
  },
  {
    href: "/discovery",
    label: "Discovery",
    shortDescription: "Targeted testing hypotheses",
  },
  {
    href: "/tournaments",
    label: "Tournaments",
    shortDescription: "Qualification planning",
  },
  {
    href: "/maiden",
    label: "Maiden",
    shortDescription: "Cross-mode ME strategy",
  },
  {
    href: "/breeding",
    label: "Breeding",
    shortDescription: "Upside, vault-fit and balanced pairs",
  },
  {
    href: "/lifecycle",
    label: "Lifecycle",
    shortDescription: "Race, retain, sell or burn",
  },
  {
    href: "/open-race",
    label: "Open Race",
    shortDescription: "Pre-entry field comparison",
  },
  {
    href: "/vault-performance",
    label: "Vault Performance",
    shortDescription: "Auditable asset-separated ledger",
  },
  {
    href: "/readiness",
    label: "Readiness",
    shortDescription: "Exact-head evidence and blockers",
  },
] as const;

export type ModuleHref = (typeof modules)[number]["href"];
