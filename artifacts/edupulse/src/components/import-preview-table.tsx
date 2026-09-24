import type { ReactNode } from "react";

export type ImportPreviewRow = {
  index: number;
  sourceRow: number;
  values: Record<string, unknown>;
  status: "READY" | "INVALID" | "DUPLICATE" | "POTENTIAL_DUPLICATE";
  errors: Array<{ field?: string; message: string }>;
  warnings: Array<{ field?: string; message: string }>;
};

export function ImportPreviewTable({
  rows,
  selected,
  onToggle,
  selectionLocked = false,
}: {
  rows: ImportPreviewRow[];
  selected: Set<number>;
  onToggle: (index: number) => void;
  selectionLocked?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[hsl(var(--border))] text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            <th className="px-3 py-3 font-bold">Import</th>
            <th className="px-3 py-3 font-bold">Row</th>
            <th className="px-3 py-3 font-bold">Record preview</th>
            <th className="px-3 py-3 font-bold">Validation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const issues = [...row.errors, ...row.warnings];
            const canSelect = row.status === "READY" || row.status === "POTENTIAL_DUPLICATE";
            return (
              <tr key={row.index} className="border-b border-[hsl(var(--border)/.6)] align-top last:border-0">
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select source row ${row.sourceRow}`}
                    checked={selected.has(row.index)}
                    disabled={selectionLocked || !canSelect}
                    onChange={() => onToggle(row.index)}
                    className="h-4 w-4 accent-[hsl(var(--primary))] disabled:opacity-40"
                  />
                </td>
                <td className="px-3 py-3 font-mono text-xs">{row.sourceRow}</td>
                <td className="max-w-[320px] px-3 py-3">
                  <div className="space-y-1">
                    {Object.entries(row.values).filter(([, value]) => value !== null && value !== "").slice(0, 8).map(([field, value]) => (
                      <div key={field} className="truncate text-xs">
                        <span className="font-semibold text-[hsl(var(--muted-foreground))]">{field}: </span>
                        <span>{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="min-w-[220px] px-3 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    row.status === "READY"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : row.status === "POTENTIAL_DUPLICATE"
                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                  }`}>
                    {row.status.replaceAll("_", " ")}
                  </span>
                  {issues.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {issues.map((issue, index) => (
                        <li key={`${issue.field ?? "row"}-${index}`} className={row.errors.includes(issue)
                          ? "text-[hsl(var(--destructive))]"
                          : "text-amber-700 dark:text-amber-300"}>
                          {issue.field ? `${issue.field}: ` : ""}{issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">No rows were detected.</p>}
    </div>
  );
}

export function ImportSummaryCard({ label, count, tone = "neutral" }: {
  label: string;
  count: number;
  tone?: "neutral" | "good" | "warning" | "danger";
}) {
  const tones = {
    neutral: "border-[hsl(var(--border))] bg-[hsl(var(--card))]",
    good: "border-emerald-500/20 bg-emerald-500/5",
    warning: "border-amber-500/20 bg-amber-500/5",
    danger: "border-rose-500/20 bg-rose-500/5",
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="text-2xl font-bold">{count}</div>
      <div className="mt-1 text-xs font-semibold text-[hsl(var(--muted-foreground))]">{label}</div>
    </div>
  );
}

export function ImportSection({ title, description, children }: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel p-5 md:p-6">
      <div className="mb-4">
        <h2 className="text-base font-bold">{title}</h2>
        {description && <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{description}</p>}
      </div>
      {children}
    </section>
  );
}