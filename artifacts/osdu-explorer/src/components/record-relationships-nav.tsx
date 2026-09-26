import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Waypoints, ArrowLeft } from "lucide-react";
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
  const hasRelationships = relationships.length > 0;

  return (
    <div className="flex shrink-0 items-center gap-0.5" data-testid="record-relationships-nav">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex"
            tabIndex={!canGoBack ? 0 : undefined}
            aria-label={!canGoBack ? "No previous record in navigation history" : undefined}
          >
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${canGoBack ? "text-primary hover:text-primary" : "text-muted-foreground disabled:text-muted-foreground disabled:opacity-100"}`}
              disabled={!canGoBack}
              onClick={onBack}
              aria-label="Back to previous record"
              aria-description={!canGoBack ? "No previous record in navigation history" : undefined}
              data-testid="record-relationships-back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {canGoBack ? "Back to previous record" : "No previous record in navigation history"}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex"
              tabIndex={!hasRelationships ? 0 : undefined}
              aria-label={!hasRelationships ? "No related records" : undefined}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`relative h-7 w-7 ${hasRelationships ? "text-primary hover:text-primary" : "text-muted-foreground disabled:text-muted-foreground disabled:opacity-100"}`}
                  disabled={!hasRelationships}
                  aria-label="Related records"
                  aria-description={`${relationships.length} related record${relationships.length === 1 ? "" : "s"}`}
                  data-testid="record-relationships-related"
                >
                  <Waypoints className="h-3.5 w-3.5" />
                  <span className="sr-only">Related records</span>
                  <span className={`pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-bold leading-none ${hasRelationships ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {relationships.length > 99 ? "99+" : relationships.length}
                  </span>
                </Button>
              </DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {hasRelationships ? `Related records (${relationships.length})` : "No related records"}
          </TooltipContent>
        </Tooltip>
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
    </div>
  );
}
