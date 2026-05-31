import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClipboardCopy, Check, TextSelect, Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface JsonViewerToolbarProps {
  json: string;
  className?: string;
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

export function JsonViewerToolbar({ json, className }: JsonViewerToolbarProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeMatchRef = useRef<HTMLElement>(null);

  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleSelectAll = useCallback(() => {
    const pre = preRef.current;
    if (!pre) return;
    const range = document.createRange();
    range.selectNodeContents(pre);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

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
    <div className={cn("flex flex-col gap-1", className)}>
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

        {searchOpen && (
          <div className="ml-1 flex flex-1 items-center gap-1">
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

      <pre
        ref={preRef}
        className="text-[12px] font-mono bg-muted/50 rounded-b-lg p-4 border border-t-0 border-border/40 text-foreground/90 whitespace-pre-wrap break-all leading-relaxed"
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
    </div>
  );
}
