const TONES = {
  sage: "bg-sage-soft text-sage",
  amber: "bg-amber-soft text-amber",
  rust: "bg-rust-soft text-rust",
  neutral: "bg-surface-2 text-ink-faint",
} as const;

export default function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
