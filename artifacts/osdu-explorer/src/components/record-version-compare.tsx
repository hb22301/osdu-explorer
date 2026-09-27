import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, AlertCircle, ArrowRight, Plus, Minus, Pencil } from "lucide-react";
import { fetchStorageRecordVersion } from "@/lib/storage-version-fetch";
import {
  diffRecords,
  summarizeChanges,
  isSystemFieldChange,
  type FieldChange,
} from "@/lib/storage-version-diff";
import type { StorageVersion } from "@/lib/storage-version-history";
import { formatVersion } from "@/lib/storage-version-history";
import { cn } from "@/lib/utils";

interface RecordVersionCompareProps {
  recordId: string;
  versions: StorageVersion[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Render an arbitrary JSON value compactly, truncated so a large subtree can't
// blow out a diff row.
function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

const KIND_META = {
  added: { Icon: Plus, label: "added", cls: "text-emerald-500" },
  removed: { Icon: Minus, label: "removed", cls: "text-rose-500" },
  changed: { Icon: Pencil, label: "changed", cls: "text-amber-500" },
} as const;

function ChangeRow({ change }: { change: FieldChange }) {
  const { Icon, cls } = KIND_META[change.kind];
  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-border/40 last:border-0" data-testid="version-change-row">
      <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", cls)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs break-all">{change.path}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          {change.kind !== "added" && (
            <span className="font-mono rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 break-all">
              {formatValue(change.before)}
            </span>
          )}
          {change.kind === "changed" && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />}
          {change.kind !== "removed" && (
            <span className="font-mono rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 break-all">
              {formatValue(change.after)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Compares two versions of a Storage record and shows a field-by-field diff.
// Data-payload changes are surfaced first; system-field churn is grouped apart.
export function RecordVersionCompare({
  recordId,
  versions,
  open,
  onOpenChange,
}: RecordVersionCompareProps) {
  // Sensible default: previous vs latest (versions are sorted descending).
  const latest = versions[0]?.version;
  const previous = versions[1]?.version ?? versions[0]?.version;

  const [baseVersion, setBaseVersion] = useState<number | undefined>(previous);
  const [targetVersion, setTargetVersion] = useState<number | undefined>(latest);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<FieldChange[] | null>(null);

  // Re-seed the pickers whenever the dialog is (re)opened for a record.
  useEffect(() => {
    if (!open) return;
    setBaseVersion(versions[1]?.version ?? versions[0]?.version);
    setTargetVersion(versions[0]?.version);
    setChanges(null);
    setError(null);
  }, [open, recordId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || baseVersion === undefined || targetVersion === undefined) return;
    if (baseVersion === targetVersion) {
      setChanges([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [base, target] = await Promise.all([
          fetchStorageRecordVersion(recordId, baseVersion),
          fetchStorageRecordVersion(recordId, targetVersion),
        ]);
        if (cancelled) return;
        setChanges(diffRecords(base, target));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to compare versions.");
        setChanges(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, recordId, baseVersion, targetVersion]);

  const dataChanges = useMemo(() => (changes ?? []).filter((c) => !isSystemFieldChange(c)), [changes]);
  const systemChanges = useMemo(() => (changes ?? []).filter(isSystemFieldChange), [changes]);
  const summary = useMemo(() => summarizeChanges(changes ?? []), [changes]);
  const sameVersion = baseVersion === targetVersion;

  const renderPicker = (
    label: string,
    value: number | undefined,
    onChange: (v: number) => void,
    ariaLabel: string,
  ) => (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value?.toString()} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-8 w-36 text-xs" aria-label={ariaLabel}>
          <SelectValue placeholder="Select version" />
        </SelectTrigger>
        <SelectContent>
          {versions.map((v) => (
            <SelectItem key={v.version} value={v.version.toString()} className="text-xs font-mono">
              {formatVersion(v.version, v.isLatest)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compare versions</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">{recordId}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          {renderPicker("Base", baseVersion, setBaseVersion, "Select base version")}
          <ArrowRight className="h-4 w-4 mb-2 text-muted-foreground shrink-0" aria-hidden="true" />
          {renderPicker("Target", targetVersion, setTargetVersion, "Select target version")}
          {!loading && !error && changes !== null && !sameVersion && (
            <div className="mb-1 ml-auto flex flex-wrap items-center gap-1.5 text-xs" data-testid="version-diff-summary">
              <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400">{summary.added} added</Badge>
              <Badge variant="outline" className="text-rose-600 dark:text-rose-400">{summary.removed} removed</Badge>
              <Badge variant="outline" className="text-amber-600 dark:text-amber-400">{summary.changed} changed</Badge>
            </div>
          )}
        </div>

        <div className="min-h-[16rem]">
          {loading && (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Comparing versions…
            </div>
          )}

          {!loading && error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-error-border/60 bg-error-surface p-3 text-sm text-error-text">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}

          {!loading && !error && sameVersion && (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              Pick two different versions to compare.
            </div>
          )}

          {!loading && !error && !sameVersion && changes !== null && changes.length === 0 && (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground" data-testid="version-diff-identical">
              No differences between these versions.
            </div>
          )}

          {!loading && !error && !sameVersion && changes !== null && changes.length > 0 && (
            <ScrollArea className="h-[24rem] rounded-lg border border-border/50">
              {dataChanges.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/40 border-b border-border/50 sticky top-0">
                    Data changes ({dataChanges.length})
                  </div>
                  {dataChanges.map((c) => <ChangeRow key={c.path} change={c} />)}
                </div>
              )}
              {systemChanges.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/40 border-y border-border/50 sticky top-0">
                    System fields ({systemChanges.length})
                  </div>
                  {systemChanges.map((c) => <ChangeRow key={c.path} change={c} />)}
                </div>
              )}
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
