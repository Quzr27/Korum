import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import { useSettings } from "@/lib/settings-context";
import {
  type BaseColor,
  type CanvasAtmosphere,
  type RadiusPreset,
  type TerminalTheme,
  BASE_COLOR_LABELS,
  BASE_COLOR_SWATCHES,
  CANVAS_ATMOSPHERE_LABELS,
  CANVAS_ATMOSPHERES,
  DEFAULT_SETTINGS,
  RADIUS_PRESETS,
  TERMINAL_FONTS,
  TERMINAL_FONT_FAMILIES,
  TERMINAL_THEME_LABELS,
  TERMINAL_THEMES,
  XTERM_THEMES,
} from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const BASE_COLORS: readonly BaseColor[] = Object.keys(BASE_COLOR_LABELS) as BaseColor[];

function isBaseColor(value: string): value is BaseColor {
  return (BASE_COLORS as readonly string[]).includes(value);
}

function isRadiusPreset(value: number): value is RadiusPreset {
  return (RADIUS_PRESETS as readonly number[]).includes(value);
}

interface SettingsPanelProps {
  dismissVersion?: number;
}

export default function SettingsPanel({ dismissVersion = 0 }: SettingsPanelProps) {
  const { settings, update } = useSettings();
  const [open, setOpen] = useState(false);
  const [fontSizeDraft, setFontSizeDraft] = useState(settings.terminalFontSize);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFontSizeDraft(settings.terminalFontSize);
  }, [settings.terminalFontSize]);

  useEffect(() => {
    setOpen(false);
  }, [dismissVersion]);

  // Close settings panel on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Don't close panel when Escape is used inside an input (e.g. rename)
        if ((e.target as HTMLElement).closest("input, textarea")) return;
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const commitFontSize = useCallback((value?: number) => {
    const nextValue = value ?? fontSizeDraft;
    if (nextValue !== settings.terminalFontSize) {
      update({ terminalFontSize: nextValue });
    }
  }, [fontSizeDraft, settings.terminalFontSize, update]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="glass-subtle h-8 w-full text-muted-foreground hover:text-foreground cursor-pointer"
        aria-label="Settings"
        onClick={() => setOpen((prev) => !prev)}
      >
        <HugeiconsIcon icon={Settings01Icon} size={13} />
      </Button>

      <div
        ref={panelRef}
        role="dialog"
        aria-label="Settings"
        data-slot="settings-panel"
        className={`fixed top-3 bottom-3 right-3 z-50 flex w-3/4 max-w-sm flex-col rounded-xl border border-border bg-popover text-xs/relaxed text-popover-foreground shadow-2xl shadow-black/25 transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-[calc(100%+0.75rem)]"}`}
      >
        <div className="flex flex-col gap-1 p-4">
          <h2 className="font-heading text-sm font-medium text-foreground">
            Settings
          </h2>
          <p className="text-xs/relaxed text-muted-foreground">
            Changes apply instantly so the canvas stays visible while you tune it.
          </p>
        </div>

        <Separator />

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 p-4">
            <SettingRow label="Mode">
              <ToggleGroup
                type="single"
                value={settings.theme}
                onValueChange={(value) => {
                  if (value === "dark" || value === "light") {
                    update({ theme: value });
                  }
                }}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="dark" aria-label="Dark">
                  Dark
                </ToggleGroupItem>
                <ToggleGroupItem value="light" aria-label="Light">
                  Light
                </ToggleGroupItem>
              </ToggleGroup>
            </SettingRow>

            <Separator />

            <SettingRow label="Usage Limits">
              <ToggleGroup
                type="single"
                value={settings.showUsageLimits ? "on" : "off"}
                onValueChange={(value) => {
                  if (value === "on" || value === "off") {
                    update({ showUsageLimits: value === "on" });
                  }
                }}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="on" aria-label="Show usage limits">
                  On
                </ToggleGroupItem>
                <ToggleGroupItem value="off" aria-label="Hide usage limits">
                  Off
                </ToggleGroupItem>
              </ToggleGroup>
            </SettingRow>

            <Separator />

            <SettingRow label="Base Color">
              <ToggleGroup
                type="single"
                value={settings.baseColor}
                onValueChange={(value) => {
                  if (isBaseColor(value)) {
                    update({ baseColor: value });
                  }
                }}
                spacing={2}
              >
                {BASE_COLORS.map((color) => (
                  <ToggleGroupItem
                    key={color}
                    value={color}
                    aria-label={BASE_COLOR_LABELS[color]}
                    title={BASE_COLOR_LABELS[color]}
                    className="size-8 rounded-full border border-transparent p-0 hover:bg-transparent data-[state=on]:border-foreground data-[state=on]:bg-transparent"
                  >
                    <span
                      className="size-5 rounded-full"
                      style={{ backgroundColor: BASE_COLOR_SWATCHES[color] }}
                    />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </SettingRow>

            <Separator />

            <SettingRow label="Canvas Atmosphere">
              <div className="grid grid-cols-2 gap-2">
                {CANVAS_ATMOSPHERES.map((atmosphere) => {
                  const isActive = settings.canvasAtmosphere === atmosphere;
                  return (
                    <button
                      key={atmosphere}
                      type="button"
                      className={`relative flex flex-col items-start gap-1.5 rounded-lg border px-2 py-2 text-left transition-all duration-200 cursor-pointer ${isActive ? "border-foreground/40 bg-accent/50" : "border-border hover:border-foreground/30 hover:bg-accent/20"}`}
                      onClick={() => update({ canvasAtmosphere: atmosphere })}
                    >
                      <CanvasAtmospherePreview atmosphere={atmosphere} />
                      <span className={`text-[11px] transition-colors ${isActive ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                        {CANVAS_ATMOSPHERE_LABELS[atmosphere]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </SettingRow>

            <Separator />

            <SettingRow label="Radius">
              <ToggleGroup
                type="single"
                value={String(settings.radius)}
                onValueChange={(value) => {
                  const parsed = Number(value);
                  if (isRadiusPreset(parsed)) {
                    update({ radius: parsed });
                  }
                }}
                variant="outline"
                size="sm"
                spacing={1}
              >
                {RADIUS_PRESETS.map((radius) => (
                  <ToggleGroupItem
                    key={radius}
                    value={String(radius)}
                    aria-label={radius === 0 ? "Sharp" : `${radius}rem`}
                    title={radius === 0 ? "Sharp" : `${radius}rem`}
                    className="size-7 p-0 data-[state=on]:border-foreground"
                  >
                    <div
                      className="size-3.5 border-2 border-current"
                      style={{ borderRadius: `${Math.max(radius * 4, 1)}px` }}
                    />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </SettingRow>

            <Separator />

            <SettingRow label="Terminal Theme">
              <div className="rounded-md border">
                <ScrollArea className="h-48">
                  <div className="flex flex-col gap-1 p-1">
                    {TERMINAL_THEMES.map((theme) => (
                      <Button
                        key={theme}
                        type="button"
                        variant={settings.terminalTheme === theme ? "secondary" : "ghost"}
                        className="h-auto justify-start px-2 py-1.5"
                        onClick={() => update({ terminalTheme: theme })}
                      >
                        <ThemePreview theme={theme} />
                        <span className="truncate">{TERMINAL_THEME_LABELS[theme]}</span>
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </SettingRow>

            <Separator />

            <SettingRow label="Terminal Font">
              <div className="flex flex-col gap-1">
                {TERMINAL_FONTS.map((font) => (
                  <Button
                    key={font}
                    type="button"
                    variant={settings.terminalFont === font ? "secondary" : "ghost"}
                    className="justify-start"
                    style={{ fontFamily: TERMINAL_FONT_FAMILIES[font] }}
                    onClick={() => update({ terminalFont: font })}
                  >
                    {font}
                  </Button>
                ))}
              </div>
            </SettingRow>

            <Separator />

            <SettingRow label={`Font Size: ${fontSizeDraft}px`}>
              <Slider
                min={10}
                max={20}
                step={1}
                value={[fontSizeDraft]}
                onValueChange={(values) => setFontSizeDraft(values[0] ?? settings.terminalFontSize)}
                onValueCommit={(values) => commitFontSize(values[0])}
                aria-label="Terminal font size"
              />
            </SettingRow>
          </div>
        </ScrollArea>

        <Separator />

        <div className="mt-auto flex flex-col gap-2 p-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setFontSizeDraft(DEFAULT_SETTINGS.terminalFontSize);
              update(DEFAULT_SETTINGS);
            }}
          >
            Reset to defaults
          </Button>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </div>
    </>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function ThemePreview({ theme }: { theme: TerminalTheme }) {
  const colors = [XTERM_THEMES[theme].red, XTERM_THEMES[theme].green, XTERM_THEMES[theme].blue, XTERM_THEMES[theme].yellow];
  return (
    <span className="flex shrink-0 gap-0.5">
      {colors.map((color, i) => (
        <span key={i} className="size-2 rounded-full" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

// Simplified preview approximations — intentionally not derived from CANVAS_ATMOSPHERE_VARS
const ATMOSPHERE_PREVIEW_GRADIENTS: Record<CanvasAtmosphere, string> = {
  plain: "linear-gradient(180deg, var(--background) 0%, color-mix(in oklch, var(--background) 88%, black 12%) 100%)",
  studio: "radial-gradient(circle at 18% 20%, color-mix(in oklch, var(--primary) 28%, transparent) 0%, transparent 36%), radial-gradient(circle at 82% 16%, color-mix(in oklch, var(--accent) 36%, transparent) 0%, transparent 34%), linear-gradient(180deg, color-mix(in oklch, var(--background) 90%, var(--card)) 0%, color-mix(in oklch, var(--background) 82%, black 18%) 100%)",
  aurora: "radial-gradient(circle at 16% 18%, color-mix(in oklch, var(--primary) 36%, transparent) 0%, transparent 34%), radial-gradient(circle at 84% 16%, color-mix(in oklch, var(--sidebar-primary) 34%, transparent) 0%, transparent 32%), radial-gradient(circle at 58% 100%, color-mix(in oklch, var(--accent) 26%, transparent) 0%, transparent 48%), linear-gradient(180deg, color-mix(in oklch, var(--background) 82%, var(--card)) 0%, color-mix(in oklch, var(--background) 70%, black 30%) 100%)",
  mist: "radial-gradient(circle at 18% 18%, color-mix(in oklch, var(--accent) 28%, transparent) 0%, transparent 38%), radial-gradient(circle at 80% 20%, color-mix(in oklch, white 18%, transparent) 0%, transparent 34%), linear-gradient(180deg, color-mix(in oklch, var(--background) 94%, white 6%) 0%, color-mix(in oklch, var(--background) 86%, var(--card) 14%) 100%)",
  nocturne: "radial-gradient(circle at 18% 18%, color-mix(in oklch, var(--primary) 24%, transparent) 0%, transparent 34%), radial-gradient(circle at 82% 18%, color-mix(in oklch, var(--accent) 24%, transparent) 0%, transparent 30%), linear-gradient(180deg, color-mix(in oklch, var(--background) 84%, black 16%) 0%, color-mix(in oklch, var(--background) 60%, black 40%) 100%)",
};

function CanvasAtmospherePreview({ atmosphere }: { atmosphere: CanvasAtmosphere }) {
  return (
    <span
      className="relative block h-8 w-full overflow-hidden rounded-sm border"
      style={{ backgroundImage: ATMOSPHERE_PREVIEW_GRADIENTS[atmosphere] }}
      aria-hidden="true"
    >
      <span
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklch, var(--foreground) 18%, transparent) 0.75px, transparent 0.75px)",
          backgroundSize: "18px 18px",
        }}
      />
    </span>
  );
}
