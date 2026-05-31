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
} from "lucide-react";
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

export function JsonViewerContent({
  json,
  className,
  storageKey,
  _isFullscreen = false,
  onMaximize,
  onPopOut,
  sharedTreeState,
  sharedViewerState,
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
  // Format: <partition>:<data_type>[--<EntityType>]:<id>
  // where data_type ∈ {master-data, reference-data, work-product-component, work-product}
  // and <id> may contain any characters including colons.
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
    // Strip leading non-alphanumeric chars (e.g. surrounding punctuation)
    const raw = text.slice(start, end);
    const token = raw.replace(/^[^a-zA-Z0-9]+/, "");
    if (OSDU_ID_RE.test(token)) {
      const tokenStart = text.indexOf(token, start);
      const newRange = document.createRange();
      newRange.setStart(node, tokenStart);
      newRange.setEnd(node, tokenStart + token.length);
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

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-7 w-7 transition-opacity", !selectedText || lookupLoading ? "opacity-40 pointer-events-none" : "")}
                  onClick={() => { void handleSearchLookup(); }}
                  aria-label="Search for selected text"
                  disabled={!selectedText || !!lookupLoading}
                >
                  {lookupLoading === "search" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {selectedText ? "Search by ID" : "Select text to search by ID"}
              </TooltipContent>
            </Tooltip>
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

export function JsonViewerToolbar({ json, className, storageKey, title, defaultFullscreen = false, onFullscreenClose }: JsonViewerToolbarProps) {
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
