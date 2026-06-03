import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useGetOsduConfig, useClearOsduConfig, useGetOsduConsole, getGetOsduConsoleQueryKey } from "@workspace/api-client-react";
import { Database, Search, ScrollText, Tags, LogOut, Activity, Terminal, ChevronDown, ChevronUp, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConsolePanel } from "@/components/console-panel";

const DEFAULT_CONSOLE_HEIGHT = 300;
const MIN_CONSOLE_HEIGHT = 80;
const MAX_CONSOLE_HEIGHT = 700;

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(DEFAULT_CONSOLE_HEIGHT);
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);
  const { data: config, isLoading } = useGetOsduConfig();
  const clearConfig = useClearOsduConfig();

  // Poll console entry count for the badge (lightweight — just total)
  const { data: consoleData } = useGetOsduConsole(
    { limit: 1, offset: 0 },
    { query: { refetchInterval: 3000, queryKey: getGetOsduConsoleQueryKey({ limit: 1, offset: 0 }) } }
  );
  const entryCount = consoleData?.total ?? 0;

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    if (!isLoading && !config?.configured && location !== "/") {
      setLocation("/");
    }
  }, [isLoading, config?.configured, location, setLocation]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startY: e.clientY, startHeight: consoleHeight };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const delta = dragState.current.startY - ev.clientY;
      const next = Math.min(MAX_CONSOLE_HEIGHT, Math.max(MIN_CONSOLE_HEIGHT, dragState.current.startHeight + delta));
      setConsoleHeight(next);
    };

    const onUp = () => {
      dragState.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [consoleHeight]);

  const handleLogout = () => {
    clearConfig.mutate(undefined, {
      onSuccess: () => setLocation("/"),
    });
  };

  const navItems = [
    { label: "Dashboard", href: "/dashboard", icon: Activity },
    { label: "Legal Tags", href: "/legal-tags", icon: Tags },
    { label: "Schemas", href: "/schemas", icon: ScrollText },
    { label: "Search", href: "/search", icon: Search },
    { label: "Reservoir DMS", href: "/reservoir-dms", icon: Layers },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        Loading...
      </div>
    );
  }

  if (location === "/") {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>;
  }

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <TooltipProvider delayDuration={200}>
        <div className="w-14 border-r border-border bg-card flex flex-col h-full shrink-0 items-center">
          <div className="h-14 flex items-center justify-center border-b border-border w-full shrink-0">
            <Database className="w-5 h-5 text-primary" />
          </div>

          <div className="flex-1 py-3 w-full flex flex-col items-center gap-1">
            {navItems.map((item) => {
              const isActive =
                location === item.href || location.startsWith(`${item.href}/`);
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      className={`flex items-center justify-center w-9 h-9 rounded-md transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          <div className="pb-3 w-full flex flex-col items-center gap-1 border-t border-border pt-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-9 h-9 text-muted-foreground hover:text-foreground"
                  onClick={handleLogout}
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <div className="text-xs space-y-0.5">
                  <div className="font-medium">Disconnect</div>
                  {config?.baseUrl && <div className="font-mono text-muted-foreground">{config.baseUrl}</div>}
                  {config?.partitionId && <div className="font-mono text-muted-foreground">{config.partitionId}</div>}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      {/* Right side: main content + console panel */}
      <div className="flex-1 flex flex-col h-full min-w-0 min-h-0">
        {/* Global connection indicator */}
        <div className="shrink-0 h-8 flex items-center gap-2 px-4 border-b border-border bg-card/60 select-none">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${config?.configured ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
          />
          <span className="text-[11px] font-mono text-muted-foreground truncate">
            {config?.baseUrl ?? "Not connected"}
          </span>
        </div>

        {/* Main content — shrinks when console is open */}
        <main className="flex-1 overflow-auto bg-background min-h-0">
          {children}
        </main>

        {/* Drag handle + console panel — slides in above the toggle bar */}
        {consoleOpen && (
          <>
            <div
              className="shrink-0 h-[5px] cursor-ns-resize bg-border/60 hover:bg-primary/40 active:bg-primary/60 transition-colors"
              onMouseDown={handleDragStart}
              title="Drag to resize"
            />
            <div className="shrink-0" style={{ height: consoleHeight }}>
              <ConsolePanel height={consoleHeight} />
            </div>
          </>
        )}

        {/* Console toggle bar — always visible */}
        <div
          className="shrink-0 h-7 flex items-center gap-2 px-3 border-t border-border bg-card/80 cursor-pointer select-none hover:bg-muted/60 transition-colors"
          onClick={() => setConsoleOpen((v) => !v)}
          role="button"
          aria-expanded={consoleOpen}
          aria-label="Toggle console"
        >
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium text-muted-foreground">Console</span>
          {entryCount > 0 && (
            <Badge
              variant="secondary"
              className="h-4 px-1.5 text-[10px] font-mono rounded-sm"
            >
              {entryCount}
            </Badge>
          )}
          <div className="ml-auto text-muted-foreground">
            {consoleOpen ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
