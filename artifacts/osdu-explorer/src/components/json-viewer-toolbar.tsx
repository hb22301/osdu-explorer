import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ClipboardCopy,
  Check,
  TextSelect,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Code,
  List,
  Maximize2,
  Minimize2,
  ExternalLink,
  WrapText,
} from "lucide-react";
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
  /** Internal: when true the component is already inside the fullscreen overlay */
  _isFullscreen?: boolean;
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

export function JsonViewerContent({
  json,
  className,
  storageKey,
  _isFullscreen = false,
  onMaximize,
  onPopOut,
  sharedTreeState,
}: JsonViewerToolbarProps & {
  onMaximize?: () => void;
  onPopOut?: () => void;
  sharedTreeState?: TreeCollapsedState;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeRawMatchRef = useRef<HTMLElement>(null);
  const activeTreeMatchRef = useRef<HTMLElement | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [wordWrap, setWordWrap] = useState(true);
  const [fontSize, setFontSize] = useState(12);

  const MIN_FONT_SIZE = 10;
  const MAX_FONT_SIZE = 20;

  const parsedJson: JsonValue | null = (() => {
    try {
      return JSON.parse(json) as JsonValue;
    } catch {
      return null;
    }
  })();

  const showTree = viewMode === "tree" && parsedJson !== null;

  // --- Tree mode matches ---
  const treeMatches: TreeMatch[] = useMemo(() => {
    if (!showTree || !query || !parsedJson) return [];
    const raw = buildTreeMatches(parsedJson, "root", query);
    return raw.map((m, i) => ({ ...m, globalIndex: i }));
  }, [showTree, query, parsedJson, json]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Raw mode matches ---
  const rawMatches: RawMatch[] = useMemo(() => {
    if (showTree || !query) return [];
    const lower = json.toLowerCase();
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
  }, [showTree, query, json]);

  const totalMatches = showTree ? treeMatches.length : rawMatches.length;

  // Reset active index when matches change
  useEffect(() => {
    setActiveIndex(0);
  }, [treeMatches, rawMatches]);

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
    void navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [json]);

  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) {
        setQuery("");
        setActiveIndex(0);
      }
      return !prev;
    });
  }, []);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === "tree" ? "raw" : "tree"));
  }, []);

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

  const rawSegments = buildRawSegments(json, rawMatches, activeIndex);
  let rawSegmentMatchIndex = -1;

  return (
    <div className={cn("flex flex-col gap-1", _isFullscreen && "h-full", className)}>
      <div className="flex items-center gap-1 rounded-t-md border border-border/40 bg-muted/30 px-2 py-1">
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
          <TooltipContent>{copied ? "Copied!" : "Copy"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", searchOpen && "bg-accent text-accent-foreground")}
              onClick={toggleSearch}
              aria-label="Search"
            >
              <Search className="h-3.5 w-3.5" />
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
              onClick={toggleSearch}
              aria-label="Close search"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {showTree ? (
        <div ref={treeRef} className={cn(_isFullscreen && "flex-1 overflow-auto min-h-0 rounded-b-lg border border-t-0 border-border/40 bg-muted/50 p-4")}>
          <JsonTreeView
            parsed={parsedJson}
            storageKey={storageKey}
            treeMatches={searchOpen ? treeMatches : []}
            activeMatchIndex={searchOpen ? activeIndex : -1}
            onActiveRef={handleActiveTreeRef}
            sharedState={sharedTreeState}
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
            : json}
        </pre>
      )}
    </div>
  );
}

function handlePopOut(json: string, storageKey?: string) {
  const dataKey = `osdu-json-popout-${Date.now()}`;
  localStorage.setItem(dataKey, json);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const params = new URLSearchParams({ data: dataKey });
  if (storageKey) params.set("key", storageKey);
  params.set("label", storageKey ?? "JSON");
  window.open(`${base}/json-popout?${params.toString()}`, "_blank");
}

export function JsonViewerToolbar({ json, className, storageKey }: JsonViewerToolbarProps) {
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  const parsedJson: JsonValue | null = (() => {
    try {
      return JSON.parse(json) as JsonValue;
    } catch {
      return null;
    }
  })();

  // Shared collapse state — lifted here so inline and fullscreen views stay in sync.
  const sharedTreeState = useTreeCollapsed(parsedJson, storageKey);

  return (
    <>
      <JsonViewerContent
        json={json}
        className={className}
        storageKey={storageKey}
        onMaximize={() => setFullscreenOpen(true)}
        onPopOut={() => handlePopOut(json, storageKey)}
        sharedTreeState={sharedTreeState}
      />

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent
          className="max-w-none w-screen h-screen flex flex-col p-0 gap-0 rounded-none border-0"
          aria-describedby={undefined}
          onKeyDown={(e) => {
            if (e.key === "Escape") setFullscreenOpen(false);
          }}
        >
          <DialogTitle className="sr-only">Full-screen JSON viewer</DialogTitle>
          <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-4 py-2 shrink-0">
            <span className="text-xs text-muted-foreground font-mono">JSON</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setFullscreenOpen(false)}
                  aria-label="Exit full screen"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Exit full screen</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex-1 overflow-hidden p-4">
            <JsonViewerContent
              json={json}
              storageKey={storageKey}
              _isFullscreen
              className="h-full"
              sharedTreeState={sharedTreeState}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
