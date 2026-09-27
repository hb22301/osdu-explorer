import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetOsduRecordQueryKey,
  getListOsduLegalTagsQueryKey,
  useListOsduLegalTags,
} from "@workspace/api-client-react";
import { AlertCircle, Check, Globe, Loader2, Plus, Tags, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { countryNameForCode, ISO_COUNTRY_OPTIONS, normalizeIsoCountryCode } from "@/lib/iso-countries";
import { getLegalConstraints, legalConstraintsEqual, withLegalConstraints, type LegalConstraintsDraft } from "@/lib/record-legal";
import { saveStorageRecord } from "@/lib/storage-record-save";

interface RecordLegalEditorProps {
  recordId: string;
  record: unknown;
}

interface ValueOption {
  value: string;
  label: string;
}

function ValueListEditor({
  title,
  singular,
  helperText,
  emptyText,
  inputLabel,
  placeholder,
  testIdPrefix,
  icon: Icon,
  values,
  options,
  disabled,
  normalize,
  formatValue,
  onAdd,
  onRemove,
}: {
  title: string;
  singular: string;
  helperText: string;
  emptyText: string;
  inputLabel: string;
  placeholder: string;
  testIdPrefix: string;
  icon: typeof Tags;
  values: string[];
  options: ValueOption[];
  disabled: boolean;
  normalize: (value: string) => string;
  formatValue: (value: string) => string;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const listId = `${testIdPrefix}-options`;
  const available = options.filter((option) => !values.includes(option.value));
  const allowedValues = useMemo(() => new Set(options.map((option) => option.value)), [options]);
  const candidate = normalize(draft);
  const canAdd = candidate.length > 0 && allowedValues.has(candidate) && !values.includes(candidate);

  const commit = () => {
    if (!canAdd || disabled) return;
    onAdd(candidate);
    setDraft("");
  };

  return (
    <div className="space-y-3" data-testid={`${testIdPrefix}-editor`}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{title}</span>
        </div>
        <p className="text-xs text-muted-foreground">{helperText}</p>
      </div>

      <div className="flex flex-wrap gap-2" data-testid={`${testIdPrefix}-list`}>
        {values.length === 0 && (
          <span className="text-xs italic text-muted-foreground">{emptyText}</span>
        )}
        {values.map((value) => (
          <Badge
            key={value}
            variant="secondary"
            className="gap-1 pr-1 font-mono text-xs"
            data-testid={`${testIdPrefix}-chip`}
          >
            <span className="break-all">{formatValue(value)}</span>
            <button
              type="button"
              className="ml-0.5 rounded transition-colors hover:bg-destructive/20 hover:text-destructive disabled:opacity-40"
              aria-label={`Remove ${singular} ${value}`}
              disabled={disabled}
              onClick={() => onRemove(value)}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          placeholder={placeholder}
          className="h-8 font-mono text-xs"
          list={listId}
          disabled={disabled}
          aria-label={inputLabel}
          data-testid={`${testIdPrefix}-input`}
        />
        <datalist id={listId}>
          {available.map((option) => (
            <option key={option.value} value={option.value} label={option.label} />
          ))}
        </datalist>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1 text-xs"
          disabled={disabled || !canAdd}
          onClick={commit}
          aria-label={`Add ${singular} button`}
          data-testid={`${testIdPrefix}-add`}
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}

export function RecordLegalEditor({ recordId, record }: RecordLegalEditorProps) {
  const queryClient = useQueryClient();
  const legalTagsQuery = useListOsduLegalTags(
    { valid: true },
    { query: { queryKey: getListOsduLegalTagsQueryKey({ valid: true }) } },
  );
  const original = useMemo(() => getLegalConstraints(record), [record]);
  const [draft, setDraft] = useState<LegalConstraintsDraft>(original);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setDraft(original); }, [original]);
  useEffect(() => { setSaved(false); setSaveError(null); }, [recordId]);

  const validLegalTags = useMemo(
    () => [...new Set(
      (legalTagsQuery.data?.legalTags ?? [])
        .map((tag) => typeof tag.name === "string" ? tag.name.trim() : "")
        .filter(Boolean),
    )],
    [legalTagsQuery.data],
  );
  const legalTagOptions = useMemo(
    () => validLegalTags.map((tag) => ({ value: tag, label: tag })),
    [validLegalTags],
  );
  const countryOptions = useMemo(
    () => ISO_COUNTRY_OPTIONS.map(({ code, name }) => ({ value: code, label: name })),
    [],
  );
  const dirty = !legalConstraintsEqual(draft, original);

  const mutate = (fn: (current: LegalConstraintsDraft) => LegalConstraintsDraft) => {
    setSaved(false);
    setSaveError(null);
    setDraft(fn);
  };

  const doSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    const result = await saveStorageRecord([withLegalConstraints(record, draft)]);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: getGetOsduRecordQueryKey(recordId) });
    setSaved(true);
  };

  return (
    <div className="space-y-6">
      <ValueListEditor
        title="Legal tags"
        singular="legal tag"
        helperText="Choose from legal tags currently marked valid by OSDU."
        emptyText="No legal tags selected."
        inputLabel="Add legal tag"
        placeholder={legalTagsQuery.isLoading ? "Loading valid legal tags…" : "Select a valid legal tag"}
        testIdPrefix="legal-tags"
        icon={Tags}
        values={draft.legalTags}
        options={legalTagOptions}
        disabled={saving}
        normalize={(value) => value.trim()}
        formatValue={(value) => value}
        onAdd={(tag) => mutate((current) => ({
          ...current,
          legalTags: [...current.legalTags, tag],
        }))}
        onRemove={(tag) => mutate((current) => ({
          ...current,
          legalTags: current.legalTags.filter((value) => value !== tag),
        }))}
      />

      {legalTagsQuery.isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading valid legal tags…
        </div>
      )}
      {legalTagsQuery.isError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-error-border/60 bg-error-surface p-3 text-sm text-error-text">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Could not load valid legal tags. Existing tags can be removed, but new tags cannot be added until the list loads.</span>
        </div>
      )}

      <ValueListEditor
        title="Other relevant data countries"
        singular="country"
        helperText="Use an officially assigned ISO 3166-1 alpha-2 code or country name."
        emptyText="No countries selected."
        inputLabel="Add country"
        placeholder="Search by country code or name"
        testIdPrefix="legal-countries"
        icon={Globe}
        values={draft.countries}
        options={countryOptions}
        disabled={saving}
        normalize={normalizeIsoCountryCode}
        formatValue={(value) => `${countryNameForCode(value)} (${value})`}
        onAdd={(country) => mutate((current) => ({
          ...current,
          countries: [...current.countries, country],
        }))}
        onRemove={(country) => mutate((current) => ({
          ...current,
          countries: current.countries.filter((value) => value !== country),
        }))}
      />

      {saveError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-error-border/60 bg-error-surface p-3 text-sm text-error-text">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-all">{saveError}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={!dirty || saving}
          onClick={() => void doSave()}
          aria-label="Save legal constraints"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? "Saving…" : "Save legal constraints"}
        </Button>
        {dirty && !saving && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        {saved && !dirty && (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400" data-testid="legal-saved">
            <Check className="h-3.5 w-3.5" /> Legal constraints saved
          </span>
        )}
      </div>
    </div>
  );
}