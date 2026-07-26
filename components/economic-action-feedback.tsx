import type { EconomicActionFeedback as Feedback } from "@/domain/economic-action-feedback";

const toneClasses: Record<Feedback["tone"], string> = {
  neutral: "text-[var(--muted)]",
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  error: "text-[var(--danger)]",
};

export function EconomicActionFeedback({
  feedback,
  headingId,
}: Readonly<{
  feedback: Feedback;
  headingId: string;
}>) {
  return (
    <section
      aria-labelledby={headingId}
      aria-live={feedback.live}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
      role={feedback.role}
    >
      <h3
        className={`font-semibold ${toneClasses[feedback.tone]}`}
        id={headingId}
      >
        {feedback.title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        {feedback.detail}
      </p>
      {feedback.invalidFieldLabels.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {feedback.invalidFieldLabels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
