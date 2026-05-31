import { useEffect, useRef, useState } from "react";
import { JsonViewerContent } from "@/components/json-viewer-toolbar";
import { FileJson } from "lucide-react";

type ViewMode = "tree" | "raw";

type SyncMessage =
  | { type: "viewMode"; value: ViewMode }
  | { type: "query"; value: string }
  | { type: "searchOpen"; value: boolean };

interface SharedViewerState {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  query: string;
  onQueryChange: (q: string) => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
}

export default function JsonPopoutPage() {
  const params = new URLSearchParams(window.location.search);
  const storageKey = params.get("key") ?? undefined;
  const label = params.get("label") ?? "JSON";
  const dataKey = params.get("data") ?? "";
  const channelName = params.get("channel") ?? null;

  const initialViewMode = (params.get("viewMode") as ViewMode | null) ?? "tree";
  const initialQuery = params.get("query") ?? "";
  const initialSearchOpen = params.get("searchOpen") === "1";

  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [query, setQuery] = useState(initialQuery);
  const [searchOpen, setSearchOpen] = useState(initialSearchOpen);

  // BroadcastChannel sync with the inline view.
  const channelRef = useRef<BroadcastChannel | null>(null);
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

  useEffect(() => {
    if (!dataKey) {
      setError("No data key provided.");
      return;
    }
    const stored = localStorage.getItem(dataKey);
    if (!stored) {
      setError("JSON data not found. It may have already been read or expired.");
      return;
    }
    localStorage.removeItem(dataKey);
    setJson(stored);
  }, [dataKey]);

  const sharedViewerState: SharedViewerState = {
    viewMode,
    onViewModeChange: setViewMode,
    query,
    onQueryChange: setQuery,
    searchOpen,
    onSearchOpenChange: setSearchOpen,
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-4 py-2 shrink-0">
        <FileJson className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-mono text-muted-foreground truncate">{label}</span>
      </div>
      <div className="flex-1 overflow-hidden p-4">
        {error ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            {error}
          </div>
        ) : json === null ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Loading…
          </div>
        ) : (
          <JsonViewerContent
            json={json}
            storageKey={storageKey}
            _isFullscreen
            className="h-full"
            sharedViewerState={sharedViewerState}
          />
        )}
      </div>
    </div>
  );
}
