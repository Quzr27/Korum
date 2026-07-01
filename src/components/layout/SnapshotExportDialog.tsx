import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowReloadHorizontalIcon,
  CameraIcon,
  Cancel01Icon,
  DownloadIcon,
  FolderOpenIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { toCanvas } from "html-to-image";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_SNAPSHOT_EXPORT_OPTIONS,
  buildSnapshotCaptureClassName,
  buildSnapshotFileName,
  dataUrlToBytes,
  type SnapshotExportOptions,
} from "@/lib/snapshot-export";
import { cn } from "@/lib/utils";

interface SnapshotExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  getCaptureElement: () => HTMLElement | null;
}

type ExportStatus = "idle" | "rendering" | "saved" | "revealed" | "error";
const SNAPSHOT_PIXEL_RATIO = 1;
const INITIAL_PREVIEW_DELAY_MS = 80;
const PREVIEW_REFRESH_DEBOUNCE_MS = 450;
const HIDE_SIDEBAR_CONTENT_PADDING = 24;
type SnapshotCanvasOptions = NonNullable<Parameters<typeof toCanvas>[1]>;

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function canvasToImage(canvas: HTMLCanvasElement, type = "image/png"): string {
  return canvas.toDataURL(type);
}

function isIgnoredSnapshotNode(node: HTMLElement): boolean {
  return node.closest("[data-snapshot-ignore='true']") !== null;
}

function getSnapshotSidebarCropLeft(root: HTMLElement): number {
  const sidebarRoot = root.querySelector<HTMLElement>("[data-snapshot-sidebar='true']");
  if (!sidebarRoot) return 0;

  const rootRect = root.getBoundingClientRect();
  if (rootRect.width <= 0 || rootRect.height <= 0) return 0;

  let cropLeft = 0;
  const candidates = [sidebarRoot, ...Array.from(sidebarRoot.querySelectorAll<HTMLElement>("*"))];
  for (const candidate of candidates) {
    if (candidate.getAttribute("aria-hidden") === "true" || candidate.inert) continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.right <= rootRect.left || rect.left >= rootRect.right) continue;
    cropLeft = Math.max(cropLeft, Math.min(rootRect.right, rect.right) - rootRect.left);
  }

  return Math.round(cropLeft);
}

function getSnapshotContentLeft(root: HTMLElement): number | null {
  const rootRect = root.getBoundingClientRect();
  if (rootRect.width <= 0 || rootRect.height <= 0) return null;

  let contentLeft: number | null = null;
  const candidates = root.querySelectorAll<HTMLElement>(
    ".window, .canvas-minimap, [data-snapshot-usage-card='true']",
  );

  for (const candidate of candidates) {
    if (candidate.closest("[data-snapshot-sidebar='true']")) continue;
    if (candidate.closest("[data-snapshot-chrome='true']")) continue;
    if (candidate.closest("[data-snapshot-ignore='true']")) continue;
    if (candidate.getAttribute("aria-hidden") === "true" || candidate.inert) continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.right <= rootRect.left || rect.left >= rootRect.right) continue;
    const left = Math.max(0, rect.left - rootRect.left);
    contentLeft = contentLeft === null ? left : Math.min(contentLeft, left);
  }

  return contentLeft === null ? null : Math.round(contentLeft);
}

function buildSnapshotCanvasOptions(root: HTMLElement, captureOptions: SnapshotExportOptions): SnapshotCanvasOptions {
  const baseOptions: SnapshotCanvasOptions = {
    pixelRatio: SNAPSHOT_PIXEL_RATIO,
    preferredFontFormat: "woff2",
    filter: (node) => !(node instanceof HTMLElement && isIgnoredSnapshotNode(node)),
  };

  if (!captureOptions.hideSidebar) return baseOptions;

  const rootRect = root.getBoundingClientRect();
  const sidebarCropLeft = getSnapshotSidebarCropLeft(root);
  const contentLeft = getSnapshotContentLeft(root);
  const contentSafeCropLeft = contentLeft === null
    ? sidebarCropLeft
    : Math.max(0, contentLeft - HIDE_SIDEBAR_CONTENT_PADDING);
  const cropLeft = Math.round(Math.min(sidebarCropLeft, contentSafeCropLeft));
  if (cropLeft <= 0 || cropLeft >= rootRect.width) return baseOptions;

  const width = Math.max(1, Math.round(rootRect.width - cropLeft));
  const height = Math.max(1, Math.round(rootRect.height));

  return {
    ...baseOptions,
    width,
    height,
    canvasWidth: width,
    canvasHeight: height,
    style: {
      transform: `translateX(-${cropLeft}px)`,
      transformOrigin: "top left",
      width: `${Math.round(rootRect.width)}px`,
      height: `${height}px`,
    },
  };
}

function OptionSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex h-8 items-center justify-between gap-3">
      <span className="min-w-0 truncate">{label}</span>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export default function SnapshotExportDialog({
  open,
  onOpenChange,
  workspaceName,
  getCaptureElement,
}: SnapshotExportDialogProps) {
  const [options, setOptions] = useState<SnapshotExportOptions>(() => ({ ...DEFAULT_SNAPSHOT_EXPORT_OPTIONS }));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewDirty, setPreviewDirty] = useState(false);
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const optionsRef = useRef(options);
  const renderSeqRef = useRef(0);
  const captureQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    renderSeqRef.current += 1;
    if (!open) return;
    setOptions({ ...DEFAULT_SNAPSHOT_EXPORT_OPTIONS });
    setPreviewUrl(null);
    setPreviewDirty(true);
    setStatus("idle");
    setError(null);
    setSavedPath(null);
  }, [open, workspaceName]);

  const updateOption = useCallback((updates: Partial<SnapshotExportOptions>) => {
    renderSeqRef.current += 1;
    setOptions((current) => ({
      ...current,
      ...updates,
    }));
    setPreviewDirty(true);
    setStatus("idle");
    setError(null);
  }, []);

  const capturePngNow = useCallback(async (captureOptions: SnapshotExportOptions): Promise<string> => {
    const root = getCaptureElement();
    if (!root) throw new Error("Snapshot target is unavailable");

    const classTokens = buildSnapshotCaptureClassName(captureOptions).split(" ");
    const canvasOptions = buildSnapshotCanvasOptions(root, captureOptions);
    root.classList.add(...classTokens);

    try {
      await nextAnimationFrame();
      const sourceCanvas = await toCanvas(root, canvasOptions);
      return canvasToImage(sourceCanvas);
    } finally {
      root.classList.remove(...classTokens);
    }
  }, [getCaptureElement]);

  const capturePng = useCallback((captureOptions: SnapshotExportOptions): Promise<string> => {
    const runCapture = () => capturePngNow(captureOptions);
    const nextCapture = captureQueueRef.current.then(runCapture, runCapture);
    captureQueueRef.current = nextCapture.catch(() => undefined);
    return nextCapture;
  }, [capturePngNow]);

  const refreshPreview = useCallback(async () => {
    const seq = ++renderSeqRef.current;
    const captureOptions = optionsRef.current;
    setStatus("rendering");
    setError(null);

    try {
      const nextPreview = await capturePng(captureOptions);
      if (renderSeqRef.current !== seq) return;
      setPreviewUrl(nextPreview);
      setPreviewDirty(false);
      setStatus("idle");
    } catch (captureError) {
      if (renderSeqRef.current !== seq) return;
      setPreviewUrl(null);
      setError(String(captureError));
      setStatus("error");
    }
  }, [capturePng]);

  useEffect(() => {
    if (!open || !previewDirty) return;
    const timer = window.setTimeout(() => {
      void refreshPreview();
    }, previewUrl ? PREVIEW_REFRESH_DEBOUNCE_MS : INITIAL_PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, options, previewDirty, previewUrl, refreshPreview]);

  const getCurrentPng = useCallback(async () => {
    if (previewUrl && !previewDirty) return previewUrl;
    for (;;) {
      const seq = ++renderSeqRef.current;
      const captureOptions = optionsRef.current;
      const nextPreview = await capturePng(captureOptions);
      if (renderSeqRef.current !== seq) continue;
      setPreviewUrl(nextPreview);
      setPreviewDirty(false);
      return nextPreview;
    }
  }, [capturePng, previewDirty, previewUrl]);

  const handleSave = useCallback(async () => {
    setStatus("rendering");
    setError(null);
    try {
      const defaultPath = buildSnapshotFileName(workspaceName || "korum-snapshot");
      const path = await save({
        defaultPath,
        filters: [{ name: "PNG image", extensions: ["png"] }],
      });
      if (!path) {
        setStatus("idle");
        return;
      }

      const dataUrl = await getCurrentPng();
      await invoke("save_snapshot_png", { path, bytes: Array.from(dataUrlToBytes(dataUrl)) });
      setSavedPath(path);
      setStatus("saved");
    } catch (saveError) {
      setError(String(saveError));
      setStatus("error");
    }
  }, [getCurrentPng, workspaceName]);

  const handleReveal = useCallback(async () => {
    if (!savedPath) return;
    setStatus("rendering");
    setError(null);
    try {
      await invoke("reveal_snapshot_path", { path: savedPath });
      setStatus("revealed");
    } catch (revealError) {
      setError(String(revealError));
      setStatus("error");
    }
  }, [savedPath]);

  const busy = status === "rendering";
  const statusText = status === "saved"
      ? "Saved"
      : status === "revealed"
        ? "Revealed in Finder"
        : error ?? (previewDirty && previewUrl
          ? "Options changed - refresh or export"
          : "Full screen snapshot");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-snapshot-ignore="true"
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-0! left-0! h-dvh max-h-none w-dvw max-w-none! translate-x-0! translate-y-0! gap-0 overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none ring-0 pointer-events-none"
      >
      <button
        type="button"
        aria-label="Close snapshot export"
        className="pointer-events-auto absolute inset-0 cursor-default bg-background/72 backdrop-blur-[3px]"
        onClick={() => onOpenChange(false)}
      />

      <section className="pointer-events-auto fixed inset-x-6 top-12 bottom-28 flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-border/45 bg-background/25 shadow-2xl backdrop-blur-md">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/45 bg-background/45 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground">
              <HugeiconsIcon icon={CameraIcon} className="size-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-[13px] font-semibold">
                War Room Snapshot
              </DialogTitle>
              <div className={cn("truncate text-[11px]", error ? "text-destructive" : "text-muted-foreground")}>
                {statusText}
              </div>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} aria-label="Close snapshot export">
            <HugeiconsIcon icon={Cancel01Icon} data-icon="inline-start" />
            Close
          </Button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-muted/12 p-5">
          <div className="relative flex size-full items-center justify-center overflow-hidden rounded-lg border border-border/55 bg-background/45 shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Snapshot preview"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="flex h-full min-h-[320px] w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <HugeiconsIcon icon={CameraIcon} className="size-5" strokeWidth={2} />
                <span className="text-xs">{busy ? "Rendering preview..." : "Preview unavailable"}</span>
              </div>
            )}

            {busy ? (
              <div className="absolute inset-0 grid place-items-center bg-background/48 text-xs text-muted-foreground backdrop-blur-[1px]">
                Rendering...
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="pointer-events-auto fixed bottom-5 left-1/2 grid w-[min(920px,calc(100vw-2rem))] -translate-x-1/2 grid-cols-[minmax(190px,1fr)_auto] items-center gap-3 rounded-xl border border-border/60 bg-card/90 px-3 py-2 shadow-2xl backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/55 bg-background/60 text-muted-foreground">
            <HugeiconsIcon icon={CameraIcon} className="size-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold">Snapshot export</div>
            <div className={cn("truncate text-[11px]", error ? "text-destructive" : "text-muted-foreground")}>
              {statusText}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="lg">
                <HugeiconsIcon icon={Settings02Icon} data-icon="inline-start" />
                Options
              </Button>
            </PopoverTrigger>
            <PopoverContent
              data-snapshot-ignore="true"
              side="top"
              align="end"
              className="w-80 gap-3 border-border/60 bg-popover/95 p-3"
            >
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">Composition</span>
                <div className="flex flex-col gap-1">
                  <OptionSwitch
                    checked={options.showMinimap}
                    label="Show minimap"
                    onCheckedChange={(checked) => updateOption({ showMinimap: checked })}
                  />
                  <OptionSwitch
                    checked={!options.hideUsageCard}
                    label="Show usage card"
                    onCheckedChange={(checked) => updateOption({ hideUsageCard: !checked })}
                  />
                  <OptionSwitch
                    checked={options.hideSidebar}
                    label="Hide sidebar"
                    onCheckedChange={(checked) => updateOption({ hideSidebar: checked })}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Button variant="outline" size="lg" onClick={refreshPreview} disabled={busy}>
            <HugeiconsIcon icon={ArrowReloadHorizontalIcon} data-icon="inline-start" />
            Refresh
          </Button>
          <Button variant="outline" size="lg" onClick={handleReveal} disabled={busy || !savedPath}>
            <HugeiconsIcon icon={FolderOpenIcon} data-icon="inline-start" />
            Reveal
          </Button>
          <Button size="lg" onClick={handleSave} disabled={busy || !previewUrl}>
            <HugeiconsIcon icon={DownloadIcon} data-icon="inline-start" />
            Save PNG
          </Button>
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
}
