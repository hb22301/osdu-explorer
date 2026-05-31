import { useEffect, useState } from "react";
import { JsonViewerContent } from "@/components/json-viewer-toolbar";
import { FileJson } from "lucide-react";

export default function JsonPopoutPage() {
  const params = new URLSearchParams(window.location.search);
  const storageKey = params.get("key") ?? undefined;
  const label = params.get("label") ?? "JSON";
  const dataKey = params.get("data") ?? "";

  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <JsonViewerContent json={json} storageKey={storageKey} _isFullscreen className="h-full" />
        )}
      </div>
    </div>
  );
}
