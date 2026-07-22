export type FreshnessState = "current" | "ageing" | "stale" | "unknown";

const DAY_MS = 86_400_000;

export function deriveFreshness(
  latestAcceptedEventAt: Date | null,
  now: Date,
): FreshnessState {
  if (!latestAcceptedEventAt) return "unknown";

  const ageDays = Math.max(
    0,
    (now.getTime() - latestAcceptedEventAt.getTime()) / DAY_MS,
  );
  if (ageDays <= 3) return "current";
  if (ageDays <= 7) return "ageing";
  return "stale";
}
