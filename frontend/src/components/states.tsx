import type { ReactNode } from "react";
import { AlertIcon, InboxIcon } from "@/components/icons";
import { loadErrorMessage } from "@/lib/messages";
import type { Resource } from "@/lib/use-resource";
import { cn } from "@/lib/utils";

/** A grey placeholder block. Compose it into a shape that matches the content that will replace it. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-xl bg-muted motion-reduce:animate-none", className)} />;
}

/** Placeholder cards while data loads. Screen readers get `label` once, politely. */
export function LoadingState({ label = "Loading…", cards = 1 }: { label?: string; cards?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">{label}</span>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} aria-hidden="true" className="rounded-3xl bg-card p-6 shadow-soft sm:p-8">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-5 h-4 w-full max-w-md" />
          <Skeleton className="mt-2.5 h-4 w-2/3 max-w-sm" />
        </div>
      ))}
    </div>
  );
}

/** A failed load, with a retry. Announced immediately (role="alert"). */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="rounded-3xl bg-card p-8 text-center shadow-soft">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertIcon />
      </div>
      <h2 className="mt-4 text-lg font-bold tracking-tight">{title}</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn-secondary mt-6">
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/** "Nothing here yet", with an optional way forward. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-3xl border border-dashed bg-card/60 px-6 py-10 text-center", className)}>
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon ?? <InboxIcon />}
      </div>
      <h2 className="mt-4 text-base font-bold tracking-tight">{title}</h2>
      {description ? <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * Renders the right state for a Resource, so a page only describes its success view:
 *
 *   <ResourceBoundary resource={r} isEmpty={(d) => d.length === 0} empty={<EmptyState … />}>
 *     {(data) => <List items={data} />}
 *   </ResourceBoundary>
 */
export function ResourceBoundary<T>({
  resource,
  children,
  loading,
  errorTitle,
  isEmpty,
  empty,
}: {
  resource: Resource<T>;
  children: (data: T) => ReactNode;
  loading?: ReactNode;
  errorTitle?: string;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
}) {
  if (resource.status === "loading") return <>{loading ?? <LoadingState />}</>;
  if (resource.status === "error") {
    return <ErrorState title={errorTitle} message={loadErrorMessage(resource.error)} onRetry={resource.reload} />;
  }
  if (isEmpty?.(resource.data) && empty) return <>{empty}</>;
  return <>{children(resource.data)}</>;
}
