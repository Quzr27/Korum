import BrandMark from "@/components/branding/BrandMark";
import { Button } from "@/components/ui/button";

interface EmptyCanvasStateProps {
  onCreateWorkspace: () => void;
}

export default function EmptyCanvasState({ onCreateWorkspace }: EmptyCanvasStateProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-6">
      <div
        className="es-stage pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[620px] max-w-[78vw] -translate-x-1/2 -translate-y-1/2 overflow-visible sm:max-w-[68vw]"
        aria-hidden="true"
      >
        <div className="es-pulse-ring es-pulse-ring-1" />
        <div className="es-pulse-ring es-pulse-ring-2" />
        <div className="es-pulse-ring es-pulse-ring-3" />
        <div className="es-sweep-ring" />
        <div className="es-tracer es-tracer-1" />
        <div className="es-tracer es-tracer-2" />

        <svg className="size-full overflow-visible" viewBox="0 0 620 620" fill="none">
          <circle cx="310" cy="310" r="84" className="es-arc es-arc-1" pathLength="1" />
          <circle cx="310" cy="310" r="132" className="es-arc es-arc-2" pathLength="1" />
          <circle cx="310" cy="310" r="186" className="es-arc es-arc-3" pathLength="1" />
          <circle cx="310" cy="310" r="244" className="es-arc es-arc-4" pathLength="1" />

          <path d="M154 310H466" className="es-guide" />
          <path d="M310 154V466" className="es-guide" />

          <path d="M228 254C254 230 289 216 325 216" className="es-constellation es-constellation-1" />
          <path d="M350 390C385 384 415 365 436 336" className="es-constellation es-constellation-2" />

          <circle cx="228" cy="254" r="2.25" className="es-node es-node-1" />
          <circle cx="325" cy="216" r="2.25" className="es-node es-node-2" />
          <circle cx="350" cy="390" r="2.25" className="es-node es-node-3" />
          <circle cx="436" cy="336" r="2.25" className="es-node es-node-4" />
        </svg>
      </div>

      <div className="relative isolate flex w-full max-w-[390px] flex-col items-center gap-6 text-center">
        <BrandMark size="lg" animated className="es-rise es-brand-shell" />

        <div className="es-rise es-rise-1 flex flex-col gap-1.5">
          <p className="text-[13px] font-bold tracking-tight text-foreground">
            All your terminals. One canvas.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Create a workspace to get started.
          </p>
        </div>

        <Button
          type="button"
          onClick={onCreateWorkspace}
          className="es-rise es-rise-2 es-cta-shimmer gap-2 rounded-full px-3.5"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M8 3v10M3 8h10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          New workspace
        </Button>
      </div>
    </div>
  );
}
