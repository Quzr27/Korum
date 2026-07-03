import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DownloadIcon,
  FileImportIcon,
  FolderOpenIcon,
  Layers01Icon,
  PackageIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  buildLayoutPackageFileName,
  parseLayoutPackageText,
  type LayoutPackage,
  type LayoutPackageScope,
} from "@/lib/layout-package";
import { cn } from "@/lib/utils";

interface LayoutPackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialScope?: LayoutPackageScope;
  workspaceName: string;
  workspaceCount?: number;
  windowCount?: number;
  workspaceWindowCount?: number;
  canExportKorum?: boolean;
  canExportWorkspace?: boolean;
  onBuildPackage: (scope: LayoutPackageScope) => LayoutPackage | null;
  onImportLayout: (pkg: LayoutPackage) => void;
}

type LayoutPackageStatus = "idle" | "busy" | "exported" | "imported" | "error";

function firstDialogPath(value: string | string[] | null): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function LayoutPackageDialog({
  open,
  onOpenChange,
  initialScope = "workspace",
  workspaceName,
  workspaceCount = 0,
  windowCount = 0,
  workspaceWindowCount = 0,
  canExportKorum = true,
  canExportWorkspace = true,
  onBuildPackage,
  onImportLayout,
}: LayoutPackageDialogProps) {
  const [scope, setScope] = useState<LayoutPackageScope>(initialScope);
  const [status, setStatus] = useState<LayoutPackageStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setScope(initialScope);
    setStatus("idle");
    setError(null);
  }, [initialScope, open, workspaceName]);

  const handleExport = useCallback(async () => {
    setStatus("busy");
    setError(null);
    try {
      const exportName = scope === "korum" ? "Korum" : workspaceName;
      const path = await save({
        defaultPath: buildLayoutPackageFileName(exportName),
        filters: [{ name: "Korum layout JSON", extensions: ["json"] }],
      });
      if (!path) {
        setStatus("idle");
        return;
      }

      const pkg = onBuildPackage(scope);
      if (!pkg) {
        throw new Error(scope === "korum"
          ? "No Korum layout is available to export"
          : "No workspace layout is available to export");
      }
      await invoke("save_layout_package", {
        path,
        text: JSON.stringify(pkg, null, 2),
      });
      setStatus("exported");
    } catch (exportError) {
      setError(String(exportError));
      setStatus("error");
    }
  }, [onBuildPackage, scope, workspaceName]);

  const handleImport = useCallback(async () => {
    setStatus("busy");
    setError(null);
    try {
      const selected = firstDialogPath(await openDialog({
        multiple: false,
        directory: false,
        title: "Choose Korum layout",
        filters: [{ name: "Korum layout JSON", extensions: ["json"] }],
      }));
      if (!selected) {
        setStatus("idle");
        return;
      }

      const text = await invoke<string>("load_layout_package", { path: selected });
      const pkg = parseLayoutPackageText(text);

      onImportLayout(pkg);
      setStatus("imported");
      onOpenChange(false);
    } catch (importError) {
      setError(String(importError));
      setStatus("error");
    }
  }, [onImportLayout, onOpenChange]);

  const busy = status === "busy";
  const canExport = scope === "korum" ? canExportKorum : canExportWorkspace;
  const scopeName = scope === "korum" ? "Whole Korum" : workspaceName;
  const statusText = status === "exported"
    ? "Exported"
    : status === "imported"
      ? "Imported"
      : error ?? scopeName;

  const handleScopeChange = useCallback((nextScope: string) => {
    if (nextScope === "korum" || nextScope === "workspace") {
      setScope(nextScope);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" showCloseButton aria-describedby={undefined}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/70 text-muted-foreground">
              <HugeiconsIcon icon={PackageIcon} className="size-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-[13px] font-semibold">Import / Export Layout</DialogTitle>
              <div className={cn("truncate text-[11px]", error ? "text-destructive" : "text-muted-foreground")}>
                {statusText}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <ToggleGroup
            type="single"
            value={scope}
            onValueChange={handleScopeChange}
            variant="default"
            size="sm"
            spacing={1}
            className="grid w-full grid-cols-2 rounded-lg border border-border/60 bg-background/50 p-1"
            aria-label="Layout export scope"
          >
            <ToggleGroupItem
              value="korum"
              className="h-auto min-w-0 justify-start rounded-md px-2 py-2 text-left data-[state=on]:bg-muted"
            >
              <HugeiconsIcon icon={Layers01Icon} data-icon="inline-start" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate">Whole Korum</span>
                <span className="truncate text-[10px] font-normal text-muted-foreground">
                  {countLabel(workspaceCount, "workspace", "workspaces")} / {countLabel(windowCount, "window", "windows")}
                </span>
              </span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="workspace"
              disabled={!canExportWorkspace}
              className="h-auto min-w-0 justify-start rounded-md px-2 py-2 text-left data-[state=on]:bg-muted"
            >
              <HugeiconsIcon icon={PackageIcon} data-icon="inline-start" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate">Selected Workspace</span>
                <span className="truncate text-[10px] font-normal text-muted-foreground">
                  {workspaceName} / {countLabel(workspaceWindowCount, "window", "windows")}
                </span>
              </span>
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={handleImport} disabled={busy}>
              <HugeiconsIcon icon={FileImportIcon} data-icon="inline-start" />
              Import Layout
            </Button>
            <Button type="button" onClick={handleExport} disabled={busy || !canExport}>
              <HugeiconsIcon icon={DownloadIcon} data-icon="inline-start" />
              Export Layout
            </Button>
          </div>

          {status === "busy" ? (
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              <HugeiconsIcon icon={FolderOpenIcon} className="size-3.5" strokeWidth={2} />
              Working...
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
