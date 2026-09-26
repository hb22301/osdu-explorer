import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetOsduRecordVersions, getGetOsduRecordVersionsQueryKey } from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { History, ChevronDown, Loader2, Check, Trash2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseVersions, formatVersion } from "@/lib/storage-version-history";
import { deleteStorageRecordVersions } from "@/lib/storage-record-delete";

interface VersionHistorySelectProps {
  recordId: string | undefined;
  selectedVersion: number | undefined;
  onVersionSelect: (version: number) => void;
  isVersionLoading?: boolean;
  /** The unversioned record request returned 404; offer prior versions as recovery. */
  latestUnavailable?: boolean;
  /** Called after a version is purged, with the deleted version number. */
  onVersionsDeleted?: (deletedVersion: number) => void;
}

// Compact version picker for the JSON viewer's fullscreen header. Lets the user
// switch between historical versions of a Storage record — and permanently purge
// non-latest versions — without leaving the viewer.
export function VersionHistorySelect({
  recordId,
  selectedVersion,
  onVersionSelect,
  isVersionLoading = false,
  latestUnavailable = false,
  onVersionsDeleted,
}: VersionHistorySelectProps) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { data, isLoading, error } = useGetOsduRecordVersions(recordId ?? "", {
    query: { enabled: !!recordId } as any,
  });

  if (!recordId) return null;

  const versions = parseVersions(data?.versions);
  if (!isLoading && !error && versions.length === 0 && latestUnavailable) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        disabled
        aria-label="No earlier versions available"
        title="No earlier versions were returned by the Storage Service."
      >
        <History className="h-3.5 w-3.5" />
        <span>No earlier versions</span>
      </Button>
    );
  }
  // Nothing to switch between unless there are at least two versions.
  if (!isLoading && !error && versions.length < 2 && !latestUnavailable) return null;

  const latest = versions.find((v) => v.isLatest)?.version;
  const current = selectedVersion ?? (latestUnavailable ? undefined : latest);
  const currentLabel =
    current !== undefined
      ? formatVersion(current, !latestUnavailable && current === latest)
      : latestUnavailable
        ? "Earlier versions"
        : "Versions";

  const handleConfirmDelete = async () => {
    if (deleteTarget === null || !recordId) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteStorageRecordVersions(recordId, [deleteTarget]);
    if (!result.ok) {
      setDeleteError(result.error);
      setDeleting(false);
      return;
    }
    const deleted = deleteTarget;
    setDeleting(false);
    setDeleteTarget(null);
    // Refetch the version list so the purged version drops out of the picker.
    await queryClient.invalidateQueries({ queryKey: getGetOsduRecordVersionsQueryKey(recordId) });
    onVersionsDeleted?.(deleted);
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={isLoading || isVersionLoading || !!error}
            aria-label="Select record version"
            title={error ? "Version history could not be loaded. Check your Storage Service connection and access." : undefined}
          >
            {isLoading || isVersionLoading ? (
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
              <span className="font-mono flex-1">
                {formatVersion(v.version, !latestUnavailable && v.isLatest)}
              </span>
              {/* Avoid destructive actions while the current/latest record is missing. */}
              {!latestUnavailable && !v.isLatest && (
                <button
                  type="button"
                  className="ml-2 rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
                  aria-label={`Delete version ${v.version}`}
                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpen(false);
                    setDeleteError(null);
                    setDeleteTarget(v.version);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open && !deleting) { setDeleteTarget(null); setDeleteError(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete version {deleteTarget}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently purges version <span className="font-mono">{deleteTarget}</span> of this record from the Storage Service. This cannot be undone. The latest version is never affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-error-border/60 bg-error-surface p-3 text-sm text-error-text">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="break-all">{deleteError}</span>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void handleConfirmDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</>
              ) : (
                <><Trash2 className="h-4 w-4" /> Delete version</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
