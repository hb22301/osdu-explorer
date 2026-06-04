import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Clock, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const ANY_KIND = "*:*:*:*";
const RECENT_KINDS_KEY = "osdu-navigator:recent-kinds";
const MAX_RECENT = 5;
const MAX_SUGGESTIONS = 80;

function loadRecentKinds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KINDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((k) => typeof k === "string").slice(0, MAX_RECENT);
  } catch { /* ignore */ }
  return [];
}

function saveRecentKinds(kinds: string[]): void {
  try { localStorage.setItem(RECENT_KINDS_KEY, JSON.stringify(kinds)); } catch { /* ignore */ }
}

function pushRecentKind(kind: string, prev: string[]): string[] {
  const next = [kind, ...prev.filter((k) => k !== kind)].slice(0, MAX_RECENT);
  saveRecentKinds(next);
  return next;
}

interface KindComboboxProps {
  value: string;
  onChange: (value: string) => void;
  kinds: string[];
  className?: string;
}

export function KindCombobox({ value, onChange, kinds, className }: KindComboboxProps) {
  const [inputText, setInputText] = useState(value === ANY_KIND ? "" : value);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [recentKinds, setRecentKinds] = useState<string[]>(loadRecentKinds);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep input text in sync when value changes from outside
  useEffect(() => {
    setInputText(value === ANY_KIND ? "" : value);
  }, [value]);

  const sortedKinds = useMemo(() => [...kinds].sort((a, b) => a.localeCompare(b)), [kinds]);

  const { recentFiltered, suggestions } = useMemo(() => {
    const term = inputText.trim().toLowerCase();
    if (!term) {
      const recent = recentKinds.filter((k) => kinds.includes(k));
      const all = sortedKinds.filter((k) => !recent.includes(k)).slice(0, MAX_SUGGESTIONS);
      return { recentFiltered: recent, suggestions: all };
    }
    const matched = sortedKinds.filter((k) => k.toLowerCase().includes(term)).slice(0, MAX_SUGGESTIONS);
    return { recentFiltered: [] as string[], suggestions: matched };
  }, [inputText, sortedKinds, recentKinds, kinds]);

  // Flat ordered list: recent first, then suggestions
  const flatOptions = useMemo<Array<{ kind: string; isRecent: boolean }>>(() => {
    const opts: Array<{ kind: string; isRecent: boolean }> = [];
    for (const k of recentFiltered) opts.push({ kind: k, isRecent: true });
    for (const k of suggestions) opts.push({ kind: k, isRecent: false });
    return opts;
  }, [recentFiltered, suggestions]);

  const select = useCallback((kind: string) => {
    onChange(kind);
    setInputText(kind === ANY_KIND ? "" : kind);
    setOpen(false);
    setActiveIdx(0);
    if (kind !== ANY_KIND) {
      setRecentKinds((prev) => pushRecentKind(kind, prev));
    }
    inputRef.current?.blur();
  }, [onChange]);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        // Restore display to committed value if user typed partial text
        setInputText(value === ANY_KIND ? "" : value);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, value]);

  // Scroll active item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[activeIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    setActiveIdx(0);
    setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatOptions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flatOptions[activeIdx]) {
        select(flatOptions[activeIdx].kind);
      } else if (inputText.trim()) {
        select(inputText.trim());
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setInputText(value === ANY_KIND ? "" : value);
    } else if (e.key === "Tab") {
      // Auto-complete to highlighted item on Tab
      if (flatOptions[activeIdx]) {
        e.preventDefault();
        select(flatOptions[activeIdx].kind);
      }
    }
  };

  const showAnyKindRow = !inputText.trim();

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {/* Input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={inputText}
          placeholder="Any kind  (*:*:*:*)"
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-sm font-mono shadow-sm",
            "placeholder:text-muted-foreground placeholder:font-sans",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          onFocus={() => setOpen(true)}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />
        <ChevronsUpDown
          className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40 pointer-events-none shrink-0"
        />
      </div>

      {/* Dropdown */}
      {open && (
        <ul
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-lg py-1 text-sm"
          role="listbox"
        >
          {/* "Any kind" row — always shown when input is blank */}
          {showAnyKindRow && (
            <li
              role="option"
              aria-selected={value === ANY_KIND}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 cursor-pointer font-mono text-muted-foreground",
                activeIdx === -1 ? "bg-muted/60" : "hover:bg-muted/40",
                value === ANY_KIND && "text-foreground",
              )}
              onMouseDown={(e) => { e.preventDefault(); select(ANY_KIND); }}
              onMouseEnter={() => setActiveIdx(-1)}
            >
              <span className="truncate">Any kind&nbsp;&nbsp;(*:*:*:*)</span>
            </li>
          )}

          {/* "Use custom" row when input doesn't match any known kind */}
          {inputText.trim() && !kinds.some((k) => k.toLowerCase() === inputText.trim().toLowerCase()) && (
            <li
              role="option"
              aria-selected={false}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer font-mono hover:bg-muted/40"
              onMouseDown={(e) => { e.preventDefault(); select(inputText.trim()); }}
            >
              <span className="text-muted-foreground">Use&nbsp;</span>
              <span className="text-neon truncate">"{inputText.trim()}"</span>
            </li>
          )}

          {flatOptions.length === 0 && !showAnyKindRow && (
            <li className="px-3 py-2 text-muted-foreground text-xs">No kinds found</li>
          )}

          {/* Recent group header */}
          {recentFiltered.length > 0 && (
            <li className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1 select-none">
              <Clock className="h-3 w-3" /> Recent
            </li>
          )}

          {flatOptions.map((opt, i) => {
            const isActive = activeIdx === i;
            const isSelected = value === opt.kind;
            const showAllHeader = !inputText.trim() && recentFiltered.length > 0 && !opt.isRecent && i === recentFiltered.length;
            return (
              <li key={`${opt.isRecent ? "r" : "a"}-${opt.kind}`} role="option" aria-selected={isSelected}>
                {showAllHeader && (
                  <div className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium select-none">
                    All kinds
                  </div>
                )}
                <div
                  className={cn(
                    "flex items-center px-3 py-1.5 cursor-pointer font-mono truncate",
                    isActive && "bg-muted/60",
                    !isActive && "hover:bg-muted/40",
                    isSelected && "text-neon",
                  )}
                  onMouseDown={(e) => { e.preventDefault(); select(opt.kind); }}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <span className="truncate">{opt.kind}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
