import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useListOsduSchemas, useGetOsduSchema } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Search, ChevronLeft, ChevronRight, Loader2, ArrowUp, ArrowDown, ChevronsUpDown, GripVertical, Columns3 } from "lucide-react";
import { JsonViewerToolbar } from "@/components/json-viewer-toolbar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type SortDir = "asc" | "desc";
type ColKey = "id" | "status" | "scope" | "dateCreated" | "createdBy" | "dateUpdated";

interface Col {
  key: ColKey;
  label: string;
  defaultWidth: number;
  minWidth: number;
}

const COLUMNS: Col[] = [
  { key: "id",          label: "ID",           defaultWidth: 400, minWidth: 100 },
  { key: "status",      label: "Status",       defaultWidth: 120, minWidth: 70  },
  { key: "scope",       label: "Scope",        defaultWidth: 110, minWidth: 60  },
  { key: "dateCreated", label: "Created",      defaultWidth: 160, minWidth: 80  },
  { key: "createdBy",   label: "Created By",   defaultWidth: 180, minWidth: 80  },
  { key: "dateUpdated", label: "Updated",      defaultWidth: 160, minWidth: 80  },
];

const MAX_COL_WIDTH = 800;
const COL_WIDTHS_KEY  = "osdu-schemas:col-widths";
const COL_ORDER_KEY   = "osdu-schemas:col-order";
const COL_VISIBLE_KEY = "osdu-schemas:col-visible";

function clampWidth(col: Col, v: number) {
  return Math.min(MAX_COL_WIDTH, Math.max(col.minWidth, v));
}

function loadColWidths(): Record<ColKey, number> {
  const defaults = Object.fromEntries(COLUMNS.map((c) => [c.key, c.defaultWidth])) as Record<ColKey, number>;
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<ColKey, number>>;
    for (const c of COLUMNS) {
      const v = parsed[c.key];
      if (typeof v === "number" && Number.isFinite(v)) defaults[c.key] = clampWidth(c, v);
    }
  } catch { /* ignore */ }
  return defaults;
}

function loadColOrder(): ColKey[] {
  const defaults = COLUMNS.map((c) => c.key);
  try {
    const raw = localStorage.getItem(COL_ORDER_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as ColKey[];
    if (Array.isArray(parsed) && parsed.length === defaults.length && defaults.every((k) => parsed.includes(k))) return parsed;
  } catch { /* ignore */ }
  return defaults;
}

function loadColVisible(): Record<ColKey, boolean> {
  const all = Object.fromEntries(COLUMNS.map((c) => [c.key, true])) as Record<ColKey, boolean>;
  try {
    const raw = localStorage.getItem(COL_VISIBLE_KEY);
    if (!raw) return all;
    const parsed = JSON.parse(raw) as Partial<Record<ColKey, boolean>>;
    for (const c of COLUMNS) {
      if (typeof parsed[c.key] === "boolean") all[c.key] = parsed[c.key]!;
    }
    if (COLUMNS.every((c) => !all[c.key])) return Object.fromEntries(COLUMNS.map((c) => [c.key, true])) as Record<ColKey, boolean>;
  } catch { /* ignore */ }
  return all;
}

const CELL_CLASS: Record<ColKey, string> = {
  id:          "font-mono truncate",
  status:      "truncate",
  scope:       "truncate",
  dateCreated: "font-mono tabular-nums truncate",
  createdBy:   "truncate",
  dateUpdated: "font-mono tabular-nums truncate",
};

const CELL_HAS_TITLE = new Set<ColKey>(["id", "createdBy"]);

function fmtDate(val: string | null | undefined): string {
  if (!val) return "—";
  try { return format(new Date(val), "yyyy-MM-dd HH:mm"); } catch { return val; }
}

function SortIcon({ col, sortCol, sortDir }: { col: ColKey; sortCol: ColKey | null; sortDir: SortDir }) {
  if (sortCol !== col) return <ChevronsUpDown className="ml-1 h-3 w-3 opacity-40 inline" />;
  return sortDir === "asc"
    ? <ArrowUp className="ml-1 h-3 w-3 inline" />
    : <ArrowDown className="ml-1 h-3 w-3 inline" />;
}

interface FlatRow {
  id: string;
  status: string;
  scope: string;
  dateCreated: string;
  createdBy: string;
  dateUpdated: string;
}

export default function SchemasPage() {
  const [authority, setAuthority]   = useState("");
  const [source, setSource]         = useState("");
  const [entityType, setEntityType] = useState("");
  const [params, setParams] = useState({ authority: "", source: "", entityType: "" });
  const [offset, setOffset] = useState(0);
  const [limit, setLimit]   = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("osdu-schemas:page-size"));
      return [25, 50, 100, 250, 500, 1000, 2000].includes(v) ? v : 100;
    } catch { return 100; }
  });

  const [sortCol, setSortCol] = useState<ColKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewingId, setViewingId]   = useState<string | null>(null);

  const [colWidths,  setColWidths]  = useState<Record<ColKey, number>>(loadColWidths);
  const [colOrder,   setColOrder]   = useState<ColKey[]>(loadColOrder);
  const [colVisible, setColVisible] = useState<Record<ColKey, boolean>>(loadColVisible);
  const [dragOverCol, setDragOverCol] = useState<ColKey | null>(null);
  const resizing      = useRef<{ key: ColKey; startX: number; startW: number } | null>(null);
  const dragColRef    = useRef<ColKey | null>(null);
  const endResizeRef  = useRef<(() => void) | null>(null);

  const { data: schemasData, isLoading, isError, error } = useListOsduSchemas({
    authority:  params.authority  || undefined,
    source:     params.source     || undefined,
    entityType: params.entityType || undefined,
    limit,
    offset,
  });

  const { data: schemaDetails } = useGetOsduSchema(
    encodeURIComponent(viewingId ?? ""),
    { query: { enabled: !!viewingId, queryKey: ["osduSchema", viewingId] } }
  );

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    setParams({ authority, source, entityType });
  };

  // ── Column persistence ────────────────────────────────────────────
  const persistColWidths = useCallback((w: Record<ColKey, number>) => {
    try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(w)); } catch { /* ignore */ }
  }, []);
  const persistColOrder = useCallback((o: ColKey[]) => {
    try { localStorage.setItem(COL_ORDER_KEY, JSON.stringify(o)); } catch { /* ignore */ }
  }, []);

  // ── Column resize ─────────────────────────────────────────────────
  const startResize = useCallback((e: React.MouseEvent, col: Col) => {
    e.preventDefault(); e.stopPropagation();
    endResizeRef.current?.();
    resizing.current = { key: col.key, startX: e.clientX, startW: colWidths[col.key] };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const r = resizing.current; if (!r) return;
      const next = clampWidth(col, r.startW + (ev.clientX - r.startX));
      setColWidths((prev) => prev[r.key] === next ? prev : { ...prev, [r.key]: next });
    };
    const end = (persist: boolean) => {
      resizing.current = null; endResizeRef.current = null;
      document.body.style.cursor = ""; document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onBlur);
      if (persist) setColWidths((prev) => { persistColWidths(prev); return prev; });
    };
    const onUp = () => end(true);
    const onBlur = () => end(true);
    endResizeRef.current = () => end(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onBlur);
  }, [colWidths, persistColWidths]);

  useEffect(() => () => { endResizeRef.current?.(); }, []);

  const resetColWidth = useCallback((col: Col) => {
    setColWidths((prev) => { const next = { ...prev, [col.key]: col.defaultWidth }; persistColWidths(next); return next; });
  }, [persistColWidths]);

  // ── Column reorder ────────────────────────────────────────────────
  const handleColDragStart = useCallback((e: React.DragEvent, key: ColKey) => {
    dragColRef.current = key; e.dataTransfer.effectAllowed = "move";
  }, []);
  const handleColDragOver = useCallback((e: React.DragEvent, key: ColKey) => {
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    if (dragColRef.current && dragColRef.current !== key) setDragOverCol(key);
  }, []);
  const handleColDrop = useCallback((e: React.DragEvent, targetKey: ColKey) => {
    e.preventDefault();
    const src = dragColRef.current;
    if (!src || src === targetKey) { setDragOverCol(null); return; }
    setColOrder((prev) => {
      const next = [...prev];
      next.splice(next.indexOf(src), 1);
      next.splice(next.indexOf(targetKey), 0, src);
      persistColOrder(next);
      return next;
    });
    setDragOverCol(null); dragColRef.current = null;
  }, [persistColOrder]);
  const handleColDragEnd = useCallback(() => {
    setDragOverCol(null); dragColRef.current = null;
  }, []);

  // ── Column visibility ─────────────────────────────────────────────
  const toggleColVisible = useCallback((key: ColKey) => {
    setColVisible((prev) => {
      if (prev[key] && Object.values(prev).filter(Boolean).length <= 1) return prev;
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(COL_VISIBLE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const showAllCols = useCallback(() => {
    const next = Object.fromEntries(COLUMNS.map((c) => [c.key, true])) as Record<ColKey, boolean>;
    setColVisible(next);
    try { localStorage.setItem(COL_VISIBLE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  // ── Sort ──────────────────────────────────────────────────────────
  const handleSortClick = (col: ColKey) => {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  // ── Rows ──────────────────────────────────────────────────────────
  const rows: FlatRow[] = useMemo(() => {
    const flat = (schemasData?.schemaInfos ?? []).map((s) => ({
      id:          s.kind        ?? "—",
      status:      s.status      ?? "—",
      scope:       s.scope       ?? "—",
      dateCreated: fmtDate(s.dateCreated),
      createdBy:   s.createdBy   ?? "—",
      dateUpdated: fmtDate(s.dateUpdated),
    }));
    if (!sortCol) return flat;
    return [...flat].sort((a, b) => {
      const av = a[sortCol] ?? ""; const bv = b[sortCol] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [schemasData?.schemaInfos, sortCol, sortDir]);

  const orderedCols = useMemo(
    () => colOrder.filter((k) => colVisible[k]).map((k) => COLUMNS.find((c) => c.key === k)!),
    [colOrder, colVisible],
  );
  const visibleCount = useMemo(() => Object.values(colVisible).filter(Boolean).length, [colVisible]);

  const total    = schemasData?.totalCount ?? 0;
  const pageEnd  = Math.min(offset + (schemasData?.count ?? 0), total);
  const pageStart = total > 0 ? offset + 1 : 0;

  return (
    <div className="p-8 max-w-full mx-auto space-y-6 isolate">
      {/* Header */}
      <div className="space-y-2">
        <h1
          className="text-3xl font-bold tracking-tight text-neon"
          style={{ textShadow: "0 0 24px hsl(180 100% 55% / 0.45), 0 0 8px hsl(180 100% 55% / 0.25)" }}
        >
          Schema Browser
        </h1>
        <p className="text-muted-foreground pl-3" style={{ borderLeft: "2px solid hsl(180 100% 55% / 0.5)" }}>
          Browse and inspect OSDU data schemas.
        </p>
      </div>

      {/* Filter form */}
      <div className="glass-card p-6">
        <form onSubmit={handleFilter} className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium leading-none">Authority</label>
            <Input placeholder="e.g. osdu" value={authority} onChange={(e) => setAuthority(e.target.value)} />
          </div>
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium leading-none">Source</label>
            <Input placeholder="e.g. wks" value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
          <div className="flex-[2] space-y-2">
            <label className="text-sm font-medium leading-none">Entity Type</label>
            <Input placeholder="e.g. Well" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
          </div>
          <Button
            type="submit"
            disabled={isLoading}
            className="shrink-0 bg-neon text-black hover:bg-neon/90 border-neon/80 focus-visible:ring-neon/60"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="ml-2">Search</span>
          </Button>
        </form>
      </div>

      {/* Error */}
      {isError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive font-medium">Failed to load schemas</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
              {error instanceof Error ? error.message : "An unexpected error occurred."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle>Schemas</CardTitle>
            <CardDescription>
              {isLoading
                ? "Loading…"
                : total > 0
                  ? `${pageStart}–${pageEnd} of ${total.toLocaleString()} — click to select, double-click for full JSON; drag column edges to resize`
                  : schemasData
                    ? "No schemas found"
                    : "Enter filters above and click Search"}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {/* Column visibility */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8">
                      <Columns3 className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Toggle columns</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COLUMNS.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={colVisible[col.key]}
                    onCheckedChange={() => toggleColVisible(col.key)}
                    disabled={colVisible[col.key] && visibleCount <= 1}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <button
                  className="w-full text-xs text-center py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors rounded-sm"
                  onClick={showAllCols}
                >
                  Show all
                </button>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Page size */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Rows</span>
              <Select value={String(limit)} onValueChange={handleLimitChange}>
                <SelectTrigger className="h-8 w-[70px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 250, 500, 1000, 2000].map((n) => (
                    <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Pagination */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="icon" className="h-8 w-8"
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0 || isLoading}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground min-w-[90px] text-center">
                {total > 0 ? `${pageStart}–${pageEnd} / ${total.toLocaleString()}` : "—"}
              </span>
              <Button
                variant="outline" size="icon" className="h-8 w-8"
                onClick={() => setOffset(offset + limit)}
                disabled={pageEnd >= total || isLoading}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table style={{ tableLayout: "fixed", minWidth: orderedCols.reduce((s, c) => s + colWidths[c.key], 0) }}>
                <TableHeader>
                  <TableRow>
                    {orderedCols.map((col) => (
                      <TableHead
                        key={col.key}
                        style={{ width: colWidths[col.key], minWidth: col.minWidth, position: "relative" }}
                        className={cn(
                          "select-none overflow-hidden whitespace-nowrap cursor-pointer",
                          dragOverCol === col.key && "bg-primary/10",
                        )}
                        draggable
                        onDragStart={(e) => handleColDragStart(e, col.key)}
                        onDragOver={(e) => handleColDragOver(e, col.key)}
                        onDrop={(e) => handleColDrop(e, col.key)}
                        onDragEnd={handleColDragEnd}
                        onClick={() => handleSortClick(col.key)}
                        onDoubleClick={() => resetColWidth(col)}
                      >
                        <div className="flex items-center overflow-hidden pr-3">
                          <GripVertical className="h-3 w-3 mr-1 shrink-0 opacity-30 cursor-grab" />
                          <span className="truncate">{col.label}</span>
                          <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />
                        </div>
                        <div
                          className="absolute right-0 top-0 h-full w-[5px] cursor-col-resize hover:bg-primary/40 active:bg-primary/60"
                          onMouseDown={(e) => startResize(e, col)}
                        />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={orderedCols.length} className="text-center py-8 text-muted-foreground">
                        No schemas found
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TableRow
                        key={row.id}
                        className={cn(
                          "cursor-pointer transition-colors",
                          selectedId === row.id
                            ? "bg-primary/10 hover:bg-primary/15"
                            : "hover:bg-muted/40",
                        )}
                        onClick={() => setSelectedId((prev) => prev === row.id ? null : row.id)}
                        onDoubleClick={() => setViewingId(row.id)}
                      >
                        {orderedCols.map((col) => {
                          const val = row[col.key];
                          return (
                            <TableCell
                              key={col.key}
                              className={cn(CELL_CLASS[col.key], "py-2")}
                              title={CELL_HAS_TITLE.has(col.key) ? val : undefined}
                              style={{ maxWidth: colWidths[col.key] }}
                            >
                              {col.key === "status" && val !== "—" ? (
                                <Badge variant={val === "PUBLISHED" ? "default" : "secondary"} className="text-xs">
                                  {val}
                                </Badge>
                              ) : col.key === "scope" && val !== "—" ? (
                                <Badge variant="outline" className="text-xs font-mono">
                                  {val}
                                </Badge>
                              ) : val}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fullscreen schema viewer */}
      {viewingId !== null && (
        <JsonViewerToolbar
          json={schemaDetails ? JSON.stringify(schemaDetails, null, 2) : "{}"}
          storageKey={viewingId}
          title={viewingId}
          defaultFullscreen
          onFullscreenClose={() => setViewingId(null)}
        />
      )}
    </div>
  );

  function handleLimitChange(value: string) {
    const n = Number(value);
    setLimit(n);
    try { localStorage.setItem("osdu-schemas:page-size", String(n)); } catch { /* ignore */ }
    setOffset(0);
  }
}
