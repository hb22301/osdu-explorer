import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useGetOsduRecord, getGetOsduRecordQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { DatabaseZap as StorageIcon, Loader2, AlertCircle, Terminal, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import {
  JsonViewerContent,
  type JsonViewerLookupResult,
  type RelatedRecordNavigationContext,
} from "@/components/json-viewer-toolbar";
import { ConsolePanel } from "@/components/console-panel";
import { VersionHistorySelect } from "@/components/version-history-select";
import { fetchStorageRecordVersion } from "@/lib/storage-version-fetch";
import { fetchSearchRecordById } from "@/lib/record-source-fetch";

const DEFAULT_CONSOLE_HEIGHT = 300;
const MIN_CONSOLE_HEIGHT = 80;
const MAX_CONSOLE_HEIGHT = 700;

interface RecordNavigationSnapshot {
  recordId: string;
  lookupResult: JsonViewerLookupResult | null;
}

function isHttpNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    message?: unknown;
  };
  return candidate.status === 404
    || candidate.statusCode === 404
    || candidate.response?.status === 404
    || (typeof candidate.message === "string" && /\b404\b/.test(candidate.message));
}

interface RecordLookupDialogProps {
  selectedId?: string;
  openRequestId?: string | null;
  onOpenRequestHandled?: () => void;
  onRecordDeleted?: () => void;
  /** Hide the inline trigger buttons and drive the dialog only via openRequestId. */
  hideTriggers?: boolean;
}

export function RecordLookupDialog({
  selectedId = "",
  openRequestId = null,
  onOpenRequestHandled,
  onRecordDeleted,
  hideTriggers = false,
}: RecordLookupDialogProps) {
  const [open, setOpen] = useState(false);
  const [recordId, setRecordId] = useState("");
  const [storageDeleteRequestId, setStorageDeleteRequestId] = useState<string | null>(null);
  const [displayedTitle, setDisplayedTitle] = useState("Record from Storage Service");
  const [lookupResult, setLookupResult] = useState<JsonViewerLookupResult | null>(null);
  const [selectedStorageVersion, setSelectedStorageVersion] = useState<number | undefined>();
  const [versionRecord, setVersionRecord] = useState<unknown | null>(null);
  const [isVersionLoading, setIsVersionLoading] = useState(false);
  const [versionFetchError, setVersionFetchError] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(DEFAULT_CONSOLE_HEIGHT);
  // Keep the source payload as well as its ID so Back restores the right service.
  const [navHistory, setNavHistory] = useState<RecordNavigationSnapshot[]>([]);
  const [isRelatedNavigationLoading, setIsRelatedNavigationLoading] = useState(false);
  const [relatedNavigationError, setRelatedNavigationError] = useState<string | null>(null);
  const consoleDragState = useRef<{ startY: number; startHeight: number } | null>(null);
  const versionRequestRef = useRef(0);

  const { data, isFetching, isError, error } = useGetOsduRecord(recordId, {
    query: {
      enabled: !!recordId && lookupResult?.responseType !== "search",
      retry: false,
      queryKey: getGetOsduRecordQueryKey(recordId),
    },
  });

  const resetVersionState = useCallback(() => {
    versionRequestRef.current += 1;
    setSelectedStorageVersion(undefined);
    setVersionRecord(null);
    setIsVersionLoading(false);
    setVersionFetchError(null);
    setRelatedNavigationError(null);
  }, []);

  const handleStorageVersionSelect = useCallback(async (version: number) => {
    const currentRecordId = (
      lookupResult?.responseType === "storage"
        ? lookupResult.storageKey?.trim() || lookupResult.label?.trim() || recordId.trim()
        : recordId.trim()
    );
    if (!currentRecordId) return;

    const requestId = ++versionRequestRef.current;
    setIsVersionLoading(true);
    setVersionFetchError(null);
    try {
      const selectedRecord = await fetchStorageRecordVersion(currentRecordId, version);
      if (requestId !== versionRequestRef.current) return;
      setVersionRecord(selectedRecord);
      setSelectedStorageVersion(version);
    } catch (versionError) {
      if (requestId !== versionRequestRef.current) return;
      setVersionFetchError(
        versionError instanceof Error
          ? versionError.message
          : "Could not load the selected Storage version.",
      );
    } finally {
      if (requestId === versionRequestRef.current) setIsVersionLoading(false);
    }
  }, [lookupResult, recordId]);

  const handleStorageVersionsDeleted = useCallback((deleted: number) => {
    if (selectedStorageVersion === deleted) resetVersionState();
  }, [resetVersionState, selectedStorageVersion]);

  const handleOpenChange = useCallback((next: boolean, seedId?: string) => {
    setOpen(next);
    resetVersionState();
    setNavHistory([]);
    setIsRelatedNavigationLoading(false);
    setRelatedNavigationError(null);
    if (next) {
      const seed = (seedId ?? selectedId).trim();
      setRecordId(seed);
      setDisplayedTitle("Record from Storage Service");
      setLookupResult(null);
    } else {
      setRecordId("");
      setLookupResult(null);
      setConsoleOpen(false);
      setStorageDeleteRequestId(null);
    }
  }, [resetVersionState, selectedId]);

  // Keep related-record navigation on the service that supplied the active JSON.
  const handleNavigateToRelated = useCallback(async (
    id: string,
    context: RelatedRecordNavigationContext,
  ) => {
    const target = id.trim();
    if (!target || target === recordId || isRelatedNavigationLoading) return;

    setIsRelatedNavigationLoading(true);
    setRelatedNavigationError(null);
    try {
      let nextLookupResult: JsonViewerLookupResult | null = null;
      if (context.responseType === "search") {
        const record = await fetchSearchRecordById(target);
        nextLookupResult = {
          responseType: "search",
          json: JSON.stringify(record, null, 2),
          label: target,
        };
      }

      setNavHistory((prev) => [...prev, { recordId, lookupResult }]);
      resetVersionState();
      setRecordId(target);
      setLookupResult(nextLookupResult);
      setDisplayedTitle(
        nextLookupResult ? "Record from Search Service" : "Record from Storage Service",
      );
    } catch (navigationError) {
      setRelatedNavigationError(
        navigationError instanceof Error
          ? navigationError.message
          : "Could not open the related record.",
      );
    } finally {
      setIsRelatedNavigationLoading(false);
    }
  }, [isRelatedNavigationLoading, lookupResult, recordId, resetVersionState]);

  const handleNavigateBack = useCallback(() => {
    const previous = navHistory[navHistory.length - 1];
    if (!previous || isRelatedNavigationLoading) return;
    setNavHistory((prev) => prev.slice(0, -1));
    resetVersionState();
    setRelatedNavigationError(null);
    setRecordId(previous.recordId);
    setLookupResult(previous.lookupResult);
    setDisplayedTitle(
      previous.lookupResult
        ? previous.lookupResult.responseType === "search"
          ? "Record from Search Service"
          : previous.lookupResult.responseType === "ddms"
            ? "Record from Reservoir DDMS"
            : "Record from Storage Service"
        : "Record from Storage Service",
    );
  }, [isRelatedNavigationLoading, navHistory, resetVersionState]);

  const handleStorageDeleteRequest = useCallback(() => {
    const seed = selectedId.trim();
    if (!seed) return;
    setStorageDeleteRequestId(seed);
    handleOpenChange(true);
  }, [handleOpenChange, selectedId]);

  const handleStorageDeleteRequestHandled = useCallback(() => {
    setStorageDeleteRequestId(null);
  }, []);

  const handleRecordDeleted = useCallback(() => {
    handleOpenChange(false);
    onRecordDeleted?.();
  }, [handleOpenChange, onRecordDeleted]);

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
    // openRequestId carries the record ID to open, so seed from it directly —
    // this lets callers look up an arbitrary record without a selected row.
    handleOpenChange(true, openRequestId);
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

  const displayedRecord = versionRecord ?? data;
  const json = displayedRecord ? JSON.stringify(displayedRecord, null, 2) : "";
  const latestStorageVersionUnavailable = isError && isHttpNotFound(error);
  const hasDisplayedRecord = Boolean(lookupResult) || versionRecord !== null || (!isError && Boolean(data));
  const activeJson = versionRecord !== null ? json : lookupResult?.json ?? json;
  const viewerLookupResult = useMemo(() => {
    if (versionRecord === null || lookupResult?.responseType !== "storage") return lookupResult;
    return { ...lookupResult, json };
  }, [json, lookupResult, versionRecord]);
  const isReservoirDdmsResponse = lookupResult?.responseType === "ddms";
  const handleLookupResult = useCallback((result: JsonViewerLookupResult | null) => {
    resetVersionState();
    setLookupResult(result);
    setDisplayedTitle(
      result?.responseType === "ddms"
        ? "Record from Reservoir DDMS"
        : result?.responseType === "search"
          ? "Record from Search Service"
          : "Record from Storage Service",
    );
  }, [resetVersionState]);

  return (
    <>
      {!hideTriggers && (
      <div className="inline-flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex"
              tabIndex={!selectedId ? 0 : undefined}
              aria-label={!selectedId ? "Storage Record unavailable until a row is selected" : undefined}
            >
              <Button
                variant="outline"
                size="icon"
                className={`h-8 w-8 ${selectedId ? "text-primary hover:text-primary" : "text-foreground disabled:text-foreground disabled:opacity-100"}`}
                disabled={!selectedId}
                onClick={() => handleOpenChange(true)}
                aria-label="Open Storage Record"
              >
                <StorageIcon className="h-4 w-4" />
                <span className="sr-only">Storage Record</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Storage Record</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex"
              tabIndex={!selectedId ? 0 : undefined}
              aria-label={!selectedId ? "Delete unavailable until a row is selected" : undefined}
            >
              <Button
                variant="outline"
                size="icon"
                className={`h-8 w-8 ${selectedId ? "text-destructive hover:text-destructive" : "text-foreground disabled:text-foreground disabled:opacity-100"}`}
                disabled={!selectedId}
                onClick={handleStorageDeleteRequest}
                aria-label="Delete selected Storage Service record"
                data-testid="button-delete-selected-storage-record"
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete Storage record</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Delete Storage record</TooltipContent>
        </Tooltip>
      </div>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-w-none w-screen h-screen flex flex-col p-0 gap-0 rounded-none border-0 [&>button]:h-7 [&>button]:w-7 [&>button]:rounded-md [&>button]:border [&>button]:border-border/60 [&>button]:bg-background/60 [&>button]:p-1 [&>button]:opacity-100 [&>button]:hover:bg-accent"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{displayedTitle}</DialogTitle>

          {/* Header: icon + title */}
          <div
            data-testid="record-lookup-dialog-header"
            className="flex items-center gap-3 border-b border-border/40 bg-muted/20 px-4 py-2 shrink-0"
          >
            <StorageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-foreground shrink-0">{displayedTitle}</span>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden min-h-0 p-4 flex flex-col gap-2">
            {versionFetchError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-error-border/60 bg-error-surface p-3 text-sm text-error-text shrink-0"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="break-all">{versionFetchError}</span>
              </div>
            )}
            <div className="flex-1 min-h-0">
            {!lookupResult && isError && versionRecord === null && (
              latestStorageVersionUnavailable ? (
                <div
                  data-testid="storage-latest-version-not-found"
                  role="alert"
                  className="flex items-start gap-3 rounded-lg border border-error-border/60 bg-error-surface p-4 text-sm text-error-text"
                >
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">Latest version not found</p>
                    <p className="mt-1 break-all text-xs opacity-80">
                      {(error as Error | undefined)?.message ?? "HTTP 404: Record not found"}
                    </p>
                    <p className="mt-2">
                      If earlier versions are retained, you can select one to open it.
                    </p>
                    <div className="mt-3">
                      <VersionHistorySelect
                        recordId={recordId}
                        selectedVersion={selectedStorageVersion}
                        onVersionSelect={handleStorageVersionSelect}
                        isVersionLoading={isVersionLoading}
                        latestUnavailable
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-error-border/60 bg-error-surface p-4 text-sm text-error-text">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span className="break-all">
                    {(error as Error | undefined)?.message ?? "Failed to fetch record."}
                  </span>
                </div>
              )
            )}
            {!isError && !data && isFetching && (
              <div className="h-full flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading record…
              </div>
            )}
            {hasDisplayedRecord && (
              <JsonViewerContent
                  key={`${recordId}:${selectedStorageVersion ?? "latest"}:${lookupResult?.label ?? "original"}`}
                json={activeJson}
                storageKey={viewerLookupResult?.storageKey ?? (recordId || undefined)}
                _isFullscreen
                className="h-full"
                 searchRecordId={recordId}
                  storageRecordId={lookupResult ? undefined : recordId}
                  isStorageVersionLoading={isVersionLoading}
                  latestStorageVersionUnavailable={latestStorageVersionUnavailable}
                  selectedStorageVersion={selectedStorageVersion}
                  onStorageVersionSelect={handleStorageVersionSelect}
                  onStorageVersionsDeleted={handleStorageVersionsDeleted}
                 rdmsContext={lookupResult?.rdmsContext}
                 hideStorageLookup={isReservoirDdmsResponse}
                 hideSearchLookup={isReservoirDdmsResponse}
                 hideDdmsLookup={isReservoirDdmsResponse}
                 hideWdmsLookup={isReservoirDdmsResponse}
                 lookupResult={viewerLookupResult}
                 onLookupResult={handleLookupResult}
                 onResponseTypeChange={handleResponseTypeChange}
                  onNavigateToRelated={handleNavigateToRelated}
                  canNavigateBack={navHistory.length > 0}
                  onNavigateBack={handleNavigateBack}
                   isRelatedNavigationLoading={isRelatedNavigationLoading}
                   relatedNavigationError={relatedNavigationError}
                  onRecordDeleted={handleRecordDeleted}
                  openStorageDeleteRequestId={storageDeleteRequestId}
                  onStorageDeleteRequestHandled={handleStorageDeleteRequestHandled}
              />
            )}
            {!lookupResult && !isError && !data && !isFetching && recordId === "" && (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No record selected.
              </div>
            )}
            {!lookupResult && !isError && !data && !isFetching && recordId !== "" && (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No record returned for this ID.
              </div>
            )}
            </div>
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
