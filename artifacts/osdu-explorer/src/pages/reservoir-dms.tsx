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

interface ResourceRecord {
  uuid: string;
  name: string;
  creator: string;
  created: string;
  lastChanged: string;
}

function extractDataspaceName(raw: string): string {
  const m = raw.match(/dataspace\('([^']+)'\)/);
  return m ? m[1] : raw;
}

function parseUuidFromUri(uri: string): string {
  const m = uri.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : uri;
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

function parseRecords(data: unknown): ResourceRecord[] {
  let items: unknown[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.resources)) items = d.resources;
    else if (Array.isArray(d.objects)) items = d.objects;
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
      const uri = typeof o.uri === "string" ? o.uri : "";
      const uuid = uri ? parseUuidFromUri(uri) : (typeof o.id === "string" ? o.id : "");
      const name = typeof o.name === "string" ? o.name : "";
      const custom = o.customData && typeof o.customData === "object" ? o.customData as Record<string, unknown> : {};
      const creator = typeof custom.creator === "string" ? custom.creator : (typeof o.creator === "string" ? o.creator : "");
      const created = typeof custom.created === "string" ? custom.created : (typeof o.created === "string" ? o.created : "");
      const lastChanged = typeof o.lastChanged === "string" ? o.lastChanged : "";
      return { uuid, name, creator, created, lastChanged };
    }
    return { uuid: "", name: String(it), creator: "", created: "", lastChanged: "" };
  });
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ReservoirDmsPage() {
  const [dataspaces, setDataspaces] = useState<string[]>([]);
  const [dataspaceError, setDataspaceError] = useState<string | null>(null);
  const [selectedDataspace, setSelectedDataspace] = useState<string>("");

  const [resources, setResources] = useState<Resource[] | null>(null);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [selectedResource, setSelectedResource] = useState<string | null>(null);

  const [records, setRecords] = useState<ResourceRecord[] | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);

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
    setSelectedResource(null);
    setRecords(null);
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

  const fetchRecords = useCallback(async (datatype: string) => {
    if (!selectedDataspace || recordsLoading) return;
    setSelectedResource(datatype);
    setRecordsLoading(true);
    setRecordsError(null);
    setRecords(null);
    try {
      const res = await fetch(
        `/api/osdu/rdms/dataspaces/${encodeURIComponent(selectedDataspace)}/resources/${encodeURIComponent(datatype)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setRecordsError(err.error ?? `Failed to fetch records for "${datatype}"`);
        return;
      }
      const data = await res.json() as unknown;
      setRecords(parseRecords(data));
    } catch {
      setRecordsError("Failed to fetch records");
    } finally {
      setRecordsLoading(false);
    }
  }, [selectedDataspace, recordsLoading]);

  const showRecords = records !== null || recordsLoading || recordsError !== null;

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

      {/* Content area — split when records are active */}
      <div className={`flex-1 overflow-hidden ${showRecords ? "flex" : ""}`}>
        {/* Resources panel */}
        <div className={`flex flex-col overflow-auto ${showRecords ? "w-80 shrink-0 border-r border-border" : "w-full"} p-4`}>
          {resourcesError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
              {resourcesError}
            </div>
          )}

          {resources === null && !resourcesError && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
              <FlaskConical className="h-10 w-10 opacity-20" />
              <p className="text-sm text-center">
                {selectedDataspace
                  ? `Select a dataspace and click "Fetch Resources"`
                  : "Select a dataspace to get started"}
              </p>
            </div>
          )}

          {resources !== null && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-foreground">Resources</h2>
                <Badge variant="secondary" className="text-xs font-mono truncate max-w-[10rem]">
                  {selectedDataspace}
                </Badge>
                <Badge variant="outline" className="text-xs shrink-0">
                  {resources.length} type{resources.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              {!showRecords && (
                <p className="text-[11px] text-muted-foreground">Double-click a row to view its records.</p>
              )}

              {resources.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center border rounded-md">
                  No resources found in this dataspace.
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="text-xs font-semibold text-muted-foreground py-2">name</TableHead>
                        {!showRecords && (
                          <TableHead className="text-xs font-semibold text-muted-foreground py-2 text-right w-24">count</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resources.map((r, i) => (
                        <TableRow
                          key={i}
                          className={`cursor-pointer select-none transition-colors ${
                            selectedResource === r.name
                              ? "bg-emerald-500/10 hover:bg-emerald-500/15"
                              : "hover:bg-muted/40"
                          }`}
                          onDoubleClick={() => { void fetchRecords(r.name); }}
                          title="Double-click to view records"
                        >
                          <TableCell className="text-xs font-mono py-1.5 truncate max-w-[14rem]">{r.name}</TableCell>
                          {!showRecords && (
                            <TableCell className="text-xs tabular-nums text-right py-1.5 text-muted-foreground">{r.count.toLocaleString()}</TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Records panel — shown when a row is double-clicked */}
        {showRecords && (
          <div className="flex-1 flex flex-col overflow-auto p-4 gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-foreground">Records</h2>
              {selectedResource && (
                <Badge variant="secondary" className="text-xs font-mono truncate max-w-xs">
                  {selectedResource}
                </Badge>
              )}
              {recordsLoading && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              {records && (
                <Badge variant="outline" className="text-xs">
                  {records.length} record{records.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            {recordsError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {recordsError}
              </div>
            )}

            {recordsLoading && !recordsError && (
              <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading records…</span>
              </div>
            )}

            {records !== null && !recordsLoading && (
              records.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center border rounded-md">
                  No records found for this resource type.
                </div>
              ) : (
                <div className="border rounded-md overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="text-xs font-semibold text-muted-foreground py-2 w-72">Uuid</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground py-2">name</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground py-2 w-64">creator</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground py-2 w-44">created</TableHead>
                        <TableHead className="text-xs font-semibold text-muted-foreground py-2 w-44">lastChanged</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.map((rec, i) => (
                        <TableRow key={i} className="hover:bg-muted/30">
                          <TableCell className="text-xs font-mono py-2 text-muted-foreground">{rec.uuid || "—"}</TableCell>
                          <TableCell className="text-xs py-2">{rec.name || "—"}</TableCell>
                          <TableCell className="text-xs font-mono py-2 text-muted-foreground truncate max-w-[16rem]">{rec.creator || "—"}</TableCell>
                          <TableCell className="text-xs py-2 text-muted-foreground whitespace-nowrap">{formatDate(rec.created)}</TableCell>
                          <TableCell className="text-xs py-2 text-muted-foreground whitespace-nowrap">{formatDate(rec.lastChanged)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
