import { useState, useCallback, useEffect, useRef } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

interface JsonTreeNodeProps {
  value: JsonValue;
  path: string;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  depth: number;
  isLast: boolean;
  keyName?: string;
}

const INDENT = 16;
const AUTO_COLLAPSE_DEPTH = 2;
const LS_PREFIX = "osdu-tree-state:";

function isObject(v: JsonValue): v is { [key: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArray(v: JsonValue): v is JsonValue[] {
  return Array.isArray(v);
}

function LeafValue({ value }: { value: JsonValue }) {
  if (value === null) {
    return <span className="text-muted-foreground/70 italic">null</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className={cn("font-medium", value ? "text-emerald-500" : "text-rose-400")}>
        {String(value)}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="text-blue-400">{String(value)}</span>;
  }
  if (typeof value === "string") {
    return (
      <span className="text-amber-400/90 break-all">
        &quot;{value}&quot;
      </span>
    );
  }
  return null;
}

function JsonTreeNode({
  value,
  path,
  collapsed,
  onToggle,
  depth,
  isLast,
  keyName,
}: JsonTreeNodeProps) {
  const isCol = collapsed.has(path);
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

  const keyLabel = keyName !== undefined ? (
    <span className="text-violet-400/90 select-text">{isObj || typeof keyName === "string" ? `"${keyName}"` : keyName}: </span>
  ) : null;

  if (!isExpandable) {
    return (
      <div
        className="flex items-start font-mono text-[12px] leading-[1.6] select-text hover:bg-muted/20"
        style={{ paddingLeft }}
      >
        <span className="w-4 shrink-0" />
        {keyLabel}
        <LeafValue value={value} />
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
            onToggle={onToggle}
            depth={depth + 1}
            isLast={i === entries.length - 1}
            keyName={isObj ? k : undefined}
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

function buildInitialCollapsed(value: JsonValue, path: string, depth: number): Set<string> {
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

function loadSavedState(storageKey: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + storageKey);
    if (!raw) return null;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return null;
    return new Set(arr as string[]);
  } catch {
    return null;
  }
}

function persistState(storageKey: string, collapsed: Set<string>) {
  try {
    localStorage.setItem(LS_PREFIX + storageKey, JSON.stringify([...collapsed]));
  } catch {
    // ignore quota errors
  }
}

function hasSavedState(storageKey: string): boolean {
  try {
    return localStorage.getItem(LS_PREFIX + storageKey) !== null;
  } catch {
    return false;
  }
}

interface JsonTreeViewProps {
  parsed: JsonValue;
  storageKey?: string;
  className?: string;
}

export function JsonTreeView({ parsed, storageKey, className }: JsonTreeViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (storageKey) {
      const saved = loadSavedState(storageKey);
      if (saved) return saved;
    }
    return buildInitialCollapsed(parsed, "root", 0);
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
          setCollapsed(buildInitialCollapsed(parsed, "root", 0));
          setHasCustomLayout(false);
        }
      } else {
        setCollapsed(buildInitialCollapsed(parsed, "root", 0));
        setHasCustomLayout(false);
      }
    }
  }, [storageKey, parsed]);

  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;

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
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const next = new Set<string>();
    if (storageKeyRef.current) {
      persistState(storageKeyRef.current, next);
      setHasCustomLayout(true);
    }
    setCollapsed(next);
  }, []);

  const collapseAll = useCallback(() => {
    const next = buildInitialCollapsed(parsed, "root", 0);
    if (storageKeyRef.current) {
      persistState(storageKeyRef.current, next);
      setHasCustomLayout(true);
    }
    setCollapsed(next);
  }, [parsed]);

  const resetLayout = useCallback(() => {
    if (storageKeyRef.current) {
      try {
        localStorage.removeItem(LS_PREFIX + storageKeyRef.current);
      } catch {
        // ignore
      }
    }
    setHasCustomLayout(false);
    setCollapsed(buildInitialCollapsed(parsed, "root", 0));
  }, [parsed]);

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
        {storageKey && hasCustomLayout && (
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
      <div className="bg-muted/50 rounded-b-lg p-3 border border-t-0 border-border/40 overflow-auto select-text">
        <JsonTreeNode
          value={parsed}
          path="root"
          collapsed={collapsed}
          onToggle={handleToggle}
          depth={0}
          isLast={true}
        />
      </div>
    </div>
  );
}
