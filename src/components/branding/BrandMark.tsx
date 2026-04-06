import { cn } from "@/lib/utils";

type BrandMarkSize = "sm" | "md" | "lg";

interface BrandMarkProps {
  size?: BrandMarkSize;
  animated?: boolean;
  className?: string;
}

const SIZE_PX: Record<BrandMarkSize, number> = {
  sm: 18,
  md: 30,
  lg: 62,
};

const BG_OUTER = "#0a0a0f";
const BG_INNER = "#0d0d14";
const GLYPH_FILL = "#e8e8f0";

/** JetBrains Mono 700 "K" outlined via fonttools — no font dependency */
const K_PATH = "M62.81 122V57.76H73.81V83.72H81.46L93.52 57.76H105.49L91.14 88.56L106.19 122H93.96L81.29 93.75H73.81V122Z";

export default function BrandMark({
  size = "md",
  animated = false,
  className,
}: BrandMarkProps) {
  const px = SIZE_PX[size];
  const showCursor = size !== "sm";

  return (
    <div
      className={cn(
        "brand-mark",
        `brand-mark-${size}`,
        className,
      )}
      aria-hidden="true"
    >
      <svg
        className="brand-mark-image"
        width={px}
        height={px}
        viewBox="0 0 200 200"
        fill="none"
      >
        <rect width="200" height="200" rx="44" fill={BG_OUTER} />
        <rect x="22" y="22" width="156" height="156" rx="30" fill={BG_INNER} />

        <g transform="translate(0 10)">
          <path d={K_PATH} transform="translate(3 0)" fill={GLYPH_FILL} />
          {showCursor && (
            <rect
              x="112"
              y="119"
              width="28"
              height="3.5"
              rx="1"
              fill={GLYPH_FILL}
              className={animated ? "brand-mark-cursor" : undefined}
            />
          )}
        </g>
      </svg>
    </div>
  );
}
