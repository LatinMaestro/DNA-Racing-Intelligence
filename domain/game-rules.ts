export const coreClasses = ["Genesis", "Morphed", "Freak", "X-Class"] as const;
export type CoreClass = (typeof coreClasses)[number];

export const elements = ["Metal", "Fire", "Earth", "Water"] as const;
export type Element = (typeof elements)[number];

const classMatrix: Record<CoreClass, Record<CoreClass, CoreClass>> = {
  Genesis: {
    Genesis: "Morphed",
    Morphed: "Freak",
    Freak: "Freak",
    "X-Class": "X-Class",
  },
  Morphed: {
    Genesis: "Freak",
    Morphed: "Freak",
    Freak: "X-Class",
    "X-Class": "X-Class",
  },
  Freak: {
    Genesis: "Freak",
    Morphed: "X-Class",
    Freak: "X-Class",
    "X-Class": "X-Class",
  },
  "X-Class": {
    Genesis: "X-Class",
    Morphed: "X-Class",
    Freak: "X-Class",
    "X-Class": "X-Class",
  },
};

const elementRank: Record<Element, number> = {
  Metal: 4,
  Fire: 3,
  Earth: 2,
  Water: 1,
};

export function offspringClass(
  parentA: CoreClass,
  parentB: CoreClass,
): CoreClass {
  return classMatrix[parentA][parentB];
}

export function offspringElement(parentA: Element, parentB: Element): Element {
  return elementRank[parentA] <= elementRank[parentB] ? parentA : parentB;
}

export function offspringFNumber(parentA: number, parentB: number): number {
  if (
    !Number.isInteger(parentA) ||
    !Number.isInteger(parentB) ||
    parentA < 1 ||
    parentB < 1
  ) {
    throw new RangeError("F-numbers must be positive integers.");
  }

  return parentA + parentB;
}

export function canBurn(coreClass: CoreClass): boolean {
  return coreClass !== "Genesis";
}

export function isGoldStarEligible(gateCount: number): boolean {
  return Number.isInteger(gateCount) && gateCount > 3;
}
