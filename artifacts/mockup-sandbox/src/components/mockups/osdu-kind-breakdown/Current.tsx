import "./_group.css";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import {
  fetchAggregation,
  aggregationTotal,
  collapseBuckets,
  shortKind,
  type AggregationBucket,
} from "./aggregation-data";

interface DashboardAggregationsProps {
  // The current dashboard time-window Lucene query; the breakdown covers every
  // record matching it, across all pages.
  query: string | undefined;
  // Bumped by the parent's Refresh so the panel re-queries in step with the table.
  refreshKey?: number;
}

const TOP_N = 8;

// "Records by kind" breakdown for the dashboard, powered by an OSDU Search
// aggregation (aggregateBy: "kind"). Turns the dashboard from a bare result
// table into a real landing page with at-a-glance composition of the window.
export function Current({ query, refreshKey }: DashboardAggregationsProps) {
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
      .then((result) => { if (!cancelled) setBuckets(result); })
      .catch((err) => {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load the kind breakdown.");
        setBuckets(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [query, refreshKey, reloadTick]);

  const total = buckets ? aggregationTotal(buckets) : 0;
  const collapsed = buckets ? collapseBuckets(buckets, TOP_N) : null;
  const maxCount = collapsed && collapsed.top.length > 0
    ? Math.max(collapsed.top[0].count, collapsed.otherCount)
    : 0;

  return (
    <div className="dark min-h-screen bg-background p-4 text-foreground">
      <Card className="border-border/50" data-testid="dashboard-aggregations">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pt-3 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BarChart3 className="h-4 w-4 text-neon" />
          Records by kind
        </CardTitle>
        <div className="flex items-center gap-2">
          {buckets && !loading && !error && (
            <Badge variant="outline" className="text-xs" data-testid="agg-total">
              {total.toLocaleString()} records · {buckets.length} kinds
            </Badge>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={() => setReloadTick((t) => t + 1)}
            disabled={loading}
            aria-label="Refresh kind breakdown"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        {loading && !buckets && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading breakdown…
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-error-border/60 bg-error-surface p-3 text-sm text-error-text">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {!error && collapsed && collapsed.top.length === 0 && !loading && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No records in this window.
          </p>
        )}

        {!error && collapsed && collapsed.top.length > 0 && (
          <div className="space-y-1.5">
            {collapsed.top.map((bucket) => (
              <div key={bucket.key} className="flex items-center gap-2" data-testid="agg-bucket" title={bucket.key}>
                <span className="w-40 shrink-0 truncate font-mono text-xs">{shortKind(bucket.key)}</span>
                <div className="relative h-4 flex-1 rounded bg-muted/40">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-neon/30"
                    style={{ width: maxCount > 0 ? `${Math.max(2, (bucket.count / maxCount) * 100)}%` : "0%" }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">{bucket.count.toLocaleString()}</span>
              </div>
            ))}
            {collapsed.otherKinds > 0 && (
              <div className="flex items-center gap-2" data-testid="agg-other" title={`${collapsed.otherKinds} more kinds`}>
                <span className="w-40 shrink-0 truncate text-xs text-muted-foreground italic">
                  Other ({collapsed.otherKinds} kinds)
                </span>
                <div className="relative h-4 flex-1 rounded bg-muted/40">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-muted-foreground/30"
                    style={{ width: maxCount > 0 ? `${Math.max(2, (collapsed.otherCount / maxCount) * 100)}%` : "0%" }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
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
