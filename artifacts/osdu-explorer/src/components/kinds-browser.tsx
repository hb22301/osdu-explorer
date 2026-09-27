import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { listOsduKinds, searchOsduRecords, useGetOsduSchema } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, ArrowUp, ArrowDown, ChevronsUpDown, FileJson2, FilePlus2, Hash, AlertCircle, RefreshCw, Filter, X } from "lucide-react";
import { JsonViewerToolbar } from "@/components/json-viewer-toolbar";
import { buildNewRecordTemplate } from "@/lib/storage-record-new";
import { createStorageRecords } from "@/lib/storage-record-clone";
import { cn } from "@/lib/utils";

// How many kinds to request per page while looping the Storage query/kinds cursor,
// and a safety cap so a runaway cursor can never loop forever.
const KINDS_PAGE_SIZE = 200;
const MAX_KIND_PAGES = 50;
// Concurrency for the optional "load record counts" fan-out across kinds.
const COUNT_CONCURRENCY = 5;

type SortCol = "kind" | "authority" | "source" | "entity" | "version" | "records";
type SortDir = "asc" | "desc";
type CountState = number | "loading" | "error" | undefined;

interface KindRow {
  kind: string;
  authority: string;
  source: string;
  entity: string;
  version: string;
}

// A kind is authority:source:entity:version. Split defensively so malformed
// kinds still render rather than throwing.
function parseKind(kind: string): KindRow {
  const parts = kind.split(":");
  return {
    kind,
    authority: parts[0] ?? "—",
    source:    parts[1] ?? "—",
    entity:    parts[2] ?? "—",
    version:   parts[3] ?? "—",
  };
}

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol | null; sortDir: SortDir }) {
  if (sortCol !== col) return <ChevronsUpDown className="ml-1 h-3 w-3 opacity-40 inline" />;
  return sortDir === "asc"
    ? <ArrowUp className="ml-1 h-3 w-3 inline" />
    : <ArrowDown className="ml-1 h-3 w-3 inline" />;
}

const HEADERS: { key: SortCol; label: string; className?: string }[] = [
  { key: "kind",      label: "Kind" },
  { key: "authority", label: "Authority" },
  { key: "source",    label: "Source" },
  { key: "entity",    label: "Entity" },
  { key: "version",   label: "Version" },
  { key: "records",   label: "Records", className: "text-right" },
];

// Create a new Storage record of a chosen kind. Fetches the kind's schema to
// seed the editor with a best-effort field skeleton (falling back to the bare
// {kind, acl, legal, data:{}} envelope when no schema is registered), then PUTs
// an id-less record so OSDU creates it fresh.
function NewRecordDialog({ kind, onClose }: { kind: string; onClose: () => void }) {
  const { data: schema, isFetching, isError } = useGetOsduSchema(
    encodeURIComponent(kind),
    { query: { enabled: true, retry: false, queryKey: ["osduSchema", kind] } },
  );

  const [draft, setDraft] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdIds, setCreatedIds] = useState<string[] | null>(null);

  // Seed the draft once the schema resolves (data or error → bare fallback).
  useEffect(() => {
    if (draft !== null || isFetching) return;
    setDraft(buildNewRecordTemplate(kind, isError ? undefined : schema));
  }, [draft, isFetching, isError, schema, kind]);

  const handleChange = (value: string) => {
    setDraft(value);
    if (value.trim() === "") {
      setParseError("JSON is empty");
      return;
    }
    try {
      JSON.parse(value);
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  const create = async () => {
    if (draft === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    const records = Array.isArray(parsed) ? parsed : [parsed];
    setSaving(true);
    setSaveError(null);
    const result = await createStorageRecords(records, setStep);
    setSaving(false);
    setStep(null);
    if (result.ok) setCreatedIds(result.recordIds);
    else setSaveError(result.error);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-3xl flex flex-col max-h-[85vh]" data-testid="new-record-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="h-4 w-4 text-neon" />
            New record
          </DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">{kind}</DialogDescription>
        </DialogHeader>

        {draft === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing template…
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col gap-2">
            {!isError && (
              <p className="shrink-0 text-xs text-muted-foreground">
                Fill in <span className="font-mono">acl</span>, <span className="font-mono">legal</span>, and the{" "}
                <span className="font-mono">data</span> fields. Fields behind schema references aren't scaffolded — add them as needed.
              </p>
            )}
            {isError && (
              <p className="shrink-0 text-xs text-muted-foreground">
                No registered schema for this kind — starting from the bare record envelope.
              </p>
            )}
            <Textarea
              value={draft}
              onChange={(e) => handleChange(e.target.value)}
              spellCheck={false}
              className="flex-1 min-h-[280px] resize-none font-mono text-xs"
              aria-label="New record JSON editor"
              data-testid="new-record-editor"
              disabled={createdIds !== null}
            />
            {parseError ? (
              <div role="alert" className="shrink-0 rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text">
                Invalid JSON: {parseError}
              </div>
            ) : (
              <div className="shrink-0 text-xs text-emerald-500">Valid JSON</div>
            )}
            {saveError && (
              <div role="alert" className="shrink-0 rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text break-all">
                {saveError}
              </div>
            )}
            {createdIds && (
              <div
                role="status"
                data-testid="new-record-success"
                className="shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 break-all"
              >
                {createdIds.length > 0
                  ? `Created new record: ${createdIds.join(", ")}`
                  : "New record created."}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {saving && step && (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {step}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {createdIds ? "Close" : "Cancel"}
          </Button>
          {!createdIds && (
            <Button
              size="sm"
              onClick={() => { void create(); }}
              disabled={draft === null || saving || parseError !== null}
              data-testid="button-create-new-record"
            >
              {saving ? "Creating…" : "Create record"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Browse the kinds that actually have records in the partition (Storage
// query/kinds), with optional record counts and a jump to each kind's schema.
export function KindsBrowser() {
  const [allKinds, setAllKinds]   = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const [filter, setFilter]   = useState("");
  const hasFilter = filter.trim().length > 0;
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [counts, setCounts] = useState<Record<string, CountState>>({});
  const [countProgress, setCountProgress] = useState<{ done: number; total: number } | null>(null);

  const [viewingKind, setViewingKind] = useState<string | null>(null);
  const [creatingKind, setCreatingKind] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const activeLoad = useRef(0);

  // ── Load kinds (loop the cursor to get the full set) ─────────────────
  useEffect(() => {
    const loadId = ++activeLoad.current;
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setTruncated(false);

    (async () => {
      const collected: string[] = [];
      let cursor: string | undefined;
      try {
        for (let page = 0; page < MAX_KIND_PAGES; page++) {
          const res = await listOsduKinds({ limit: KINDS_PAGE_SIZE, ...(cursor ? { cursor } : {}) });
          if (cancelled || loadId !== activeLoad.current) return;
          collected.push(...(res.kinds ?? []));
          cursor = res.cursor ?? undefined;
          if (!cursor) break;
          if (page === MAX_KIND_PAGES - 1 && cursor) setTruncated(true);
        }
        if (cancelled || loadId !== activeLoad.current) return;
        // Distinct + stable order.
        setAllKinds([...new Set(collected)].sort((a, b) => a.localeCompare(b)));
      } catch (err) {
        if (cancelled || loadId !== activeLoad.current) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load kinds.");
      } finally {
        if (!cancelled && loadId === activeLoad.current) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [reloadToken]);

  const handleSortClick = (col: SortCol) => {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const parsed = allKinds
      .map(parseKind)
      .filter((r) => {
        if (!needle) return true;

        const count = counts[r.kind];
        const countText = typeof count === "number"
          ? `${count} ${count.toLocaleString()}`
          : count === "error"
            ? "error retry"
            : count === "loading"
              ? "loading"
              : "";

        return [r.kind, r.authority, r.source, r.entity, r.version, countText]
          .some((value) => value.toLowerCase().includes(needle));
      });

    if (!sortCol) return parsed;
    return [...parsed].sort((a, b) => {
      let cmp: number;
      if (sortCol === "records") {
        const av = typeof counts[a.kind] === "number" ? (counts[a.kind] as number) : -1;
        const bv = typeof counts[b.kind] === "number" ? (counts[b.kind] as number) : -1;
        cmp = av - bv;
      } else {
        cmp = a[sortCol] < b[sortCol] ? -1 : a[sortCol] > b[sortCol] ? 1 : 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [allKinds, filter, sortCol, sortDir, counts]);

  // ── Record counts (Search Service, limit:0 → totalCount) ─────────────
  const fetchCount = useCallback(async (kind: string) => {
    setCounts((prev) => ({ ...prev, [kind]: "loading" }));
    try {
      const res = await searchOsduRecords({ kind, limit: 0, trackTotalCount: true });
      setCounts((prev) => ({ ...prev, [kind]: res.totalCount ?? 0 }));
    } catch {
      setCounts((prev) => ({ ...prev, [kind]: "error" }));
    }
  }, []);

  // Fetch counts for every currently-visible kind that has none yet, bounded
  // by a small concurrency pool so we never storm the Search Service.
  const loadVisibleCounts = useCallback(async () => {
    const targets = rows.map((r) => r.kind).filter((k) => counts[k] === undefined);
    if (targets.length === 0) return;
    setCountProgress({ done: 0, total: targets.length });
    let index = 0;
    let done = 0;
    const worker = async () => {
      while (index < targets.length) {
        const kind = targets[index++];
        await fetchCount(kind);
        done++;
        setCountProgress({ done, total: targets.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(COUNT_CONCURRENCY, targets.length) }, worker));
    setCountProgress(null);
  }, [rows, counts, fetchCount]);

  // ── Schema view ──────────────────────────────────────────────────────
  const { data: schemaDetails, isError: schemaError, isFetching: schemaFetching } = useGetOsduSchema(
    encodeURIComponent(viewingKind ?? ""),
    { query: { enabled: !!viewingKind, retry: false, queryKey: ["osduSchema", viewingKind] } },
  );

  const renderCount = (kind: string) => {
    const state = counts[kind];
    if (state === "loading") return <Loader2 className="h-3.5 w-3.5 animate-spin inline" />;
    if (state === "error") {
      return (
        <button
          className="text-xs text-error-text hover:underline"
          onClick={(e) => { e.stopPropagation(); void fetchCount(kind); }}
          aria-label={`Retry record count for ${kind}`}
        >
          error — retry
        </button>
      );
    }
    if (typeof state === "number") return <span className="font-mono tabular-nums">{state.toLocaleString()}</span>;
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-xs text-muted-foreground"
        onClick={(e) => { e.stopPropagation(); void fetchCount(kind); }}
        aria-label={`Load record count for ${kind}`}
      >
        <Hash className="h-3 w-3 mr-1" />
        count
      </Button>
    );
  };

  return (
    <>
      {loadError && (
        <Card className="border-error-border/60 bg-error-surface">
          <CardContent className="pt-6">
            <p className="text-sm text-error-text font-medium">Failed to load kinds</p>
            <p className="text-xs text-error-text/85 mt-1 font-mono break-all">{loadError}</p>
          </CardContent>
        </Card>
      )}

      {viewingKind && schemaError && !schemaFetching && (
        <Card className="border-error-border/60 bg-error-surface">
          <CardContent className="pt-6 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-error-text" />
            <p className="text-sm text-error-text break-all">
              No registered schema for <span className="font-mono">{viewingKind}</span>.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle>Kinds in partition</CardTitle>
          <CardDescription>
            {isLoading
              ? "Loading…"
              : allKinds.length > 0
                ? `${hasFilter ? `Showing ${rows.length.toLocaleString()} of ` : ""}${hasFilter ? allKinds.length.toLocaleString() : rows.length.toLocaleString()} kinds — click a header to sort, "count" for record totals${truncated ? ` (showing first ${allKinds.length.toLocaleString()}; more exist)` : ""}`
                : "No kinds found in this partition"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="px-3 py-1.5 border-t border-border flex flex-wrap items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                <Input
                  placeholder="Filter by kind, authority, source, entity, version, or records…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="Search all table fields"
                  className="h-7 min-w-[12rem] flex-1 text-xs py-0 border-0 shadow-none focus-visible:ring-0 bg-transparent placeholder:text-muted-foreground/60"
                />
                {hasFilter && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setFilter("")}
                    title="Clear filter"
                    aria-label="Clear kinds filter"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  onClick={() => void loadVisibleCounts()}
                  disabled={isLoading || rows.length === 0 || countProgress !== null}
                  aria-label="Load record counts"
                >
                  {countProgress
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="ml-1.5">Counting… {countProgress.done}/{countProgress.total}</span></>
                    : <><Hash className="h-3.5 w-3.5" /><span className="ml-1.5">Load counts</span></>}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setReloadToken((t) => t + 1)}
                      disabled={isLoading}
                      aria-label="Reload kinds"
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reload kinds</TooltipContent>
                </Tooltip>
              </div>
              <div className="overflow-x-auto">
                <Table>
                <TableHeader>
                  <TableRow>
                    {HEADERS.map((h) => (
                      <TableHead
                        key={h.key}
                        className={cn("select-none whitespace-nowrap cursor-pointer", h.className)}
                        onClick={() => handleSortClick(h.key)}
                      >
                        {h.label}
                        <SortIcon col={h.key} sortCol={sortCol} sortDir={sortDir} />
                      </TableHead>
                    ))}
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={HEADERS.length + 1} className="text-center py-8 text-muted-foreground">
                        {hasFilter ? "No rows match the current filters" : "No kinds found"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TableRow key={row.kind} className="hover:bg-muted/40" data-testid="kind-row">
                        <TableCell className="font-mono text-xs break-all" title={row.kind}>{row.kind}</TableCell>
                        <TableCell className="truncate">{row.authority}</TableCell>
                        <TableCell className="truncate">{row.source}</TableCell>
                        <TableCell className="truncate">
                          <Badge variant="outline" className="text-xs font-mono">{row.entity}</Badge>
                        </TableCell>
                        <TableCell className="font-mono tabular-nums truncate">{row.version}</TableCell>
                        <TableCell className="text-right">{renderCount(row.kind)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => setCreatingKind(row.kind)}
                                  aria-label={`Create a new record of ${row.kind}`}
                                  data-testid="button-new-record"
                                >
                                  <FilePlus2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>New record of this kind</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => setViewingKind(row.kind)}
                                  aria-label={`View schema for ${row.kind}`}
                                >
                                  <FileJson2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View schema</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Fullscreen schema viewer (only once the schema has loaded) */}
      {viewingKind !== null && schemaDetails && (
        <JsonViewerToolbar
          json={JSON.stringify(schemaDetails, null, 2)}
          storageKey={viewingKind}
          title={viewingKind}
          defaultFullscreen
          onFullscreenClose={() => setViewingKind(null)}
        />
      )}

      {/* Create a new record of a kind, seeded from its schema. */}
      {creatingKind !== null && (
        <NewRecordDialog kind={creatingKind} onClose={() => setCreatingKind(null)} />
      )}
    </>
  );
}
