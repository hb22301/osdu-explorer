import { useListOsduLegalTags, getListOsduLegalTagsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Tags } from "lucide-react";

export default function LegalTagsPage() {
  const { data, isLoading } = useListOsduLegalTags(
    { valid: true },
    { query: { queryKey: getListOsduLegalTagsQueryKey({ valid: true }) } }
  );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Legal Tags</h1>
        <p className="text-muted-foreground">View available legal tags for data compliance and access control.</p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5 text-muted-foreground" />
            Valid Legal Tags
          </CardTitle>
          <CardDescription>
            {data ? `Showing ${data.legalTags.length} tags` : "Loading..."}
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
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Properties</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.legalTags?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                        No legal tags found
                      </TableCell>
                    </TableRow>
                  )}
                  {data?.legalTags?.map((tag) => {
                    const props = tag.properties as any;
                    return (
                      <TableRow key={tag.name}>
                        <TableCell className="font-mono text-sm font-medium">
                          {tag.name}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">
                          {tag.description || "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {props?.countryOfOrigin && (
                              <Badge variant="outline" className="text-xs">
                                Origin: {props.countryOfOrigin.join(", ")}
                              </Badge>
                            )}
                            {props?.contractId && (
                              <Badge variant="outline" className="text-xs">
                                Contract: {props.contractId}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}