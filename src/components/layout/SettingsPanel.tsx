import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
const RADIUS_LABELS: Record<RadiusPreset, string> = {
  0.625: "Default",
  0: "None",
};

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
        aria-hidden={!open}
        data-slot="settings-panel"
        className={`app-settings-panel fixed right-3 z-50 flex w-3/4 max-w-sm flex-col rounded-xl border border-border bg-popover text-xs/relaxed text-popover-foreground shadow-[var(--app-panel-shadow)] transition-transform duration-300 ease-out ${open ? "pointer-events-auto translate-x-0" : "pointer-events-none translate-x-[calc(100%+0.75rem)]"}`}
      >
        <div className="flex flex-col px-4 pb-2 pt-4">
          <h2 className="font-heading text-sm font-medium text-foreground">
            Settings
          </h2>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 px-3.5 pb-3.5 pt-2">
            <SettingsSection title="General">
              <div className="grid grid-cols-2 gap-2">
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
                    className="w-full"
                  >
                    <ToggleGroupItem value="dark" aria-label="Dark" className="flex-1">
                      Dark
                    </ToggleGroupItem>
                    <ToggleGroupItem value="light" aria-label="Light" className="flex-1">
                      Light
                    </ToggleGroupItem>
                  </ToggleGroup>
                </SettingRow>

                <SettingRow label="Usage">
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
                    className="w-full"
                  >
                    <ToggleGroupItem value="on" aria-label="Show usage limits" className="flex-1">
                      On
                    </ToggleGroupItem>
                    <ToggleGroupItem value="off" aria-label="Hide usage limits" className="flex-1">
                      Off
                    </ToggleGroupItem>
                  </ToggleGroup>
                </SettingRow>
              </div>

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
                  spacing={2}
                  className="grid w-full grid-cols-2"
                >
                  {RADIUS_PRESETS.map((radius) => (
                    <ToggleGroupItem
                      key={radius}
                      value={String(radius)}
                      aria-label={RADIUS_LABELS[radius]}
                      className="h-8 justify-start gap-2 rounded-md border-border/80 px-2.5 data-[state=on]:border-foreground/70 data-[state=on]:bg-foreground/[0.045] dark:data-[state=on]:bg-accent/70"
                    >
                      <span
                        className="size-4 shrink-0 border-2 border-current"
                        style={{ borderRadius: radius === 0 ? "0px" : "7px" }}
                        aria-hidden="true"
                      />
                      <span>{RADIUS_LABELS[radius]}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </SettingRow>
            </SettingsSection>

            <SettingsSection title="Canvas">
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
                  className="w-full justify-between"
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
                        className="size-5 rounded-full ring-1 ring-black/10 dark:shadow-sm dark:shadow-black/25"
                        style={{ backgroundColor: BASE_COLOR_SWATCHES[color] }}
                      />
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </SettingRow>

              <SettingRow label="Surface">
                <div className="grid grid-cols-2 gap-2">
                  {CANVAS_ATMOSPHERES.map((atmosphere) => {
                    const isActive = settings.canvasAtmosphere === atmosphere;
                    return (
                      <button
                        key={atmosphere}
                        type="button"
                        className={`relative flex min-h-14 cursor-pointer flex-col items-start gap-1.5 rounded-md border px-2 py-2 text-left transition-all duration-200 ${isActive ? "border-foreground/45 bg-foreground/[0.045] dark:bg-accent/55" : "border-border/80 bg-background/20 hover:border-foreground/30 hover:bg-foreground/[0.035] dark:hover:bg-accent/25"}`}
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
            </SettingsSection>

            <SettingsSection title="Terminal">
              <SettingRow label="Theme">
                <div className="rounded-md border border-border/80 bg-background/15">
                  <ScrollArea className="h-44">
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

              <SettingRow label="Font">
                <div className="grid grid-cols-1 gap-1">
                  {TERMINAL_FONTS.map((font) => (
                    <Button
                      key={font}
                      type="button"
                      variant={settings.terminalFont === font ? "secondary" : "ghost"}
                      className="h-7 justify-start"
                      style={{ fontFamily: TERMINAL_FONT_FAMILIES[font] }}
                      onClick={() => update({ terminalFont: font })}
                    >
                      {font}
                    </Button>
                  ))}
                </div>
              </SettingRow>

              <SettingRow label={`Font Size: ${fontSizeDraft}px`}>
                <Slider
                  min={10}
                  max={30}
                  step={1}
                  value={[fontSizeDraft]}
                  onValueChange={(values) => setFontSizeDraft(values[0] ?? settings.terminalFontSize)}
                  onValueCommit={(values) => commitFontSize(values[0])}
                  aria-label="Terminal font size"
                />
              </SettingRow>
            </SettingsSection>
          </div>
        </ScrollArea>

        <Separator />

        <div className="mt-auto flex flex-col gap-2 p-3.5">
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

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border/70 bg-background/20 p-3 dark:shadow-inner dark:shadow-black/5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-3">
        {children}
      </div>
    </section>
  );
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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

const SURFACE_PREVIEW_STYLES: Record<CanvasAtmosphere, CSSProperties> = {
  workbench: {
    backgroundImage:
      "linear-gradient(180deg, color-mix(in oklch, var(--background) 88%, var(--card) 12%) 0%, color-mix(in oklch, var(--background) 78%, black 22%) 100%)",
  },
  blueprint: {
    backgroundImage:
      "linear-gradient(color-mix(in oklch, var(--foreground) 14%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklch, var(--foreground) 14%, transparent) 1px, transparent 1px), linear-gradient(color-mix(in oklch, var(--sidebar-primary) 12%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklch, var(--sidebar-primary) 12%, transparent) 1px, transparent 1px), linear-gradient(180deg, color-mix(in oklch, var(--background) 84%, var(--card) 16%) 0%, color-mix(in oklch, var(--background) 76%, black 24%) 100%)",
    backgroundSize: "18px 18px, 18px 18px, 9px 9px, 9px 9px, auto",
  },
  draft: {
    backgroundImage:
      "radial-gradient(circle, color-mix(in oklch, var(--foreground) 14%, transparent) 0 0.85px, transparent 1px), radial-gradient(circle, color-mix(in oklch, var(--sidebar-primary) 12%, transparent) 0 0.75px, transparent 1px), linear-gradient(180deg, color-mix(in oklch, var(--background) 86%, var(--card) 14%) 0%, color-mix(in oklch, var(--background) 82%, black 18%) 100%)",
    backgroundPosition: "0 0, 14px 14px, 0 0",
    backgroundSize: "28px 28px, 28px 28px, auto",
  },
  signal: {
    backgroundImage:
      "radial-gradient(circle, color-mix(in oklch, var(--foreground) 12%, transparent) 0 0.8px, transparent 1px), linear-gradient(color-mix(in oklch, var(--sidebar-primary) 14%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklch, var(--sidebar-primary) 14%, transparent) 1px, transparent 1px), linear-gradient(180deg, color-mix(in oklch, var(--background) 78%, black 22%) 0%, color-mix(in oklch, var(--background) 66%, black 34%) 100%)",
    backgroundSize: "14px 14px, 56px 56px, 56px 56px, auto",
  },
};

function CanvasAtmospherePreview({ atmosphere }: { atmosphere: CanvasAtmosphere }) {
  return (
    <span
      className="relative block h-8 w-full overflow-hidden rounded-sm border"
      style={SURFACE_PREVIEW_STYLES[atmosphere]}
      aria-hidden="true"
    >
      <span
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklch, var(--foreground) 14%, transparent) 0.75px, transparent 0.75px)",
          backgroundSize: "18px 18px",
          opacity: 0.22,
        }}
      />
    </span>
  );
}
