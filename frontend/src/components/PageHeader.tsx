import type { ReactNode } from "react";

/** The h1 and intro line every signed-in page starts with. */
export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="mb-8">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      {description ? <p className="mt-2 max-w-prose text-muted-foreground">{description}</p> : null}
    </header>
  );
}
