import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ClipboardCopy,
  Check,
  TextSelect,
  TextSearch,
  X,
  ChevronUp,
  ChevronDown,
  Code,
  List,
  Maximize2,
  Minimize2,
  ExternalLink,
  WrapText,
  ArrowLeft,
  Search,
  Database,
  Loader2,
  Terminal,
  Waves,
  Grid3x3,
  Download,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConsolePanel } from "@/components/console-panel";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  JsonTreeView,
  buildTreeMatches,
  useTreeCollapsed,
  type JsonValue,
  type TreeMatch,
  type TreeCollapsedState,
} from "@/components/json-tree-view";

interface JsonViewerToolbarProps {
  json: string;
  className?: string;
  storageKey?: string;
  /** Label shown in the fullscreen overlay header */
  title?: string;
  /** Internal: when true the component is already inside the fullscreen overlay */
  _isFullscreen?: boolean;
  /** When true, open directly in fullscreen (no inline view rendered) */
  defaultFullscreen?: boolean;
  /** Called when the fullscreen overlay is closed (only relevant with defaultFullscreen) */
  onFullscreenClose?: () => void;
  /** When true, hide the Storage lookup button in fullscreen mode */
  hideStorageLookup?: boolean;
  /** When true, hide the Wellbore DMS lookup button in fullscreen mode */
  hideWdmsLookup?: boolean;
  /** When provided, the Search lookup button performs an RDMS lookup instead of OSDU search */
  rdmsContext?: { dataspace: string; datatype?: string; uuid?: string };
}

interface RawMatch {
  start: number;
  end: number;
}

function buildRawSegments(text: string, matches: RawMatch[], activeIndex: number) {
  if (matches.length === 0) return [{ text, highlight: false, active: false }];
  const segments: { text: string; highlight: boolean; active: boolean }[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) {
      segments.push({ text: text.slice(cursor, m.start), highlight: false, active: false });
    }
    segments.push({ text: text.slice(m.start, m.end), highlight: true, active: i === activeIndex });
    cursor = m.end;
  });
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlight: false, active: false });
  }
  return segments;
}

type ViewMode = "tree" | "raw";

interface SharedViewerState {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  query: string;
  onQueryChange: (q: string) => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findObjectTypeForUuid(node: JsonValue, uuid: string): string | null {
  if (typeof node !== "object" || node === null) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findObjectTypeForUuid(item, uuid);
      if (found !== null) return found;
    }
    return null;
  }
  const obj = node as Record<string, JsonValue>;

  // If this object directly contains the UUID as a value, check its own $type.
  // Only qualify if $type starts with "resqml" — otherwise keep searching other occurrences.
  const containsUuid = Object.values(obj).some((v) => typeof v === "string" && v === uuid);
  if (containsUuid) {
    const ownType = typeof obj["$type"] === "string" ? (obj["$type"] as string) : undefined;
    if (ownType !== undefined && /^resqml/i.test(ownType)) return ownType;
  }

  // Recurse into child objects regardless, to find other occurrences of the UUID.
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object") {
      const found = findObjectTypeForUuid(val, uuid);
      if (found !== null) return found;
    }
  }
  return null;
}

// ─── RDMS array-data helpers ───────────────────────────────────────────────

const RDMS_ARRAY_TYPES = [
  "resqml20.obj_Grid2dRepresentation",
  "resqml20.obj_PolylineSetRepresentation",
] as const;
type RdmsArrayType = (typeof RDMS_ARRAY_TYPES)[number];

function getRootField<T>(parsed: JsonValue | null, key: string): T | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const v = (parsed as Record<string, JsonValue>)[key];
  return (v as T) ?? null;
}

interface PathTraversalOk { ok: true; value: string }
interface PathTraversalFail {
  ok: false;
  failedKey: string;
  parentPath: string;
  availableKeys: string[] | null;
}
type PathTraversalResult = PathTraversalOk | PathTraversalFail;

function traversePathDebug(root: JsonValue, keys: string[], pathPrefix = ""): PathTraversalResult {
  const fullPath = [pathPrefix, ...keys].filter(Boolean).join(".");
  console.log("[ArrayData] Traversing path:", fullPath);

  let cur: JsonValue = root;
  const traversed: string[] = pathPrefix ? [pathPrefix] : [];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const displayPath = [...traversed, key].join(".");

    if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
      console.log(`[ArrayData] ${displayPath} => FAILED (parent is ${Array.isArray(cur) ? "array" : typeof cur})`);
      return { ok: false, failedKey: key, parentPath: traversed.join(".") || "(root)", availableKeys: null };
    }

    const obj = cur as Record<string, JsonValue>;
    const next = obj[key];

    if (next === null || next === undefined) {
      const availableKeys = Object.keys(obj);
      console.log(`[ArrayData] ${displayPath} => FAILED (value is ${next === undefined ? "undefined" : "null"})`);
      if (i === 0 && !pathPrefix) console.log("[ArrayData] Top-level keys:", availableKeys);
      return { ok: false, failedKey: key, parentPath: traversed.join(".") || "(root)", availableKeys };
    }

    if (i === keys.length - 1) {
      if (typeof next === "string") {
        console.log(`[ArrayData] ${displayPath} => OK`);
        return { ok: true, value: next };
      }
      const availableKeys = Object.keys(obj);
      console.log(`[ArrayData] ${displayPath} => FAILED (expected string, got ${Array.isArray(next) ? "array" : typeof next})`);
      return { ok: false, failedKey: key, parentPath: traversed.join(".") || "(root)", availableKeys };
    }

    console.log(`[ArrayData] ${displayPath} => OK`);
    traversed.push(key);
    cur = next;
  }

  return { ok: false, failedKey: "", parentPath: "(root)", availableKeys: null };
}

function formatPathError(result: PathTraversalFail): string {
  const keysStr = result.availableKeys ? `[${result.availableKeys.join(", ")}]` : "N/A";
  return `Path not found: '${result.failedKey}' not found under '${result.parentPath}'. Available keys: ${keysStr}`;
}

function getRdmsArrayType(parsed: JsonValue | null): RdmsArrayType | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const t = (parsed as Record<string, JsonValue>)["$type"];
  if (typeof t === "string" && (RDMS_ARRAY_TYPES as readonly string[]).includes(t)) {
    return t as RdmsArrayType;
  }
  return null;
}

function getRootUuid(parsed: JsonValue | null): string | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const v = (parsed as Record<string, JsonValue>)["uuid"];
  return typeof v === "string" ? v : null;
}

interface ArrayDataResult {
  label: string;
  dimensions?: number[];
  data?: unknown[];
  error?: string;
}

const MAX_RENDERED_ROWS = 500;

function formatNumber(n: number): string {
  if (!isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toLocaleString();
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs >= 0.001 && abs < 1e7) return parseFloat(n.toPrecision(6)).toString();
  return n.toExponential(4);
}

function ArrayDataTable({ result }: { result: ArrayDataResult }) {
  const [flashCell, setFlashCell] = useState<string | null>(null);

  const shortPath = result.label.split("/").filter(Boolean).slice(-2).join("/");

  if (result.error) {
    return (
      <div className="flex flex-col gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="text-[11px] font-mono text-cyan-500 truncate px-1 cursor-default">…/{shortPath}</div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs font-mono text-[10px] break-all">{result.label}</TooltipContent>
        </Tooltip>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {result.error}
        </div>
      </div>
    );
  }

  const data = result.data ?? [];
  const dims = result.dimensions ?? [data.length];
  const is2D = dims.length >= 2;
  const rowCount = dims[0] ?? 0;
  const colCount = is2D ? (dims[1] ?? 1) : 1;
  const visibleRows = Math.min(rowCount, MAX_RENDERED_ROWS);
  const truncated = rowCount > MAX_RENDERED_ROWS;

  function getCell(row: number, col: number): unknown {
    if (Array.isArray(data[row])) return (data[row] as unknown[])[col];
    if (is2D) return data[row * colCount + col];
    return data[row];
  }

  function renderCellValue(val: unknown) {
    if (val === null || val === undefined) return <span className="text-muted-foreground/40">—</span>;
    if (typeof val === "number") return formatNumber(val);
    if (typeof val === "object") return <span className="font-mono text-muted-foreground/80">{JSON.stringify(val)}</span>;
    return String(val);
  }

  function copyCell(val: unknown, key: string) {
    const text = val === null || val === undefined ? "" : String(val);
    void navigator.clipboard.writeText(text);
    setFlashCell(key);
    setTimeout(() => setFlashCell(prev => prev === key ? null : prev), 700);
  }

  function downloadCsv() {
    const header = is2D
      ? ["row", ...Array.from({ length: colCount }, (_, i) => `col_${i}`)].join(",")
      : "row,value";
    const csvRows = Array.from({ length: rowCount }, (_, ri) => {
      const cells = is2D
        ? Array.from({ length: colCount }, (_, ci) => {
            const v = getCell(ri, ci);
            const s = v === null || v === undefined ? "" : String(v);
            return s.includes(",") ? `"${s}"` : s;
          })
        : [String(getCell(ri, 0) ?? "")];
      return [ri, ...cells].join(",");
    });
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${shortPath.replace(/\//g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const statsLabel = `${rowCount.toLocaleString()} row${rowCount !== 1 ? "s" : ""}${is2D ? ` × ${colCount.toLocaleString()} col${colCount !== 1 ? "s" : ""}` : ""} · [${dims.join(", ")}]`;

  return (
    <div className="flex flex-col gap-2">
      {/* Header: path + stats + download */}
      <div className="flex items-center justify-between gap-3 px-1 min-w-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="text-[11px] font-mono text-cyan-500 truncate cursor-default min-w-0">…/{shortPath}</div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm font-mono text-[10px] break-all">{result.label}</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{statsLabel}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={downloadCsv}>
                <Download className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download CSV ({rowCount.toLocaleString()} rows)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border/50 overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: "55vh" }}>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="sticky left-0 z-10 bg-muted/50 border-r border-border/40 text-[11px] font-semibold text-muted-foreground py-2 px-3 w-14 text-center select-none">
                  #
                </TableHead>
                {is2D
                  ? Array.from({ length: colCount }, (_, ci) => (
                      <TableHead key={ci} className="text-[11px] font-semibold text-muted-foreground py-2 px-3 text-right tabular-nums min-w-[80px]">
                        col {ci}
                      </TableHead>
                    ))
                  : <TableHead className="text-[11px] font-semibold text-muted-foreground py-2 px-3">value</TableHead>
                }
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: visibleRows }, (_, ri) => {
                const isOdd = ri % 2 === 1;
                const rowBg = isOdd ? "hsl(var(--muted) / 0.25)" : "transparent";
                return (
                  <TableRow key={ri} style={{ background: rowBg }} className="hover:!bg-accent/40">
                    <TableCell
                      className="sticky left-0 z-10 border-r border-border/30 text-[11px] tabular-nums text-muted-foreground text-center py-1.5 px-3 select-none w-14"
                      style={{ background: rowBg }}
                    >
                      {ri}
                    </TableCell>
                    {is2D
                      ? Array.from({ length: colCount }, (_, ci) => {
                          const val = getCell(ri, ci);
                          const key = `${ri}-${ci}`;
                          return (
                            <TableCell
                              key={ci}
                              onClick={() => copyCell(val, key)}
                              title="Click to copy"
                              className={cn(
                                "text-xs py-1.5 px-3 tabular-nums text-right cursor-pointer transition-colors duration-150",
                                flashCell === key ? "!bg-yellow-400/40" : ""
                              )}
                            >
                              {renderCellValue(val)}
                            </TableCell>
                          );
                        })
                      : (() => {
                          const val = getCell(ri, 0);
                          const key = `${ri}-0`;
                          return (
                            <TableCell
                              onClick={() => copyCell(val, key)}
                              title="Click to copy"
                              className={cn(
                                "text-xs py-1.5 px-3 tabular-nums cursor-pointer transition-colors duration-150",
                                flashCell === key ? "!bg-yellow-400/40" : ""
                              )}
                            >
                              {renderCellValue(val)}
                            </TableCell>
                          );
                        })()
                    }
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="px-3 py-1.5 border-t border-border/40 bg-muted/20 text-[11px] text-muted-foreground flex items-center justify-between gap-2">
          {truncated
            ? <span className="text-amber-500">Showing first {MAX_RENDERED_ROWS.toLocaleString()} of {rowCount.toLocaleString()} rows — download CSV for all data</span>
            : <span>Click any value cell to copy · {rowCount.toLocaleString()} row{rowCount !== 1 ? "s" : ""} total</span>
          }
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────

export function JsonViewerContent({
  json,
  className,
  storageKey,
  _isFullscreen = false,
  onMaximize,
  onPopOut,
  sharedTreeState,
  sharedViewerState,
  hideStorageLookup,
  hideWdmsLookup,
  rdmsContext,
}: JsonViewerToolbarProps & {
  onMaximize?: () => void;
  onPopOut?: () => void;
  sharedTreeState?: TreeCollapsedState;
  sharedViewerState?: SharedViewerState;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeRawMatchRef = useRef<HTMLElement>(null);
  const activeTreeMatchRef = useRef<HTMLElement | null>(null);

  const [localViewMode, setLocalViewMode] = useState<ViewMode>("tree");
  const [copied, setCopied] = useState(false);
  const [localSearchOpen, setLocalSearchOpen] = useState(false);
  const [localQuery, setLocalQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [wordWrap, setWordWrap] = useState(true);
  const [fontSize, setFontSize] = useState(12);
  const [badgeRendered, setBadgeRendered] = useState(false);
  const [badgeExiting, setBadgeExiting] = useState(false);
  const badgeExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedText, setSelectedText] = useState("");
  const [lookupLoading, setLookupLoading] = useState<"search" | "storage" | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const errorDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overlayJson, setOverlayJson] = useState<string | null>(null);
  const [overlayLabel, setOverlayLabel] = useState<string | null>(null);

  type WdmsResult = {
    urn: string;
    status: "found" | "error";
    columns?: string[];
    dataRows?: unknown[][];
    error?: string;
  };
  const [wdmsOpen, setWdmsOpen] = useState(false);
  const [wdmsResults, setWdmsResults] = useState<WdmsResult[]>([]);
  const [wdmsLoading, setWdmsLoading] = useState(false);
  const [wdmsError, setWdmsError] = useState<string | null>(null);

  const [arrayOpen, setArrayOpen] = useState(false);
  const [arrayLoading, setArrayLoading] = useState(false);
  const [arrayError, setArrayError] = useState<string | null>(null);
  const [arrayResults, setArrayResults] = useState<ArrayDataResult[]>([]);

  const MIN_FONT_SIZE = 10;
  const MAX_FONT_SIZE = 20;

  const viewMode = sharedViewerState ? sharedViewerState.viewMode : localViewMode;
  const searchOpen = sharedViewerState ? sharedViewerState.searchOpen : localSearchOpen;
  const query = sharedViewerState ? sharedViewerState.query : localQuery;

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      if (sharedViewerState) {
        sharedViewerState.onViewModeChange(mode);
      } else {
        setLocalViewMode(mode);
      }
    },
    [sharedViewerState],
  );

  const setSearchOpen = useCallback(
    (open: boolean) => {
      if (sharedViewerState) {
        sharedViewerState.onSearchOpenChange(open);
      } else {
        setLocalSearchOpen(open);
      }
    },
    [sharedViewerState],
  );

  const setQuery = useCallback(
    (q: string) => {
      if (sharedViewerState) {
        sharedViewerState.onQueryChange(q);
      } else {
        setLocalQuery(q);
      }
    },
    [sharedViewerState],
  );

  const displayJson = overlayJson ?? json;

  const parsedJson: JsonValue | null = useMemo(() => {
    try {
      return JSON.parse(displayJson) as JsonValue;
    } catch {
      return null;
    }
  }, [displayJson]);

  const showTree = viewMode === "tree" && parsedJson !== null;

  // --- Tree mode matches ---
  const treeMatches: TreeMatch[] = useMemo(() => {
    if (!showTree || !query || !parsedJson) return [];
    const raw = buildTreeMatches(parsedJson, "root", query);
    return raw.map((m, i) => ({ ...m, globalIndex: i }));
  }, [showTree, query, parsedJson]);

  // --- Raw mode matches ---
  const rawMatches: RawMatch[] = useMemo(() => {
    if (showTree || !query) return [];
    const lower = displayJson.toLowerCase();
    const q = query.toLowerCase();
    const found: RawMatch[] = [];
    let idx = 0;
    while (idx < lower.length) {
      const pos = lower.indexOf(q, idx);
      if (pos === -1) break;
      found.push({ start: pos, end: pos + q.length });
      idx = pos + q.length;
    }
    return found;
  }, [showTree, query, displayJson]);

  const totalMatches = showTree ? treeMatches.length : rawMatches.length;

  // Reset active index when matches change
  useEffect(() => {
    setActiveIndex(0);
  }, [treeMatches, rawMatches]);

  // Animate badge in/out when match count crosses zero
  const hasMatches = totalMatches > 0 && !!query;
  useEffect(() => {
    if (hasMatches) {
      if (badgeExitTimerRef.current) {
        clearTimeout(badgeExitTimerRef.current);
        badgeExitTimerRef.current = null;
      }
      setBadgeExiting(false);
      setBadgeRendered(true);
    } else if (badgeRendered) {
      setBadgeExiting(true);
      badgeExitTimerRef.current = setTimeout(() => {
        setBadgeRendered(false);
        setBadgeExiting(false);
        badgeExitTimerRef.current = null;
      }, 160);
    }
    return () => {
      if (badgeExitTimerRef.current) {
        clearTimeout(badgeExitTimerRef.current);
      }
    };
  }, [hasMatches]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectAll = useCallback(() => {
    const target = showTree ? treeRef.current : preRef.current;
    if (!target) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [showTree]);

  const handleCopy = useCallback(() => {
    const sel = window.getSelection();
    const selectedText = sel && sel.toString().length > 0 ? sel.toString() : null;
    void navigator.clipboard.writeText(selectedText ?? displayJson).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [json]);

  const toggleSearch = useCallback(() => {
    setSearchOpen(!searchOpen);
  }, [searchOpen, setSearchOpen]);

  const closeAndClearSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, [setSearchOpen, setQuery]);

  const toggleViewMode = useCallback(() => {
    setViewMode(viewMode === "tree" ? "raw" : "tree");
  }, [viewMode, setViewMode]);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [searchOpen]);

  // Scroll active raw match into view
  useEffect(() => {
    if (!showTree && activeRawMatchRef.current) {
      activeRawMatchRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, rawMatches, showTree]);

  // Scroll active tree match into view
  useEffect(() => {
    if (showTree && activeTreeMatchRef.current) {
      activeTreeMatchRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, treeMatches, showTree]);

  const goNext = useCallback(() => {
    if (totalMatches === 0) return;
    setActiveIndex((i) => (i + 1) % totalMatches);
  }, [totalMatches]);

  const goPrev = useCallback(() => {
    if (totalMatches === 0) return;
    setActiveIndex((i) => (i - 1 + totalMatches) % totalMatches);
  }, [totalMatches]);

  const handleSearchKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        toggleSearch();
      } else if (e.key === "Enter") {
        if (e.shiftKey) {
          goPrev();
        } else {
          goNext();
        }
        e.preventDefault();
      }
    },
    [toggleSearch, goNext, goPrev],
  );

  const handleActiveTreeRef = useCallback((el: HTMLElement | null) => {
    activeTreeMatchRef.current = el;
  }, []);

  // Auto-select full OSDU record ID on click.
  // OSDU format: <partition>:<data_type>[--<EntityType>]:<id>
  const OSDU_ID_RE = /^[a-zA-Z0-9][\w-]*:(?:master-data|reference-data|work-product-component|work-product)(?:--[\w.-]+)?:.+$/;
  const handleContainerClick = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent ?? "";
    const offset = range.startOffset;
    // Expand left/right through characters that can appear in OSDU IDs
    let start = offset;
    while (start > 0 && /[^\s"'\[\]{},]/.test(text[start - 1])) start--;
    let end = offset;
    while (end < text.length && /[^\s"'\[\]{},]/.test(text[end])) end++;
    const cleanToken = text.slice(start, end).replace(/^[^a-zA-Z0-9]+/, "");
    if (UUID_RE.test(cleanToken) || OSDU_ID_RE.test(cleanToken)) {
      const tokenStart = text.indexOf(cleanToken, start);
      const newRange = document.createRange();
      newRange.setStart(node, tokenStart);
      newRange.setEnd(node, tokenStart + cleanToken.length);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
  }, []);

  // Track text selection within the viewer (fullscreen only)
  useEffect(() => {
    if (!_isFullscreen) return;
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (text && containerRef.current && sel?.rangeCount) {
        const range = sel.getRangeAt(0);
        if (containerRef.current.contains(range.commonAncestorContainer)) {
          setSelectedText(text);
          return;
        }
      }
      setSelectedText("");
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [_isFullscreen]);

  // Auto-dismiss lookup error after 4 seconds
  useEffect(() => {
    if (!lookupError) return;
    if (errorDismissTimerRef.current) clearTimeout(errorDismissTimerRef.current);
    errorDismissTimerRef.current = setTimeout(() => setLookupError(null), 4000);
    return () => {
      if (errorDismissTimerRef.current) clearTimeout(errorDismissTimerRef.current);
    };
  }, [lookupError]);

  const openRecordInPopout = useCallback((recordJson: string, label: string) => {
    const dataKey = `osdu-json-popout-${Date.now()}`;
    localStorage.setItem(dataKey, recordJson);
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const params = new URLSearchParams({ data: dataKey, label });
    window.open(`${base}/json-popout?${params.toString()}`, "_blank");
  }, []);

  const handleStorageLookup = useCallback(async () => {
    if (!selectedText || lookupLoading) return;
    setLookupLoading("storage");
    setLookupError(null);
    const lookupId = selectedText.replace(/:+$/, "");
    try {
      const res = await fetch(`/api/osdu/records/${encodeURIComponent(lookupId)}`);
      if (res.status === 404) { setLookupError("Record not found"); return; }
      if (!res.ok) { setLookupError("Failed to fetch record"); return; }
      const data: unknown = await res.json();
      setOverlayJson(JSON.stringify(data, null, 2));
      setOverlayLabel(selectedText);
    } catch {
      setLookupError("Failed to fetch record");
    } finally {
      setLookupLoading(null);
    }
  }, [selectedText, lookupLoading]);

  const handleSearchLookup = useCallback(async () => {
    if (!selectedText || lookupLoading) return;
    setLookupLoading("search");
    setLookupError(null);
    const lookupId = selectedText.replace(/:+$/, "");
    try {
      const res = await fetch("/api/osdu/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "*:*:*:*", query: `id:"${lookupId}"`, limit: 1 }),
      });
      if (!res.ok) { setLookupError("Search failed"); return; }
      const data = await res.json() as { results: unknown[]; totalCount: number };
      if (data.totalCount === 0 || data.results.length === 0) { setLookupError("No results found"); return; }
      setOverlayJson(JSON.stringify(data.results[0], null, 2));
      setOverlayLabel(selectedText);
    } catch {
      setLookupError("Search failed");
    } finally {
      setLookupLoading(null);
    }
  }, [selectedText, lookupLoading]);

  // Extract OSDU record IDs from selectedText (handles single ID or text containing multiple IDs)
  const OSDU_ID_EXTRACT_RE = /[a-zA-Z0-9][\w-]*:(?:master-data|reference-data|work-product-component|work-product)(?:--[\w.-]+)?:[^\s"'\[\]{},\n\\]+/g;
  const selectedUrns = useMemo(() => {
    if (!selectedText) return [];
    const matches = [...selectedText.matchAll(OSDU_ID_EXTRACT_RE)];
    return [...new Set(matches.map((m) => m[0].replace(/:+$/, "")))];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedText]);

  // WDMS-eligible IDs: only those whose ID string encodes a supported kind
  const WDMS_SUPPORTED_KINDS = ["work-product-component--WellLog", "work-product-component--WellboreTrajectory"];
  const wdmsUrns = useMemo(
    () => selectedUrns.filter((id) => WDMS_SUPPORTED_KINDS.some((k) => id.includes(k))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedUrns],
  );

  const handleWdmsSearch = useCallback(async () => {
    if (wdmsUrns.length === 0 || wdmsLoading) return;
    setWdmsLoading(true);
    setWdmsError(null);
    setWdmsResults([]);
    try {
      const res = await fetch("/api/osdu/wdms/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urns: wdmsUrns }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setWdmsError(err.error ?? "WDMS request failed");
        setWdmsOpen(true);
        return;
      }
      const json = await res.json() as { results: Array<{ urn: string; status: "found" | "error"; data?: Record<string, unknown>; error?: string }> };
      const parsed: WdmsResult[] = json.results.map((row) => {
        if (row.status === "found" && row.data) {
          const columns = Array.isArray(row.data.columns)
            ? (row.data.columns as unknown[]).map(String)
            : undefined;
          const dataRows = Array.isArray(row.data.data)
            ? (row.data.data as unknown[]).map((r) => (Array.isArray(r) ? r : [r]))
            : undefined;
          return { urn: row.urn, status: "found", columns, dataRows };
        }
        return { urn: row.urn, status: "error", error: row.error };
      });
      setWdmsResults(parsed);
      setWdmsOpen(true);
    } catch {
      setWdmsError("Failed to connect to WDMS");
      setWdmsOpen(true);
    } finally {
      setWdmsLoading(false);
    }
  }, [selectedUrns, wdmsLoading]);

  // RDMS lookup: detect UUID in selectedText, resolve $type from JSON context
  const selectedUuid = useMemo(() => {
    if (!rdmsContext || !_isFullscreen) return null;
    const t = selectedText.trim();
    return UUID_RE.test(t) ? t : null;
  }, [rdmsContext, _isFullscreen, selectedText]);

  const rdmsDatatype = useMemo(() => {
    if (!selectedUuid || !parsedJson) return null;
    return findObjectTypeForUuid(parsedJson, selectedUuid);
  }, [selectedUuid, parsedJson]);

  // RDMS array-data: detect entity type and UUID from the root of the original record
  const parsedOriginalJson: JsonValue | null = useMemo(() => {
    try { return JSON.parse(json) as JsonValue; } catch { return null; }
  }, [json]);
  const rdmsArrayType = useMemo((): RdmsArrayType | null => {
    if (!rdmsContext) return null;
    // Prefer the datatype passed directly via rdmsContext (set from the resource selection),
    // fall back to parsing $type from the JSON root.
    const candidate = rdmsContext.datatype ?? getRootField<string>(parsedOriginalJson, "$type");
    if (typeof candidate === "string" && (RDMS_ARRAY_TYPES as readonly string[]).includes(candidate)) {
      return candidate as RdmsArrayType;
    }
    return null;
  }, [rdmsContext, parsedOriginalJson]);
  const rdmsRootUuid = useMemo(
    () => rdmsContext?.uuid ?? getRootUuid(parsedOriginalJson),
    [rdmsContext, parsedOriginalJson],
  );

  const handleRdmsLookup = useCallback(async () => {
    if (!selectedUuid || !rdmsContext || lookupLoading) return;
    setLookupLoading("search");
    setLookupError(null);
    const datatype = rdmsDatatype ?? "";
    try {
      const url = `/api/osdu/rdms/dataspaces/${encodeURIComponent(rdmsContext.dataspace)}/resources/${encodeURIComponent(datatype)}/${encodeURIComponent(selectedUuid)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setLookupError(err.error ?? "Failed to fetch RDMS record");
        return;
      }
      const data: unknown = await res.json();
      setOverlayJson(JSON.stringify(data, null, 2));
      setOverlayLabel(selectedUuid);
    } catch {
      setLookupError("Failed to fetch RDMS record");
    } finally {
      setLookupLoading(null);
    }
  }, [selectedUuid, rdmsContext, rdmsDatatype, lookupLoading]);

  const handleArrayData = useCallback(async () => {
    if (!rdmsContext || !parsedOriginalJson || !rdmsArrayType || !rdmsRootUuid) return;
    setArrayOpen(true);
    setArrayLoading(true);
    setArrayError(null);
    setArrayResults([]);

    const ds = encodeURIComponent(rdmsContext.dataspace);
    const dt = encodeURIComponent(rdmsArrayType);
    const uid = encodeURIComponent(rdmsRootUuid);
    const base = `/api/osdu/rdms/dataspaces/${ds}/resources/${dt}/${uid}/arrays`;

    async function fetchArrayPath(hdfPath: string): Promise<ArrayDataResult> {
      const res = await fetch(`${base}?path=${encodeURIComponent(hdfPath)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        return { label: hdfPath, error: err.error ?? `HTTP ${res.status}` };
      }
      const payload = await res.json() as { data?: { data?: unknown; dimensions?: number[] } };
      const data = Array.isArray(payload.data?.data) ? payload.data.data as unknown[] : [];
      const dimensions = Array.isArray(payload.data?.dimensions) ? payload.data.dimensions as number[] : [data.length];
      return { label: hdfPath, dimensions, data };
    }

    try {
      console.log("[ArrayData] Full JSON:", parsedOriginalJson);

      // The API may return an array of records; always use the first element.
      const root: JsonValue = Array.isArray(parsedOriginalJson)
        ? (parsedOriginalJson as JsonValue[])[0] ?? null
        : parsedOriginalJson;

      if (!root || typeof root !== "object" || Array.isArray(root)) {
        setArrayError("JSON root is not an object (empty or unexpected structure)");
        return;
      }

      if (rdmsArrayType === "resqml20.obj_Grid2dRepresentation") {
        const result = traversePathDebug(
          root,
          ["Grid2dPatch", "Geometry", "Points", "ZValues", "Values", "PathInHdfFile"],
        );
        if (!result.ok) { setArrayError(formatPathError(result)); return; }
        setArrayResults([await fetchArrayPath(result.value)]);

      } else if (rdmsArrayType === "resqml20.obj_PolylineSetRepresentation") {
        // Resolve LinePatch (may be an array — use first element)
        const rawLinePatch = (root as Record<string, JsonValue>)["LinePatch"] ?? null;
        const patch: JsonValue = Array.isArray(rawLinePatch)
          ? (rawLinePatch as JsonValue[])[0] ?? null
          : rawLinePatch;

        if (!patch) {
          const availableKeys = Object.keys(root as Record<string, JsonValue>);
          const keysStr = `[${availableKeys.join(", ")}]`;
          console.log("[ArrayData] LinePatch => FAILED. Top-level keys:", availableKeys);
          setArrayError(`Path not found: 'LinePatch' not found under '(root)'. Available keys: ${keysStr}`);
          return;
        }
        console.log("[ArrayData] LinePatch => OK (using index 0 if array)");

        const results: ArrayDataResult[] = [];

        const ncResult = traversePathDebug(patch, ["NodeCountPerPolyline", "Values", "PathInHdfFile"], "LinePatch[0]");
        results.push(ncResult.ok
          ? await fetchArrayPath(ncResult.value)
          : { label: "LinePatch.NodeCountPerPolyline.Values.PathInHdfFile", error: formatPathError(ncResult) });

        const coordResult = traversePathDebug(patch, ["Geometry", "Points", "Coordinates", "PathInHdfFile"], "LinePatch[0]");
        results.push(coordResult.ok
          ? await fetchArrayPath(coordResult.value)
          : { label: "LinePatch.Geometry.Points.Coordinates.PathInHdfFile", error: formatPathError(coordResult) });

        setArrayResults(results);
      }
    } catch {
      setArrayError("Failed to fetch array data");
    } finally {
      setArrayLoading(false);
    }
  }, [rdmsContext, parsedOriginalJson, rdmsArrayType, rdmsRootUuid]);

  const rawSegments = buildRawSegments(displayJson, rawMatches, activeIndex);
  let rawSegmentMatchIndex = -1;

  return (
    <div ref={containerRef} className={cn("flex flex-col gap-1", _isFullscreen && "h-full", className)} onClick={handleContainerClick}>
      {_isFullscreen && lookupError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive animate-in fade-in slide-in-from-top-1 duration-150">
          <span className="flex-1">{lookupError}</span>
          <button
            onClick={() => setLookupError(null)}
            className="shrink-0 rounded p-0.5 hover:bg-destructive/20 transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className={cn(
        "flex items-center gap-1 rounded-t-md border border-border/40 px-2 py-1",
        _isFullscreen
          ? "bg-muted/30"
          : "sticky top-0 z-10 bg-card/95 backdrop-blur-sm",
      )}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleSelectAll}
              aria-label="Select all"
            >
              <TextSelect className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Select all</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleCopy}
              aria-label="Copy"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <ClipboardCopy className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied!" : "Copy selection (or all)"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7 relative", searchOpen && "bg-accent text-accent-foreground")}
              onClick={toggleSearch}
              aria-label="Search"
            >
              <TextSearch className="h-3.5 w-3.5" />
              {badgeRendered && (
                <span
                  className={cn(
                    "absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold leading-none text-primary-foreground pointer-events-none select-none",
                    badgeExiting
                      ? "animate-out fade-out zoom-out-75 duration-150 motion-reduce:duration-0"
                      : "animate-in fade-in zoom-in-75 duration-150 motion-reduce:duration-0",
                  )}
                >
                  {totalMatches > 99 ? "99+" : totalMatches}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Find</TooltipContent>
        </Tooltip>

        {parsedJson !== null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7",
                  viewMode === "tree" && "bg-accent text-accent-foreground",
                )}
                onClick={toggleViewMode}
                aria-label={viewMode === "tree" ? "Switch to raw view" : "Switch to tree view"}
              >
                {viewMode === "tree" ? (
                  <Code className="h-3.5 w-3.5" />
                ) : (
                  <List className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {viewMode === "tree" ? "Raw view" : "Tree view"}
            </TooltipContent>
          </Tooltip>
        )}

        {_isFullscreen && (
          <>
            {overlayJson && (
              <>
                <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => { setOverlayJson(null); setOverlayLabel(null); }}
                      aria-label="Back to original"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Back to original</TooltipContent>
                </Tooltip>
                {overlayLabel && (
                  <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                    {overlayLabel}
                  </span>
                )}
              </>
            )}
            <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7", wordWrap && "bg-accent text-accent-foreground")}
                  onClick={() => setWordWrap((v) => !v)}
                  aria-label={wordWrap ? "Disable word wrap" : "Enable word wrap"}
                >
                  <WrapText className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{wordWrap ? "Disable word wrap" : "Enable word wrap"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setFontSize((s) => Math.max(MIN_FONT_SIZE, s - 1))}
                  disabled={fontSize <= MIN_FONT_SIZE}
                  aria-label="Decrease font size"
                >
                  <span className="text-[10px] font-bold font-mono leading-none select-none">A-</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Decrease font size</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setFontSize((s) => Math.min(MAX_FONT_SIZE, s + 1))}
                  disabled={fontSize >= MAX_FONT_SIZE}
                  aria-label="Increase font size"
                >
                  <span className="text-[13px] font-bold font-mono leading-none select-none">A+</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Increase font size</TooltipContent>
            </Tooltip>

            <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />

            {!hideStorageLookup && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-7 w-7 transition-opacity", !selectedText || lookupLoading ? "opacity-40 pointer-events-none" : "")}
                    onClick={() => { void handleStorageLookup(); }}
                    aria-label="Look up selected text in Storage"
                    disabled={!selectedText || !!lookupLoading}
                  >
                    {lookupLoading === "storage" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Database className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {selectedText ? "Look up in Storage" : "Select text to look up in Storage"}
                </TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-7 w-7 transition-opacity",
                    rdmsContext
                      ? (!selectedUuid || !!lookupLoading ? "opacity-40 pointer-events-none" : "")
                      : (!selectedText || !!lookupLoading ? "opacity-40 pointer-events-none" : ""),
                  )}
                  onClick={() => { rdmsContext ? void handleRdmsLookup() : void handleSearchLookup(); }}
                  aria-label={rdmsContext ? "Look up UUID in Reservoir DMS" : "Search for selected text"}
                  disabled={rdmsContext ? (!selectedUuid || !!lookupLoading) : (!selectedText || !!lookupLoading)}
                >
                  {lookupLoading === "search" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {rdmsContext
                  ? (selectedUuid ? "Look up UUID in Reservoir DMS" : "Click a UUID value to enable lookup")
                  : (selectedText ? "Search by ID" : "Select text to search by ID")}
              </TooltipContent>
            </Tooltip>

            {!hideWdmsLookup && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-7 w-7 transition-opacity", wdmsUrns.length === 0 || wdmsLoading ? "opacity-40 pointer-events-none" : "")}
                    onClick={() => { void handleWdmsSearch(); }}
                    aria-label="Search Wellbore DMS"
                    disabled={wdmsUrns.length === 0 || wdmsLoading}
                  >
                    {wdmsLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Waves className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {wdmsUrns.length > 0
                    ? `Search Wellbore DMS (${wdmsUrns.length} ID${wdmsUrns.length > 1 ? "s" : ""})`
                    : selectedUrns.length > 0
                      ? "Selected IDs are not WellLog or WellboreTrajectory"
                      : "Select a WellLog or WellboreTrajectory ID to search Wellbore DMS"}
                </TooltipContent>
              </Tooltip>
            )}

            {rdmsContext && rdmsArrayType && (
              <>
                <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => { void handleArrayData(); }}
                      aria-label="Get array data from Reservoir DMS"
                      disabled={arrayLoading}
                    >
                      {arrayLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Grid3x3 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Get Array Data from Reservoir DMS</TooltipContent>
                </Tooltip>
              </>
            )}

          </>
        )}

        {!_isFullscreen && (onMaximize || onPopOut) && (
          <div className="flex items-center gap-1 ml-auto">
            {onMaximize && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={onMaximize}
                    aria-label="Expand to full screen"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Full screen</TooltipContent>
              </Tooltip>
            )}
            {onPopOut && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={onPopOut}
                    aria-label="Pop out in new tab"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Pop out in new tab</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {searchOpen && (
          <div className={cn("flex flex-1 items-center gap-1", !_isFullscreen && (onMaximize || onPopOut) ? "mr-0" : "ml-1")}>
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKey}
              placeholder="Find…"
              className="h-6 flex-1 px-2 py-0 text-xs font-mono"
            />
            <span className="min-w-[4rem] text-center text-xs text-muted-foreground">
              {totalMatches === 0
                ? query
                  ? "No results"
                  : ""
                : `${activeIndex + 1} / ${totalMatches}`}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={goPrev}
              disabled={totalMatches === 0}
              aria-label="Previous match"
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={goNext}
              disabled={totalMatches === 0}
              aria-label="Next match"
            >
              <ChevronDown className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={closeAndClearSearch}
              aria-label="Close search"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {showTree ? (
        <div
          ref={treeRef}
          className={cn(_isFullscreen && "flex-1 overflow-auto min-h-0 rounded-b-lg border border-t-0 border-border/40 bg-muted/50 p-4")}
          style={_isFullscreen ? { fontSize: `${fontSize}px` } : undefined}
        >
          <JsonTreeView
            parsed={parsedJson}
            storageKey={overlayJson ? (overlayLabel ?? undefined) : storageKey}
            treeMatches={searchOpen ? treeMatches : []}
            activeMatchIndex={searchOpen ? activeIndex : -1}
            onActiveRef={handleActiveTreeRef}
            onMatchClick={searchOpen ? setActiveIndex : undefined}
            sharedState={overlayJson ? undefined : sharedTreeState}
          />
        </div>
      ) : (
        <pre
          ref={preRef}
          className={cn(
            "font-mono bg-muted/50 rounded-b-lg p-4 border border-t-0 border-border/40 text-foreground/90 leading-relaxed",
            wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre overflow-x-auto",
            _isFullscreen && "flex-1 overflow-auto min-h-0",
          )}
          style={{ fontSize: `${fontSize}px` }}
        >
          {rawMatches.length > 0
            ? rawSegments.map((seg, i) => {
                if (seg.highlight) {
                  rawSegmentMatchIndex++;
                  const isActive = seg.active;
                  const capturedIndex = rawSegmentMatchIndex;
                  return (
                    <mark
                      key={i}
                      ref={isActive ? activeRawMatchRef : undefined}
                      onClick={() => setActiveIndex(capturedIndex)}
                      className={cn(
                        "rounded-sm cursor-pointer",
                        isActive
                          ? "bg-orange-400/80 text-foreground"
                          : "bg-yellow-300/70 text-foreground",
                      )}
                    >
                      {seg.text}
                    </mark>
                  );
                }
                return <span key={i}>{seg.text}</span>;
              })
            : displayJson}
        </pre>
      )}

      {/* Wellbore DMS results dialog */}
      <Dialog open={wdmsOpen} onOpenChange={setWdmsOpen}>
        <DialogContent className="max-w-6xl w-full flex flex-col gap-3" style={{ maxHeight: "90vh" }}>
          <DialogTitle className="flex items-center gap-2">
            <Waves className="h-4 w-4 text-cyan-500" />
            Wellbore DMS Results
            {wdmsResults.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {wdmsResults.length} record{wdmsResults.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </DialogTitle>
          {wdmsError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {wdmsError}
            </div>
          )}
          {!wdmsError && wdmsResults.length === 0 && (
            <div className="text-xs text-muted-foreground py-4 text-center">No results returned.</div>
          )}
          {wdmsResults.length > 0 && (
            <ScrollArea className="flex-1 min-h-0" style={{ maxHeight: "75vh" }}>
              <div className="flex flex-col gap-6">
                {wdmsResults.map((result, ri) => (
                  <div key={ri} className="flex flex-col gap-2">
                    {wdmsResults.length > 1 && (
                      <div className="text-[11px] font-mono text-cyan-500 break-all px-1">
                        {result.urn}
                      </div>
                    )}
                    {result.status === "error" ? (
                      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {result.error ?? "Error fetching data"}
                      </div>
                    ) : result.columns && result.dataRows ? (
                      <div className="rounded-md border border-border/50 overflow-hidden">
                        <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-muted/40">
                                <TableHead className="whitespace-nowrap font-semibold text-xs py-2 px-3 text-muted-foreground sticky left-0 bg-muted/40 z-10">
                                  #
                                </TableHead>
                                {result.columns.map((col) => (
                                  <TableHead key={col} className="whitespace-nowrap font-semibold text-xs py-2 px-3">
                                    {col}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {result.dataRows.map((row, rowIdx) => (
                                <TableRow key={rowIdx} className="hover:bg-muted/30">
                                  <TableCell className="text-xs py-1.5 px-3 tabular-nums text-muted-foreground sticky left-0 bg-background z-10 border-r border-border/30">
                                    {rowIdx + 1}
                                  </TableCell>
                                  {result.columns!.map((col, colIdx) => {
                                    const val = row[colIdx];
                                    return (
                                      <TableCell key={col} className="text-xs py-1.5 px-3 tabular-nums">
                                        {val === undefined || val === null
                                          ? <span className="text-muted-foreground/40">—</span>
                                          : typeof val === "number"
                                            ? val
                                            : typeof val === "object"
                                              ? <span className="font-mono text-muted-foreground">{JSON.stringify(val)}</span>
                                              : String(val)}
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        <div className="px-3 py-1.5 border-t border-border/40 bg-muted/20 text-[11px] text-muted-foreground">
                          {result.dataRows.length} row{result.dataRows.length !== 1 ? "s" : ""} · {result.columns.length} column{result.columns.length !== 1 ? "s" : ""}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic px-1">
                        Response did not contain a <code className="font-mono">columns</code> / <code className="font-mono">data</code> array.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Array Data dialog */}
      <Dialog open={arrayOpen} onOpenChange={setArrayOpen}>
        <DialogContent className="max-w-5xl w-full flex flex-col gap-3" style={{ maxHeight: "90vh" }} aria-describedby={undefined}>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Grid3x3 className="h-4 w-4 text-emerald-500" />
            Array Data — Reservoir DMS
            {rdmsArrayType && (
              <Badge variant="secondary" className="ml-1 text-xs font-mono font-normal">
                {rdmsArrayType}
              </Badge>
            )}
          </DialogTitle>

          {arrayLoading && (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Fetching array data…</span>
            </div>
          )}

          {!arrayLoading && arrayError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {arrayError}
            </div>
          )}

          {!arrayLoading && !arrayError && arrayResults.length === 0 && (
            <div className="text-xs text-muted-foreground py-4 text-center">No data returned.</div>
          )}

          {!arrayLoading && arrayResults.length > 0 && (
            <ScrollArea className="flex-1 min-h-0" style={{ maxHeight: "75vh" }}>
              <div className="flex flex-col gap-6 pr-1">
                {arrayResults.map((result, ri) => (
                  <ArrayDataTable key={ri} result={result} />
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SyncMessage =
  | { type: "viewMode"; value: ViewMode }
  | { type: "query"; value: string }
  | { type: "searchOpen"; value: boolean };

const FS_CONSOLE_DEFAULT = 300;
const FS_CONSOLE_MIN = 80;
const FS_CONSOLE_MAX = 700;

export function JsonViewerToolbar({ json, className, storageKey, title, defaultFullscreen = false, onFullscreenClose, hideStorageLookup, hideWdmsLookup, rdmsContext }: JsonViewerToolbarProps) {
  const [fullscreenOpen, setFullscreenOpen] = useState(defaultFullscreen);
  const [fsConsoleOpen, setFsConsoleOpen] = useState(false);
  const [fsConsoleHeight, setFsConsoleHeight] = useState(FS_CONSOLE_DEFAULT);
  const fsConsoleDragState = useRef<{ startY: number; startHeight: number } | null>(null);

  const handleFsConsoleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    fsConsoleDragState.current = { startY: e.clientY, startHeight: fsConsoleHeight };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!fsConsoleDragState.current) return;
      const delta = fsConsoleDragState.current.startY - ev.clientY;
      const next = Math.min(FS_CONSOLE_MAX, Math.max(FS_CONSOLE_MIN, fsConsoleDragState.current.startHeight + delta));
      setFsConsoleHeight(next);
    };
    const onUp = () => {
      fsConsoleDragState.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [fsConsoleHeight]);

  const handleFullscreenClose = useCallback(() => {
    setFullscreenOpen(false);
    onFullscreenClose?.();
  }, [onFullscreenClose]);

  const parsedJson: JsonValue | null = (() => {
    try {
      return JSON.parse(json) as JsonValue;
    } catch {
      return null;
    }
  })();

  // Shared collapse state — lifted here so inline and fullscreen views stay in sync.
  const sharedTreeState = useTreeCollapsed(parsedJson, storageKey);

  // Shared viewer state — lifted here so inline and fullscreen views stay in sync.
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  // BroadcastChannel sync with the pop-out tab.
  const channelName = storageKey ? `osdu-json-sync-${storageKey}` : null;
  const channelRef = useRef<BroadcastChannel | null>(null);
  // Track the last value received from the channel so we don't echo it back.
  const lastReceivedRef = useRef<{ viewMode: ViewMode | null; query: string | null; searchOpen: boolean | null }>({
    viewMode: null,
    query: null,
    searchOpen: null,
  });

  useEffect(() => {
    if (!channelName) return;
    const ch = new BroadcastChannel(channelName);
    channelRef.current = ch;
    ch.onmessage = (e: MessageEvent<SyncMessage>) => {
      const msg = e.data;
      if (msg.type === "viewMode") { lastReceivedRef.current.viewMode = msg.value; setViewMode(msg.value); }
      if (msg.type === "query") { lastReceivedRef.current.query = msg.value; setQuery(msg.value); }
      if (msg.type === "searchOpen") { lastReceivedRef.current.searchOpen = msg.value; setSearchOpen(msg.value); }
    };
    return () => { ch.close(); channelRef.current = null; };
  }, [channelName]);

  useEffect(() => {
    if (!channelRef.current) return;
    if (lastReceivedRef.current.viewMode === viewMode) { lastReceivedRef.current.viewMode = null; return; }
    channelRef.current.postMessage({ type: "viewMode", value: viewMode } satisfies SyncMessage);
  }, [viewMode]);

  useEffect(() => {
    if (!channelRef.current) return;
    if (lastReceivedRef.current.query === query) { lastReceivedRef.current.query = null; return; }
    channelRef.current.postMessage({ type: "query", value: query } satisfies SyncMessage);
  }, [query]);

  useEffect(() => {
    if (!channelRef.current) return;
    if (lastReceivedRef.current.searchOpen === searchOpen) { lastReceivedRef.current.searchOpen = null; return; }
    channelRef.current.postMessage({ type: "searchOpen", value: searchOpen } satisfies SyncMessage);
  }, [searchOpen]);

  const sharedViewerState: SharedViewerState = {
    viewMode,
    onViewModeChange: setViewMode,
    query,
    onQueryChange: setQuery,
    searchOpen,
    onSearchOpenChange: setSearchOpen,
  };

  const handlePopOut = useCallback(() => {
    const dataKey = `osdu-json-popout-${Date.now()}`;
    localStorage.setItem(dataKey, json);
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const params = new URLSearchParams({ data: dataKey });
    if (storageKey) params.set("key", storageKey);
    params.set("label", storageKey ?? "JSON");
    params.set("viewMode", viewMode);
    params.set("query", query);
    params.set("searchOpen", searchOpen ? "1" : "0");
    if (channelName) params.set("channel", channelName);
    window.open(`${base}/json-popout?${params.toString()}`, "_blank");
  }, [json, storageKey, viewMode, query, searchOpen, channelName]);

  return (
    <>
      {!defaultFullscreen && (
        <JsonViewerContent
          json={json}
          className={className}
          storageKey={storageKey}
          onMaximize={() => setFullscreenOpen(true)}
          onPopOut={handlePopOut}
          sharedTreeState={sharedTreeState}
          sharedViewerState={sharedViewerState}
          hideStorageLookup={hideStorageLookup}
          hideWdmsLookup={hideWdmsLookup}
          rdmsContext={rdmsContext}
        />
      )}

      <Dialog open={fullscreenOpen} onOpenChange={(open) => { if (!open) handleFullscreenClose(); }}>
        <DialogContent
          className="max-w-none w-screen h-screen flex flex-col p-0 gap-0 rounded-none border-0"
          aria-describedby={undefined}
          onKeyDown={(e) => {
            if (e.key === "Escape") handleFullscreenClose();
          }}
        >
          <DialogTitle className="sr-only">{title ?? "Full-screen JSON viewer"}</DialogTitle>
          <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-4 py-2 shrink-0">
            <span className="text-sm font-medium text-foreground">{title ?? "JSON"}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleFullscreenClose}
                  aria-label="Exit full screen"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Exit full screen</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex-1 overflow-hidden min-h-0 p-4">
            <JsonViewerContent
              json={json}
              storageKey={storageKey}
              _isFullscreen
              className="h-full"
              sharedTreeState={sharedTreeState}
              sharedViewerState={sharedViewerState}
              hideStorageLookup={hideStorageLookup}
              hideWdmsLookup={hideWdmsLookup}
              rdmsContext={rdmsContext}
            />
          </div>
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
    </>
  );
}
