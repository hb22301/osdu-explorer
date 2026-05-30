import { useGetOsduConfig } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, ScrollText, Tags, Server, ArrowRight } from "lucide-react";

export default function DashboardPage() {
  const { data: config, isLoading } = useGetOsduConfig();
  const [, setLocation] = useLocation();

  if (isLoading) return null;
  if (!config?.configured) {
    setLocation("/");
    return null;
  }

  const quickActions = [
    {
      title: "Search Records",
      description: "Query and inspect OSDU data records",
      icon: Search,
      href: "/search",
      color: "text-blue-500",
      bg: "bg-blue-500/10"
    },
    {
      title: "Schema Browser",
      description: "Explore available data structures",
      icon: ScrollText,
      href: "/schemas",
      color: "text-purple-500",
      bg: "bg-purple-500/10"
    },
    {
      title: "Legal Tags",
      description: "Manage data compliance and access",
      icon: Tags,
      href: "/legal-tags",
      color: "text-green-500",
      bg: "bg-green-500/10"
    }
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Welcome to OSDU Explorer. You are connected to {config.partitionId}.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {quickActions.map((action) => (
          <Link key={action.href} href={action.href}>
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full border-border/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {action.title}
                </CardTitle>
                <div className={`p-2 rounded-md ${action.bg}`}>
                  <action.icon className={`h-4 w-4 ${action.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4">
                  {action.description}
                </p>
                <div className="flex items-center text-sm font-medium text-primary">
                  Open <ArrowRight className="ml-1 h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5 text-muted-foreground" />
            Connection Status
          </CardTitle>
          <CardDescription>Current session information</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col space-y-1 p-4 rounded-lg bg-muted/50 border border-border/50">
              <dt className="text-sm font-medium text-muted-foreground">Platform URL</dt>
              <dd className="text-sm font-mono break-all">{config.baseUrl}</dd>
            </div>
            <div className="flex flex-col space-y-1 p-4 rounded-lg bg-muted/50 border border-border/50">
              <dt className="text-sm font-medium text-muted-foreground">Partition ID</dt>
              <dd className="text-sm font-mono">{config.partitionId}</dd>
            </div>
            <div className="flex flex-col space-y-1 p-4 rounded-lg bg-muted/50 border border-border/50">
              <dt className="text-sm font-medium text-muted-foreground">Token Endpoint</dt>
              <dd className="text-sm font-mono break-all">{config.tokenEndpoint}</dd>
            </div>
            <div className="flex flex-col space-y-1 p-4 rounded-lg bg-muted/50 border border-border/50">
              <dt className="text-sm font-medium text-muted-foreground">Client ID</dt>
              <dd className="text-sm font-mono break-all">{config.clientId}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}