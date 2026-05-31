import { useRef, useState, useCallback, useEffect } from "react";
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
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { JsonTreeView, type JsonValue } from "@/components/json-tree-view";

interface JsonViewerToolbarProps {
  json: string;
  className?: string;
  /** Internal: when true the component is already inside the fullscreen overlay */
  _isFullscreen?: boolean;
}

interface Match {
  start: number;
  end: number;
}

function buildSegments(text: string, matches: Match[], activeIndex: number) {
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

function JsonViewerContent({
  json,
  className,
  _isFullscreen = false,
  onMaximize,
}: JsonViewerToolbarProps & { onMaximize?: () => void }) {
  const preRef = useRef<HTMLPreElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeMatchRef = useRef<HTMLElement>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const parsedJson: JsonValue | null = (() => {
    try {
      return JSON.parse(json) as JsonValue;
    } catch {
      return null;
    }
  })();

  const showTree = viewMode === "tree" && !searchOpen && parsedJson !== null;

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
        setMatches([]);
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

  useEffect(() => {
    if (!query) {
      setMatches([]);
      setActiveIndex(0);
      return;
    }
    const lower = json.toLowerCase();
    const q = query.toLowerCase();
    const found: Match[] = [];
    let idx = 0;
    while (idx < lower.length) {
      const pos = lower.indexOf(q, idx);
      if (pos === -1) break;
      found.push({ start: pos, end: pos + q.length });
      idx = pos + q.length;
    }
    setMatches(found);
    setActiveIndex(0);
  }, [query, json]);

  useEffect(() => {
    if (activeMatchRef.current) {
      activeMatchRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, matches]);

  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    setActiveIndex((i) => (i + 1) % matches.length);
  }, [matches]);

  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches]);

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

  const segments = buildSegments(json, matches, activeIndex);
  let segmentMatchIndex = -1;

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
                  viewMode === "tree" && !searchOpen && "bg-accent text-accent-foreground",
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

        {!_isFullscreen && onMaximize && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 ml-auto"
                onClick={onMaximize}
                aria-label="Expand to full screen"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Full screen</TooltipContent>
          </Tooltip>
        )}

        {searchOpen && (
          <div className={cn("flex flex-1 items-center gap-1", !_isFullscreen && onMaximize ? "mr-0" : "ml-1")}>
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKey}
              placeholder="Find…"
              className="h-6 flex-1 px-2 py-0 text-xs font-mono"
            />
            <span className="min-w-[4rem] text-center text-xs text-muted-foreground">
              {matches.length === 0
                ? query
                  ? "No results"
                  : ""
                : `${activeIndex + 1} / ${matches.length}`}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={goPrev}
              disabled={matches.length === 0}
              aria-label="Previous match"
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={goNext}
              disabled={matches.length === 0}
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
          <JsonTreeView parsed={parsedJson} />
        </div>
      ) : (
        <pre
          ref={preRef}
          className={cn(
            "text-[12px] font-mono bg-muted/50 rounded-b-lg p-4 border border-t-0 border-border/40 text-foreground/90 whitespace-pre-wrap break-all leading-relaxed",
            _isFullscreen && "flex-1 overflow-auto min-h-0",
          )}
        >
          {matches.length > 0
            ? segments.map((seg, i) => {
                if (seg.highlight) {
                  segmentMatchIndex++;
                  const isActive = seg.active;
                  const capturedIndex = segmentMatchIndex;
                  return (
                    <mark
                      key={i}
                      ref={isActive ? activeMatchRef : undefined}
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

export function JsonViewerToolbar({ json, className }: JsonViewerToolbarProps) {
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  return (
    <>
      <JsonViewerContent
        json={json}
        className={className}
        onMaximize={() => setFullscreenOpen(true)}
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
            <JsonViewerContent json={json} _isFullscreen className="h-full" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
