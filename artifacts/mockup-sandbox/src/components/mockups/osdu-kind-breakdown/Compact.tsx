import "./_group.css";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, BarChart3, Loader2, RefreshCw } from "lucide-react";
import {
  aggregationTotal,
  collapseBuckets,
  fetchAggregation,
  shortKind,
  type AggregationBucket,
} from "./aggregation-data";

interface CompactProps {
  query?: string;
  refreshKey?: number;
}

const TOP_N = 36;

export function Compact({ query, refreshKey }: CompactProps) {
  const [buckets, setBuckets] = useState<AggregationBucket[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchAggregation("kind", query, controller.signal)
      .then((result) => {
        if (!cancelled) setBuckets(result);
      })
      .catch((err) => {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load the kind breakdown.");
        setBuckets(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [query, refreshKey, reloadTick]);

  const total = buckets ? aggregationTotal(buckets) : 0;
  const collapsed = buckets ? collapseBuckets(buckets, TOP_N) : null;
  const maxCount = collapsed && collapsed.top.length > 0
    ? Math.max(collapsed.top[0].count, collapsed.otherCount)
    : 0;

  const barWidth = (count: number) =>
    maxCount > 0 ? `${Math.max(8, (count / maxCount) * 100)}%` : "0%";

  return (
    <div className="dark min-h-screen bg-background p-4 text-foreground">
      <Card className="border-border/50" data-testid="dashboard-aggregations">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 py-1.5">
          <CardTitle className="flex items-center gap-1.5 text-xs">
            <BarChart3 className="h-3.5 w-3.5 text-neon" />
            Records by kind
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {buckets && !loading && !error && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]" data-testid="agg-total">
                {total.toLocaleString()} records · {buckets.length} kinds
              </Badge>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              onClick={() => setReloadTick((tick) => tick + 1)}
              disabled={loading}
              aria-label="Refresh kind breakdown"
              data-testid="button-refresh-kind-breakdown"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-2 pt-0">
          {loading && !buckets && (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading breakdown…
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-error-border/60 bg-error-surface p-2 text-xs text-error-text">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}

          {!error && collapsed && collapsed.top.length === 0 && !loading && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No records in this window.
            </p>
          )}

          {!error && collapsed && collapsed.top.length > 0 && (
            <div
              className="grid max-h-56 grid-cols-1 gap-x-5 gap-y-1 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="agg-grid"
            >
              {collapsed.top.map((bucket) => (
                <div
                  key={bucket.key}
                  className="flex min-w-0 items-center gap-1.5"
                  data-testid="agg-bucket"
                  title={bucket.key}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] leading-3">
                    {shortKind(bucket.key)}
                  </span>
                  <div className="relative h-1.5 w-8 shrink-0 overflow-hidden rounded-full bg-muted/50">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-neon/60"
                      style={{ width: barWidth(bucket.count) }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right font-mono text-[10px] leading-3 tabular-nums">
                    {bucket.count.toLocaleString()}
                  </span>
                </div>
              ))}

              {collapsed.otherKinds > 0 && (
                <div
                  className="flex min-w-0 items-center gap-1.5"
                  data-testid="agg-other"
                  title={`${collapsed.otherKinds} more kinds`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] leading-3 italic text-muted-foreground">
                    Other · {collapsed.otherKinds}
                  </span>
                  <div className="relative h-1.5 w-8 shrink-0 overflow-hidden rounded-full bg-muted/50">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/40"
                      style={{ width: barWidth(collapsed.otherCount) }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right font-mono text-[10px] leading-3 tabular-nums text-muted-foreground">
                    {collapsed.otherCount.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}