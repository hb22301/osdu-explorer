import { useState } from "react";
import { Link } from "wouter";
import { useSearchOsduRecords, useListOsduKinds } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Search as SearchIcon, FileJson, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function SearchPage() {
  const [kind, setKind] = useState("*:*:*:*");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { data: kindsData } = useListOsduKinds({ limit: 1000 });
  const searchMutation = useSearchOsduRecords();

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    searchMutation.mutate({
      data: {
        kind,
        query: query || undefined,
        limit,
        offset
      }
    });
  };

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
    searchMutation.mutate({
      data: {
        kind,
        query: query || undefined,
        limit,
        offset: newOffset
      }
    });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Record Search</h1>
        <p className="text-muted-foreground">Search and explore records in the OSDU data platform.</p>
      </div>

      <Card className="border-border/50">
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex gap-4">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium leading-none">Kind</label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue placeholder="Select kind" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="*:*:*:*">Any kind (*:*:*:*)</SelectItem>
                  {kindsData?.kinds?.map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-[2] space-y-2">
              <label className="text-sm font-medium leading-none">Lucene Query</label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. data.ProjectName: 'MyProject'"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="font-mono text-sm"
                />
                <Button type="submit" disabled={searchMutation.isPending}>
                  {searchMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <SearchIcon className="h-4 w-4 mr-2" />}
                  Search
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {searchMutation.data && (
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle>Results</CardTitle>
              <CardDescription>Found {searchMutation.data.totalCount} records</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(Math.max(0, offset - limit))}
                disabled={offset === 0 || searchMutation.isPending}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Prev
              </Button>
              <span className="text-sm text-muted-foreground min-w-[100px] text-center">
                {offset + 1} - {Math.min(offset + limit, searchMutation.data.totalCount)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(offset + limit)}
                disabled={offset + limit >= searchMutation.data.totalCount || searchMutation.isPending}
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searchMutation.data.results?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        No records found
                      </TableCell>
                    </TableRow>
                  )}
                  {searchMutation.data.results?.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-mono text-sm max-w-[300px] truncate" title={record.id}>
                        {record.id}
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate" title={record.kind}>
                        <Badge variant="secondary" className="font-mono font-normal">
                          {record.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {record.version}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/records/${encodeURIComponent(record.id!)}`}>
                          <Button variant="ghost" size="sm">
                            <FileJson className="h-4 w-4 mr-2" />
                            Inspect
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}