import { useState, useRef, useCallback } from "react";
import { useGetOsduRecord, getGetOsduRecordQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HardDrive as StorageIcon, Loader2, AlertCircle, Terminal, ChevronDown, ChevronUp } from "lucide-react";
import { JsonViewerContent } from "@/components/json-viewer-toolbar";
import { ConsolePanel } from "@/components/console-panel";

const DEFAULT_CONSOLE_HEIGHT = 300;
const MIN_CONSOLE_HEIGHT = 80;
const MAX_CONSOLE_HEIGHT = 700;

export function RecordLookupDialog({ selectedId = "" }: { selectedId?: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [recordId, setRecordId] = useState("");
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(DEFAULT_CONSOLE_HEIGHT);
  const consoleDragState = useRef<{ startY: number; startHeight: number } | null>(null);

  const { data, isFetching, isError, error, refetch } = useGetOsduRecord(recordId, {
    query: {
      enabled: !!recordId,
      retry: false,
      queryKey: getGetOsduRecordQueryKey(recordId),
    },
  });

  const lookup = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (trimmed === recordId) {
      void refetch();
    } else {
      setRecordId(trimmed);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      const seed = selectedId.trim();
      setInput(seed);
      setRecordId(seed);
    } else {
      setInput("");
      setRecordId("");
      setConsoleOpen(false);
    }
  };

  const handleConsoleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    consoleDragState.current = { startY: e.clientY, startHeight: consoleHeight };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!consoleDragState.current) return;
      const delta = consoleDragState.current.startY - ev.clientY;
      const next = Math.min(MAX_CONSOLE_HEIGHT, Math.max(MIN_CONSOLE_HEIGHT, consoleDragState.current.startHeight + delta));
      setConsoleHeight(next);
    };
    const onUp = () => {
      consoleDragState.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [consoleHeight]);

  const json = data ? JSON.stringify(data, null, 2) : "";

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleOpenChange(true)}
          >
            <StorageIcon className="h-4 w-4" />
            <span className="sr-only">Storage</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Storage</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-w-none w-screen h-screen flex flex-col p-0 gap-0 rounded-none border-0"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">Record from Storage Service</DialogTitle>

          {/* Header: icon + title + form + close */}
          <div className="flex items-center gap-3 border-b border-border/40 bg-muted/20 px-4 py-2 shrink-0">
            <StorageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-foreground shrink-0">Storage</span>
            <form
              className="flex gap-2 flex-1"
              onSubmit={(e) => { e.preventDefault(); lookup(); }}
            >
              <Input
                autoFocus
                placeholder="opendes:work-product-component--…:…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="font-mono text-xs h-7 flex-1"
              />
              <Button type="submit" size="sm" className="h-7 shrink-0" disabled={!input.trim() || isFetching}>
                {isFetching
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <StorageIcon className="h-3.5 w-3.5" />}
                <span className="ml-1">Fetch</span>
              </Button>
            </form>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden min-h-0 p-4">
            {isError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="break-all">
                  {(error as Error | undefined)?.message ?? "Failed to fetch record."}
                </span>
              </div>
            )}
            {!isError && data && (
              <JsonViewerContent
                key={recordId}
                json={json}
                storageKey={recordId || undefined}
                _isFullscreen
                className="h-full"
              />
            )}
            {!isError && !data && !isFetching && recordId === "" && (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Enter a record ID above and click Fetch.
              </div>
            )}
            {!isError && !data && !isFetching && recordId !== "" && (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No record returned for this ID.
              </div>
            )}
          </div>

          {/* Console drag handle + panel */}
          {consoleOpen && (
            <>
              <div
                className="shrink-0 h-[5px] cursor-ns-resize bg-border/60 hover:bg-primary/40 active:bg-primary/60 transition-colors"
                onMouseDown={handleConsoleDragStart}
                title="Drag to resize"
              />
              <div className="shrink-0" style={{ height: consoleHeight }}>
                <ConsolePanel height={consoleHeight} />
              </div>
            </>
          )}

          {/* Console toggle bar */}
          <div
            className="shrink-0 h-7 flex items-center gap-2 px-3 border-t border-border bg-card/80 cursor-pointer select-none hover:bg-muted/60 transition-colors"
            onClick={() => setConsoleOpen((v) => !v)}
            role="button"
            aria-expanded={consoleOpen}
            aria-label="Toggle console"
          >
            <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] font-medium text-muted-foreground">Console</span>
            <div className="ml-auto text-muted-foreground">
              {consoleOpen
                ? <ChevronDown className="w-3.5 h-3.5" />
                : <ChevronUp className="w-3.5 h-3.5" />}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
