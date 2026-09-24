import { useMemo } from "react";
import { colormapGradientCss, type ColormapName } from "@/lib/colormap";

interface Grid2dColormapLegendProps {
  name: ColormapName;
  domain: [number, number];
  label?: string;
  units?: string;
}

function formatTick(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-2 || abs >= 1e6)) return v.toExponential(2);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function Grid2dColormapLegend({
  name,
  domain,
  label = "Elevation",
  units,
}: Grid2dColormapLegendProps) {
  const [vmin, vmax] = domain;
  const gradient = useMemo(() => colormapGradientCss(name, "to top"), [name]);
  const mid = (vmin + vmax) / 2;
  const unitSuffix = units ? ` (${units})` : "";

  return (
    <div className="flex flex-col items-start gap-1.5 rounded-md border border-border/40 bg-background/80 px-2 py-2 backdrop-blur-sm">
      <div className="text-[11px] font-medium text-foreground/80">
        {label}
        {unitSuffix}
      </div>
      <div className="flex items-stretch gap-2">
        <div
          className="w-3 rounded-sm border border-border/40"
          style={{ height: 140, background: gradient }}
          aria-hidden
        />
        <div className="flex flex-col justify-between text-[10px] tabular-nums text-muted-foreground" style={{ height: 140 }}>
          <span>{formatTick(vmax)}</span>
          <span>{formatTick(mid)}</span>
          <span>{formatTick(vmin)}</span>
        </div>
      </div>
    </div>
  );
}