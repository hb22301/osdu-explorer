import { useState, useEffect, useCallback } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface Resource {
  name: string;
  count: number;
}

function extractDataspaceName(raw: string): string {
  const m = raw.match(/dataspace\('([^']+)'\)/);
  return m ? m[1] : raw;
}

function parseDataspaces(data: unknown): string[] {
  let items: unknown[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    items = Array.isArray(d.data) ? d.data : Array.isArray(d.dataspaces) ? d.dataspaces : [];
  }
  return items.map((it) => {
    const raw =
      typeof it === "string"
        ? it
        : it && typeof it === "object"
          ? (() => {
              const o = it as Record<string, unknown>;
              return typeof o.name === "string"
                ? o.name
                : typeof o.id === "string"
                  ? o.id
                  : JSON.stringify(it);
            })()
          : String(it);
    return extractDataspaceName(raw);
  });
}

function parseResources(data: unknown): Resource[] {
  let items: unknown[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.resources)) items = d.resources;
    else if (Array.isArray(d.data)) items = d.data;
    else if (Array.isArray(d.items)) items = d.items;
    else {
      const vals = Object.values(d);
      const firstArr = vals.find(Array.isArray);
      if (firstArr) items = firstArr as unknown[];
    }
  }
  return items.map((it) => {
    if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      const name =
        typeof o.name === "string"
          ? o.name
          : typeof o.type === "string"
            ? o.type
            : typeof o.id === "string"
              ? o.id
              : JSON.stringify(it);
      const count = typeof o.count === "number" ? o.count : typeof o.total === "number" ? o.total : 0;
      return { name, count };
    }
    return { name: String(it), count: 0 };
  });
}

export default function ReservoirDmsPage() {
  const [dataspaces, setDataspaces] = useState<string[]>([]);
  const [dataspaceError, setDataspaceError] = useState<string | null>(null);
  const [selectedDataspace, setSelectedDataspace] = useState<string>("");

  const [resources, setResources] = useState<Resource[] | null>(null);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState<string | null>(null);

  const loadDataspaces = useCallback(async () => {
    setDataspaceError(null);
    try {
      const res = await fetch("/api/osdu/rdms/dataspaces");
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setDataspaceError(err.error ?? "Failed to load dataspaces");
        return;
      }
      const data = await res.json() as unknown;
      const names = parseDataspaces(data);
      setDataspaces(names);
      if (names.length > 0 && !selectedDataspace) {
        setSelectedDataspace(names[0]);
      }
    } catch {
      setDataspaceError("Failed to connect to Reservoir DMS");
    }
  }, [selectedDataspace]);

  useEffect(() => {
    void loadDataspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchResources = useCallback(async () => {
    if (!selectedDataspace || resourcesLoading) return;
    setResourcesLoading(true);
    setResourcesError(null);
    setResources(null);
    try {
      const res = await fetch(`/api/osdu/rdms/dataspaces/${encodeURIComponent(selectedDataspace)}/resources`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setResourcesError(err.error ?? `Failed to fetch resources for "${selectedDataspace}"`);
        return;
      }
      const data = await res.json() as unknown;
      setResources(parseResources(data));
    } catch {
      setResourcesError("Failed to fetch resources");
    } finally {
      setResourcesLoading(false);
    }
  }, [selectedDataspace, resourcesLoading]);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-2 px-6 py-3 border-b border-border bg-card/40">
        <FlaskConical className="h-4 w-4 text-emerald-500 shrink-0" />
        <span className="text-sm font-semibold text-foreground mr-2">Reservoir DMS Data</span>
        <div className="h-4 border-l border-border mx-1" />
        {dataspaceError ? (
          <span className="text-xs text-destructive">{dataspaceError}</span>
        ) : (
          <Select value={selectedDataspace} onValueChange={setSelectedDataspace}>
            <SelectTrigger className="h-8 text-xs w-64">
              <SelectValue placeholder={dataspaces.length === 0 ? "Loading dataspaces…" : "Select dataspace…"} />
            </SelectTrigger>
            <SelectContent>
              {dataspaces.map((ds) => (
                <SelectItem key={ds} value={ds} className="text-xs font-mono">
                  {ds}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={!selectedDataspace || resourcesLoading}
          onClick={() => { void fetchResources(); }}
        >
          {resourcesLoading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Fetch Resources
        </Button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto p-6">
        {resourcesError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
            {resourcesError}
          </div>
        )}

        {resources === null && !resourcesError && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <FlaskConical className="h-10 w-10 opacity-20" />
            <p className="text-sm">
              {selectedDataspace
                ? `Select a dataspace and click "Fetch Resources" to view data`
                : "Select a dataspace to get started"}
            </p>
          </div>
        )}

        {resources !== null && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Resources</h2>
              <Badge variant="secondary" className="text-xs font-mono">
                {selectedDataspace}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {resources.length} type{resources.length !== 1 ? "s" : ""}
              </Badge>
            </div>

            {resources.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center border rounded-md">
                No resources found in this dataspace.
              </div>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="text-xs font-semibold text-muted-foreground py-2.5">name</TableHead>
                      <TableHead className="text-xs font-semibold text-muted-foreground py-2.5 text-right w-32">count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resources.map((r, i) => (
                      <TableRow key={i} className="hover:bg-muted/30">
                        <TableCell className="text-xs font-mono py-2">{r.name}</TableCell>
                        <TableCell className="text-xs tabular-nums text-right py-2 text-muted-foreground">{r.count.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
