import { useState, useEffect, useMemo } from "react";
import {
  useGetOsduSchema,
  useListOsduLegalTags,
  getListOsduLegalTagsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { KindCombobox } from "@/components/kind-combobox";
import { ChipListInput } from "@/components/chip-list-input";
import { Loader2, FilePlus2, ShieldCheck, Eye, Tags, Globe } from "lucide-react";
import { buildNewRecordTemplate } from "@/lib/storage-record-new";
import { createStorageRecords } from "@/lib/storage-record-clone";
import { isValidGroup } from "@/lib/record-acl";
import {
  countryNameForCode,
  isIsoAlpha2CountryCode,
  normalizeIsoCountryCode,
  ISO_COUNTRY_OPTIONS,
} from "@/lib/iso-countries";

// A kind is create-ready only when it has all four segments filled
// (authority:source:type--Entity:version) and carries no wildcard.
function isCompleteKind(kind: string): boolean {
  const parts = kind.split(":");
  return parts.length === 4 && parts.every((p) => p.length > 0 && p !== "*");
}

function readArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// Create a new Storage record from scratch. Pick a kind (or start from
// initialKind), and the dialog seeds the editor with a best-effort skeleton from
// that kind's schema — falling back to the bare {kind, acl, legal, data:{}}
// envelope — then PUTs an id-less record so OSDU creates it fresh. The acl and
// legal fields get lookup pickers backed by Entitlements groups, the Legal
// Service's valid tags, and the ISO country list; they stay in sync with the
// JSON editor below.
export function NewRecordDialog({
  onClose,
  kinds,
  initialKind,
}: {
  onClose: () => void;
  kinds: string[];
  initialKind?: string;
}) {
  const [kind, setKind] = useState(initialKind ?? "");
  const [draft, setDraft] = useState<string | null>(null);
  const [seededKind, setSeededKind] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdIds, setCreatedIds] = useState<string[] | null>(null);
  const [groupSuggestions, setGroupSuggestions] = useState<string[]>([]);

  const ready = isCompleteKind(kind);
  const { data: schema, isFetching, isError } = useGetOsduSchema(
    encodeURIComponent(kind),
    { query: { enabled: ready, retry: false, queryKey: ["osduSchema", kind] } },
  );

  // Best-effort load of the caller's Entitlements groups for owner/viewer
  // autocomplete. A failure just leaves the suggestion list empty — you can
  // still type any valid group email.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/osdu/entitlements/groups");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { groups?: { email?: string }[] };
        if (cancelled) return;
        setGroupSuggestions((body.groups ?? []).map((g) => g.email).filter((e): e is string => !!e));
      } catch {
        /* autocomplete stays empty; manual entry still works */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const legalTagsQuery = useListOsduLegalTags(
    { valid: true },
    { query: { queryKey: getListOsduLegalTagsQueryKey({ valid: true }) } },
  );
  const legalTagOptions = useMemo(
    () => [...new Set(
      (legalTagsQuery.data?.legalTags ?? [])
        .map((tag) => (typeof tag.name === "string" ? tag.name.trim() : ""))
        .filter(Boolean),
    )].map((tag) => ({ value: tag, label: tag })),
    [legalTagsQuery.data],
  );
  const validTagSet = useMemo(() => new Set(legalTagOptions.map((o) => o.value)), [legalTagOptions]);
  const groupOptions = useMemo(() => groupSuggestions.map((g) => ({ value: g, label: g })), [groupSuggestions]);
  const countryOptions = useMemo(
    () => ISO_COUNTRY_OPTIONS.map(({ code, name }) => ({ value: code, label: name })),
    [],
  );

  // Seed the editor once per chosen kind, after its schema resolves (data or
  // error → bare fallback). Changing the kind re-seeds a fresh template.
  useEffect(() => {
    if (!ready) {
      if (seededKind !== null) { setSeededKind(null); setDraft(null); }
      return;
    }
    if (seededKind === kind || isFetching) return;
    setDraft(buildNewRecordTemplate(kind, isError ? undefined : schema));
    setSeededKind(kind);
    setParseError(null);
    setSaveError(null);
    setCreatedIds(null);
  }, [ready, kind, seededKind, isFetching, isError, schema]);

  const preparing = ready && seededKind !== kind;
  const locked = createdIds !== null || saving;

  // The parsed envelope drives the acl/legal lookup pickers. It's null while the
  // JSON is invalid, which disables the pickers (edit the JSON directly instead).
  const parsed = useMemo<Record<string, unknown> | null>(() => {
    if (draft === null) return null;
    try {
      const p = JSON.parse(draft);
      return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }, [draft]);

  const acl = (parsed?.acl ?? {}) as Record<string, unknown>;
  const legal = (parsed?.legal ?? {}) as Record<string, unknown>;
  const owners = readArray(acl.owners);
  const viewers = readArray(acl.viewers);
  const legaltags = readArray(legal.legaltags);
  const countries = readArray(legal.otherRelevantDataCountries);

  // Apply a structured edit to the acl/legal arrays and re-serialise, preserving
  // the rest of the record (kind, data, …) and the readable field order.
  const editEnvelope = (mutate: (env: Record<string, any>) => void) => {
    if (parsed === null) return;
    const next = JSON.parse(JSON.stringify(parsed)) as Record<string, any>;
    if (!next.acl || typeof next.acl !== "object") next.acl = {};
    if (!Array.isArray(next.acl.owners)) next.acl.owners = [];
    if (!Array.isArray(next.acl.viewers)) next.acl.viewers = [];
    if (!next.legal || typeof next.legal !== "object") next.legal = {};
    if (!Array.isArray(next.legal.legaltags)) next.legal.legaltags = [];
    if (!Array.isArray(next.legal.otherRelevantDataCountries)) next.legal.otherRelevantDataCountries = [];
    mutate(next);
    setDraft(JSON.stringify(next, null, 2));
    setParseError(null);
  };

  const addTo = (arr: (env: Record<string, any>) => string[], value: string) =>
    editEnvelope((env) => { const a = arr(env); if (!a.includes(value)) a.push(value); });
  const removeFrom = (arr: (env: Record<string, any>) => string[], value: string) =>
    editEnvelope((env) => { const a = arr(env); const i = a.indexOf(value); if (i >= 0) a.splice(i, 1); });

  const handleChange = (value: string) => {
    setDraft(value);
    if (value.trim() === "") {
      setParseError("JSON is empty");
      return;
    }
    try {
      JSON.parse(value);
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  const create = async () => {
    if (draft === null) return;
    let parsedRecord: unknown;
    try {
      parsedRecord = JSON.parse(draft);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    const records = Array.isArray(parsedRecord) ? parsedRecord : [parsedRecord];
    setSaving(true);
    setSaveError(null);
    const result = await createStorageRecords(records, setStep);
    setSaving(false);
    setStep(null);
    if (result.ok) setCreatedIds(result.recordIds);
    else setSaveError(result.error);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-3xl flex flex-col max-h-[85vh]" data-testid="new-record-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="h-4 w-4 text-neon" />
            New record
          </DialogTitle>
          <DialogDescription>
            Create a record in the Storage Service. Pick a kind to seed a starting template.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 space-y-1">
          <label className="text-xs font-medium leading-none">Kind</label>
          <KindCombobox value={kind} onChange={setKind} kinds={kinds} />
        </div>

        {!ready ? (
          <div className="py-8 text-center text-sm text-muted-foreground" data-testid="new-record-pick-kind">
            Choose a kind above to generate a starting template.
          </div>
        ) : preparing || draft === null ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing template…
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto pr-1">
            {/* acl / legal lookups — stay in sync with the JSON below */}
            <div className="shrink-0 space-y-3 rounded-md border border-border/60 bg-muted/20 p-3" data-testid="new-record-lookups">
              {parsed === null ? (
                <p className="text-xs text-muted-foreground">
                  Fix the JSON below to edit access &amp; legal fields with lookups.
                </p>
              ) : (
                <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                  <ChipListInput
                    label="Owners"
                    hint="full control"
                    icon={ShieldCheck}
                    values={owners}
                    options={groupOptions}
                    placeholder="group.name@partition.domain"
                    inputLabel="Add owner group"
                    disabled={locked}
                    testIdPrefix="new-record-acl-owners"
                    normalize={(v) => v.trim()}
                    isValid={isValidGroup}
                    formatValue={(v) => v}
                    onAdd={(v) => addTo((env) => env.acl.owners, v)}
                    onRemove={(v) => removeFrom((env) => env.acl.owners, v)}
                  />
                  <ChipListInput
                    label="Viewers"
                    hint="read-only"
                    icon={Eye}
                    values={viewers}
                    options={groupOptions}
                    placeholder="group.name@partition.domain"
                    inputLabel="Add viewer group"
                    disabled={locked}
                    testIdPrefix="new-record-acl-viewers"
                    normalize={(v) => v.trim()}
                    isValid={isValidGroup}
                    formatValue={(v) => v}
                    onAdd={(v) => addTo((env) => env.acl.viewers, v)}
                    onRemove={(v) => removeFrom((env) => env.acl.viewers, v)}
                  />
                  <ChipListInput
                    label="Legal tags"
                    hint={legalTagsQuery.isLoading ? "loading…" : "valid tags"}
                    icon={Tags}
                    values={legaltags}
                    options={legalTagOptions}
                    placeholder="Select a valid legal tag"
                    inputLabel="Add legal tag"
                    disabled={locked}
                    testIdPrefix="new-record-legaltags"
                    normalize={(v) => v.trim()}
                    isValid={(v) => validTagSet.has(v)}
                    formatValue={(v) => v}
                    onAdd={(v) => addTo((env) => env.legal.legaltags, v)}
                    onRemove={(v) => removeFrom((env) => env.legal.legaltags, v)}
                  />
                  <ChipListInput
                    label="Data countries"
                    hint="ISO 3166-1"
                    icon={Globe}
                    values={countries}
                    options={countryOptions}
                    placeholder="Country code or name"
                    inputLabel="Add data country"
                    disabled={locked}
                    testIdPrefix="new-record-countries"
                    normalize={normalizeIsoCountryCode}
                    isValid={isIsoAlpha2CountryCode}
                    formatValue={(v) => `${countryNameForCode(v)} (${v})`}
                    onAdd={(v) => addTo((env) => env.legal.otherRelevantDataCountries, v)}
                    onRemove={(v) => removeFrom((env) => env.legal.otherRelevantDataCountries, v)}
                  />
                </div>
              )}
            </div>

            <p className="shrink-0 text-xs text-muted-foreground">
              {isError
                ? "No registered schema for this kind — starting from the bare record envelope."
                : <>Fill in the <span className="font-mono">data</span> fields. Fields behind schema references aren't scaffolded — add them as needed.</>}
            </p>
            <Textarea
              value={draft}
              onChange={(e) => handleChange(e.target.value)}
              spellCheck={false}
              className="min-h-[200px] flex-1 resize-none font-mono text-xs"
              aria-label="New record JSON editor"
              data-testid="new-record-editor"
              disabled={createdIds !== null}
            />
            {parseError ? (
              <div role="alert" className="shrink-0 rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text">
                Invalid JSON: {parseError}
              </div>
            ) : (
              <div className="shrink-0 text-xs text-emerald-500">Valid JSON</div>
            )}
            {saveError && (
              <div role="alert" className="shrink-0 rounded-md border border-error-border/60 bg-error-surface px-3 py-2 text-xs text-error-text break-all">
                {saveError}
              </div>
            )}
            {createdIds && (
              <div
                role="status"
                data-testid="new-record-success"
                className="shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 break-all"
              >
                {createdIds.length > 0
                  ? `Created new record: ${createdIds.join(", ")}`
                  : "New record created."}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {saving && step && (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {step}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {createdIds ? "Close" : "Cancel"}
          </Button>
          {!createdIds && (
            <Button
              size="sm"
              onClick={() => { void create(); }}
              disabled={!ready || preparing || draft === null || saving || parseError !== null}
              data-testid="button-create-new-record"
            >
              {saving ? "Creating…" : "Create record"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
