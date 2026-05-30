import { useState } from "react";
import { useListOsduSchemas, getListOsduSchemasQueryKey, useGetOsduSchema } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, FileJson } from "lucide-react";

export default function SchemasPage() {
  const [authority, setAuthority] = useState("");
  const [source, setSource] = useState("");
  const [entityType, setEntityType] = useState("");
  const [params, setParams] = useState({ authority: "", source: "", entityType: "" });
  
  const [selectedKind, setSelectedKind] = useState<string | null>(null);

  const { data: schemasData, isLoading } = useListOsduSchemas(
    { 
      authority: params.authority || undefined,
      source: params.source || undefined,
      entityType: params.entityType || undefined,
      limit: 100,
    },
    { query: { queryKey: getListOsduSchemasQueryKey(params) } }
  );

  const { data: schemaDetails, isLoading: isLoadingDetails } = useGetOsduSchema(
    encodeURIComponent(selectedKind || ""),
    { query: { enabled: !!selectedKind, queryKey: ["osduSchema", selectedKind] } }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setParams({ authority, source, entityType });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Schema Browser</h1>
        <p className="text-muted-foreground">Browse and inspect OSDU data schemas.</p>
      </div>

      <Card className="border-border/50">
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex gap-4 items-end">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium leading-none">Authority</label>
              <Input placeholder="e.g. osdu" value={authority} onChange={(e) => setAuthority(e.target.value)} />
            </div>
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium leading-none">Source</label>
              <Input placeholder="e.g. wks" value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
            <div className="flex-[2] space-y-2">
              <label className="text-sm font-medium leading-none">Entity Type</label>
              <Input placeholder="e.g. well" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
            </div>
            <Button type="submit">
              <Search className="h-4 w-4 mr-2" /> Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle>Schemas</CardTitle>
          <CardDescription>
            {schemasData ? `Found ${schemasData.totalCount} schemas` : "Loading..."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex py-12 justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kind</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schemasData?.schemaInfos?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        No schemas found
                      </TableCell>
                    </TableRow>
                  )}
                  {schemasData?.schemaInfos?.map((schema) => (
                    <TableRow key={schema.kind}>
                      <TableCell className="font-mono text-sm">
                        {schema.kind}
                      </TableCell>
                      <TableCell>
                        <Badge variant={schema.status === "PUBLISHED" ? "default" : "secondary"}>
                          {schema.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {schema.dateCreated ? new Date(schema.dateCreated).toLocaleDateString() : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedKind(schema.kind!)}>
                          <FileJson className="h-4 w-4 mr-2" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selectedKind} onOpenChange={(open) => !open && setSelectedKind(null)}>
        <SheetContent className="sm:max-w-xl md:max-w-2xl w-full flex flex-col h-full bg-background border-border">
          <SheetHeader className="pb-4 border-b border-border shrink-0">
            <SheetTitle className="font-mono break-all text-lg">{selectedKind}</SheetTitle>
            <SheetDescription>JSON Schema Definition</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-hidden py-4">
            {isLoadingDetails ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : schemaDetails ? (
              <ScrollArea className="h-full rounded-md border border-border/50 bg-muted/30">
                <div className="p-4">
                  <pre className="text-xs font-mono text-foreground">
                    {JSON.stringify(schemaDetails.schema, null, 2)}
                  </pre>
                </div>
              </ScrollArea>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                Failed to load schema definition.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}