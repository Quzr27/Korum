import { useSettings } from "@/lib/settings-context";
import { ZOOM_SPEED_OPTIONS } from "@/lib/settings";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export default function ZoomSpeedControl() {
  const { settings, update } = useSettings();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="glass-subtle rounded-lg h-8 w-full flex items-center justify-center text-[11px] text-muted-foreground tabular-nums select-none font-medium cursor-pointer hover:text-foreground transition-colors"
          aria-label="Zoom speed"
        >
          {settings.zoomSpeed}x
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-auto">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Zoom speed
          </span>
          <div className="flex gap-1">
            {ZOOM_SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors",
                  s === settings.zoomSpeed
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
                )}
                onClick={() => update({ zoomSpeed: s })}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
