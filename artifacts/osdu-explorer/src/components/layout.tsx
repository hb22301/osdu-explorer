import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useGetOsduConfig, useClearOsduConfig } from "@workspace/api-client-react";
import { Database, Search, ScrollText, Tags, LogOut, ChevronDown, Activity, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: config, isLoading } = useGetOsduConfig();
  const clearConfig = useClearOsduConfig();

  // Force dark mode on mount
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  const handleLogout = () => {
    clearConfig.mutate(undefined, {
      onSuccess: () => {
        setLocation("/");
      }
    });
  };

  const navItems = [
    { label: "Dashboard", href: "/dashboard", icon: Activity },
    { label: "Search", href: "/search", icon: Search },
    { label: "Schemas", href: "/schemas", icon: ScrollText },
    { label: "Legal Tags", href: "/legal-tags", icon: Tags },
  ];

  if (isLoading) {
    return <div className="min-h-screen bg-background text-foreground flex items-center justify-center">Loading...</div>;
  }

  // If not configured and not on home page, user shouldn't see layout (handled by page guards usually, but good fallback)
  if (!config?.configured && location !== "/") {
    setLocation("/");
    return null;
  }

  // Hide sidebar on connection screen
  if (location === "/") {
    return <div className="min-h-screen bg-background text-foreground">{children}</div>;
  }

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col h-full shrink-0">
        <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
          <Database className="w-5 h-5 text-primary mr-2" />
          <span className="font-bold tracking-tight">OSDU Explorer</span>
        </div>
        
        <div className="flex-1 py-4 overflow-y-auto">
          <nav className="space-y-1 px-2">
            {navItems.map((item) => {
              const isActive = location === item.href || location.startsWith(`${item.href}/`);
              return (
                <Link key={item.href} href={item.href} className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                  <item.icon className={`w-4 h-4 mr-3 flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-border shrink-0 space-y-4">
          <div className="space-y-1">
            <p className="text-xs font-mono text-muted-foreground truncate" title={config?.baseUrl || ""}>
              {config?.baseUrl}
            </p>
            <p className="text-xs font-mono text-muted-foreground truncate" title={config?.partitionId || ""}>
              {config?.partitionId}
            </p>
          </div>
          <Button variant="outline" className="w-full justify-start text-muted-foreground" size="sm" onClick={handleLogout}>
            <LogOut className="w-4 h-4 mr-2" />
            Disconnect
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        <main className="flex-1 overflow-auto bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}