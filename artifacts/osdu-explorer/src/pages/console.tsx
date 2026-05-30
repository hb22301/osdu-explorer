import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetOsduConsole, useClearOsduConsole, getGetOsduConsoleQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Play, Pause, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function ConsolePage() {
  const [isPaused, setIsPaused] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetOsduConsole(
    undefined,
    {
      query: {
        refetchInterval: isPaused ? false : 2000,
        queryKey: getGetOsduConsoleQueryKey()
      }
    }
  );

  const clearConsole = useClearOsduConsole({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetOsduConsoleQueryKey() });
      }
    }
  });

  const entries = data?.entries || [];

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Console</h1>
          <p className="text-sm text-muted-foreground">Live log of API interactions</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch 
              id="pause-auto-refresh" 
              checked={isPaused} 
              onCheckedChange={setIsPaused} 
            />
            <Label htmlFor="pause-auto-refresh" className="flex items-center gap-1 cursor-pointer">
              {isPaused ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPaused ? "Paused" : "Live"}
            </Label>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => clearConsole.mutate(undefined)}
            disabled={clearConsole.isPending || entries.length === 0}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {isLoading && entries.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground font-mono text-sm">
            Loading...
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground font-mono text-sm">
            No requests captured yet. Make an API call to see activity here.
          </div>
        ) : (
          <div className="p-4 space-y-2 font-mono text-sm">
            {entries.map((entry) => (
              <ConsoleEntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function ConsoleEntryRow({ entry }: { entry: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const hasBody = entry.requestBody || entry.responseBody;

  const levelColor = {
    info: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    warn: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    error: "bg-red-500/10 text-red-500 border-red-500/20",
  }[entry.level as "info" | "warn" | "error"] || "bg-slate-500/10 text-slate-400";

  const typeColor = {
    token_fetch: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    api_request: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    error: "bg-red-500/10 text-red-500 border-red-500/20",
  }[entry.type as "token_fetch" | "api_request" | "error"] || "bg-slate-500/10 text-slate-400";

  const statusColor = 
    !entry.responseStatus ? "text-muted-foreground" :
    entry.responseStatus >= 500 ? "text-red-500" :
    entry.responseStatus >= 400 ? "text-amber-500" :
    entry.responseStatus >= 200 ? "text-green-500" :
    "text-muted-foreground";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className={`p-3 rounded-md border border-border bg-card/50 transition-colors ${isOpen ? 'bg-card' : 'hover:bg-card/80'}`}>
        <div className="flex items-start gap-3">
          {hasBody ? (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="w-6 h-6 p-0 shrink-0 mt-0.5 text-muted-foreground">
                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </Button>
            </CollapsibleTrigger>
          ) : (
            <div className="w-6 h-6 shrink-0" /> // spacer
          )}
          
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center flex-wrap gap-x-3 gap-y-2">
              <span className="text-muted-foreground text-xs shrink-0">
                {format(new Date(entry.timestamp), "HH:mm:ss.SSS")}
              </span>
              
              <Badge variant="outline" className={`text-[10px] h-5 px-1.5 uppercase ${levelColor}`}>
                {entry.level}
              </Badge>
              
              <Badge variant="outline" className={`text-[10px] h-5 px-1.5 uppercase ${typeColor}`}>
                {entry.type.replace('_', ' ')}
              </Badge>

              {entry.method && (
                <span className="font-bold text-foreground shrink-0">{entry.method}</span>
              )}
              
              {entry.url && (
                <span className="text-muted-foreground truncate max-w-[300px] md:max-w-md lg:max-w-xl xl:max-w-2xl" title={entry.url}>
                  {entry.url}
                </span>
              )}

              <div className="flex items-center gap-3 ml-auto shrink-0">
                {entry.responseStatus && (
                  <span className={`font-bold flex items-center gap-1 ${statusColor}`}>
                    → {entry.responseStatus}
                  </span>
                )}
                
                {entry.durationMs !== null && (
                  <span className="text-muted-foreground text-xs">
                    {entry.durationMs}ms
                  </span>
                )}
              </div>
            </div>

            {entry.message && (
              <div className="flex items-start gap-2 text-muted-foreground/80 pl-2 border-l-2 border-border/50 text-xs mt-2">
                <span className="shrink-0 pt-0.5">↳</span>
                <span className="whitespace-pre-wrap">{entry.message}</span>
              </div>
            )}
          </div>
        </div>

        <CollapsibleContent className="mt-3 pl-9">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {entry.requestBody && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Request Body</div>
                <div className="bg-muted/50 rounded-md p-3 overflow-x-auto border border-border/50">
                  <pre className="text-xs text-foreground/90 whitespace-pre-wrap break-all">
                    {typeof entry.requestBody === 'object' 
                      ? JSON.stringify(entry.requestBody, null, 2) 
                      : String(entry.requestBody)}
                  </pre>
                </div>
              </div>
            )}
            
            {entry.responseBody && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Response Body</div>
                <div className="bg-muted/50 rounded-md p-3 overflow-x-auto border border-border/50 max-h-[400px]">
                  <pre className="text-xs text-foreground/90 whitespace-pre-wrap break-all">
                    {typeof entry.responseBody === 'object' 
                      ? JSON.stringify(entry.responseBody, null, 2) 
                      : String(entry.responseBody)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
