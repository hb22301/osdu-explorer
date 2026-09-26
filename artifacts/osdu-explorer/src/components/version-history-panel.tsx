import { useGetOsduRecordVersions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { parseVersions, formatVersion } from "@/lib/storage-version-history";

interface VersionHistoryPanelProps {
  recordId: string | undefined;
  selectedVersion: number;
  onVersionSelect: (version: number) => void;
}

export function VersionHistoryPanel({
  recordId,
  selectedVersion,
  onVersionSelect,
}: VersionHistoryPanelProps) {
  const { data, isLoading, error } = useGetOsduRecordVersions(recordId ?? "", {
    query: { enabled: !!recordId } as any,
  });

  const versions = parseVersions(data?.versions);

  if (!recordId) return null;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="border-b pb-3">
        <CardTitle className="text-sm">Version History</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-2">
        {isLoading && (
          <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Loading versions…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Failed to load version history</span>
          </div>
        )}
        {!isLoading && !error && versions.length === 0 && (
          <div className="text-xs text-muted-foreground py-4">No versions available</div>
        )}
        {!isLoading && !error && versions.length > 0 && (
          <div className="space-y-1">
            {versions.map((v) => (
              <Button
                key={v.version}
                variant={selectedVersion === v.version ? "default" : "ghost"}
                size="sm"
                className="w-full justify-start text-xs h-8"
                onClick={() => onVersionSelect(v.version)}
              >
                <span className="font-mono">{formatVersion(v.version, v.isLatest)}</span>
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
