import { useState, useRef, useCallback, useEffect } from "react";
import { useGetOsduRecord, getGetOsduRecordQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { DatabaseZap as StorageIcon, Loader2, AlertCircle, Terminal, ChevronDown, ChevronUp } from "lucide-react";
import { JsonViewerContent, type JsonViewerLookupResult } from "@/components/json-viewer-toolbar";
import { ConsolePanel } from "@/components/console-panel";

const DEFAULT_CONSOLE_HEIGHT = 300;
const MIN_CONSOLE_HEIGHT = 80;
const MAX_CONSOLE_HEIGHT = 700;

interface RecordLookupDialogProps {
  selectedId?: string;
  openRequestId?: string | null;
  onOpenRequestHandled?: () => void;
}

export function RecordLookupDialog({
  selectedId = "",
  openRequestId = null,
  onOpenRequestHandled,
}: RecordLookupDialogProps) {
  const [open, setOpen] = useState(false);
  const [recordId, setRecordId] = useState("");
  const [displayedTitle, setDisplayedTitle] = useState("Record from Storage Service");
  const [lookupResult, setLookupResult] = useState<JsonViewerLookupResult | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(DEFAULT_CONSOLE_HEIGHT);
  const consoleDragState = useRef<{ startY: number; startHeight: number } | null>(null);

  const { data, isFetching, isError, error } = useGetOsduRecord(recordId, {
    query: {
      enabled: !!recordId,
      retry: false,
      queryKey: getGetOsduRecordQueryKey(recordId),
    },
  });

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      const seed = selectedId.trim();
      setRecordId(seed);
      setDisplayedTitle("Record from Storage Service");
      setLookupResult(null);
    } else {
      setRecordId("");
      setLookupResult(null);
      setConsoleOpen(false);
    }
  }, [selectedId]);

  const handleResponseTypeChange = useCallback((type: "search" | "storage" | "ddms") => {
    setDisplayedTitle(
      type === "search"
        ? "Record from Search Service"
        : type === "ddms"
          ? "Record from Reservoir DDMS"
          : "Record from Storage Service",
    );
  }, []);

  useEffect(() => {
    if (!openRequestId) return;
    handleOpenChange(true);
    onOpenRequestHandled?.();
  }, [openRequestId, handleOpenChange, onOpenRequestHandled]);

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
  const activeJson = lookupResult?.json ?? json;
  const isReservoirDdmsResponse = Boolean(lookupResult);
  const handleLookupResult = useCallback((result: JsonViewerLookupResult | null) => {
    setLookupResult(result);
    setDisplayedTitle(
      result?.responseType === "ddms"
        ? "Record from Reservoir DDMS"
        : "Record from Storage Service",
    );
  }, []);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex"
            tabIndex={!selectedId ? 0 : undefined}
            aria-label={!selectedId ? "Storage API unavailable until a row is selected" : undefined}
          >
            <Button
              variant="outline"
              size="icon"
              className={`h-8 w-8 ${selectedId ? "text-primary hover:text-primary" : "text-foreground disabled:text-foreground disabled:opacity-100"}`}
              disabled={!selectedId}
              onClick={() => handleOpenChange(true)}
            >
              <StorageIcon className="h-4 w-4" />
              <span className="sr-only">Storage API</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Storage API</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-w-none w-screen h-screen flex flex-col p-0 gap-0 rounded-none border-0 [&>button]:h-7 [&>button]:w-7 [&>button]:rounded-md [&>button]:border [&>button]:border-border/60 [&>button]:bg-background/60 [&>button]:p-1 [&>button]:opacity-100 [&>button]:hover:bg-accent"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{displayedTitle}</DialogTitle>

          {/* Header: icon + title */}
          <div className="flex items-center gap-3 border-b border-border/40 bg-muted/20 px-4 py-2 shrink-0">
            <StorageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-foreground shrink-0">{displayedTitle}</span>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden min-h-0 p-4">
            {isError && (
              <div className="flex items-start gap-2 rounded-lg border border-error-border/60 bg-error-surface p-4 text-sm text-error-text">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="break-all">
                  {(error as Error | undefined)?.message ?? "Failed to fetch record."}
                </span>
              </div>
            )}
            {!isError && !data && isFetching && (
              <div className="h-full flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading record…
              </div>
            )}
            {!isError && data && (
              <JsonViewerContent
                key={`${recordId}:${lookupResult?.label ?? "original"}`}
                json={activeJson}
                storageKey={lookupResult?.storageKey ?? (recordId || undefined)}
                _isFullscreen
                className="h-full"
                 searchRecordId={recordId}
                 rdmsContext={lookupResult?.rdmsContext}
                 hideStorageLookup={isReservoirDdmsResponse}
                 hideSearchLookup={isReservoirDdmsResponse}
                 hideDdmsLookup={isReservoirDdmsResponse}
                 hideWdmsLookup={isReservoirDdmsResponse}
                 lookupResult={lookupResult}
                 onLookupResult={handleLookupResult}
                 onResponseTypeChange={handleResponseTypeChange}
                 onRecordDeleted={() => handleOpenChange(false)}
              />
            )}
            {!isError && !data && !isFetching && recordId === "" && (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No record selected.
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
