import { statusMeta, type StatusTone } from "@/lib/profile";
import { cn } from "@/lib/utils";

// Full class names on purpose: Tailwind only generates classes it can find as whole strings.
const TONE: Record<StatusTone, { bg: string; dot: string }> = {
  neutral: { bg: "bg-muted", dot: "bg-muted-foreground" },
  info: { bg: "bg-accent/15", dot: "bg-accent" },
  success: { bg: "bg-success/10", dot: "bg-success" },
  warning: { bg: "bg-warning/15", dot: "bg-warning" },
  danger: { bg: "bg-destructive/10", dot: "bg-destructive" },
};

/** The account status as text plus a colour dot, so colour is never the only signal. */
export function StatusPill({ status, className }: { status: string; className?: string }) {
  const meta = statusMeta(status);
  const tone = TONE[meta.tone];
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold", tone.bg, className)}>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", tone.dot)} />
      {meta.label}
    </span>
  );
}
