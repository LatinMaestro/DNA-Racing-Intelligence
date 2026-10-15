import { raceModes, type RaceMode } from "@/domain/core-performance";

export type EvidenceViewFilters = Readonly<{
  mode: RaceMode | "all";
  distance: number | null;
}>;

// Presentation filters only. Never map an unsupported distance to a nearby one.
export function evidenceViewFilters(input: {
  mode?: unknown;
  distance?: unknown;
}): EvidenceViewFilters {
  const mode = raceModes.find((value) => value === input.mode) ?? "all";
  const distance =
    typeof input.distance === "string" && /^[1-9][0-9]*$/.test(input.distance)
      ? Number(input.distance)
      : null;
  return {
    mode,
    distance:
      distance !== null && Number.isSafeInteger(distance) ? distance : null,
  };
}
