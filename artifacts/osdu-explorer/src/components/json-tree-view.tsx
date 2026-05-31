import { useState, useCallback, useEffect, useRef, useMemo, useLayoutEffect } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export interface TreeMatch {
  path: string;
  matchIn: "key" | "value";
  start: number;
  end: number;
  globalIndex: number;
}

interface JsonTreeNodeProps {
  value: JsonValue;
  path: string;
  collapsed: Set<string>;
  forcedOpen: Set<string>;
  onToggle: (path: string) => void;
  depth: number;
  isLast: boolean;
  keyName?: string;
  matchMap: Map<string, TreeMatch[]>;
  activeMatchIndex: number;
  onActiveRef: (el: HTMLElement | null) => void;
  onMatchClick?: (globalIndex: number) => void;
}

const INDENT = 16;
const AUTO_COLLAPSE_DEPTH = 2;
const LS_PREFIX = "osdu-tree-state:";
const LS_LRU_KEY = "osdu-tree-state-lru";
const MAX_SAVED_LAYOUTS = 100;

function isObject(v: JsonValue): v is { [key: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArray(v: JsonValue): v is JsonValue[] {
  return Array.isArray(v);
}

function HighlightText({
  text,
  matches,
  activeMatchIndex,
  onActiveRef,
  onMatchClick,
  className,
}: {
  text: string;
  matches: TreeMatch[];
  activeMatchIndex: number;
  onActiveRef: (el: HTMLElement | null) => void;
  onMatchClick?: (globalIndex: number) => void;
  className?: string;
}) {
  if (matches.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const sorted = [...matches].sort((a, b) => a.start - b.start);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const m of sorted) {
    if (m.start > cursor) {
      nodes.push(
        <span key={`t-${cursor}`} className={className}>
          {text.slice(cursor, m.start)}
        </span>,
      );
    }
    const isActive = m.globalIndex === activeMatchIndex;
    const capturedIndex = m.globalIndex;
    nodes.push(
      <mark
        key={`m-${m.start}`}
        data-match-index={m.globalIndex}
        ref={isActive ? onActiveRef : undefined}
        onClick={onMatchClick ? (e) => { e.stopPropagation(); onMatchClick(capturedIndex); } : undefined}
        className={cn(
          "rounded-sm",
          onMatchClick && !isActive && "cursor-pointer",
          isActive
            ? "bg-orange-400/70 dark:bg-orange-400/80"
            : "bg-yellow-400/50 dark:bg-yellow-300/70",
        )}
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    cursor = m.end;
  }

  if (cursor < text.length) {
    nodes.push(
      <span key={`t-${cursor}`} className={className}>
        {text.slice(cursor)}
      </span>,
    );
  }

  return <>{nodes}</>;
}

function LeafValue({
  value,
  path,
  matchMap,
  activeMatchIndex,
  onActiveRef,
  onMatchClick,
}: {
  value: JsonValue;
  path: string;
  matchMap: Map<string, TreeMatch[]>;
  activeMatchIndex: number;
  onActiveRef: (el: HTMLElement | null) => void;
  onMatchClick?: (globalIndex: number) => void;
}) {
  const matches = matchMap.get(`${path}::value`) ?? [];

  if (value === null) {
    return (
      <HighlightText
        text="null"
        matches={matches}
        activeMatchIndex={activeMatchIndex}
        onActiveRef={onActiveRef}
        onMatchClick={onMatchClick}
        className="text-muted-foreground/70 italic"
      />
    );
  }
  if (typeof value === "boolean") {
    return (
      <HighlightText
        text={String(value)}
        matches={matches}
        activeMatchIndex={activeMatchIndex}
        onActiveRef={onActiveRef}
        onMatchClick={onMatchClick}
        className={cn("font-medium", value ? "text-emerald-500" : "text-rose-400")}
      />
    );
  }
  if (typeof value === "number") {
    return (
      <HighlightText
        text={String(value)}
        matches={matches}
        activeMatchIndex={activeMatchIndex}
        onActiveRef={onActiveRef}
        onMatchClick={onMatchClick}
        className="text-blue-400"
      />
    );
  }
  if (typeof value === "string") {
    return (
      <HighlightText
        text={`"${value}"`}
        matches={matches}
        activeMatchIndex={activeMatchIndex}
        onActiveRef={onActiveRef}
        onMatchClick={onMatchClick}
        className="text-amber-400/90 break-all"
      />
    );
  }
  return null;
}

function KeyLabel({
  keyName,
  isExpandable,
  path,
  matchMap,
  activeMatchIndex,
  onActiveRef,
  onMatchClick,
}: {
  keyName: string;
  isExpandable: boolean;
  path: string;
  matchMap: Map<string, TreeMatch[]>;
  activeMatchIndex: number;
  onActiveRef: (el: HTMLElement | null) => void;
  onMatchClick?: (globalIndex: number) => void;
}) {
  const matches = matchMap.get(`${path}::key`) ?? [];
  const displayText = isExpandable || typeof keyName === "string" ? `"${keyName}"` : keyName;

  return (
    <>
      <HighlightText
        text={displayText}
        matches={matches}
        activeMatchIndex={activeMatchIndex}
        onActiveRef={onActiveRef}
        onMatchClick={onMatchClick}
        className="text-violet-400/90 select-text"
      />
      <span className="text-violet-400/90 select-text">:{" "}</span>
    </>
  );
}

function JsonTreeNode({
  value,
  path,
  collapsed,
  forcedOpen,
  onToggle,
  depth,
  isLast,
  keyName,
  matchMap,
  activeMatchIndex,
  onActiveRef,
  onMatchClick,
}: JsonTreeNodeProps) {
  const isCol = collapsed.has(path) && !forcedOpen.has(path);
  const isObj = isObject(value);
  const isArr = isArray(value);
  const isExpandable = isObj || isArr;

  const paddingLeft = depth * INDENT;

  const entries = isObj
    ? Object.entries(value)
    : isArr
      ? (value as JsonValue[]).map((v, i) => [String(i), v] as [string, JsonValue])
      : [];

  const count = entries.length;
  const openBracket = isObj ? "{" : "[";
  const closeBracket = isObj ? "}" : "]";

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggle(path);
    },
    [onToggle, path],
  );

  const keyLabel =
    keyName !== undefined ? (
      <KeyLabel
        keyName={keyName}
        isExpandable={isExpandable}
        path={path}
        matchMap={matchMap}
        activeMatchIndex={activeMatchIndex}
        onActiveRef={onActiveRef}
        onMatchClick={onMatchClick}
      />
    ) : null;

  if (!isExpandable) {
    return (
      <div
        className="flex items-start font-mono text-[12px] leading-[1.6] select-text hover:bg-muted/20"
        style={{ paddingLeft }}
      >
        <span className="w-4 shrink-0" />
        {keyLabel}
        <LeafValue
          value={value}
          path={path}
          matchMap={matchMap}
          activeMatchIndex={activeMatchIndex}
          onActiveRef={onActiveRef}
          onMatchClick={onMatchClick}
        />
        {!isLast && <span className="text-muted-foreground/50">,</span>}
      </div>
    );
  }

  if (isCol) {
    const preview = isArr
      ? `[${count} item${count !== 1 ? "s" : ""}]`
      : `{${count} key${count !== 1 ? "s" : ""}}`;
    return (
      <div
        className="flex items-center font-mono text-[12px] leading-[1.6] cursor-pointer hover:bg-muted/20 group"
        style={{ paddingLeft }}
        onClick={handleToggle}
      >
        <ChevronRight className="h-3 w-3 mr-1 shrink-0 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
        {keyLabel}
        <span className="text-muted-foreground/60">{openBracket}</span>
        <span className="text-muted-foreground/40 mx-1 italic text-[11px]">{preview}</span>
        <span className="text-muted-foreground/60">{closeBracket}</span>
        {!isLast && <span className="text-muted-foreground/50">,</span>}
      </div>
    );
  }

  return (
    <div className="font-mono text-[12px] leading-[1.6]">
      <div
        className="flex items-center cursor-pointer hover:bg-muted/20 group"
        style={{ paddingLeft }}
        onClick={handleToggle}
      >
        <ChevronDown className="h-3 w-3 mr-1 shrink-0 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
        {keyLabel}
        <span className="text-muted-foreground/60">{openBracket}</span>
      </div>

      <div>
        {entries.map(([k, v], i) => (
          <JsonTreeNode
            key={k}
            value={v}
            path={`${path}.${k}`}
            collapsed={collapsed}
            forcedOpen={forcedOpen}
            onToggle={onToggle}
            depth={depth + 1}
            isLast={i === entries.length - 1}
            keyName={isObj ? k : undefined}
            matchMap={matchMap}
            activeMatchIndex={activeMatchIndex}
            onActiveRef={onActiveRef}
            onMatchClick={onMatchClick}
          />
        ))}
      </div>

      <div
        className="flex items-center font-mono text-[12px] leading-[1.6]"
        style={{ paddingLeft }}
      >
        <span className="w-4 shrink-0" />
        <span className="text-muted-foreground/60">{closeBracket}</span>
        {!isLast && <span className="text-muted-foreground/50">,</span>}
      </div>
    </div>
  );
}

export function buildInitialCollapsed(value: JsonValue, path: string, depth: number): Set<string> {
  const set = new Set<string>();
  if (depth >= AUTO_COLLAPSE_DEPTH) {
    set.add(path);
    return set;
  }
  if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const child = buildInitialCollapsed(v, `${path}.${k}`, depth + 1);
      for (const p of child) set.add(p);
    }
  } else if (isArray(value)) {
    for (let i = 0; i < (value as JsonValue[]).length; i++) {
      const child = buildInitialCollapsed(
        (value as JsonValue[])[i],
        `${path}.${i}`,
        depth + 1,
      );
      for (const p of child) set.add(p);
    }
  }
  return set;
}

function lruRead(): string[] {
  try {
    const raw = localStorage.getItem(LS_LRU_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function lruTouch(storageKey: string): void {
  try {
    const lru = lruRead().filter((k) => k !== storageKey);
    lru.unshift(storageKey);
    const overflow = lru.splice(MAX_SAVED_LAYOUTS);
    for (const key of overflow) {
      localStorage.removeItem(LS_PREFIX + key);
    }
    localStorage.setItem(LS_LRU_KEY, JSON.stringify(lru));
  } catch {
    // ignore
  }
}

function lruRemove(storageKey: string): void {
  try {
    const lru = lruRead().filter((k) => k !== storageKey);
    localStorage.setItem(LS_LRU_KEY, JSON.stringify(lru));
  } catch {
    // ignore
  }
}

export function loadSavedState(storageKey: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + storageKey);
    if (!raw) return null;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return null;
    lruTouch(storageKey);
    return new Set(arr as string[]);
  } catch {
    return null;
  }
}

export function persistState(storageKey: string, collapsed: Set<string>) {
  try {
    localStorage.setItem(LS_PREFIX + storageKey, JSON.stringify([...collapsed]));
    lruTouch(storageKey);
  } catch {
    // ignore quota errors
  }
}

export function hasSavedState(storageKey: string): boolean {
  try {
    return localStorage.getItem(LS_PREFIX + storageKey) !== null;
  } catch {
    return false;
  }
}

export function clearSavedState(storageKey: string) {
  try {
    localStorage.removeItem(LS_PREFIX + storageKey);
    lruRemove(storageKey);
  } catch {
    // ignore
  }
}

export function clearAllSavedLayouts(): number {
  try {
    const lru = lruRead();
    for (const key of lru) {
      localStorage.removeItem(LS_PREFIX + key);
    }
    localStorage.removeItem(LS_LRU_KEY);
    return lru.length;
  } catch {
    return 0;
  }
}

export function getSavedLayoutCount(): number {
  return lruRead().length;
}

const LS_MIGRATION_FLAG = "osdu-tree-state-migration-v1";

/**
 * One-time migration: scans localStorage for orphan `osdu-tree-state:*` keys
 * that predate the LRU index and ingests them into the index. Extras beyond
 * MAX_SAVED_LAYOUTS are deleted. A version flag prevents this from running
 * more than once.
 */
export function migrateLegacyLayouts(): void {
  try {
    if (localStorage.getItem(LS_MIGRATION_FLAG)) return;

    const lru = lruRead();

    // Collect orphan keys — present in storage but absent from the index.
    const indexed = new Set(lru);
    const orphans: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const rawKey = localStorage.key(i);
      if (!rawKey?.startsWith(LS_PREFIX)) continue;
      const storageKey = rawKey.slice(LS_PREFIX.length);
      if (!indexed.has(storageKey)) {
        orphans.push(storageKey);
      }
    }

    if (orphans.length > 0) {
      // Append orphans to the end of the LRU list (treated as least-recently-used).
      const merged = [...lru, ...orphans];
      // Trim to cap, removing oldest (tail) entries.
      const overflow = merged.splice(MAX_SAVED_LAYOUTS);
      for (const key of overflow) {
        localStorage.removeItem(LS_PREFIX + key);
      }
      localStorage.setItem(LS_LRU_KEY, JSON.stringify(merged));
    }

    localStorage.setItem(LS_MIGRATION_FLAG, "1");
  } catch {
    // Never let migration errors break the app.
  }
}

export function getSavedLayoutsSize(): number {
  const lru = lruRead();
  const lruRaw = localStorage.getItem(LS_LRU_KEY) ?? "";
  const total = lruRaw.length + lru.reduce((sum, key) => {
    const val = localStorage.getItem(LS_PREFIX + key) ?? "";
    return sum + val.length;
  }, 0);
  return total;
}

export interface TreeCollapsedState {
  collapsed: Set<string>;
  hasCustomLayout: boolean;
  handleToggle: (path: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  resetLayout: () => void;
}

/** Manages the collapse/expand state for a JSON tree, with optional localStorage persistence. */
export function useTreeCollapsed(
  parsed: JsonValue | null,
  storageKey?: string,
): TreeCollapsedState {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (storageKey) {
      const saved = loadSavedState(storageKey);
      if (saved) return saved;
    }
    return parsed ? buildInitialCollapsed(parsed, "root", 0) : new Set<string>();
  });

  const [hasCustomLayout, setHasCustomLayout] = useState(() =>
    storageKey ? hasSavedState(storageKey) : false,
  );

  const prevStorageKeyRef = useRef(storageKey);
  useEffect(() => {
    if (prevStorageKeyRef.current !== storageKey) {
      prevStorageKeyRef.current = storageKey;
      if (storageKey) {
        const saved = loadSavedState(storageKey);
        if (saved) {
          setCollapsed(saved);
          setHasCustomLayout(true);
        } else {
          setCollapsed(parsed ? buildInitialCollapsed(parsed, "root", 0) : new Set<string>());
          setHasCustomLayout(false);
        }
      } else {
        setCollapsed(parsed ? buildInitialCollapsed(parsed, "root", 0) : new Set<string>());
        setHasCustomLayout(false);
      }
    }
  }, [storageKey, parsed]);

  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;

  const parsedRef = useRef(parsed);
  parsedRef.current = parsed;

  // BroadcastChannel for cross-tab (pop-out) sync.
  // Messages are NOT delivered back to the sender, so no feedback loop.
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (!storageKey) return;
    const channel = new BroadcastChannel(`osdu-tree-state:${storageKey}`);
    channel.onmessage = (e: MessageEvent<{ type: string; collapsed?: string[] }>) => {
      if (e.data.type === "collapse-state" && Array.isArray(e.data.collapsed)) {
        setCollapsed(new Set(e.data.collapsed));
        setHasCustomLayout(true);
      } else if (e.data.type === "reset") {
        const p = parsedRef.current;
        setCollapsed(p ? buildInitialCollapsed(p, "root", 0) : new Set<string>());
        setHasCustomLayout(false);
      }
    };
    channelRef.current = channel;
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [storageKey]);

  const handleToggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      if (storageKeyRef.current) {
        persistState(storageKeyRef.current, next);
        setHasCustomLayout(true);
        channelRef.current?.postMessage({ type: "collapse-state", collapsed: [...next] });
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const next = new Set<string>();
    if (storageKeyRef.current) {
      persistState(storageKeyRef.current, next);
      setHasCustomLayout(true);
      channelRef.current?.postMessage({ type: "collapse-state", collapsed: [] });
    }
    setCollapsed(next);
  }, []);

  const collapseAll = useCallback(() => {
    const p = parsedRef.current;
    const next = p ? buildInitialCollapsed(p, "root", 0) : new Set<string>();
    if (storageKeyRef.current) {
      persistState(storageKeyRef.current, next);
      setHasCustomLayout(true);
      channelRef.current?.postMessage({ type: "collapse-state", collapsed: [...next] });
    }
    setCollapsed(next);
  }, []);

  const resetLayout = useCallback(() => {
    if (storageKeyRef.current) {
      clearSavedState(storageKeyRef.current);
      channelRef.current?.postMessage({ type: "reset" });
    }
    setHasCustomLayout(false);
    const p = parsedRef.current;
    setCollapsed(p ? buildInitialCollapsed(p, "root", 0) : new Set<string>());
  }, []);

  return { collapsed, hasCustomLayout, handleToggle, expandAll, collapseAll, resetLayout };
}

/** Walk the JSON tree in DFS order and collect all key/value text matches. */
export function buildTreeMatches(
  value: JsonValue,
  path: string,
  query: string,
  keyName?: string,
): Omit<TreeMatch, "globalIndex">[] {
  const q = query.toLowerCase();
  const matches: Omit<TreeMatch, "globalIndex">[] = [];

  if (keyName !== undefined) {
    const keyText = `"${keyName}"`;
    const lower = keyText.toLowerCase();
    let idx = 0;
    while (idx < lower.length) {
      const pos = lower.indexOf(q, idx);
      if (pos === -1) break;
      matches.push({ path, matchIn: "key", start: pos, end: pos + q.length });
      idx = pos + q.length;
    }
  }

  if (!isObject(value) && !isArray(value)) {
    let valText: string;
    if (value === null) valText = "null";
    else if (typeof value === "boolean") valText = String(value);
    else if (typeof value === "number") valText = String(value);
    else valText = `"${value}"`;

    const lower = valText.toLowerCase();
    let idx = 0;
    while (idx < lower.length) {
      const pos = lower.indexOf(q, idx);
      if (pos === -1) break;
      matches.push({ path, matchIn: "value", start: pos, end: pos + q.length });
      idx = pos + q.length;
    }
  }

  if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const child = buildTreeMatches(v, `${path}.${k}`, query, k);
      matches.push(...child);
    }
  } else if (isArray(value)) {
    for (let i = 0; i < (value as JsonValue[]).length; i++) {
      const child = buildTreeMatches((value as JsonValue[])[i], `${path}.${i}`, query);
      matches.push(...child);
    }
  }

  return matches;
}

/**
 * Renders colored tick marks in a thin strip overlaid on the right edge of the
 * scroll container — one tick per match, giving a spatial map of all results.
 * Inactive matches → subtle yellow; active match → orange.
 * Clicking a tick navigates to that match.
 */
function ScrollGutter({
  scrollRef,
  matches,
  activeMatchIndex,
  onTickClick,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  matches: TreeMatch[];
  activeMatchIndex: number;
  onTickClick?: (globalIndex: number) => void;
}) {
  const [ticks, setTicks] = useState<{ index: number; pct: number }[]>([]);

  const recalculate = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const { scrollHeight } = container;
    if (scrollHeight === 0) return;

    const containerTop = container.getBoundingClientRect().top;
    const marks = container.querySelectorAll<HTMLElement>("[data-match-index]");
    const seen = new Set<number>();
    const newTicks: { index: number; pct: number }[] = [];

    for (const mark of marks) {
      const idx = parseInt(mark.dataset.matchIndex ?? "", 10);
      if (isNaN(idx) || seen.has(idx)) continue;
      seen.add(idx);
      const rect = mark.getBoundingClientRect();
      const midY = rect.top - containerTop + container.scrollTop + rect.height / 2;
      const pct = Math.min(99, Math.max(0, (midY / scrollHeight) * 100));
      newTicks.push({ index: idx, pct });
    }

    setTicks(newTicks);
  }, [scrollRef]);

  // Recalculate whenever matches change or the tree content changes.
  useLayoutEffect(() => {
    recalculate();
  }, [matches, recalculate]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    // Resize: container itself grows/shrinks
    const resizeObs = new ResizeObserver(recalculate);
    resizeObs.observe(container);

    // Mutation: nodes expand/collapse, changing scrollHeight
    const mutationObs = new MutationObserver(recalculate);
    mutationObs.observe(container, { childList: true, subtree: true });

    return () => {
      resizeObs.disconnect();
      mutationObs.disconnect();
    };
  }, [scrollRef, recalculate]);

  if (matches.length === 0 || ticks.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="absolute right-0 top-0 bottom-0 w-1.5 z-10 rounded-r pointer-events-none overflow-hidden"
    >
      {ticks.map(({ index, pct }) => {
        const isActive = index === activeMatchIndex;
        return (
          <div
            key={index}
            title={`Match ${index + 1}`}
            className={cn(
              "absolute left-0 right-0 h-[3px] rounded-sm pointer-events-auto transition-colors",
              onTickClick ? "cursor-pointer" : "",
              isActive
                ? "bg-orange-400 dark:bg-orange-400"
                : "bg-yellow-400/80 dark:bg-yellow-300/70",
            )}
            style={{ top: `${pct}%`, transform: "translateY(-50%)" }}
            onClick={onTickClick ? () => onTickClick(index) : undefined}
          />
        );
      })}
    </div>
  );
}

interface JsonTreeViewProps {
  parsed: JsonValue;
  storageKey?: string;
  className?: string;
  treeMatches?: TreeMatch[];
  activeMatchIndex?: number;
  onActiveRef?: (el: HTMLElement | null) => void;
  onMatchClick?: (globalIndex: number) => void;
  /** Controlled mode: shared collapsed state lifted by a parent (e.g. to sync inline + fullscreen). */
  sharedState?: TreeCollapsedState;
}

export function JsonTreeView({
  parsed,
  storageKey,
  className,
  treeMatches = [],
  activeMatchIndex = -1,
  onActiveRef,
  onMatchClick,
  sharedState,
}: JsonTreeViewProps) {
  const ownState = useTreeCollapsed(sharedState ? null : parsed, sharedState ? undefined : storageKey);

  const { collapsed, hasCustomLayout, handleToggle, expandAll, collapseAll, resetLayout } =
    sharedState ?? ownState;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const matchMap = useMemo(() => {
    const map = new Map<string, TreeMatch[]>();
    for (const m of treeMatches) {
      const key = `${m.path}::${m.matchIn}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  }, [treeMatches]);

  const forcedOpen = useMemo(() => {
    const set = new Set<string>();
    for (const m of treeMatches) {
      const parts = m.path.split(".");
      for (let i = 1; i < parts.length; i++) {
        set.add(parts.slice(0, i).join("."));
      }
    }
    return set;
  }, [treeMatches]);

  const handleActiveRef = useCallback(
    (el: HTMLElement | null) => {
      onActiveRef?.(el);
    },
    [onActiveRef],
  );

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center gap-2 px-3 py-1 border-x border-border/40 bg-muted/20 text-[11px] text-muted-foreground">
        <button
          onClick={expandAll}
          className="hover:text-foreground underline-offset-2 hover:underline transition-colors"
        >
          Expand all
        </button>
        <span>·</span>
        <button
          onClick={collapseAll}
          className="hover:text-foreground underline-offset-2 hover:underline transition-colors"
        >
          Collapse all
        </button>
        {(sharedState ? sharedState.hasCustomLayout : (storageKey && hasCustomLayout)) && (
          <>
            <span>·</span>
            <button
              onClick={resetLayout}
              className="hover:text-foreground underline-offset-2 hover:underline transition-colors"
            >
              Reset layout
            </button>
          </>
        )}
      </div>
      <div className="relative">
        <div
          ref={scrollContainerRef}
          className="bg-muted/50 rounded-b-lg p-3 border border-t-0 border-border/40 overflow-auto select-text"
        >
          <JsonTreeNode
            value={parsed}
            path="root"
            collapsed={collapsed}
            forcedOpen={forcedOpen}
            onToggle={handleToggle}
            depth={0}
            isLast={true}
            matchMap={matchMap}
            activeMatchIndex={activeMatchIndex}
            onActiveRef={handleActiveRef}
            onMatchClick={onMatchClick}
          />
        </div>
        <ScrollGutter
          scrollRef={scrollContainerRef}
          matches={treeMatches}
          activeMatchIndex={activeMatchIndex}
          onTickClick={onMatchClick}
        />
      </div>
    </div>
  );
}
