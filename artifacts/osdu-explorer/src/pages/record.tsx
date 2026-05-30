import { useRoute } from "wouter";
import { useGetOsduRecord, getGetOsduRecordQueryKey, useGetOsduRecordVersions, getGetOsduRecordVersionsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileJson, History, Shield, Tags as TagsIcon, Loader2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function RecordPage() {
  const [, params] = useRoute("/records/:id");
  const id = params?.id ? decodeURIComponent(params.id) : "";

  const { data: record, isLoading: isLoadingRecord } = useGetOsduRecord(id, {
    query: { enabled: !!id, queryKey: getGetOsduRecordQueryKey(id) }
  });

  const { data: versions, isLoading: isLoadingVersions } = useGetOsduRecordVersions(id, {
    query: { enabled: !!id, queryKey: getGetOsduRecordVersionsQueryKey(id) }
  });

  if (isLoadingRecord) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!record) {
    return (
      <div className="p-8 max-w-5xl mx-auto text-center space-y-4">
        <h1 className="text-2xl font-bold">Record not found</h1>
        <Link href="/search" className="text-primary hover:underline flex items-center justify-center">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to search
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="space-y-4">
        <Link href="/search" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to search
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-mono break-all">{record.id}</h1>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <Badge variant="secondary" className="font-mono text-sm px-2 py-0.5">{record.kind}</Badge>
            <span className="text-sm text-muted-foreground">Version: {record.version}</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="data" className="w-full">
        <TabsList className="grid w-full grid-cols-4 lg:w-[600px]">
          <TabsTrigger value="data"><FileJson className="h-4 w-4 mr-2" /> Data</TabsTrigger>
          <TabsTrigger value="acl"><Shield className="h-4 w-4 mr-2" /> ACL & Legal</TabsTrigger>
          <TabsTrigger value="meta"><TagsIcon className="h-4 w-4 mr-2" /> Meta & Tags</TabsTrigger>
          <TabsTrigger value="history"><History className="h-4 w-4 mr-2" /> History</TabsTrigger>
        </TabsList>
        
        <TabsContent value="data" className="mt-6">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Data Payload</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/30 rounded-lg p-4 overflow-auto border border-border/50">
                <pre className="text-sm font-mono text-foreground">
                  {JSON.stringify(record.data, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="acl" className="mt-6 space-y-6">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Access Control List (ACL)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/30 rounded-lg p-4 overflow-auto border border-border/50">
                <pre className="text-sm font-mono text-foreground">
                  {JSON.stringify(record.acl, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Legal Constraints</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/30 rounded-lg p-4 overflow-auto border border-border/50">
                <pre className="text-sm font-mono text-foreground">
                  {JSON.stringify(record.legal, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="meta" className="mt-6 space-y-6">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Metadata</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/30 rounded-lg p-4 overflow-auto border border-border/50">
                <pre className="text-sm font-mono text-foreground">
                  {JSON.stringify(record.meta, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/30 rounded-lg p-4 overflow-auto border border-border/50">
                <pre className="text-sm font-mono text-foreground">
                  {JSON.stringify(record.tags, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>Version History</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingVersions ? (
                <div className="flex py-4 justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="space-y-4">
                  {versions?.versions?.map((v) => (
                    <div key={v} className="flex items-center justify-between p-4 rounded-lg border border-border/50 bg-muted/20">
                      <div className="flex items-center gap-3">
                        <History className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium">Version {v}</p>
                          <p className="text-sm text-muted-foreground">Timestamp: {new Date(v / 1000).toLocaleString()}</p>
                        </div>
                      </div>
                      {v === record.version && (
                        <Badge>Current</Badge>
                      )}
                    </div>
                  ))}
                  {(!versions?.versions || versions.versions.length === 0) && (
                    <p className="text-muted-foreground text-center py-4">No version history available</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}