import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  DatabaseZap,
  Filter,
  FlaskConical,
  GripVertical,
  Loader2,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { JsonViewerToolbar } from "@/components/json-viewer-toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Resource {
  name: string;
  count: number;
}

interface ResourceRecord {
  uuid: string;
  name: string;
  creator: string;
  created: string;
  lastChanged: string;
}

type RecordSortDir = "asc" | "desc";
type RecordColKey = "uuid" | "name" | "creator" | "created" | "lastChanged";

interface RecordCol {
  key: RecordColKey;
  label: string;
  defaultWidth: number;
  minWidth: number;
}

const RECORD_COLUMNS: RecordCol[] = [
  { key: "uuid", label: "UUID", defaultWidth: 290, minWidth: 140 },
  { key: "name", label: "Name", defaultWidth: 220, minWidth: 100 },
  { key: "creator", label: "Creator", defaultWidth: 210, minWidth: 100 },
  { key: "created", label: "Created", defaultWidth: 180, minWidth: 120 },
  { key: "lastChanged", label: "Last Changed", defaultWidth: 180, minWidth: 120 },
];

const RECORD_MAX_COL_WIDTH = 800;
const RECORD_COL_WIDTHS_KEY = "osdu-reservoir-records:col-widths";
const RECORD_COL_ORDER_KEY = "osdu-reservoir-records:col-order";
const RECORD_COL_VISIBLE_KEY = "osdu-reservoir-records:col-visible";
const RECORD_PAGE_SIZE_KEY = "osdu-reservoir-records:page-size";

function clampRecordColWidth(col: RecordCol, value: number): number {
  return Math.min(RECORD_MAX_COL_WIDTH, Math.max(col.minWidth, value));
}

function loadRecordColWidths(): Record<RecordColKey, number> {
  const defaults = Object.fromEntries(
    RECORD_COLUMNS.map((col) => [col.key, col.defaultWidth]),
  ) as Record<RecordColKey, number>;
  try {
    const raw = localStorage.getItem(RECORD_COL_WIDTHS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<RecordColKey, number>>;
    for (const col of RECORD_COLUMNS) {
      const value = parsed[col.key];
      if (typeof value === "number" && Number.isFinite(value)) {
        defaults[col.key] = clampRecordColWidth(col, value);
      }
    }
  } catch {
    /* ignore malformed storage */
  }
  return defaults;
}

function loadRecordColOrder(): RecordColKey[] {
  const defaults = RECORD_COLUMNS.map((col) => col.key);
  try {
    const raw = localStorage.getItem(RECORD_COL_ORDER_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === defaults.length &&
      defaults.every((key) => parsed.includes(key))
    ) {
      return parsed as RecordColKey[];
    }
  } catch {
    /* ignore malformed storage */
  }
  return defaults;
}

function loadRecordColVisible(): Record<RecordColKey, boolean> {
  const all = Object.fromEntries(
    RECORD_COLUMNS.map((col) => [col.key, true]),
  ) as Record<RecordColKey, boolean>;
  try {
    const raw = localStorage.getItem(RECORD_COL_VISIBLE_KEY);
    if (!raw) return all;
    const parsed = JSON.parse(raw) as Partial<Record<RecordColKey, boolean>>;
    for (const col of RECORD_COLUMNS) {
      if (typeof parsed[col.key] === "boolean") all[col.key] = parsed[col.key]!;
    }
    if (RECORD_COLUMNS.every((col) => !all[col.key])) {
      return Object.fromEntries(
        RECORD_COLUMNS.map((col) => [col.key, true]),
      ) as Record<RecordColKey, boolean>;
    }
  } catch {
    /* ignore malformed storage */
  }
  return all;
}

function loadRecordPageSize(): number {
  try {
    const value = Number(localStorage.getItem(RECORD_PAGE_SIZE_KEY));
    return [25, 50, 100, 250, 500, 1000, 2000].includes(value) ? value : 50;
  } catch {
    return 50;
  }
}

function recordValue(record: ResourceRecord, key: RecordColKey): string {
  return record[key] || "—";
}

function compareRecordValues(a: ResourceRecord, b: ResourceRecord, key: RecordColKey): number {
  if (key === "created" || key === "lastChanged") {
    const aTime = a[key] ? Date.parse(a[key]) : Number.NEGATIVE_INFINITY;
    const bTime = b[key] ? Date.parse(b[key]) : Number.NEGATIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
  }
  return recordValue(a, key).localeCompare(recordValue(b, key), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function RecordSortIcon({
  col,
  sortCol,
  sortDir,
}: {
  col: RecordColKey;
  sortCol: RecordColKey | null;
  sortDir: RecordSortDir;
}) {
  if (sortCol !== col) return <ChevronsUpDown className="ml-1 h-3 w-3 opacity-40 inline" />;
  return sortDir === "asc"
    ? <ArrowUp className="ml-1 h-3 w-3 inline" />
    : <ArrowDown className="ml-1 h-3 w-3 inline" />;
}

function extractDataspaceName(raw: string): string {
  const m = raw.match(/dataspace\('([^']+)'\)/);
  return m ? m[1] : raw;
}

function parseUuidFromUri(uri: string): string {
  const m = uri.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : uri;
}

function parseDataspaces(data: unknown): string[] {
  let items: unknown[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    items = Array.isArray(d.data) ? d.data : Array.isArray(d.dataspaces) ? d.dataspaces : [];
  }
  return items.map((it) => {
    const raw =
      typeof it === "string"
        ? it
        : it && typeof it === "object"
          ? (() => {
              const o = it as Record<string, unknown>;
              return typeof o.name === "string"
                ? o.name
                : typeof o.id === "string"
                  ? o.id
                  : JSON.stringify(it);
            })()
          : String(it);
    return extractDataspaceName(raw);
  });
}

function parseResources(data: unknown): Resource[] {
  let items: unknown[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.resources)) items = d.resources;
    else if (Array.isArray(d.data)) items = d.data;
    else if (Array.isArray(d.items)) items = d.items;
    else {
      const vals = Object.values(d);
      const firstArr = vals.find(Array.isArray);
      if (firstArr) items = firstArr as unknown[];
    }
  }
  return items.map((it) => {
    if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      const name =
        typeof o.name === "string"
          ? o.name
          : typeof o.type === "string"
            ? o.type
            : typeof o.id === "string"
              ? o.id
              : JSON.stringify(it);
      const count = typeof o.count === "number" ? o.count : typeof o.total === "number" ? o.total : 0;
      return { name, count };
    }
    return { name: String(it), count: 0 };
  });
}

function displayResourceName(name: string): string {
  const markerIndex = name.indexOf(".obj_");
  return markerIndex >= 0 ? name.slice(markerIndex + ".obj_".length) : name;
}

function parseRecords(data: unknown): ResourceRecord[] {
  let items: unknown[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.resources)) items = d.resources;
    else if (Array.isArray(d.objects)) items = d.objects;
    else if (Array.isArray(d.data)) items = d.data;
    else if (Array.isArray(d.items)) items = d.items;
    else {
      const vals = Object.values(d);
      const firstArr = vals.find(Array.isArray);
      if (firstArr) items = firstArr as unknown[];
    }
  }
  return items.map((it) => {
    if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      const uri = typeof o.uri === "string" ? o.uri : "";
      const uuid = uri ? parseUuidFromUri(uri) : (typeof o.id === "string" ? o.id : "");
      const name = typeof o.name === "string" ? o.name : "";
      const custom = o.customData && typeof o.customData === "object" ? o.customData as Record<string, unknown> : {};
      const creator = typeof custom.creator === "string" ? custom.creator : (typeof o.creator === "string" ? o.creator : "");
      const created = typeof custom.created === "string" ? custom.created : (typeof o.created === "string" ? o.created : "");
      const lastChanged = typeof o.lastChanged === "string" ? o.lastChanged : "";
      return { uuid, name, creator, created, lastChanged };
    }
    return { uuid: "", name: String(it), creator: "", created: "", lastChanged: "" };
  });
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ReservoirDmsPage() {
  const [dataspaces, setDataspaces] = useState<string[]>([]);
  const [dataspaceError, setDataspaceError] = useState<string | null>(null);
  const [selectedDataspace, setSelectedDataspace] = useState<string>("");

  const [resources, setResources] = useState<Resource[] | null>(null);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [selectedResource, setSelectedResource] = useState<string | null>(null);
  const [resourceCounts, setResourceCounts] = useState<Record<string, number | null>>({});
  const countAbortRef = useRef<AbortController | null>(null);

  const [records, setRecords] = useState<ResourceRecord[] | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [detailRecord, setDetailRecord] = useState<{ json: string; title: string; uuid: string; datatype: string } | null>(null);
  const [recordFilter, setRecordFilter] = useState("");
  const [recordOffset, setRecordOffset] = useState(0);
  const [recordLimit, setRecordLimit] = useState(loadRecordPageSize);
  const [recordSortCol, setRecordSortCol] = useState<RecordColKey | null>(null);
  const [recordSortDir, setRecordSortDir] = useState<RecordSortDir>("asc");
  const [selectedRecordKey, setSelectedRecordKey] = useState<string | null>(null);
  const [recordTableFullscreen, setRecordTableFullscreen] = useState(false);
  const [recordColWidths, setRecordColWidths] = useState<Record<RecordColKey, number>>(loadRecordColWidths);
  const [recordColOrder, setRecordColOrder] = useState<RecordColKey[]>(loadRecordColOrder);
  const [recordColVisible, setRecordColVisible] = useState<Record<RecordColKey, boolean>>(loadRecordColVisible);
  const [recordDragOverCol, setRecordDragOverCol] = useState<RecordColKey | null>(null);
  const recordResizing = useRef<{ key: RecordColKey; startX: number; startW: number } | null>(null);
  const recordDragColRef = useRef<RecordColKey | null>(null);
  const recordEndResizeRef = useRef<(() => void) | null>(null);

  const loadDataspaces = useCallback(async () => {
    setDataspaceError(null);
    try {
      const res = await fetch("/api/osdu/rdms/dataspaces");
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setDataspaceError(err.error ?? "Failed to load dataspaces");
        return;
      }
      const data = await res.json() as unknown;
      const names = parseDataspaces(data);
      setDataspaces(names);
      if (names.length > 0 && !selectedDataspace) {
        setSelectedDataspace(names[0]);
      }
    } catch {
      setDataspaceError("Failed to connect to Reservoir DDMS");
    }
  }, [selectedDataspace]);

  useEffect(() => {
    void loadDataspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    countAbortRef.current?.abort();
    if (!resources || resources.length === 0 || !selectedDataspace) {
      setResourceCounts({});
      return;
    }

    const controller = new AbortController();
    countAbortRef.current = controller;
    const dataspace = selectedDataspace;
    setResourceCounts({});

    resources.forEach((resource) => {
      if (resource.count > 0) {
        setResourceCounts((previous) => ({ ...previous, [resource.name]: resource.count }));
        return;
      }

      fetch(
        `/api/osdu/rdms/dataspaces/${encodeURIComponent(dataspace)}/resources/${encodeURIComponent(resource.name)}`,
        { signal: controller.signal },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error("count fetch failed");
          return parseRecords(await response.json()).length;
        })
        .then((count) => {
          if (!controller.signal.aborted) {
            setResourceCounts((previous) => ({ ...previous, [resource.name]: count }));
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResourceCounts((previous) => ({ ...previous, [resource.name]: null }));
          }
        });
    });

    return () => controller.abort();
  }, [resources, selectedDataspace]);

  const fetchResources = useCallback(async () => {
    if (!selectedDataspace || resourcesLoading) return;
    setResourcesLoading(true);
    setResourcesError(null);
    setResources(null);
    setSelectedResource(null);
    setRecords(null);
    setSelectedRecordKey(null);
    setRecordOffset(0);
    try {
      const res = await fetch(`/api/osdu/rdms/dataspaces/${encodeURIComponent(selectedDataspace)}/resources`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setResourcesError(err.error ?? `Failed to fetch resources for "${selectedDataspace}"`);
        return;
      }
      const data = await res.json() as unknown;
      setResources(parseResources(data));
    } catch {
      setResourcesError("Failed to fetch resources");
    } finally {
      setResourcesLoading(false);
    }
  }, [selectedDataspace, resourcesLoading]);

  const fetchRecordDetail = useCallback(async (uuid: string, datatype: string) => {
    if (!selectedDataspace || !uuid) return;
    try {
      const res = await fetch(
        `/api/osdu/rdms/dataspaces/${encodeURIComponent(selectedDataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(uuid)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setRecordsError(err.error ?? "Failed to fetch record detail");
        return;
      }
      const data: unknown = await res.json();
      setDetailRecord({
        json: JSON.stringify(data, null, 2),
        title: `${datatype} / ${uuid}`,
        uuid,
        datatype,
      });
    } catch {
      setRecordsError("Failed to fetch record detail");
    }
  }, [selectedDataspace]);

  const fetchRecords = useCallback(async (datatype: string) => {
    if (!selectedDataspace || recordsLoading) return;
    setSelectedResource(datatype);
    setRecordsLoading(true);
    setRecordsError(null);
    setRecords(null);
    setSelectedRecordKey(null);
    setRecordOffset(0);
    try {
      const res = await fetch(
        `/api/osdu/rdms/dataspaces/${encodeURIComponent(selectedDataspace)}/resources/${encodeURIComponent(datatype)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setRecordsError(err.error ?? `Failed to fetch records for "${datatype}"`);
        return;
      }
      const data = await res.json() as unknown;
      setRecords(parseRecords(data));
    } catch {
      setRecordsError("Failed to fetch records");
    } finally {
      setRecordsLoading(false);
    }
  }, [selectedDataspace, recordsLoading]);

  const persistRecordColWidths = useCallback((widths: Record<RecordColKey, number>) => {
    try {
      localStorage.setItem(RECORD_COL_WIDTHS_KEY, JSON.stringify(widths));
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const persistRecordColOrder = useCallback((order: RecordColKey[]) => {
    try {
      localStorage.setItem(RECORD_COL_ORDER_KEY, JSON.stringify(order));
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const startRecordResize = useCallback((e: React.MouseEvent, col: RecordCol) => {
    e.preventDefault();
    e.stopPropagation();
    recordEndResizeRef.current?.();
    recordResizing.current = { key: col.key, startX: e.clientX, startW: recordColWidths[col.key] };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (event: MouseEvent) => {
      const resizing = recordResizing.current;
      if (!resizing) return;
      const next = clampRecordColWidth(col, resizing.startW + (event.clientX - resizing.startX));
      setRecordColWidths((previous) =>
        previous[resizing.key] === next ? previous : { ...previous, [resizing.key]: next },
      );
    };
    const end = (persist: boolean) => {
      recordResizing.current = null;
      recordEndResizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onBlur);
      if (persist) {
        setRecordColWidths((previous) => {
          persistRecordColWidths(previous);
          return previous;
        });
      }
    };
    const onMouseUp = () => end(true);
    const onBlur = () => end(true);

    recordEndResizeRef.current = () => end(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onBlur);
  }, [persistRecordColWidths, recordColWidths]);

  useEffect(() => () => {
    recordEndResizeRef.current?.();
  }, []);

  const resetRecordColWidth = useCallback((col: RecordCol) => {
    setRecordColWidths((previous) => {
      const next = { ...previous, [col.key]: col.defaultWidth };
      persistRecordColWidths(next);
      return next;
    });
  }, [persistRecordColWidths]);

  const handleRecordColDragStart = useCallback((e: React.DragEvent, key: RecordColKey) => {
    recordDragColRef.current = key;
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleRecordColDragOver = useCallback((e: React.DragEvent, key: RecordColKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (recordDragColRef.current && recordDragColRef.current !== key) {
      setRecordDragOverCol(key);
    }
  }, []);

  const handleRecordColDrop = useCallback((e: React.DragEvent, targetKey: RecordColKey) => {
    e.preventDefault();
    const sourceKey = recordDragColRef.current;
    if (!sourceKey || sourceKey === targetKey) {
      setRecordDragOverCol(null);
      return;
    }
    setRecordColOrder((previous) => {
      const next = [...previous];
      next.splice(next.indexOf(sourceKey), 1);
      next.splice(next.indexOf(targetKey), 0, sourceKey);
      persistRecordColOrder(next);
      return next;
    });
    setRecordDragOverCol(null);
    recordDragColRef.current = null;
  }, [persistRecordColOrder]);

  const handleRecordColDragEnd = useCallback(() => {
    setRecordDragOverCol(null);
    recordDragColRef.current = null;
  }, []);

  const toggleRecordColVisible = useCallback((key: RecordColKey) => {
    setRecordColVisible((previous) => {
      if (previous[key] && Object.values(previous).filter(Boolean).length <= 1) return previous;
      const next = { ...previous, [key]: !previous[key] };
      try {
        localStorage.setItem(RECORD_COL_VISIBLE_KEY, JSON.stringify(next));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }, []);

  const showAllRecordCols = useCallback(() => {
    const next = Object.fromEntries(
      RECORD_COLUMNS.map((col) => [col.key, true]),
    ) as Record<RecordColKey, boolean>;
    setRecordColVisible(next);
    try {
      localStorage.setItem(RECORD_COL_VISIBLE_KEY, JSON.stringify(next));
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const handleRecordSortClick = (col: RecordColKey) => {
    if (recordSortCol === col) {
      setRecordSortDir((direction) => direction === "asc" ? "desc" : "asc");
    } else {
      setRecordSortCol(col);
      setRecordSortDir("asc");
    }
  };

  const filteredRecords = useMemo(() => {
    const term = recordFilter.trim().toLowerCase();
    if (!term) return records ?? [];
    return (records ?? []).filter((record) =>
      RECORD_COLUMNS.some((col) => recordValue(record, col.key).toLowerCase().includes(term)),
    );
  }, [recordFilter, records]);

  const sortedRecords = useMemo(() => {
    if (!recordSortCol) return filteredRecords;
    return [...filteredRecords].sort((a, b) => {
      const comparison = compareRecordValues(a, b, recordSortCol);
      return recordSortDir === "asc" ? comparison : -comparison;
    });
  }, [filteredRecords, recordSortCol, recordSortDir]);

  const displayRecords = useMemo(
    () => sortedRecords.slice(recordOffset, recordOffset + recordLimit),
    [recordLimit, recordOffset, sortedRecords],
  );

  const orderedRecordCols = useMemo(
    () => recordColOrder
      .filter((key) => recordColVisible[key])
      .map((key) => RECORD_COLUMNS.find((col) => col.key === key)!),
    [recordColOrder, recordColVisible],
  );

  const visibleRecordColCount = useMemo(
    () => Object.values(recordColVisible).filter(Boolean).length,
    [recordColVisible],
  );

  const recordPageStart = sortedRecords.length > 0 ? recordOffset + 1 : 0;
  const recordPageEnd = Math.min(recordOffset + displayRecords.length, sortedRecords.length);
  const recordRowKey = (record: ResourceRecord, index: number) => `${record.uuid || "row"}-${index}`;

  const selectedRecord = useMemo(() => {
    if (!selectedRecordKey) return null;
    return (
      displayRecords.find(
        (record, index) => `${record.uuid || "row"}-${recordOffset + index}` === selectedRecordKey,
      ) ?? null
    );
  }, [displayRecords, recordOffset, selectedRecordKey]);

  const openSelectedRecord = useCallback(() => {
    if (!selectedRecord) return;
    void fetchRecordDetail(selectedRecord.uuid, selectedResource ?? "");
  }, [selectedRecord, selectedResource, fetchRecordDetail]);

  const showRecords = records !== null || recordsLoading || recordsError !== null;

  const renderRecordTable = (fullscreen = false) => (
    <div
      className={cn("border-t border-border overflow-auto", !fullscreen && "rounded-md border")}
      style={fullscreen ? undefined : { maxHeight: "min(72vh, calc(100vh - 350px))" }}
    >
      <Table
        className="text-xs [&_th]:h-8"
        style={{
          tableLayout: "fixed",
          width: orderedRecordCols.reduce((sum, col) => sum + recordColWidths[col.key], 0),
        }}
      >
        <colgroup>
          {orderedRecordCols.map((col) => (
            <col key={col.key} style={{ width: recordColWidths[col.key] }} />
          ))}
        </colgroup>
        <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0] shadow-border">
          <TableRow>
            {orderedRecordCols.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  "relative cursor-pointer select-none whitespace-nowrap overflow-hidden hover:text-foreground transition-colors",
                  recordDragOverCol === col.key && "border-l-2 border-neon",
                )}
                onClick={() => handleRecordSortClick(col.key)}
                onDragOver={(e) => handleRecordColDragOver(e, col.key)}
                onDrop={(e) => handleRecordColDrop(e, col.key)}
                onDragLeave={() => setRecordDragOverCol(null)}
              >
                <span
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    handleRecordColDragStart(e, col.key);
                  }}
                  onDragEnd={handleRecordColDragEnd}
                  onClick={(e) => e.stopPropagation()}
                  title="Drag to reorder column"
                  className="inline-flex items-center mr-1 cursor-grab active:cursor-grabbing opacity-25 hover:opacity-60 transition-opacity align-middle shrink-0"
                >
                  <GripVertical className="h-3 w-3" />
                </span>
                <span className="truncate align-middle">{col.label}</span>
                <RecordSortIcon col={col.key} sortCol={recordSortCol} sortDir={recordSortDir} />
                <span
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize • double-click to reset"
                  onMouseDown={(e) => startRecordResize(e, col)}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    resetRecordColWidth(col);
                  }}
                  className="absolute top-0 right-0 z-20 h-full w-2 cursor-col-resize select-none touch-none after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-border hover:after:bg-neon hover:after:w-0.5 after:transition-colors"
                />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayRecords.length === 0 ? (
            <TableRow>
              <TableCell colSpan={orderedRecordCols.length} className="text-center py-10 text-muted-foreground">
                {recordFilter.trim() ? "No records match the current filter" : "No records found for this resource type."}
              </TableCell>
            </TableRow>
          ) : (
            displayRecords.map((record, index) => {
              const key = recordRowKey(record, recordOffset + index);
              return (
                <TableRow
                  key={key}
                  data-state={selectedRecordKey === key ? "selected" : undefined}
                  className="cursor-pointer hover:bg-muted/50 data-[state=selected]:bg-neon/10 data-[state=selected]:hover:bg-neon/15"
                  onClick={() => setSelectedRecordKey((previous) => previous === key ? null : key)}
                  onDoubleClick={() => { void fetchRecordDetail(record.uuid, selectedResource ?? ""); }}
                  title="Double-click to view detail"
                >
                  {orderedRecordCols.map((col) => {
                    const value = recordValue(record, col.key);
                    return (
                      <TableCell
                        key={col.key}
                        className={cn(
                          "py-1.5 truncate",
                          col.key === "uuid" || col.key === "creator" ? "font-mono text-muted-foreground" : "",
                          col.key === "created" || col.key === "lastChanged" ? "whitespace-nowrap text-muted-foreground" : "",
                        )}
                        title={value}
                      >
                        {col.key === "created" || col.key === "lastChanged"
                          ? formatDate(record[col.key])
                          : value}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-2 px-6 py-3 border-b border-border bg-card/40">
        <FlaskConical className="h-4 w-4 text-emerald-500 shrink-0" />
        <span className="text-sm font-semibold text-foreground mr-2">Reservoir DDMS Data</span>
        <div className="h-4 border-l border-border mx-1" />
        {dataspaceError ? (
          <span className="text-xs text-destructive">{dataspaceError}</span>
        ) : (
          <Select value={selectedDataspace} onValueChange={setSelectedDataspace}>
            <SelectTrigger className="h-8 text-xs w-64">
              <SelectValue placeholder={dataspaces.length === 0 ? "Loading dataspaces…" : "Select dataspace…"} />
            </SelectTrigger>
            <SelectContent>
              {dataspaces.map((ds) => (
                <SelectItem key={ds} value={ds} className="text-xs font-mono">
                  {ds}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={!selectedDataspace || resourcesLoading}
          onClick={() => { void fetchResources(); }}
        >
          {resourcesLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Fetch Resources
        </Button>
      </div>

      {/* Content area — split when records are active */}
      <div className={`flex-1 overflow-hidden ${showRecords ? "flex" : ""}`}>
        {/* Resources panel */}
        <div className={`flex flex-col overflow-auto ${showRecords ? "w-80 shrink-0 border-r border-border" : "w-full"} p-4`}>
          {resourcesError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
              {resourcesError}
            </div>
          )}

          {resources === null && !resourcesError && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
              <FlaskConical className="h-10 w-10 opacity-20" />
              <p className="text-sm text-center">
                {selectedDataspace
                  ? `Select a dataspace and click "Fetch Resources"`
                  : "Select a dataspace to get started"}
              </p>
            </div>
          )}

          {resources !== null && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-foreground">Resources</h2>
                <Badge variant="secondary" className="text-xs font-mono truncate max-w-[10rem]">
                  {selectedDataspace}
                </Badge>
                <Badge variant="outline" className="text-xs shrink-0">
                  {resources.length} type{resources.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              {!showRecords && (
                <p className="text-[11px] text-muted-foreground">Click a row to view its records.</p>
              )}

              {resources.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center border rounded-md">
                  No resources found in this dataspace.
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="text-xs font-semibold text-muted-foreground py-2">name</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground py-2 text-right w-20">count</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resources.map((r, i) => (
                        <TableRow
                          key={i}
                          className={`cursor-pointer select-none transition-colors ${
                            selectedResource === r.name
                              ? "bg-emerald-500/10 hover:bg-emerald-500/15"
                              : "hover:bg-muted/40"
                          }`}
                          onClick={() => { void fetchRecords(r.name); }}
                          title="Click to view records"
                        >
                          <TableCell
                            className="text-xs font-mono py-1.5 truncate max-w-[14rem]"
                            title={r.name}
                          >
                            {displayResourceName(r.name)}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums text-right py-1.5 text-muted-foreground">
                            {(() => {
                              const count = resourceCounts[r.name];
                              if (count === undefined) {
                                return <Loader2 className="inline-block h-3 w-3 animate-spin opacity-50" />;
                              }
                              if (count === null) return "—";
                              return count.toLocaleString();
                            })()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Records panel — shown when a row is double-clicked */}
        {showRecords && (
          <div className="flex-1 flex flex-col overflow-auto p-4 gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-foreground">Records</h2>
                {selectedResource && (
                  <Badge variant="secondary" className="text-xs font-mono truncate max-w-xs">
                    {selectedResource}
                  </Badge>
                )}
                {recordsLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
                {records && (
                  <Badge variant="outline" className="text-xs">
                    {recordPageStart}–{recordPageEnd} of {sortedRecords.length.toLocaleString()} records
                  </Badge>
                )}
              </div>
              {records && records.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className={cn(
                      "h-8 w-8",
                      selectedRecord
                        ? "text-emerald-500 hover:text-emerald-500"
                        : "disabled:opacity-100 disabled:text-muted-foreground",
                    )}
                    disabled={!selectedRecord}
                    onClick={openSelectedRecord}
                    aria-label="Open selected record in Reservoir DDMS viewer"
                    title={selectedRecord ? "Open record JSON (Reservoir DDMS)" : "Select a record first"}
                  >
                    <DatabaseZap className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setRecordTableFullscreen(true)}
                    aria-label="Full screen records table"
                    title="Full screen"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {recordsError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {recordsError}
              </div>
            )}

            {recordsLoading && !recordsError && (
              <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading records…</span>
              </div>
            )}

            {records !== null && !recordsLoading && (
              records.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center border rounded-md">
                  No records found for this resource type.
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 border rounded-md px-2 py-1">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Input
                      placeholder="Filter by UUID, name, creator, or date…"
                      value={recordFilter}
                      onChange={(e) => {
                        setRecordFilter(e.target.value);
                        setRecordOffset(0);
                      }}
                      className="h-7 text-xs py-0 border-0 shadow-none focus-visible:ring-0 bg-transparent placeholder:text-muted-foreground/60"
                    />
                    {recordFilter && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setRecordFilter("");
                          setRecordOffset(0);
                        }}
                        title="Clear filter"
                        aria-label="Clear records filter"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] text-muted-foreground">
                      Click to select; double-click to open full JSON. Drag column edges to resize.
                    </span>
                    <div className="flex items-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                            <Columns3 className="h-3.5 w-3.5" />
                            Columns
                            {visibleRecordColCount < RECORD_COLUMNS.length && (
                              <span className="text-muted-foreground">
                                ({visibleRecordColCount}/{RECORD_COLUMNS.length})
                              </span>
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuLabel className="text-xs">Toggle columns</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {recordColOrder.map((key) => {
                            const col = RECORD_COLUMNS.find((candidate) => candidate.key === key);
                            if (!col) return null;
                            const isLast = visibleRecordColCount === 1 && recordColVisible[key];
                            return (
                              <DropdownMenuCheckboxItem
                                key={key}
                                checked={recordColVisible[key]}
                                onCheckedChange={() => !isLast && toggleRecordColVisible(key)}
                                disabled={isLast}
                                className="text-xs"
                              >
                                {col.label}
                              </DropdownMenuCheckboxItem>
                            );
                          })}
                          {visibleRecordColCount < RECORD_COLUMNS.length && (
                            <>
                              <DropdownMenuSeparator />
                              <button
                                className="w-full text-xs text-center py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors rounded-sm"
                                onClick={showAllRecordCols}
                              >
                                Show all columns
                              </button>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Rows</span>
                        <Select
                          value={String(recordLimit)}
                          onValueChange={(value) => {
                            const nextLimit = Number(value);
                            setRecordLimit(nextLimit);
                            setRecordOffset(0);
                            try {
                              localStorage.setItem(RECORD_PAGE_SIZE_KEY, String(nextLimit));
                            } catch {
                              /* ignore storage errors */
                            }
                          }}
                        >
                          <SelectTrigger className="h-7 w-[70px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[25, 50, 100, 250, 500, 1000, 2000].map((size) => (
                              <SelectItem key={size} value={String(size)} className="text-xs">
                                {size}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setRecordOffset(Math.max(0, recordOffset - recordLimit))}
                          disabled={recordOffset === 0}
                          aria-label="Previous records page"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-xs text-muted-foreground min-w-[90px] text-center">
                          {recordPageStart}–{recordPageEnd} / {sortedRecords.length.toLocaleString()}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setRecordOffset(recordOffset + recordLimit)}
                          disabled={recordPageEnd >= sortedRecords.length}
                          aria-label="Next records page"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  {renderRecordTable()}
                </>
              )
            )}
          </div>
        )}
      </div>

      {records !== null && (
        <Dialog
          open={recordTableFullscreen}
          onOpenChange={(open) => {
            if (!open) setRecordTableFullscreen(false);
          }}
        >
          <DialogContent
            className="max-w-none w-screen h-screen flex flex-col p-0 gap-0 rounded-none border-0"
            aria-describedby={undefined}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRecordTableFullscreen(false);
            }}
          >
            <DialogTitle className="sr-only">Reservoir Records Full Screen</DialogTitle>
            <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-4 py-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium text-foreground">Reservoir Records</span>
                {selectedResource && (
                  <span className="text-xs font-mono text-muted-foreground truncate">{selectedResource}</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setRecordTableFullscreen(false)}
                aria-label="Exit full screen"
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Input
                placeholder="Filter by UUID, name, creator, or date…"
                value={recordFilter}
                onChange={(e) => {
                  setRecordFilter(e.target.value);
                  setRecordOffset(0);
                }}
                className="h-8 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
              />
              {recordFilter && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => {
                    setRecordFilter("");
                    setRecordOffset(0);
                  }}
                  aria-label="Clear records filter"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="flex-1 min-h-0 p-4">
              {renderRecordTable(true)}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {detailRecord && (
        <JsonViewerToolbar
          json={detailRecord.json}
          title={detailRecord.title}
          defaultFullscreen
          hideStorageLookup
          hideSearchLookup
          hideDdmsLookup
          hideWdmsLookup
          rdmsContext={{ dataspace: selectedDataspace, datatype: detailRecord.datatype, uuid: detailRecord.uuid }}
          onFullscreenClose={() => setDetailRecord(null)}
        />
      )}
    </div>
  );
}
