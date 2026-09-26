import { useGetOsduRecordVersions } from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { History, ChevronDown, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseVersions, formatVersion } from "@/lib/storage-version-history";

interface VersionHistorySelectProps {
  recordId: string | undefined;
  selectedVersion: number | undefined;
  onVersionSelect: (version: number) => void;
}

// Compact version picker for the JSON viewer's fullscreen header. Lets the user
// switch between historical versions of a Storage record without leaving the viewer.
export function VersionHistorySelect({
  recordId,
  selectedVersion,
  onVersionSelect,
}: VersionHistorySelectProps) {
  const { data, isLoading, error } = useGetOsduRecordVersions(recordId ?? "", {
    query: { enabled: !!recordId } as any,
  });

  if (!recordId) return null;

  const versions = parseVersions(data?.versions);
  // Nothing to switch between unless there are at least two versions.
  if (!isLoading && !error && versions.length < 2) return null;

  const latest = versions.find((v) => v.isLatest)?.version;
  const current = selectedVersion ?? latest;
  const currentLabel =
    current !== undefined ? formatVersion(current, current === latest) : "Versions";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={isLoading || !!error}
          aria-label="Select record version"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <History className="h-3.5 w-3.5" />
          )}
          <span className="font-mono">{error ? "Versions" : currentLabel}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-auto">
        {versions.map((v) => (
          <DropdownMenuItem
            key={v.version}
            onSelect={() => onVersionSelect(v.version)}
            className="gap-2 text-xs"
          >
            <Check
              className={cn(
                "h-3.5 w-3.5",
                v.version === current ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="font-mono">{formatVersion(v.version, v.isLatest)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
