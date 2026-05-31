import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useGetOsduConfig, useClearOsduConfig, useGetOsduConsole, getGetOsduConsoleQueryKey } from "@workspace/api-client-react";
import { Database, Search, ScrollText, Tags, LogOut, Activity, Terminal, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    { label: "Search", href: "/search", icon: Search },
    { label: "Schemas", href: "/schemas", icon: ScrollText },
    { label: "Legal Tags", href: "/legal-tags", icon: Tags },
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
      <div className="w-64 border-r border-border bg-card flex flex-col h-full shrink-0">
        <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
          <Database className="w-5 h-5 text-primary mr-2" />
          <span className="font-bold tracking-tight">OSDU Navigator</span>
        </div>

        <div className="flex-1 py-4 overflow-y-auto">
          <nav className="space-y-1 px-2">
            {navItems.map((item) => {
              const isActive =
                location === item.href || location.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon
                    className={`w-4 h-4 mr-3 flex-shrink-0 ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`}
                  />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-border shrink-0 space-y-3">
          <div className="space-y-1">
            <p
              className="text-xs font-mono text-muted-foreground truncate"
              title={config?.baseUrl ?? ""}
            >
              {config?.baseUrl}
            </p>
            <p
              className="text-xs font-mono text-muted-foreground truncate"
              title={config?.partitionId ?? ""}
            >
              {config?.partitionId}
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full justify-start text-muted-foreground"
            size="sm"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Disconnect
          </Button>
        </div>
      </div>

      {/* Right side: main content + console panel */}
      <div className="flex-1 flex flex-col h-full min-w-0 min-h-0">
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
