import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetOsduRecordQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Plus, X, Loader2, AlertCircle, Check, ShieldCheck, Eye } from "lucide-react";
import { saveStorageRecord } from "@/lib/storage-record-save";
import {
  getAcl,
  withAcl,
  addGroup,
  removeGroup,
  validateAcl,
  isValidGroup,
  aclEquals,
  type Acl,
  type AclRole,
} from "@/lib/record-acl";

interface RecordAclEditorProps {
  recordId: string;
  record: unknown;
}

const ROLE_META: Record<AclRole, { label: string; Icon: typeof ShieldCheck; hint: string }> = {
  owners: { label: "Owners", Icon: ShieldCheck, hint: "Full control — can read, edit and delete this record." },
  viewers: { label: "Viewers", Icon: Eye, hint: "Read-only access to this record." },
};

// Editable owners/viewers list for one ACL role, with removable chips and an
// autocompleting add-group input. Free text is allowed (you can grant a group
// you don't belong to) but must be a valid group email before it can be added.
function RoleEditor({
  role,
  groups,
  suggestions,
  disabled,
  onAdd,
  onRemove,
}: {
  role: AclRole;
  groups: string[];
  suggestions: string[];
  disabled: boolean;
  onAdd: (group: string) => void;
  onRemove: (group: string) => void;
}) {
  const { label, Icon, hint } = ROLE_META[role];
  const [draft, setDraft] = useState("");
  const listId = `acl-${role}-suggestions`;
  const canAdd = isValidGroup(draft) && !groups.includes(draft.trim());

  const commit = () => {
    if (!canAdd) return;
    onAdd(draft.trim());
    setDraft("");
  };

  // Only suggest groups not already granted this role.
  const available = suggestions.filter((s) => !groups.includes(s));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>

      <div className="flex flex-wrap gap-2" data-testid={`acl-${role}-list`}>
        {groups.length === 0 && (
          <span className="text-xs text-muted-foreground italic">No {label.toLowerCase()} groups.</span>
        )}
        {groups.map((g) => (
          <Badge key={g} variant="secondary" className="gap-1 font-mono text-xs pr-1" data-testid={`acl-${role}-chip`}>
            <span className="break-all">{g}</span>
            <button
              type="button"
              className="ml-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-colors disabled:opacity-40"
              aria-label={`Remove ${label.toLowerCase()} group ${g}`}
              disabled={disabled}
              onClick={() => onRemove(g)}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
          placeholder="group.name@partition.domain"
          className="h-8 font-mono text-xs"
          list={listId}
          disabled={disabled}
          aria-label={`Add ${label.toLowerCase()} group`}
        />
        <datalist id={listId}>
          {available.map((s) => <option key={s} value={s} />)}
        </datalist>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs shrink-0"
          disabled={disabled || !canAdd}
          onClick={commit}
          aria-label={`Add ${label.toLowerCase()} group button`}
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}

// Validated ACL editor for a Storage record. Replaces the read-only ACL dump on
// the record page: edit owners/viewers and save the change back through the
// Storage Service. Guards against saving a record with no owners and warns
// before you remove every group you belong to.
export function RecordAclEditor({ recordId, record }: RecordAclEditorProps) {
  const queryClient = useQueryClient();
  const original = useMemo(() => getAcl(record), [record]);
  const [draft, setDraft] = useState<Acl>(original);
  const [myGroups, setMyGroups] = useState<string[] | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmLockout, setConfirmLockout] = useState(false);

  // Re-seed the draft whenever a fresh record arrives (e.g. after a save refetch).
  useEffect(() => { setDraft(original); setSaved(false); }, [original]);

  // Best-effort: load the caller's groups for autocomplete + lockout detection.
  // A failure just disables autocomplete; editing still works.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/osdu/entitlements/groups");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { groups?: { email?: string }[] };
        if (cancelled) return;
        const emails = (body.groups ?? []).map((g) => g.email).filter((e): e is string => !!e);
        setMyGroups(emails);
        setSuggestions(emails);
      } catch {
        if (!cancelled) { setMyGroups([]); setSuggestions([]); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const validation = useMemo(() => validateAcl(draft, myGroups ?? undefined), [draft, myGroups]);
  const dirty = !aclEquals(draft, original);

  const mutate = (fn: (acl: Acl) => Acl) => { setSaved(false); setSaveError(null); setDraft(fn); };

  const doSave = async () => {
    setConfirmLockout(false);
    setSaving(true);
    setSaveError(null);
    const result = await saveStorageRecord([withAcl(record, draft)]);
    setSaving(false);
    if (!result.ok) { setSaveError(result.error); return; }
    setSaved(true);
    // Refetch the record so the persisted ACL (and version) flow back in.
    await queryClient.invalidateQueries({ queryKey: getGetOsduRecordQueryKey(recordId) });
  };

  const attemptSave = () => {
    if (!validation.valid || !dirty) return;
    if (validation.warnings.length > 0) { setConfirmLockout(true); return; }
    void doSave();
  };

  return (
    <div className="space-y-6">
      <RoleEditor
        role="owners"
        groups={draft.owners}
        suggestions={suggestions}
        disabled={saving}
        onAdd={(g) => mutate((acl) => addGroup(acl, "owners", g))}
        onRemove={(g) => mutate((acl) => removeGroup(acl, "owners", g))}
      />
      <RoleEditor
        role="viewers"
        groups={draft.viewers}
        suggestions={suggestions}
        disabled={saving}
        onAdd={(g) => mutate((acl) => addGroup(acl, "viewers", g))}
        onRemove={(g) => mutate((acl) => removeGroup(acl, "viewers", g))}
      />

      {validation.errors.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-error-border/60 bg-error-surface p-3 text-sm text-error-text" data-testid="acl-error">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <ul className="space-y-0.5">
            {validation.errors.map((e) => <li key={e} className="break-all">{e}</li>)}
          </ul>
        </div>
      )}

      {saveError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-error-border/60 bg-error-surface p-3 text-sm text-error-text">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="break-all">{saveError}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={!dirty || !validation.valid || saving}
          onClick={attemptSave}
          aria-label="Save ACL"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? "Saving…" : "Save ACL"}
        </Button>
        {dirty && !saving && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        {saved && !dirty && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1" data-testid="acl-saved">
            <Check className="h-3.5 w-3.5" /> ACL saved
          </span>
        )}
      </div>

      <AlertDialog open={confirmLockout} onOpenChange={(open) => { if (!open) setConfirmLockout(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove your own access?</AlertDialogTitle>
            <AlertDialogDescription>
              {validation.warnings[0]} Continue only if another administrator can restore your access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void doSave(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
