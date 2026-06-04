import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Clock, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const ANY_KIND = "*:*:*:*";
const RECENT_KINDS_KEY = "osdu-navigator:recent-kinds";
const MAX_RECENT = 5;
const MAX_SUGGESTIONS = 100;

// ── Recent kinds ───────────────────────────────────────────────────
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

// ── OSDU segment parsing ───────────────────────────────────────────
// kind format: authority:source:type--EntityName:version
// depths:        0         1      2       3          4

interface ParsedKind {
  prefix: string; // the part already completed
  term: string;   // what's being typed in the current segment
  depth: number;  // 0=authority 1=source 2=type 3=entity 4=version
}

function parseKindInput(input: string): ParsedKind {
  const c1 = input.indexOf(":");
  if (c1 < 0) return { prefix: "", term: input, depth: 0 };

  const c2 = input.indexOf(":", c1 + 1);
  if (c2 < 0) return { prefix: input.slice(0, c1 + 1), term: input.slice(c1 + 1), depth: 1 };

  const seg3 = input.slice(c2 + 1);
  const dd = seg3.indexOf("--");
  if (dd < 0) return { prefix: input.slice(0, c2 + 1), term: seg3, depth: 2 };

  const afterDD = seg3.slice(dd + 2);
  const c3 = afterDD.indexOf(":");
  if (c3 < 0) return { prefix: input.slice(0, c2 + 1 + dd + 2), term: afterDD, depth: 3 };

  return {
    prefix: input.slice(0, c2 + 1 + dd + 2 + c3 + 1),
    term: afterDD.slice(c3 + 1),
    depth: 4,
  };
}

/** Extract the segment value (with its trailing delimiter) for the given depth. */
function extractSegment(rest: string, depth: number): string | null {
  switch (depth) {
    case 0: { const i = rest.indexOf(":"); return i >= 0 ? rest.slice(0, i + 1) : null; }
    case 1: { const i = rest.indexOf(":"); return i >= 0 ? rest.slice(0, i + 1) : null; }
    case 2: { const i = rest.indexOf("--"); return i >= 0 ? rest.slice(0, i + 2) : null; }
    case 3: { const i = rest.indexOf(":"); return i >= 0 ? rest.slice(0, i + 1) : null; }
    case 4: {
      // Version — up to next colon (shouldn't exist in normal kinds, but be safe)
      const i = rest.indexOf(":");
      return i >= 0 ? rest.slice(0, i) : rest;
    }
  }
  return null;
}

interface Suggestion {
  /** Text shown in dropdown */
  label: string;
  /** Full input value when selected (prefix + label) */
  value: string;
  /** True when value is a known complete kind */
  isComplete: boolean;
}

function getSegmentSuggestions(
  kinds: string[],
  prefix: string,
  term: string,
  depth: number,
): Suggestion[] {
  const lowerTerm = term.toLowerCase();
  const prefixLen = prefix.length;

  const seen = new Map<string, boolean>(); // label → isComplete
  for (const k of kinds) {
    if (!k.startsWith(prefix)) continue;
    const rest = k.slice(prefixLen);
    const seg = extractSegment(rest, depth);
    if (!seg) continue;
    if (lowerTerm && !seg.toLowerCase().includes(lowerTerm)) continue;
    const isCompleteKind = (prefix + seg) === k; // only true at depth 4
    if (!seen.has(seg) || (!seen.get(seg) && isCompleteKind)) {
      seen.set(seg, isCompleteKind);
    }
  }

  return Array.from(seen.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_SUGGESTIONS)
    .map(([label, isComplete]) => ({ label, value: prefix + label, isComplete }));
}

// ── Component ──────────────────────────────────────────────────────
export interface KindComboboxProps {
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
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync input when value changes from parent
  useEffect(() => {
    setInputText(value === ANY_KIND ? "" : value);
  }, [value]);

  const sortedKinds = useMemo(() => [...kinds].sort((a, b) => a.localeCompare(b)), [kinds]);

  // ── Compute suggestions ──────────────────────────────────────────
  const { suggestions, mode } = useMemo<{
    suggestions: Suggestion[];
    mode: "empty" | "segment" | "fulltext";
  }>(() => {
    const trimmed = inputText.trim();
    if (!trimmed) return { suggestions: [], mode: "empty" };

    const { prefix, term, depth } = parseKindInput(trimmed);

    // Try segment-aware suggestions first
    const segSuggestions = getSegmentSuggestions(kinds, prefix, term, depth);
    if (segSuggestions.length > 0) {
      return { suggestions: segSuggestions, mode: "segment" };
    }

    // Fallback: full-text search across all kinds
    const lower = trimmed.toLowerCase();
    const fallback = sortedKinds
      .filter((k) => k.toLowerCase().includes(lower))
      .slice(0, MAX_SUGGESTIONS)
      .map((k) => ({ label: k, value: k, isComplete: true }));
    return { suggestions: fallback, mode: "fulltext" };
  }, [inputText, kinds, sortedKinds]);

  const recentFiltered = useMemo(
    () => recentKinds.filter((k) => kinds.includes(k)),
    [recentKinds, kinds],
  );

  // Total flat list for keyboard nav (any kind + custom + recent + suggestions)
  // We enumerate items manually in the JSX; activeIdx aligns with this order:
  // 0 = "any kind" (always) or absent if typing
  // then "use custom" if applicable
  // then recent (blank input only)
  // then suggestions
  const isBlank = !inputText.trim();
  const isExactMatch = kinds.some((k) => k.toLowerCase() === inputText.trim().toLowerCase());
  const showAnyKind = true; // always in list index 0
  const showCustom = !!inputText.trim() && !isExactMatch;
  const showRecent = isBlank && recentFiltered.length > 0;
  const showSuggestions = suggestions.length > 0;

  // Flat navigation count
  const navItems = useMemo(() => {
    const items: Array<{ type: "anykind" | "custom" | "recent" | "suggestion"; idx?: number; value: string }> = [];
    items.push({ type: "anykind", value: ANY_KIND });
    if (showCustom) items.push({ type: "custom", value: inputText.trim() });
    if (showRecent) recentFiltered.forEach((k) => items.push({ type: "recent", value: k }));
    if (showSuggestions) suggestions.forEach((s, i) => items.push({ type: "suggestion", idx: i, value: s.value }));
    return items;
  }, [showCustom, showRecent, showSuggestions, inputText, recentFiltered, suggestions]);

  // Scroll active item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-nav-item]");
    const el = items[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        // Commit current text to parent on outside click
        const t = inputText.trim();
        const committed = t ? t : ANY_KIND;
        if (committed !== value) onChange(committed);
        if (!t) setInputText("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, inputText, value, onChange]);

  // ── Selection ────────────────────────────────────────────────────
  const selectItem = useCallback((v: string, isComplete: boolean, isFullClose: boolean) => {
    setInputText(v === ANY_KIND ? "" : v);
    onChange(v);
    setActiveIdx(0);

    if (isFullClose || v === ANY_KIND) {
      if (v !== ANY_KIND && isComplete) {
        setRecentKinds((prev) => pushRecentKind(v, prev));
      }
      setOpen(false);
      inputRef.current?.blur();
    }
    // else: segment selected — keep open for next segment
  }, [onChange]);

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
      setActiveIdx((i) => Math.min(i + 1, navItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      const item = navItems[activeIdx];
      if (!item) {
        if (inputText.trim()) { e.preventDefault(); selectItem(inputText.trim(), false, true); }
        return;
      }
      e.preventDefault();
      if (item.type === "anykind") {
        selectItem(ANY_KIND, false, true);
      } else if (item.type === "custom") {
        selectItem(inputText.trim(), false, true);
      } else if (item.type === "recent") {
        selectItem(item.value, true, true);
      } else {
        const sg = suggestions[item.idx!];
        // Tab fills segment without closing; Enter also fills segment (keeps open) unless it's a complete kind
        selectItem(sg.value, sg.isComplete, sg.isComplete || e.key === "Enter");
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setInputText(value === ANY_KIND ? "" : value);
      onChange(value); // restore
    }
  };

  // ── Segment depth label for the hint ────────────────────────────
  const segmentHint = useMemo(() => {
    if (isBlank) return null;
    const { depth } = parseKindInput(inputText.trim());
    return ["authority", "source", "type", "entity-name", "version"][depth] ?? null;
  }, [isBlank, inputText]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
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
            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-8",
            "text-sm font-mono shadow-sm transition-colors",
            "placeholder:text-muted-foreground placeholder:font-sans placeholder:text-sm",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
          onFocus={() => setOpen(true)}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
        />
        <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40 pointer-events-none" />
      </div>

      {/* Dropdown */}
      {open && (
        <div
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1 rounded-md border border-border bg-popover shadow-lg overflow-hidden"
          style={{ minWidth: "100%" }}
        >
          {/* Segment hint */}
          {segmentHint && mode === "segment" && (
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 border-b border-border select-none font-medium">
              Completing: {segmentHint}
            </div>
          )}

          <ul className="max-h-64 overflow-y-auto py-1">
            {/* Any kind */}
            <li
              data-nav-item
              role="option"
              aria-selected={value === ANY_KIND}
              className={cn(
                "flex items-center px-3 py-1.5 cursor-pointer font-mono text-xs",
                activeIdx === 0 ? "bg-muted/60" : "hover:bg-muted/40",
                value === ANY_KIND ? "text-foreground" : "text-muted-foreground",
              )}
              onMouseDown={(e) => { e.preventDefault(); selectItem(ANY_KIND, false, true); }}
              onMouseEnter={() => setActiveIdx(0)}
            >
              Any kind&nbsp;&nbsp;(*:*:*:*)
            </li>

            {/* Use custom */}
            {showCustom && (
              <li
                data-nav-item
                role="option"
                aria-selected={false}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 cursor-pointer font-mono text-xs",
                  activeIdx === 1 ? "bg-muted/60" : "hover:bg-muted/40",
                )}
                onMouseDown={(e) => { e.preventDefault(); selectItem(inputText.trim(), false, true); }}
                onMouseEnter={() => setActiveIdx(1)}
              >
                <span className="text-muted-foreground">Use</span>
                <span className="text-neon truncate">"{inputText.trim()}"</span>
              </li>
            )}

            {/* Recent kinds (blank input only) */}
            {showRecent && (
              <>
                <li className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1 select-none">
                  <Clock className="h-3 w-3" /> Recent
                </li>
                {recentFiltered.map((k, ri) => {
                  const navIdx = 1 + ri; // 0=anykind, 1..n=recent
                  return (
                    <li
                      key={`recent-${k}`}
                      data-nav-item
                      role="option"
                      aria-selected={value === k}
                      className={cn(
                        "flex items-center px-3 py-1.5 cursor-pointer font-mono text-xs",
                        activeIdx === navIdx ? "bg-muted/60" : "hover:bg-muted/40",
                        value === k && "text-neon",
                      )}
                      onMouseDown={(e) => { e.preventDefault(); selectItem(k, true, true); }}
                      onMouseEnter={() => setActiveIdx(navIdx)}
                    >
                      <span className="truncate">{k}</span>
                    </li>
                  );
                })}
              </>
            )}

            {/* Segment / fulltext suggestions */}
            {showSuggestions && (
              <>
                {!isBlank && (
                  <li className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium select-none">
                    {mode === "segment" ? "Completions" : "Matching kinds"}
                  </li>
                )}
                {isBlank && (
                  <li className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium select-none">
                    All kinds
                  </li>
                )}
                {suggestions.map((sg, si) => {
                  const navIdx = 1 + (showCustom ? 1 : 0) + (showRecent ? recentFiltered.length : 0) + si;
                  return (
                    <li
                      key={`sg-${sg.value}`}
                      data-nav-item
                      role="option"
                      aria-selected={value === sg.value}
                      className={cn(
                        "flex items-center px-3 py-1.5 cursor-pointer font-mono text-xs",
                        activeIdx === navIdx ? "bg-muted/60" : "hover:bg-muted/40",
                        value === sg.value && "text-neon",
                      )}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        // Segment suggestions (not complete): keep open. Full kind: close.
                        selectItem(sg.value, sg.isComplete, sg.isComplete);
                      }}
                      onMouseEnter={() => setActiveIdx(navIdx)}
                    >
                      <span className="truncate">{sg.label}</span>
                      {!sg.isComplete && (
                        <span className="ml-1 text-[9px] text-muted-foreground/50 shrink-0">→</span>
                      )}
                    </li>
                  );
                })}
              </>
            )}

            {/* Empty state */}
            {!showSuggestions && !isBlank && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No kinds match</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
