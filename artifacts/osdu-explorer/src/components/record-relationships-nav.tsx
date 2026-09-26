import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Waypoints, ArrowLeft, ChevronDown } from "lucide-react";
import type { RecordRelationship } from "@/lib/storage-record-relationships";

interface RecordRelationshipsNavProps {
  relationships: RecordRelationship[];
  onNavigate: (id: string) => void;
  canGoBack: boolean;
  onBack: () => void;
}

// Lets the user follow references from the displayed record to related records
// (parent/child and others), with a Back control to retrace the navigation.
export function RecordRelationshipsNav({
  relationships,
  onNavigate,
  canGoBack,
  onBack,
}: RecordRelationshipsNavProps) {
  if (!canGoBack && relationships.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {canGoBack && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={onBack}
          aria-label="Back to previous record"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      )}
      {relationships.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              aria-label="Related records"
            >
              <Waypoints className="h-3.5 w-3.5" />
              <span>Related ({relationships.length})</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-auto">
            <DropdownMenuLabel className="text-xs">Referenced records</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {relationships.map((rel) => (
              <DropdownMenuItem
                key={`${rel.path}:${rel.id}`}
                onSelect={() => onNavigate(rel.id)}
                className="flex flex-col items-start gap-0.5"
                aria-label={`Open related record ${rel.id}`}
              >
                <span className="text-[11px] text-muted-foreground">{rel.path}</span>
                <span className="font-mono text-xs break-all">{rel.id}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
