import type { CodeViewMode } from "@/types";
import type { ChangedFileRow } from "@/lib/changed-files";
import { GIT_STATUS_COLORS } from "@/lib/file-icons";
import { cn } from "@/lib/utils";

interface ChangedFilesStripProps {
  rows: readonly ChangedFileRow[];
  onOpenFile: (filePath: string, viewMode: CodeViewMode) => void;
}

export default function ChangedFilesStrip({ rows, onOpenFile }: ChangedFilesStripProps) {
  if (rows.length === 0) return null;

  return (
    <section className="border-b border-border/20 px-2 py-1.5" aria-label="Changed files">
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/65">
          Changed
        </p>
        <span className="text-[9px] tabular-nums text-muted-foreground/35">
          {rows.length}
        </span>
      </div>
      <div className="max-h-36 overflow-y-auto pr-0.5">
        <div className="flex flex-col gap-0.5">
          {rows.map((row) => {
            const actionLabel = row.openMode === "changes" ? "Open diff" : "Open file";
            return (
              <button
                key={row.key}
                type="button"
                className={cn(
                  "grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md px-1.5 py-1",
                  "text-left text-[11px] text-muted-foreground transition-colors",
                  "hover:bg-sidebar-accent/55 hover:text-foreground",
                )}
                onClick={() => onOpenFile(row.absolutePath, row.openMode)}
                aria-label={`${actionLabel} for ${row.displayPath}`}
              >
                <span
                  className="justify-self-center text-[9px] font-bold tabular-nums"
                  style={{ color: GIT_STATUS_COLORS[row.status] ?? "var(--muted-foreground)" }}
                >
                  {row.status}
                </span>
                <span className="min-w-0 truncate" title={row.displayPath} translate="no">
                  {row.displayPath}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[9px] tabular-nums text-muted-foreground/45">
                  {row.insertions > 0 && (
                    <span style={{ color: GIT_STATUS_COLORS.A }}>+{row.insertions}</span>
                  )}
                  {row.deletions > 0 && (
                    <span style={{ color: GIT_STATUS_COLORS.D }}>-{row.deletions}</span>
                  )}
                  <span className="text-muted-foreground/30">{actionLabel}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
