import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useSearchOsduRecords, useListOsduKinds } from "@workspace/api-client-react";
import { LuceneQueryInput } from "@/components/lucene-query-input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search as SearchIcon, ChevronLeft, ChevronRight, Loader2, ArrowUp, ArrowDown, ChevronsUpDown, Copy, Check, Clock, X, Trash2, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

type SortDir = "asc" | "desc";
type ColKey = "id" | "version" | "kind" | "name" | "code" | "createdBy" | "createTime" | "modifyBy" | "modifyTime";

interface Col {
  key: ColKey;
  label: string;
  width: string;
}

const COLUMNS: Col[] = [
  { key: "id",         label: "ID",          width: "w-[220px] min-w-[180px]" },
  { key: "version",    label: "Version",     width: "w-[90px] min-w-[70px]" },
  { key: "kind",       label: "Kind",        width: "w-[240px] min-w-[180px]" },
  { key: "name",       label: "Name",        width: "w-[160px] min-w-[120px]" },
  { key: "code",       label: "Code",        width: "w-[120px] min-w-[90px]" },
  { key: "createdBy",  label: "Created By",  width: "w-[140px] min-w-[110px]" },
  { key: "createTime", label: "Create Time", width: "w-[160px] min-w-[130px]" },
  { key: "modifyBy",   label: "Updated By",  width: "w-[140px] min-w-[110px]" },
  { key: "modifyTime", label: "Update Time", width: "w-[160px] min-w-[130px]" },
];

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
  const [copied, setCopied] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [rowFilter, setRowFilter] = useState("");
  const limit = 50;

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
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium leading-none">Kind</label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue placeholder="Select kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="*:*:*:*">Any kind (*:*:*:*)</SelectItem>
                {kindsData?.kinds?.map((k) => (
                  <SelectItem key={k} value={k}>{k}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-[2] space-y-2">
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
              <Button
                type="submit"
                disabled={searchMutation.isPending}
                className="shrink-0 bg-neon text-black hover:bg-neon/90 border-neon/80 focus-visible:ring-neon/60"
              >
                {searchMutation.isPending
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <SearchIcon className="h-4 w-4 mr-2" />}
                Search
              </Button>
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
                {rows.length > 0 && !rowFilter.trim() && " — double-click a row to view full JSON"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
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
            </div>
            <div className="border-t border-border overflow-auto" style={{ maxHeight: "55vh" }}>
              <Table className="text-xs">
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0] shadow-border">
                  <TableRow>
                    {COLUMNS.map((col) => (
                      <TableHead
                        key={col.key}
                        className={`${col.width} cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors`}
                        onClick={() => handleSortClick(col.key)}
                      >
                        {col.label}
                        <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />
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
                      className="cursor-pointer hover:bg-muted/50"
                      onDoubleClick={() => setSelected(row._raw)}
                    >
                      <TableCell className="font-mono truncate max-w-[220px]" title={row.id}>{row.id}</TableCell>
                      <TableCell className="font-mono tabular-nums">{row.version}</TableCell>
                      <TableCell className="font-mono truncate max-w-[240px]" title={row.kind}>{row.kind}</TableCell>
                      <TableCell className="truncate max-w-[160px]" title={row.name}>{row.name}</TableCell>
                      <TableCell className="font-mono truncate max-w-[120px]" title={row.code}>{row.code}</TableCell>
                      <TableCell className="truncate max-w-[140px]" title={row.createdBy}>{row.createdBy}</TableCell>
                      <TableCell className="font-mono tabular-nums whitespace-nowrap">{row.createTime}</TableCell>
                      <TableCell className="truncate max-w-[140px]" title={row.modifyBy}>{row.modifyBy}</TableCell>
                      <TableCell className="font-mono tabular-nums whitespace-nowrap">{row.modifyTime}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm truncate pr-8" title={selected?.id}>
              {selected?.id ?? "Record"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0">
            <pre className="text-[12px] font-mono bg-muted/50 rounded-lg p-4 border border-border/40 text-foreground/90 whitespace-pre-wrap break-all leading-relaxed">
              {selected ? JSON.stringify(selected, null, 2) : ""}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
