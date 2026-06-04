import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useSearchOsduRecords, useListOsduKinds } from "@workspace/api-client-react";
import { LuceneQueryInput } from "@/components/lucene-query-input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KindCombobox } from "@/components/kind-combobox";
import { RecordLookupDialog } from "@/components/record-lookup-dialog";
import { JsonViewerToolbar } from "@/components/json-viewer-toolbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search as SearchIcon, ChevronLeft, ChevronRight, Loader2, ArrowUp, ArrowDown, ChevronsUpDown, Copy, Check, Clock, X, Trash2, Filter, GripVertical, Columns3 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { format } from "date-fns";

type SortDir = "asc" | "desc";
type ColKey = "id" | "version" | "kind" | "name" | "code" | "createdBy" | "createTime" | "modifyBy" | "modifyTime";

interface Col {
  key: ColKey;
  label: string;
  defaultWidth: number;
  minWidth: number;
}

const COLUMNS: Col[] = [
  { key: "id",         label: "ID",          defaultWidth: 220, minWidth: 80 },
  { key: "version",    label: "Version",     defaultWidth: 90,  minWidth: 60 },
  { key: "kind",       label: "Kind",        defaultWidth: 240, minWidth: 80 },
  { key: "name",       label: "Name",        defaultWidth: 160, minWidth: 70 },
  { key: "code",       label: "Code",        defaultWidth: 120, minWidth: 60 },
  { key: "createdBy",  label: "Created By",  defaultWidth: 140, minWidth: 70 },
  { key: "createTime", label: "Create Time", defaultWidth: 160, minWidth: 80 },
  { key: "modifyBy",   label: "Updated By",  defaultWidth: 140, minWidth: 70 },
  { key: "modifyTime", label: "Update Time", defaultWidth: 160, minWidth: 80 },
];

const COL_WIDTHS_KEY = "osdu-explorer:col-widths";
const MAX_COL_WIDTH = 800;

const COL_ORDER_KEY = "osdu-explorer:col-order";

function loadColOrder(): ColKey[] {
  const defaults = COLUMNS.map((c) => c.key);
  try {
    const raw = localStorage.getItem(COL_ORDER_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as ColKey[];
    if (
      Array.isArray(parsed) &&
      parsed.length === defaults.length &&
      defaults.every((k) => parsed.includes(k))
    ) return parsed;
  } catch { /* ignore */ }
  return defaults;
}

const CELL_CLASS: Record<ColKey, string> = {
  id:         "font-mono truncate",
  version:    "font-mono tabular-nums truncate",
  kind:       "font-mono truncate",
  name:       "truncate",
  code:       "font-mono truncate",
  createdBy:  "truncate",
  createTime: "font-mono tabular-nums truncate",
  modifyBy:   "truncate",
  modifyTime: "font-mono tabular-nums truncate",
};

const CELL_HAS_TITLE = new Set<ColKey>(["id", "kind", "name", "code", "createdBy", "modifyBy"]);

const COL_VISIBLE_KEY = "osdu-explorer:col-visible";

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

function clampWidth(col: Col, v: number): number {
  return Math.min(MAX_COL_WIDTH, Math.max(col.minWidth, v));
}

function loadColWidths(): Record<ColKey, number> {
  const defaults = Object.fromEntries(
    COLUMNS.map((c) => [c.key, c.defaultWidth]),
  ) as Record<ColKey, number>;
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<ColKey, number>>;
    for (const c of COLUMNS) {
      const v = parsed[c.key];
      if (typeof v === "number" && Number.isFinite(v)) {
        defaults[c.key] = clampWidth(c, v);
      }
    }
  } catch {
    /* ignore malformed storage */
  }
  return defaults;
}

type RawRecord = {
  id?: string;
  kind?: string;
  version?: number | null;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>[];
  [key: string]: unknown;
};

interface FlatRow {
  _raw: RawRecord;
  id: string;
  version: string;
  kind: string;
  name: string;
  code: string;
  createdBy: string;
  createTime: string;
  modifyBy: string;
  modifyTime: string;
}

interface RecentSearch {
  kind: string;
  query: string;
  ts: number;
}

const STORAGE_KEY = "osdu-explorer:recent-searches";
const MAX_RECENT = 10;

function loadRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RecentSearch[]) : [];
  } catch {
    return [];
  }
}

function saveRecentSearches(searches: RecentSearch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch {
    // ignore quota errors
  }
}

function useRecentSearches() {
  const [recent, setRecent] = useState<RecentSearch[]>(loadRecentSearches);

  const add = useCallback((kind: string, query: string) => {
    setRecent((prev) => {
      const entry: RecentSearch = { kind, query, ts: Date.now() };
      const filtered = prev.filter((r) => !(r.kind === kind && r.query === query));
      const next = [entry, ...filtered].slice(0, MAX_RECENT);
      saveRecentSearches(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    saveRecentSearches([]);
    setRecent([]);
  }, []);

  return { recent, add, clear };
}

function fmtDate(val: unknown): string {
  if (!val) return "—";
  try {
    return format(new Date(String(val)), "yyyy-MM-dd HH:mm");
  } catch {
    return String(val);
  }
}

function flatten(rec: RawRecord): FlatRow {
  const data = rec.data ?? {};
  const sys = (rec.meta?.[0] ?? {}) as Record<string, unknown>;

  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = data[k] ?? sys[k] ?? rec[k];
      if (v != null && v !== "") return String(v);
    }
    return "—";
  };

  return {
    _raw: rec,
    id:         rec.id ?? "—",
    version:    rec.version != null ? String(rec.version) : "—",
    kind:       rec.kind ?? "—",
    name:       pick("Name", "name"),
    code:       pick("Code", "code"),
    createdBy:  pick("createUser", "createdBy", "CreateUser"),
    createTime: fmtDate(data["createTime"] ?? sys["createTime"] ?? rec["createTime"]),
    modifyBy:   pick("modifyUser", "modifyBy", "updatedBy", "ModifyUser"),
    modifyTime: fmtDate(data["modifyTime"] ?? sys["modifyTime"] ?? rec["modifyTime"]),
  };
}

function SortIcon({ col, sortCol, sortDir }: { col: ColKey; sortCol: ColKey | null; sortDir: SortDir }) {
  if (sortCol !== col) return <ChevronsUpDown className="ml-1 h-3 w-3 opacity-40 inline" />;
  return sortDir === "asc"
    ? <ArrowUp className="ml-1 h-3 w-3 inline" />
    : <ArrowDown className="ml-1 h-3 w-3 inline" />;
}

const KIND_QUERY_EXAMPLES: Record<string, string> = {
  well:      'data.WellName:"Volve" AND data.CountryName:"Norway"',
  wellbore:  'data.WellboreName:"Volve-1" AND data.VerticalMeasurement.VerticalMeasurementID:"*KB*"',
  welllog:   'data.Name:"GR Log" AND data.CurveID:"*GR*"',
  seismic:   'data.Name:"3D Survey" AND data.SeismicDomainTypeID:"*Time*"',
  survey:    'data.SurveyName:"Block 34" AND data.ProjectedCRSID:"*WGS84*"',
  field:     'data.FieldName:"Volve" AND data.GeoPoliticalEntityID:"*Norway*"',
  facility:  'data.FacilityName:"Platform A" AND data.FacilityTypeID:"*Wellhead*"',
  document:  'data.DocumentTitle:"Well Report" AND data.DocumentTypeID:"*Completion*"',
  dataset:   'data.Name:"Seismic Dataset" AND data.DatasetProperties.FileSourceInfo.FileSize:[1000 TO *]',
};

const GENERIC_EXAMPLE = 'data.ProjectName:"MyProject"';

function getQueryExample(kind: string): string {
  if (!kind || kind === "*:*:*:*") return GENERIC_EXAMPLE;
  const lower = kind.toLowerCase();
  const entries = Object.entries(KIND_QUERY_EXAMPLES).sort(
    ([a], [b]) => b.length - a.length
  );
  for (const [key, example] of entries) {
    if (lower.includes(key)) return example;
  }
  return GENERIC_EXAMPLE;
}

function RecentSearchesDropdown({
  recent,
  onSelect,
  onClear,
  onClose,
}: {
  recent: RecentSearch[];
  onSelect: (r: RecentSearch) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recent searches</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={onClear}
            title="Clear history"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <ul className="max-h-56 overflow-y-auto py-1">
        {recent.map((r, i) => (
          <li key={i}>
            <button
              type="button"
              className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted/60 transition-colors"
              onClick={() => onSelect(r)}
            >
              <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono text-neon/80 truncate">{r.kind}</div>
                {r.query ? (
                  <div className="text-xs font-mono text-foreground/70 truncate">{r.query}</div>
                ) : (
                  <div className="text-xs text-muted-foreground italic">no filter</div>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SearchPage() {
  const [kind, setKind]   = useState("*:*:*:*");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [sortCol, setSortCol] = useState<ColKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<RawRecord | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(loadColWidths);
  const [colOrder, setColOrder] = useState<ColKey[]>(loadColOrder);
  const [colVisible, setColVisible] = useState<Record<ColKey, boolean>>(loadColVisible);
  const [dragOverCol, setDragOverCol] = useState<ColKey | null>(null);
  const resizing = useRef<{ key: ColKey; startX: number; startW: number } | null>(null);
  const dragColRef = useRef<ColKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [rowFilter, setRowFilter] = useState("");
  const [limit, setLimit] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("osdu-explorer:page-size"));
      return [10, 25, 50, 100, 500, 1000, 2000].includes(v) ? v : 50;
    } catch { return 50; }
  });

  const { recent, add: addRecent, clear: clearRecent } = useRecentSearches();
  const queryWrapRef = useRef<HTMLDivElement>(null);

  const { data: kindsData } = useListOsduKinds({ limit: 1000 });
  const searchMutation = useSearchOsduRecords();

  const queryPlaceholder = useMemo(() => getQueryExample(kind), [kind]);

  useEffect(() => {
    if (!showRecent) return;
    function handleClick(e: MouseEvent) {
      if (queryWrapRef.current && !queryWrapRef.current.contains(e.target as Node)) {
        setShowRecent(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showRecent]);

  const handleCopy = () => {
    const text = query || queryPlaceholder;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setOffset(0);
    setShowRecent(false);
    addRecent(kind, query);
    searchMutation.mutate({ data: { kind, query: query || undefined, limit, offset: 0 } });
  };

  const handleSelectRecent = (r: RecentSearch) => {
    setKind(r.kind);
    setQuery(r.query);
    setShowRecent(false);
    setOffset(0);
    addRecent(r.kind, r.query);
    searchMutation.mutate({ data: { kind: r.kind, query: r.query || undefined, limit, offset: 0 } });
  };

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
    searchMutation.mutate({ data: { kind, query: query || undefined, limit, offset: newOffset } });
  };

  const handleLimitChange = (value: string) => {
    const newLimit = Number(value);
    setLimit(newLimit);
    try { localStorage.setItem("osdu-explorer:page-size", String(newLimit)); } catch { /* ignore */ }
    if (searchMutation.data) {
      setOffset(0);
      searchMutation.mutate({ data: { kind, query: query || undefined, limit: newLimit, offset: 0 } });
    }
  };

  const persistColWidths = useCallback((widths: Record<ColKey, number>) => {
    try {
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(widths));
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const endResizeRef = useRef<(() => void) | null>(null);

  const startResize = useCallback(
    (e: React.MouseEvent, col: Col) => {
      e.preventDefault();
      e.stopPropagation();
      endResizeRef.current?.();
      resizing.current = { key: col.key, startX: e.clientX, startW: colWidths[col.key] };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const r = resizing.current;
        if (!r) return;
        const next = clampWidth(col, r.startW + (ev.clientX - r.startX));
        setColWidths((prev) => (prev[r.key] === next ? prev : { ...prev, [r.key]: next }));
      };
      const end = (persist: boolean) => {
        resizing.current = null;
        endResizeRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("blur", onBlur);
        if (persist) {
          setColWidths((prev) => {
            persistColWidths(prev);
            return prev;
          });
        }
      };
      const onUp = () => end(true);
      const onBlur = () => end(true);

      endResizeRef.current = () => end(false);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("blur", onBlur);
    },
    [colWidths, persistColWidths],
  );

  useEffect(() => {
    return () => {
      endResizeRef.current?.();
    };
  }, []);

  const resetColWidth = useCallback(
    (col: Col) => {
      setColWidths((prev) => {
        const next = { ...prev, [col.key]: col.defaultWidth };
        persistColWidths(next);
        return next;
      });
    },
    [persistColWidths],
  );

  const orderedCols = useMemo(
    () => colOrder.filter((k) => colVisible[k]).map((k) => COLUMNS.find((c) => c.key === k)!),
    [colOrder, colVisible],
  );

  const visibleCount = useMemo(() => Object.values(colVisible).filter(Boolean).length, [colVisible]);

  const toggleColVisible = useCallback((key: ColKey) => {
    setColVisible((prev) => {
      const currentlyVisible = Object.values(prev).filter(Boolean).length;
      if (prev[key] && currentlyVisible <= 1) return prev;
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

  const persistColOrder = useCallback((order: ColKey[]) => {
    try { localStorage.setItem(COL_ORDER_KEY, JSON.stringify(order)); } catch { /* ignore */ }
  }, []);

  const handleColDragStart = useCallback((e: React.DragEvent, key: ColKey) => {
    dragColRef.current = key;
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleColDragOver = useCallback((e: React.DragEvent, key: ColKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragColRef.current && dragColRef.current !== key) setDragOverCol(key);
  }, []);

  const handleColDrop = useCallback((e: React.DragEvent, targetKey: ColKey) => {
    e.preventDefault();
    const src = dragColRef.current;
    if (!src || src === targetKey) { setDragOverCol(null); return; }
    setColOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(src);
      const to = next.indexOf(targetKey);
      next.splice(from, 1);
      next.splice(to, 0, src);
      persistColOrder(next);
      return next;
    });
    setDragOverCol(null);
    dragColRef.current = null;
  }, [persistColOrder]);

  const handleColDragEnd = useCallback(() => {
    setDragOverCol(null);
    dragColRef.current = null;
  }, []);

  const handleSortClick = (col: ColKey) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const rows: FlatRow[] = useMemo(() => {
    const raw = (searchMutation.data?.results ?? []) as RawRecord[];
    const flat = raw.map(flatten);
    if (!sortCol) return flat;
    return [...flat].sort((a, b) => {
      const av = a[sortCol] ?? "";
      const bv = b[sortCol] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [searchMutation.data?.results, sortCol, sortDir]);

  const filteredRows = useMemo(() => {
    const term = rowFilter.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      row.id.toLowerCase().includes(term) ||
      row.kind.toLowerCase().includes(term) ||
      row.name.toLowerCase().includes(term) ||
      row.code.toLowerCase().includes(term)
    );
  }, [rows, rowFilter]);

  const total = searchMutation.data?.totalCount ?? 0;

  useEffect(() => {
    if (selectedRowId !== null && !rows.some((r) => r.id === selectedRowId)) {
      setSelectedRowId(null);
    }
  }, [rows, selectedRowId]);

  return (
    <div className="p-8 max-w-full mx-auto space-y-6 isolate">
      <div className="space-y-2">
        <h1
          className="text-3xl font-bold tracking-tight text-neon"
          style={{ textShadow: "0 0 24px hsl(180 100% 55% / 0.45), 0 0 8px hsl(180 100% 55% / 0.25)" }}
        >
          Record Search
        </h1>
        <p
          className="text-muted-foreground pl-3"
          style={{ borderLeft: "2px solid hsl(180 100% 55% / 0.5)" }}
        >
          Search and explore records in the OSDU data platform.
        </p>
      </div>

      <div className="glass-card p-6">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <label className="text-sm font-medium leading-none">Kind</label>
            <KindCombobox
              value={kind}
              onChange={setKind}
              kinds={kindsData?.kinds ?? []}
            />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <label className="text-sm font-medium leading-none">Lucene Query</label>
            <div className="flex gap-2">
              <div ref={queryWrapRef} className="relative flex-1">
                <LuceneQueryInput
                  placeholder={queryPlaceholder}
                  value={query}
                  onChange={setQuery}
                  onFocus={() => { if (recent.length > 0) setShowRecent(true); }}
                />
                {showRecent && recent.length > 0 && (
                  <RecentSearchesDropdown
                    recent={recent}
                    onSelect={handleSelectRecent}
                    onClear={() => { clearRecent(); setShowRecent(false); }}
                    onClose={() => setShowRecent(false)}
                  />
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                title="Copy query"
                className={`shrink-0 focus-visible:ring-neon/60 ${copied ? "text-neon" : "text-muted-foreground hover:text-neon"}`}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="submit"
                    disabled={searchMutation.isPending}
                    className="shrink-0 bg-neon text-black hover:bg-neon/90 border-neon/80 focus-visible:ring-neon/60"
                  >
                    {searchMutation.isPending
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <SearchIcon className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Search</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </form>
      </div>

      {searchMutation.isError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive font-medium">Search failed</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono break-all">
              {searchMutation.error instanceof Error
                ? searchMutation.error.message
                : "An unexpected error occurred. Check the Console for details."}
            </p>
          </CardContent>
        </Card>
      )}

      {searchMutation.data && (
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle>Results</CardTitle>
              <CardDescription>
                {rowFilter.trim()
                  ? `Showing ${filteredRows.length.toLocaleString()} of ${rows.length.toLocaleString()} on this page (${total.toLocaleString()} total)`
                  : `${total.toLocaleString()} record${total !== 1 ? "s" : ""} found`}
                {rows.length > 0 && !rowFilter.trim() && " — click a row to select, then Search; double-click for full JSON; drag column edges to resize"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={!selectedRowId}
                    onClick={() => {
                      const row = rows.find((r) => r.id === selectedRowId);
                      if (row) setSelected(row._raw);
                    }}
                    aria-label="View search result"
                  >
                    <SearchIcon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Search result</TooltipContent>
              </Tooltip>
              <RecordLookupDialog selectedId={selectedRowId ?? ""} />
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Rows</span>
                <Select value={String(limit)} onValueChange={handleLimitChange}>
                  <SelectTrigger className="h-8 w-[70px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100, 500, 1000, 2000].map((n) => (
                      <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline" size="sm"
                onClick={() => handlePageChange(Math.max(0, offset - limit))}
                disabled={offset === 0 || searchMutation.isPending}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Prev
              </Button>
              <span className="text-sm text-muted-foreground min-w-[130px] text-center">
                {total === 0 ? "0 records" : `${offset + 1}–${Math.min(offset + limit, total)} of ${total.toLocaleString()}`}
              </span>
              <Button
                variant="outline" size="sm"
                onClick={() => handlePageChange(offset + limit)}
                disabled={offset + limit >= total || searchMutation.isPending}
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="px-4 py-2 border-t border-border flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Input
                placeholder="Filter by ID, kind, name, or code…"
                value={rowFilter}
                onChange={(e) => setRowFilter(e.target.value)}
                className="h-7 text-xs py-0 border-0 shadow-none focus-visible:ring-0 bg-transparent placeholder:text-muted-foreground/60"
              />
              {rowFilter && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setRowFilter("")}
                  title="Clear filter"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
              <div className="ml-auto shrink-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                      <Columns3 className="h-3.5 w-3.5" />
                      Columns
                      {visibleCount < COLUMNS.length && (
                        <span className="text-muted-foreground">({visibleCount}/{COLUMNS.length})</span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuLabel className="text-xs">Toggle columns</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {colOrder.map((key) => {
                      const col = COLUMNS.find((c) => c.key === key)!;
                      const isLast = visibleCount === 1 && colVisible[key];
                      return (
                        <DropdownMenuCheckboxItem
                          key={key}
                          checked={colVisible[key]}
                          onCheckedChange={() => !isLast && toggleColVisible(key)}
                          disabled={isLast}
                          className="text-xs"
                        >
                          {col.label}
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                    {visibleCount < COLUMNS.length && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-xs" onSelect={showAllCols}>
                          Show all columns
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="border-t border-border overflow-auto" style={{ maxHeight: "55vh" }}>
              <Table
                className="text-xs"
                style={{
                  tableLayout: "fixed",
                  width: orderedCols.reduce((sum, c) => sum + colWidths[c.key], 0),
                }}
              >
                <colgroup>
                  {orderedCols.map((col) => (
                    <col key={col.key} style={{ width: colWidths[col.key] }} />
                  ))}
                </colgroup>
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0] shadow-border">
                  <TableRow>
                    {orderedCols.map((col) => (
                      <TableHead
                        key={col.key}
                        className={`relative cursor-pointer select-none whitespace-nowrap overflow-hidden hover:text-foreground transition-colors${dragOverCol === col.key ? " border-l-2 border-neon" : ""}`}
                        onClick={() => handleSortClick(col.key)}
                        onDragOver={(e) => handleColDragOver(e, col.key)}
                        onDrop={(e) => handleColDrop(e, col.key)}
                        onDragLeave={() => setDragOverCol(null)}
                      >
                        <span
                          draggable
                          onDragStart={(e) => { e.stopPropagation(); handleColDragStart(e, col.key); }}
                          onDragEnd={handleColDragEnd}
                          onClick={(e) => e.stopPropagation()}
                          title="Drag to reorder column"
                          className="inline-flex items-center mr-1 cursor-grab active:cursor-grabbing opacity-25 hover:opacity-60 transition-opacity align-middle shrink-0"
                        >
                          <GripVertical className="h-3 w-3" />
                        </span>
                        <span className="truncate align-middle">{col.label}</span>
                        <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          title="Drag to resize • double-click to reset"
                          onMouseDown={(e) => startResize(e, col)}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            resetColWidth(col);
                          }}
                          className="absolute top-0 right-0 z-20 h-full w-2 cursor-col-resize select-none touch-none after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-border hover:after:bg-neon hover:after:w-0.5 after:transition-colors"
                        />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={COLUMNS.length} className="text-center py-10 text-muted-foreground">
                        {rowFilter.trim() ? "No rows match the current filter" : "No records found"}
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredRows.map((row, i) => (
                    <TableRow
                      key={row.id + i}
                      data-state={selectedRowId === row.id ? "selected" : undefined}
                      className="cursor-pointer hover:bg-muted/50 data-[state=selected]:bg-neon/10 data-[state=selected]:hover:bg-neon/15"
                      onClick={() => setSelectedRowId(row.id !== "—" ? row.id : null)}
                      onDoubleClick={() => setSelected(row._raw)}
                    >
                      {orderedCols.map((col) => {
                        const val = (row as Record<ColKey, string>)[col.key];
                        return (
                          <TableCell
                            key={col.key}
                            className={CELL_CLASS[col.key]}
                            title={CELL_HAS_TITLE.has(col.key) ? val : undefined}
                          >
                            {val}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {selected !== null && (
        <JsonViewerToolbar
          json={JSON.stringify(selected, null, 2)}
          storageKey={selected.id as string | undefined}
          title="Record from Search Service"
          defaultFullscreen
          onFullscreenClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
