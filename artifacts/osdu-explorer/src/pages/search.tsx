import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { searchOsduRecords, useSearchOsduRecords, useListOsduKinds } from "@workspace/api-client-react";
import { LuceneQueryInput } from "@/components/lucene-query-input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KindCombobox } from "@/components/kind-combobox";
import { RecordLookupDialog } from "@/components/record-lookup-dialog";
import { JsonViewerToolbar } from "@/components/json-viewer-toolbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSearch2, Rocket, ChevronLeft, ChevronRight, Loader2, ArrowUp, ArrowDown, ChevronsUpDown, Copy, Check, Clock, X, Trash2, Filter, GripVertical, Columns3, Maximize2, Minimize2, Terminal, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ConsolePanel } from "@/components/console-panel";
import { format } from "date-fns";
import {
  collectDashboardRows,
  DashboardRowsFetchError,
  filterDashboardRows,
  getDashboardKindOptions,
  paginateDashboardRows,
} from "@/lib/dashboard-kind-filter";
import type { DashboardKindOption, DashboardRowsProgress } from "@/lib/dashboard-kind-filter";
import { trackEvent } from "@/lib/analytics";

const FS_CONSOLE_DEFAULT = 300;
const FS_CONSOLE_MIN = 80;
const FS_CONSOLE_MAX = 700;
const DASHBOARD_KIND_PAGE_SIZE = 1000;
const ID_COLUMN_WIDTH = 280;

type SortDir = "asc" | "desc";
type ColKey = "id" | "kind" | "name" | "code" | "createdBy" | "createTime" | "modifyBy" | "modifyTime";
type DashboardSortMode = "createTime" | "modifyTime";
type DashboardWindowUnit = "seconds" | "minutes" | "hours" | "days";

interface DashboardWindowSetting {
  value: number;
  unit: DashboardWindowUnit;
}

interface Col {
  key: ColKey;
  label: string;
  defaultWidth: number;
  minWidth: number;
}

const COLUMNS: Col[] = [
  { key: "id",         label: "ID",          defaultWidth: ID_COLUMN_WIDTH, minWidth: ID_COLUMN_WIDTH },
  { key: "kind",       label: "Kind",        defaultWidth: 140, minWidth: 80 },
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
const DASHBOARD_WINDOW_VALUE_KEY = "osdu-explorer:dashboard-window-value";
const DASHBOARD_WINDOW_UNIT_KEY = "osdu-explorer:dashboard-window-unit";
const LEGACY_DASHBOARD_WINDOW_MINUTES_KEY = "osdu-explorer:dashboard-window-minutes";
const DASHBOARD_WINDOW_MAX_SECONDS = 7 * 24 * 60 * 60;

const DASHBOARD_WINDOW_UNITS: Array<{
  value: DashboardWindowUnit;
  label: string;
  suffix: string;
  seconds: number;
  max: number;
}> = [
  { value: "seconds", label: "Seconds", suffix: "s", seconds: 1, max: DASHBOARD_WINDOW_MAX_SECONDS },
  { value: "minutes", label: "Minutes", suffix: "m", seconds: 60, max: DASHBOARD_WINDOW_MAX_SECONDS / 60 },
  { value: "hours", label: "Hours", suffix: "h", seconds: 60 * 60, max: DASHBOARD_WINDOW_MAX_SECONDS / (60 * 60) },
  { value: "days", label: "Days", suffix: "d", seconds: 24 * 60 * 60, max: DASHBOARD_WINDOW_MAX_SECONDS / (24 * 60 * 60) },
];

function getDashboardWindowUnit(unit: DashboardWindowUnit) {
  return DASHBOARD_WINDOW_UNITS.find((entry) => entry.value === unit) ?? DASHBOARD_WINDOW_UNITS[1];
}

function clampDashboardWindowValue(value: number, unit: DashboardWindowUnit): number {
  const max = getDashboardWindowUnit(unit).max;
  return Number.isFinite(value) ? Math.min(max, Math.max(1, Math.round(value))) : unit === "minutes" ? 60 : 1;
}

function dashboardWindowToSeconds(value: number, unit: DashboardWindowUnit): number {
  return clampDashboardWindowValue(value, unit) * getDashboardWindowUnit(unit).seconds;
}

function loadDashboardWindowSetting(): DashboardWindowSetting {
  try {
    const storedUnit = localStorage.getItem(DASHBOARD_WINDOW_UNIT_KEY);
    const unit = DASHBOARD_WINDOW_UNITS.some((entry) => entry.value === storedUnit)
      ? storedUnit as DashboardWindowUnit
      : null;
    const storedValue = Number(localStorage.getItem(DASHBOARD_WINDOW_VALUE_KEY));
    if (unit && Number.isFinite(storedValue)) {
      return { value: clampDashboardWindowValue(storedValue, unit), unit };
    }

    const legacyMinutes = Number(localStorage.getItem(LEGACY_DASHBOARD_WINDOW_MINUTES_KEY));
    if (Number.isFinite(legacyMinutes)) {
      return { value: clampDashboardWindowValue(legacyMinutes, "minutes"), unit: "minutes" };
    }
  } catch {
    /* ignore storage errors */
  }
  return { value: 60, unit: "minutes" };
}

function loadColOrder(): ColKey[] {
  const defaults = COLUMNS.map((c) => c.key);
  try {
    const raw = localStorage.getItem(COL_ORDER_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const valid = parsed.filter(
        (key): key is ColKey =>
          typeof key === "string" && defaults.includes(key as ColKey),
      );
      const missing = defaults.filter((key) => !valid.includes(key));
      return [...valid, ...missing];
    }
  } catch { /* ignore */ }
  return defaults;
}

const CELL_CLASS: Record<ColKey, string> = {
  id:         "font-mono truncate",
  kind:       "font-mono truncate",
  name:       "truncate",
  code:       "font-mono truncate",
  createdBy:  "truncate",
  createTime: "font-mono tabular-nums truncate",
  modifyBy:   "truncate",
  modifyTime: "font-mono tabular-nums truncate",
};

const CELL_HAS_TITLE = new Set<ColKey>(["id", "kind", "name", "code", "createdBy", "modifyBy"]);

function displayCellValue(col: ColKey, value: string): string {
  if (col === "id") {
    const separator = value.lastIndexOf(":");
    return separator >= 0 ? value.slice(separator + 1) : value;
  }
  if (col !== "kind") return value;
  const separator = value.indexOf("--");
  return separator >= 0 ? value.slice(separator + 2) : value;
}

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
  if (col.key === "id") return ID_COLUMN_WIDTH;
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
        const isLegacyKindWidth = c.key === "kind" && (v === 240 || v === 180);
        defaults[c.key] = clampWidth(c, isLegacyKindWidth ? c.defaultWidth : v);
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
  kind: string;
  name: string;
  code: string;
  createdBy: string;
  createTime: string;
  modifyBy: string;
  modifyTime: string;
}

function timestampValue(value: string): number {
  if (value === "—") return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function dashboardSortFor(mode: DashboardSortMode) {
  return mode === "createTime"
    ? { field: ["createTime"], order: ["desc"] }
    : { field: ["modifyTime"], order: ["desc"] };
}

function compareDashboardRows(a: FlatRow, b: FlatRow, mode: DashboardSortMode): number {
  const primaryField = mode === "createTime" ? "createTime" : "modifyTime";
  return timestampValue(b[primaryField]) - timestampValue(a[primaryField]);
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

function buildRecentRecordsQuery(
  value: number,
  unit: DashboardWindowUnit,
  sortMode: DashboardSortMode,
): string {
  const { suffix } = getDashboardWindowUnit(unit);
  const timeField = sortMode === "createTime" ? "createTime" : "modifyTime";
  return `${timeField}:[now-${value}${suffix} TO now]`;
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

function DashboardKindFilter({
  options,
  selectedKinds,
  onChange,
  loading = false,
}: {
  options: DashboardKindOption[];
  selectedKinds: string[];
  onChange: (kinds: string[]) => void;
  loading?: boolean;
}) {
  const totalRows = options.reduce((sum, option) => sum + option.count, 0);
  const toggleKind = (value: string, checked: boolean) => {
    onChange(
      checked
        ? [...selectedKinds, value]
        : selectedKinds.filter((kind) => kind !== value),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          aria-label="Filter recent records by kind"
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Filter className="h-3.5 w-3.5" />}
          Kinds
          <span className="text-muted-foreground">
            ({selectedKinds.length > 0 ? `${selectedKinds.length}/` : ""}{options.length})
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-h-80 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">
          Distinct kinds across all pages
        </DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={selectedKinds.length === 0}
          onCheckedChange={() => onChange([])}
          onSelect={(event) => event.preventDefault()}
          className="text-xs"
        >
          <span className="flex-1">All kinds</span>
          <span className="ml-2 text-muted-foreground">{totalRows}</span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selectedKinds.includes(option.value)}
            onCheckedChange={(checked) => toggleKind(option.value, checked === true)}
            onSelect={(event) => event.preventDefault()}
            className="text-xs"
            title={option.value}
          >
            <span className="min-w-0 flex-1 truncate font-mono">
              {displayCellValue("kind", option.value)}
            </span>
            <span className="ml-2 text-muted-foreground">{option.count}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {selectedKinds.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => onChange([])}
            >
              Clear Kind filter
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DashboardKindLoadingStatus({
  progress,
  onCancel,
}: {
  progress: DashboardRowsProgress | null;
  onCancel: () => void;
}) {
  const pageLabel = progress?.totalPages
    ? `page ${Math.min(progress.currentPage, progress.totalPages)} of ${progress.totalPages}`
    : progress
      ? `fetching page ${progress.currentPage}`
      : "starting";
  const rowsLabel = progress && progress.rowsFetched > 0
    ? ` · ${progress.rowsFetched.toLocaleString()} rows loaded`
    : "";

  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>
        Loading Kind data: {pageLabel}
        {progress && progress.completedPages > 0 && progress.totalPages
          ? ` (${progress.completedPages} loaded)`
          : ""}
        {rowsLabel}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 gap-1 px-2 text-[11px]"
        onClick={onCancel}
        aria-label="Cancel Kind scan"
      >
        <X className="h-3 w-3" />
        Cancel
      </Button>
    </span>
  );
}

function DashboardKindErrorStatus({
  error,
  stale,
  onRetry,
  compact = false,
}: {
  error: string;
  stale: boolean;
  onRetry: () => void;
  compact?: boolean;
}) {
  const message = stale
    ? `Latest Kind scan incomplete: ${error}`
    : error;

  if (compact) {
    return (
      <div role="alert" className="inline-flex min-w-0 items-center gap-2 text-[11px] text-amber-700 dark:text-amber-300">
        <span className="min-w-0 truncate" title={message}>{message}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 shrink-0 gap-1 px-2 text-[11px]"
          onClick={onRetry}
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <Card role="alert" className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">
            {stale
              ? "Kind filters are showing the last successful scan"
              : "Kind filtering is temporarily unavailable"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {stale
              ? `The latest Kind scan could not be completed. ${error} Regular dashboard rows remain current.`
              : error}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5"
          onClick={onRetry}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry Kind loading
        </Button>
      </CardContent>
    </Card>
  );
}
export default function SearchPage({ dashboardMode = false }: { dashboardMode?: boolean }) {
  const [kind, setKind]   = useState("*:*:*:*");
  const [query, setQuery] = useState(() => {
    const setting = loadDashboardWindowSetting();
    return dashboardMode ? buildRecentRecordsQuery(setting.value, setting.unit, "createTime") : "";
  });
  const [offset, setOffset] = useState(0);
  const [sortCol, setSortCol] = useState<ColKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<RawRecord | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [storageOpenId, setStorageOpenId] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(loadColWidths);
  const [colOrder, setColOrder] = useState<ColKey[]>(loadColOrder);
  const [colVisible, setColVisible] = useState<Record<ColKey, boolean>>(loadColVisible);
  const [dragOverCol, setDragOverCol] = useState<ColKey | null>(null);
  const resizing = useRef<{ key: ColKey; startX: number; startW: number } | null>(null);
  const dragColRef = useRef<ColKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [rowFilter, setRowFilter] = useState("");
  const [dashboardKindFilter, setDashboardKindFilter] = useState<string[]>([]);
  const [tableFullscreen, setTableFullscreen] = useState(false);
  const [fsConsoleOpen, setFsConsoleOpen] = useState(false);
  const [fsConsoleHeight, setFsConsoleHeight] = useState(FS_CONSOLE_DEFAULT);
  const fsConsoleDragState = useRef<{ startY: number; startHeight: number } | null>(null);
  const fsConsoleDragCleanupRef = useRef<(() => void) | null>(null);
  const [dashboardWindow, setDashboardWindow] = useState<DashboardWindowSetting>(loadDashboardWindowSetting);
  const [dashboardWindowDraft, setDashboardWindowDraft] = useState(() => {
    return String(loadDashboardWindowSetting().value);
  });
  const [dashboardWindowUnitDraft, setDashboardWindowUnitDraft] = useState<DashboardWindowUnit>(
    () => loadDashboardWindowSetting().unit,
  );
  const [dashboardSortMode, setDashboardSortMode] = useState<DashboardSortMode>("createTime");
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
  const dashboardKindLoadId = useRef(0);
  const dashboardKindAbortController = useRef<AbortController | null>(null);
  const [dashboardAllRows, setDashboardAllRows] = useState<FlatRow[]>([]);
  const [dashboardKindRowsLoading, setDashboardKindRowsLoading] = useState(false);
  const [dashboardKindRowsProgress, setDashboardKindRowsProgress] = useState<DashboardRowsProgress | null>(null);
  const [dashboardKindRowsError, setDashboardKindRowsError] = useState<string | null>(null);
  const [dashboardKindHasSuccessfulScan, setDashboardKindHasSuccessfulScan] = useState(false);

  const queryPlaceholder = useMemo(() => getQueryExample(kind), [kind]);

  const loadDashboardKindRows = useCallback(async (recentQuery: string, sort: ReturnType<typeof dashboardSortFor>) => {
    dashboardKindAbortController.current?.abort();
    const loadId = ++dashboardKindLoadId.current;
    const abortController = new AbortController();
    dashboardKindAbortController.current = abortController;
    setDashboardKindRowsLoading(true);
    setDashboardKindRowsProgress(null);
    setDashboardKindRowsError(null);

    try {
      const allRows = await collectDashboardRows(
        async (offset) => {
          const page = await searchOsduRecords({
            kind: "*:*:*:*",
            query: recentQuery,
            limit: DASHBOARD_KIND_PAGE_SIZE,
            offset,
            sort,
          }, {
            signal: abortController.signal,
          });
          return {
            results: (page.results as RawRecord[]).map(flatten),
            totalCount: page.totalCount,
          };
        },
        {
          pageSize: DASHBOARD_KIND_PAGE_SIZE,
          signal: abortController.signal,
          onProgress: (progress) => {
            if (loadId === dashboardKindLoadId.current) {
              setDashboardKindRowsProgress(progress);
            }
          },
        },
      );

      if (loadId === dashboardKindLoadId.current) {
        setDashboardAllRows(allRows);
        setDashboardKindHasSuccessfulScan(true);
      }
    } catch (error) {
      if (loadId === dashboardKindLoadId.current) {
        if (!abortController.signal.aborted) {
          if (error instanceof DashboardRowsFetchError) {
            const loadedRowsLabel = error.rowsFetched > 0
              ? `${error.rowsFetched.toLocaleString()} rows loaded`
              : "no rows loaded yet";
            setDashboardKindRowsError(
              `Could not load Kind data for page ${error.page} (offset ${error.offset.toLocaleString()}); ${loadedRowsLabel}.`,
            );
          } else {
            setDashboardKindRowsError("Could not load all Dashboard pages for Kind filtering.");
          }
        }
      }
    } finally {
      if (loadId === dashboardKindLoadId.current) {
        dashboardKindAbortController.current = null;
        setDashboardKindRowsLoading(false);
        setDashboardKindRowsProgress(null);
      }
    }
  }, []);

  const cancelDashboardKindScan = useCallback(() => {
    if (!dashboardKindRowsLoading) return;
    dashboardKindLoadId.current += 1;
    dashboardKindAbortController.current?.abort();
    dashboardKindAbortController.current = null;
    setDashboardKindRowsLoading(false);
    setDashboardKindRowsProgress(null);
    setDashboardKindRowsError("Kind scan canceled. Regular dashboard rows remain current.");
  }, [dashboardKindRowsLoading]);

  useEffect(() => () => {
    dashboardKindLoadId.current += 1;
    dashboardKindAbortController.current?.abort();
    dashboardKindAbortController.current = null;
  }, []);

  useEffect(() => {
    if (!dashboardMode) return;
    const recentQuery = buildRecentRecordsQuery(
      dashboardWindow.value,
      dashboardWindow.unit,
      dashboardSortMode,
    );
    setOffset(0);
    setKind("*:*:*:*");
    setQuery(recentQuery);
    searchMutation.mutate({
      data: { kind: "*:*:*:*", query: recentQuery, limit, offset: 0, sort: dashboardSortFor(dashboardSortMode) },
    });
    void loadDashboardKindRows(recentQuery, dashboardSortFor(dashboardSortMode));
  }, [dashboardMode, dashboardSortMode]);

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
    trackEvent("search_submitted", {
      surface: dashboardMode ? "dashboard" : "search",
      source: "form",
      has_query: Boolean(query.trim()),
      has_kind_filter: kind !== "*:*:*:*",
      page_size: limit,
    });
    searchMutation.mutate({ data: { kind, query: query || undefined, limit, offset: 0 } });
  };

  const handleSelectRecent = (r: RecentSearch) => {
    setKind(r.kind);
    setQuery(r.query);
    setShowRecent(false);
    setOffset(0);
    addRecent(r.kind, r.query);
    trackEvent("search_submitted", {
      surface: dashboardMode ? "dashboard" : "search",
      source: "history",
      has_query: Boolean(r.query.trim()),
      has_kind_filter: r.kind !== "*:*:*:*",
      page_size: limit,
    });
    searchMutation.mutate({ data: { kind: r.kind, query: r.query || undefined, limit, offset: 0 } });
  };

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
    if (dashboardMode && dashboardKindFilter.length > 0) return;
    searchMutation.mutate({
      data: {
        kind,
        query: query || undefined,
        limit,
        offset: newOffset,
        ...(dashboardMode ? { sort: dashboardSortFor(dashboardSortMode) } : {}),
      },
    });
  };

  const handleLimitChange = (value: string) => {
    const newLimit = Number(value);
    setLimit(newLimit);
    try { localStorage.setItem("osdu-explorer:page-size", String(newLimit)); } catch { /* ignore */ }
    if (dashboardMode && dashboardKindFilter.length > 0) {
      setOffset(0);
      return;
    }
    if (searchMutation.data) {
      setOffset(0);
      searchMutation.mutate({
        data: {
          kind,
          query: query || undefined,
          limit: newLimit,
          offset: 0,
          ...(dashboardMode ? { sort: dashboardSortFor(dashboardSortMode) } : {}),
        },
      });
    }
  };

  const handleDashboardRefresh = () => {
    const parsed = Number(dashboardWindowDraft);
    const value = clampDashboardWindowValue(parsed, dashboardWindowUnitDraft);
    const nextWindow = { value, unit: dashboardWindowUnitDraft };
    setDashboardWindow(nextWindow);
    setDashboardWindowDraft(String(value));
    try {
      localStorage.setItem(DASHBOARD_WINDOW_VALUE_KEY, String(value));
      localStorage.setItem(DASHBOARD_WINDOW_UNIT_KEY, dashboardWindowUnitDraft);
    } catch { /* ignore */ }
    const recentQuery = buildRecentRecordsQuery(value, dashboardWindowUnitDraft, dashboardSortMode);
    trackEvent("dashboard_refreshed", {
      window_value: value,
      window_unit: dashboardWindowUnitDraft,
      timestamp_field: dashboardSortMode === "createTime" ? "create_time" : "update_time",
      page_size: limit,
    });
    setKind("*:*:*:*");
    setQuery(recentQuery);
    setOffset(0);
    searchMutation.mutate({
      data: { kind: "*:*:*:*", query: recentQuery, limit, offset: 0, sort: dashboardSortFor(dashboardSortMode) },
    });
    void loadDashboardKindRows(recentQuery, dashboardSortFor(dashboardSortMode));
  };

  const handleDashboardWindowUnitChange = (nextUnit: DashboardWindowUnit) => {
    const currentValue = Number(dashboardWindowDraft);
    const currentSeconds = dashboardWindowToSeconds(
      Number.isFinite(currentValue) ? currentValue : dashboardWindow.value,
      dashboardWindowUnitDraft,
    );
    const nextValue = clampDashboardWindowValue(
      currentSeconds / getDashboardWindowUnit(nextUnit).seconds,
      nextUnit,
    );
    setDashboardWindowUnitDraft(nextUnit);
    setDashboardWindowDraft(String(nextValue));
  };

  const handleDashboardKindRetry = () => {
    if (!dashboardMode || dashboardKindRowsLoading) return;
    void loadDashboardKindRows(
      buildRecentRecordsQuery(dashboardWindow.value, dashboardWindow.unit, dashboardSortMode),
      dashboardSortFor(dashboardSortMode),
    );
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
    () => colOrder
      .filter((k) => colVisible[k])
      .map((k) => COLUMNS.find((c) => c.key === k))
      .filter((col): col is Col => Boolean(col)),
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

  const handleFsConsoleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    fsConsoleDragCleanupRef.current?.();
    fsConsoleDragState.current = { startY: e.clientY, startHeight: fsConsoleHeight };
    const onMove = (ev: MouseEvent) => {
      if (!fsConsoleDragState.current) return;
      const delta = fsConsoleDragState.current.startY - ev.clientY;
      const next = Math.min(FS_CONSOLE_MAX, Math.max(FS_CONSOLE_MIN, fsConsoleDragState.current.startHeight + delta));
      setFsConsoleHeight(next);
    };
    const cleanup = () => {
      fsConsoleDragState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (fsConsoleDragCleanupRef.current === cleanup) fsConsoleDragCleanupRef.current = null;
    };
    const onUp = cleanup;
    fsConsoleDragCleanupRef.current = cleanup;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [fsConsoleHeight]);

  useEffect(() => () => {
    fsConsoleDragCleanupRef.current?.();
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
    if (!sortCol && dashboardMode) {
      return [...flat].sort((a, b) => compareDashboardRows(a, b, dashboardSortMode));
    }
    if (!sortCol) return flat;
    return [...flat].sort((a, b) => {
      const av = a[sortCol] ?? "";
      const bv = b[sortCol] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [dashboardMode, dashboardSortMode, searchMutation.data?.results, sortCol, sortDir]);

  const kindFilterActive = dashboardMode && dashboardKindFilter.length > 0;
  const filteredRows = useMemo(() => {
    const sourceRows = kindFilterActive ? dashboardAllRows : rows;
    const kindFiltered = kindFilterActive
      ? filterDashboardRows(sourceRows, dashboardKindFilter)
      : sourceRows;
    const term = rowFilter.trim().toLowerCase();
    if (!term) return kindFiltered;
    return kindFiltered.filter((row) =>
      row.id.toLowerCase().includes(term) ||
      row.kind.toLowerCase().includes(term) ||
      row.name.toLowerCase().includes(term) ||
      row.code.toLowerCase().includes(term)
    );
  }, [dashboardAllRows, dashboardKindFilter, kindFilterActive, rowFilter, rows]);

  const displayRows = useMemo(
    () => kindFilterActive
      ? paginateDashboardRows(filteredRows, offset, limit)
      : filteredRows,
    [filteredRows, kindFilterActive, limit, offset],
  );

  const dashboardKindOptions = useMemo(() => {
    if (!dashboardMode) return [];
    const sourceRows = dashboardKindHasSuccessfulScan ? dashboardAllRows : rows;
    return getDashboardKindOptions(sourceRows);
  }, [dashboardAllRows, dashboardKindHasSuccessfulScan, dashboardMode, rows]);
  const dashboardKindDataIsStale = dashboardKindRowsError !== null && dashboardKindHasSuccessfulScan;

  const hasActiveTableFilters = Boolean(
    rowFilter.trim() || (dashboardMode && dashboardKindFilter.length > 0),
  );

  const handleRowDoubleClick = useCallback((row: FlatRow) => {
    const id = row.id !== "—" ? row.id : null;
    trackEvent("record_opened", {
      source: "table",
      mode: id ? "storage_lookup" : "json_viewer",
    });
    if (id) {
      setStorageOpenId(id);
    } else {
      setSelected(row._raw);
    }
  }, []);

  const handleRowClick = useCallback((row: FlatRow) => {
    setSelectedRowId(row.id !== "—" ? row.id : null);
  }, []);

  const total = kindFilterActive ? filteredRows.length : (searchMutation.data?.totalCount ?? 0);

  const handleDashboardKindFilterChange = (nextKinds: string[]) => {
    setDashboardKindFilter(nextKinds);
    setOffset(0);
    trackEvent("dashboard_kind_filter_changed", {
      selected_count: nextKinds.length,
      cleared: nextKinds.length === 0,
    });
    if (nextKinds.length === 0 && dashboardMode) {
      searchMutation.mutate({
        data: {
          kind,
          query: query || undefined,
          limit,
          offset: 0,
          sort: dashboardSortFor(dashboardSortMode),
        },
      });
    }
  };

  useEffect(() => {
    if (selectedRowId !== null && !displayRows.some((r) => r.id === selectedRowId)) {
      setSelectedRowId(null);
    }
  }, [displayRows, selectedRowId]);

  return (
    <div className="p-4 sm:p-5 max-w-full mx-auto space-y-3 isolate">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1
          className="text-xl font-bold tracking-tight text-foreground"
        >
          {dashboardMode ? "Dashboard" : "Record Search"}
        </h1>
        <p
          className="text-sm text-muted-foreground border-l-2 border-neon/50 pl-3"
        >
          {dashboardMode
            ? `Records ${dashboardSortMode === "createTime" ? "created" : "updated"} within the last ${dashboardWindow.value.toLocaleString()} ${dashboardWindow.unit}.`
            : "Search and explore records in the OSDU data platform."}
        </p>
        {dashboardMode && (
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="dashboard-window" className="text-xs text-muted-foreground whitespace-nowrap">
              Window
            </label>
            <Input
              id="dashboard-window"
              type="number"
              min={1}
              max={getDashboardWindowUnit(dashboardWindowUnitDraft).max}
              value={dashboardWindowDraft}
              onChange={(e) => setDashboardWindowDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleDashboardRefresh(); }}
              className="h-8 w-20 text-xs"
              aria-label={`Recent records window in ${dashboardWindowUnitDraft}`}
            />
            <Select
              value={dashboardWindowUnitDraft}
              onValueChange={(value) => handleDashboardWindowUnitChange(value as DashboardWindowUnit)}
            >
              <SelectTrigger id="dashboard-window-unit" className="h-8 w-[100px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DASHBOARD_WINDOW_UNITS.map((unit) => (
                  <SelectItem key={unit.value} value={unit.value} className="text-xs">
                    {unit.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label htmlFor="dashboard-sort-mode" className="text-xs text-muted-foreground whitespace-nowrap">
              Newest by
            </label>
            <Select
              value={dashboardSortMode}
              onValueChange={(value) => {
                setDashboardSortMode(value as DashboardSortMode);
                setOffset(0);
              }}
            >
              <SelectTrigger id="dashboard-sort-mode" className="h-8 w-[132px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="createTime" className="text-xs">Create Time</SelectItem>
                <SelectItem value="modifyTime" className="text-xs">Update Time</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={handleDashboardRefresh}
              disabled={searchMutation.isPending}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${searchMutation.isPending ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        )}
      </div>

      {!dashboardMode && <div className="glass-card p-3">
        <form
          onSubmit={handleSearch}
          className="grid items-stretch gap-2.5 sm:grid-cols-[minmax(0,1fr)_3rem]"
        >
          <div className="min-w-0 space-y-2">
            <div className="space-y-1">
              <label className="text-xs font-medium leading-none">Kind</label>
              <KindCombobox
                value={kind}
                onChange={setKind}
                kinds={kindsData?.kinds ?? []}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium leading-none">Lucene Query</label>
              <div className="flex min-w-0 gap-1.5">
                <div ref={queryWrapRef} className="relative min-w-0 flex-1">
                  <LuceneQueryInput
                    placeholder={queryPlaceholder}
                    value={query}
                    onChange={setQuery}
                    onFocus={() => { if (recent.length > 0) setShowRecent(true); }}
                    className="min-w-0 max-w-full h-8"
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
                  className={`h-8 w-8 shrink-0 focus-visible:ring-neon/60 ${copied ? "text-neon" : "text-muted-foreground hover:text-neon"}`}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="submit"
                disabled={searchMutation.isPending}
                aria-label="Run query"
                className="h-8 w-full self-stretch bg-primary text-primary-foreground hover:bg-primary/90 border-primary/80 focus-visible:ring-primary/60 sm:h-auto sm:w-12"
              >
                {searchMutation.isPending
                  ? <Loader2 className="h-5 w-5 animate-spin" />
                  : <Rocket className="h-5 w-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Launch query</TooltipContent>
          </Tooltip>
        </form>
      </div>}

      {searchMutation.isError && (
        <Card className="border-error-border/60 bg-error-surface">
          <CardContent className="px-4 py-3">
            <p className="text-sm text-error-text font-medium">Search failed</p>
            <p className="text-xs text-error-text/85 mt-1 font-mono break-all">
              {searchMutation.error instanceof Error
                ? searchMutation.error.message
                : "An unexpected error occurred. Check the Console for details."}
            </p>
          </CardContent>
        </Card>
      )}

      {dashboardMode && dashboardKindRowsError && (
        <DashboardKindErrorStatus
          error={dashboardKindRowsError}
          stale={dashboardKindDataIsStale}
          onRetry={handleDashboardKindRetry}
        />
      )}

      {dashboardMode && searchMutation.isPending && !searchMutation.data && (
        <Card className="border-border/50">
          <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading recent records…
          </CardContent>
        </Card>
      )}

      {searchMutation.data && (
        <Card className="border-border/50">
          <CardHeader className="space-y-2 px-4 pt-3 pb-2">
            {rows.length > 0 && !hasActiveTableFilters && (
              <p className="overflow-x-auto whitespace-nowrap text-[11px] leading-4 text-muted-foreground">
                Click the Search API or Storage API icon to open the corresponding response; double-click a row to open its Storage API response
              </p>
            )}
            <div className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm">{dashboardMode ? "Recent Records" : "Results"}</CardTitle>
                {hasActiveTableFilters && (
                  <CardDescription className="text-xs">
                    Showing {displayRows.length.toLocaleString()} of {kindFilterActive
                      ? filteredRows.length.toLocaleString()
                      : rows.length.toLocaleString()} {kindFilterActive ? "across all pages" : "on this page"} ({total.toLocaleString()} total)
                  </CardDescription>
                )}
              </div>
              <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex"
                    tabIndex={!selectedRowId ? 0 : undefined}
                    aria-label={!selectedRowId ? "Search API unavailable until a row is selected" : undefined}
                  >
                    <Button
                      variant="outline"
                      size="icon"
                      className={`h-8 w-8 ${selectedRowId ? "text-primary hover:text-primary" : "text-foreground disabled:text-foreground disabled:opacity-100"}`}
                      disabled={!selectedRowId}
                      onClick={() => {
                        const row = displayRows.find((r) => r.id === selectedRowId);
                        if (row) setSelected(row._raw);
                      }}
                      aria-label="Open Search API result"
                    >
                      <FileSearch2 className="h-4 w-4" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Search API</TooltipContent>
              </Tooltip>
              <RecordLookupDialog
                selectedId={selectedRowId ?? ""}
                openRequestId={storageOpenId}
                onOpenRequestHandled={() => setStorageOpenId(null)}
              />
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setTableFullscreen(true)}
                    aria-label="Full screen"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Full screen</TooltipContent>
              </Tooltip>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="px-3 py-1.5 border-t border-border flex items-center gap-2">
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
              {dashboardMode && dashboardKindOptions.length > 0 && (
                <DashboardKindFilter
                  options={dashboardKindOptions}
                  selectedKinds={dashboardKindFilter}
                  onChange={handleDashboardKindFilterChange}
                  loading={dashboardKindRowsLoading || (dashboardKindRowsError !== null && !dashboardKindHasSuccessfulScan)}
                />
              )}
              {dashboardMode && dashboardKindRowsLoading && (
                <DashboardKindLoadingStatus
                  progress={dashboardKindRowsProgress}
                  onCancel={cancelDashboardKindScan}
                />
              )}
              {dashboardMode && dashboardKindDataIsStale && (
                <span className="text-[11px] text-amber-700 dark:text-amber-300 whitespace-nowrap">
                  Showing the last successful Kind scan; regular dashboard rows remain current.
                </span>
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
                      const col = COLUMNS.find((c) => c.key === key);
                      if (!col) return null;
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
            <div className="border-t border-border overflow-auto" style={{ maxHeight: "min(72vh, calc(100vh - 340px))" }}>
              <Table
                className="text-xs [&_th]:h-8"
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
                  {displayRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={COLUMNS.length} className="text-center py-10 text-muted-foreground">
                        {dashboardKindRowsLoading
                          ? "Loading records across all pages…"
                          : hasActiveTableFilters
                            ? "No rows match the current filters"
                            : "No records found"}
                      </TableCell>
                    </TableRow>
                  )}
                  {displayRows.map((row, i) => (
                    <TableRow
                      key={row.id + i}
                      data-state={selectedRowId === row.id ? "selected" : undefined}
                      className="cursor-pointer hover:bg-muted/50 data-[state=selected]:bg-neon/10 data-[state=selected]:hover:bg-neon/15"
                      onClick={() => handleRowClick(row)}
                      onDoubleClick={() => handleRowDoubleClick(row)}
                    >
                      {orderedCols.map((col) => {
                        const val = (row as Record<ColKey, string>)[col.key];
                        return (
                          <TableCell
                            key={col.key}
                            className={`${CELL_CLASS[col.key]} py-1`}
                            title={CELL_HAS_TITLE.has(col.key) ? val : undefined}
                          >
                            {displayCellValue(col.key, val)}
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

      {searchMutation.data && (
        <Dialog open={tableFullscreen} onOpenChange={(open) => { if (!open) setTableFullscreen(false); }}>
          <DialogContent
            className="max-w-none w-screen h-screen flex flex-col p-0 gap-0 rounded-none border-0"
            aria-describedby={undefined}
            onKeyDown={(e) => {
              if (e.key === "Escape") setTableFullscreen(false);
            }}
          >
            <DialogTitle className="sr-only">Search Results Full Screen</DialogTitle>

            {/* 1. Header bar */}
            <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-4 py-2 shrink-0">
              <span className="text-sm font-medium text-foreground">Search Results</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setTableFullscreen(false)}
                    aria-label="Exit full screen"
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Exit full screen</TooltipContent>
              </Tooltip>
            </div>

            {rows.length > 0 && !hasActiveTableFilters && (
              <div className="shrink-0 overflow-x-auto border-b border-border/40 px-4 py-1.5">
                <p className="whitespace-nowrap text-[11px] leading-4 text-muted-foreground">
                  Click the Search API or Storage API icon to open the corresponding response; double-click a row to open its Storage API response
                </p>
              </div>
            )}

            {/* 2. Filter + Columns toolbar */}
            <div className="px-4 py-2 border-b border-border flex items-center gap-2 shrink-0">
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
              {dashboardMode && dashboardKindOptions.length > 0 && (
                <DashboardKindFilter
                  options={dashboardKindOptions}
                  selectedKinds={dashboardKindFilter}
                  onChange={handleDashboardKindFilterChange}
                  loading={dashboardKindRowsLoading || (dashboardKindRowsError !== null && !dashboardKindHasSuccessfulScan)}
                />
              )}
              {dashboardMode && dashboardKindRowsLoading && (
                <DashboardKindLoadingStatus
                  progress={dashboardKindRowsProgress}
                  onCancel={cancelDashboardKindScan}
                />
              )}
              {dashboardMode && dashboardKindRowsError && (
                <DashboardKindErrorStatus
                  error={dashboardKindRowsError}
                  stale={dashboardKindDataIsStale}
                  onRetry={handleDashboardKindRetry}
                  compact
                />
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
                      const col = COLUMNS.find((c) => c.key === key);
                      if (!col) return null;
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

            {/* 3. Table area */}
            <div className="flex-1 overflow-hidden min-h-0">
              <div className="h-full overflow-auto">
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
                  {displayRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={COLUMNS.length} className="text-center py-10 text-muted-foreground">
                        {dashboardKindRowsLoading
                          ? "Loading records across all pages…"
                          : hasActiveTableFilters
                            ? "No rows match the current filters"
                            : "No records found"}
                        </TableCell>
                      </TableRow>
                    )}
                  {displayRows.map((row, i) => (
                      <TableRow
                        key={row.id + i}
                        data-state={selectedRowId === row.id ? "selected" : undefined}
                        className="cursor-pointer hover:bg-muted/50 data-[state=selected]:bg-neon/10 data-[state=selected]:hover:bg-neon/15"
                        onClick={() => handleRowClick(row)}
                        onDoubleClick={() => handleRowDoubleClick(row)}
                      >
                        {orderedCols.map((col) => {
                          const val = (row as Record<ColKey, string>)[col.key];
                          return (
                            <TableCell
                              key={col.key}
                              className={CELL_CLASS[col.key]}
                              title={CELL_HAS_TITLE.has(col.key) ? val : undefined}
                            >
                              {displayCellValue(col.key, val)}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* 4. Console panel (resizable) */}
            {fsConsoleOpen && (
              <>
                <div
                  className="shrink-0 h-[5px] cursor-ns-resize bg-border/60 hover:bg-primary/40 active:bg-primary/60 transition-colors"
                  onMouseDown={handleFsConsoleDragStart}
                  title="Drag to resize"
                />
                <div className="shrink-0" style={{ height: fsConsoleHeight }}>
                  <ConsolePanel height={fsConsoleHeight} />
                </div>
              </>
            )}

            {/* 4. Console toggle bar */}
            <div
              className="shrink-0 h-7 flex items-center gap-2 px-3 border-t border-border bg-card/80 cursor-pointer select-none hover:bg-muted/60 transition-colors"
              onClick={() => setFsConsoleOpen((v) => !v)}
              role="button"
              aria-expanded={fsConsoleOpen}
              aria-label="Toggle console"
            >
              <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] font-medium text-muted-foreground">Console</span>
              <div className="ml-auto text-muted-foreground">
                {fsConsoleOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5" />
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {selected !== null && (
        <JsonViewerToolbar
          json={JSON.stringify(selected, null, 2)}
          storageKey={selected.id as string | undefined}
          title="Record from Search Service"
          defaultFullscreen
          onFullscreenClose={() => setSelected(null)}
          storageRecordId={selected.id as string | undefined}
        />
      )}
    </div>
  );
}
