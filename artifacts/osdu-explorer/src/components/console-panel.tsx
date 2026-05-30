import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOsduConsole,
  useClearOsduConsole,
  getGetOsduConsoleQueryKey,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Trash2, ChevronRight, ChevronDown, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ConsoleEntryRowProps {
  entry: {
    id: string;
    timestamp: string;
    type: string;
    level: string;
    method: string | null;
    url: string | null;
    requestBody?: unknown;
    responseStatus: number | null;
    responseBody?: unknown;
    durationMs: number | null;
    message: string | null;
  };
}

function ConsoleEntryRow({ entry }: ConsoleEntryRowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasBody = entry.requestBody || entry.responseBody;

  const levelColor =
    {
      info: "bg-slate-500/10 text-slate-400 border-slate-500/20",
      warn: "bg-amber-500/10 text-amber-500 border-amber-500/20",
      error: "bg-red-500/10 text-red-500 border-red-500/20",
    }[(entry.level as "info" | "warn" | "error")] ??
    "bg-slate-500/10 text-slate-400 border-slate-500/20";

  const typeColor =
    {
      token_fetch: "bg-purple-500/10 text-purple-400 border-purple-500/20",
      api_request: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
      error: "bg-red-500/10 text-red-500 border-red-500/20",
    }[(entry.type as "token_fetch" | "api_request" | "error")] ??
    "bg-slate-500/10 text-slate-400 border-slate-500/20";

  const statusColor =
    !entry.responseStatus
      ? "text-muted-foreground"
      : entry.responseStatus >= 500
      ? "text-red-500"
      : entry.responseStatus >= 400
      ? "text-amber-500"
      : "text-green-500";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={`px-3 py-1.5 border-b border-border/50 transition-colors ${
          isOpen ? "bg-card" : "hover:bg-muted/40"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasBody ? (
            <CollapsibleTrigger asChild>
              <button className="shrink-0 text-muted-foreground hover:text-foreground">
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            </CollapsibleTrigger>
          ) : (
            <div className="w-3.5 shrink-0" />
          )}

          <span className="text-[11px] font-mono text-muted-foreground shrink-0 tabular-nums">
            {format(new Date(entry.timestamp), "HH:mm:ss.SSS")}
          </span>

          <Badge
            variant="outline"
            className={`text-[9px] h-4 px-1 uppercase tracking-wide shrink-0 ${levelColor}`}
          >
            {entry.level}
          </Badge>

          <Badge
            variant="outline"
            className={`text-[9px] h-4 px-1 uppercase tracking-wide shrink-0 ${typeColor}`}
          >
            {entry.type.replace("_", " ")}
          </Badge>

          {entry.method && (
            <span className="text-[11px] font-mono font-bold text-foreground shrink-0">
              {entry.method}
            </span>
          )}

          {entry.url && (
            <span
              className="text-[11px] font-mono text-muted-foreground truncate"
              title={entry.url}
            >
              {entry.url}
            </span>
          )}

          <div className="ml-auto flex items-center gap-3 shrink-0">
            {entry.responseStatus !== null && (
              <span className={`text-[11px] font-mono font-bold ${statusColor}`}>
                {entry.responseStatus}
              </span>
            )}
            {entry.durationMs !== null && (
              <span className="text-[11px] font-mono text-muted-foreground">
                {entry.durationMs}ms
              </span>
            )}
          </div>
        </div>

        {entry.message && (
          <div className="flex items-start gap-2 mt-1 pl-5 text-[11px] font-mono text-muted-foreground/80">
            <span className="shrink-0">↳</span>
            <span>{entry.message}</span>
          </div>
        )}

        <CollapsibleContent className="mt-2 pl-5">
          <div className="grid grid-cols-2 gap-3 pb-1">
            {entry.requestBody && (
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Request
                </div>
                <pre className="text-[11px] font-mono bg-muted/50 rounded p-2 overflow-x-auto max-h-40 border border-border/40 text-foreground/80 whitespace-pre-wrap break-all">
                  {typeof entry.requestBody === "object"
                    ? JSON.stringify(entry.requestBody, null, 2)
                    : String(entry.requestBody)}
                </pre>
              </div>
            )}
            {entry.responseBody && (
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Response
                </div>
                <pre className="text-[11px] font-mono bg-muted/50 rounded p-2 overflow-x-auto max-h-40 border border-border/40 text-foreground/80 whitespace-pre-wrap break-all">
                  {typeof entry.responseBody === "object"
                    ? JSON.stringify(entry.responseBody, null, 2)
                    : String(entry.responseBody)}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface ConsolePanelProps {
  height?: number;
}

export function ConsolePanel({ height = 280 }: ConsolePanelProps) {
  const [isPaused, setIsPaused] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useGetOsduConsole(undefined, {
    query: {
      refetchInterval: isPaused ? false : 2000,
      queryKey: getGetOsduConsoleQueryKey(),
    },
  });

  const clearConsole = useClearOsduConsole({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetOsduConsoleQueryKey() });
      },
    },
  });

  const entries = [...(data?.entries ?? [])].reverse();

  return (
    <div className="flex flex-col bg-background border-border" style={{ height }}>
      {/* Panel toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0 bg-card/60">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Network
        </span>
        {data && data.total > 0 && (
          <span className="text-[10px] font-mono text-muted-foreground">
            {data.total} {data.total === 1 ? "entry" : "entries"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-muted-foreground hover:text-foreground gap-1"
            onClick={() => setIsPaused((p) => !p)}
          >
            {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            <span className="text-[11px]">{isPaused ? "Resume" : "Pause"}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-muted-foreground hover:text-foreground gap-1"
            onClick={() => clearConsole.mutate(undefined)}
            disabled={clearConsole.isPending || !entries.length}
          >
            <Trash2 className="w-3 h-3" />
            <span className="text-[11px]">Clear</span>
          </Button>
        </div>
      </div>

      {/* Entries */}
      <ScrollArea className="flex-1">
        {entries.length === 0 ? (
          <div className="p-6 text-center text-[12px] font-mono text-muted-foreground">
            No requests captured yet.
          </div>
        ) : (
          <div>
            {entries.map((entry) => (
              <ConsoleEntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
