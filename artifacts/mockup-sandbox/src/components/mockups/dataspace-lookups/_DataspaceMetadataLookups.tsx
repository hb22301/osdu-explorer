import { useEffect, useMemo, useState } from "react";
import {
  getListOsduLegalTagsQueryKey,
  useListOsduLegalTags,
} from "./lookup-fixtures";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ISO_COUNTRY_OPTIONS,
  isIsoAlpha2CountryCode,
  normalizeIsoCountryCode,
} from "./iso-countries";
import { isValidGroup } from "./record-acl";
import { Loader2, Plus, X } from "lucide-react";

type DataspaceMetadataField = "legalTags" | "countries" | "owners" | "viewers";
type LookupOption = {
  value: string;
  label: string;
  searchText?: string;
};

interface DataspaceMetadataLookupsProps {
  enabled: boolean;
  disabled: boolean;
  values: Record<DataspaceMetadataField, string[]>;
  onChange: (field: DataspaceMetadataField, values: string[]) => void;
  compact?: boolean;
}

interface LookupFieldProps {
  label: string;
  description: string;
  testId: string;
  placeholder: string;
  values: string[];
  options: LookupOption[];
  loading?: boolean;
  lookupMessage?: string;
  disabled: boolean;
  normalizeValue?: (value: string) => string | null;
  invalidValueMessage?: string;
  compact?: boolean;
  popoverSide?: "left" | "right";
  onChange: (values: string[]) => void;
}

const COUNTRY_OPTIONS: LookupOption[] = ISO_COUNTRY_OPTIONS.map(({ code, name }) => ({
  value: code,
  label: `${name} (${code})`,
  searchText: `${name} ${code}`,
}));

function errorMessageFrom(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const body = value as Record<string, unknown>;
    for (const key of ["error", "message", "details"] as const) {
      if (typeof body[key] === "string" && body[key].trim()) return body[key] as string;
    }
  }
  return null;
}

function LookupField({
  label,
  description,
  testId,
  placeholder,
  values,
  options,
  loading = false,
  lookupMessage,
  disabled,
  normalizeValue,
  invalidValueMessage,
  compact = false,
  popoverSide = "left",
  onChange,
}: LookupFieldProps) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const query = draft.trim().toLowerCase();
    return options
      .filter((option) => !values.some((selected) => selected.toLowerCase() === option.value.toLowerCase()))
      .filter((option) => {
        if (!query) return true;
        return `${option.value} ${option.label} ${option.searchText ?? ""}`.toLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [draft, options, values]);

  const addValue = (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) return;
    const normalized = normalizeValue ? normalizeValue(trimmed) : trimmed;
    if (!normalized) {
      setValidationMessage(invalidValueMessage ?? `Enter a valid ${label.toLowerCase()}.`);
      return;
    }
    if (values.some((selected) => selected.toLowerCase() === normalized.toLowerCase())) {
      setDraft("");
      setValidationMessage(null);
      return;
    }
    onChange([...values, normalized]);
    setDraft("");
    setValidationMessage(null);
  };

  return (
    <div className={compact
      ? `relative min-w-0 space-y-1 ${focused && !disabled ? "z-30" : ""}`
      : "min-w-0 space-y-1.5"}>
      {compact ? (
        <div className="flex min-h-4 items-center justify-between gap-2">
          <label htmlFor={testId} className="shrink-0 text-xs font-medium">{label}</label>
          <div className="flex min-w-0 max-w-[62%] items-center gap-1 overflow-x-auto whitespace-nowrap">
            {values.map((value) => (
              <span
                key={value}
                className="inline-flex shrink-0 items-center rounded-full border bg-secondary/60 pl-2 text-[10px]"
                data-testid={`chip-${testId}`}
                data-value={value}
                title={value}
              >
                {value}
                <button
                  type="button"
                  className="ml-1 rounded-full p-1 hover:bg-accent disabled:opacity-50"
                  aria-label={`Remove ${label} ${value}`}
                  data-testid={`remove-${testId}`}
                  disabled={disabled}
                  onClick={() => onChange(values.filter((selected) => selected !== value))}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <label htmlFor={testId} className="text-xs font-medium">{label}</label>
      )}
      <div className={compact ? "relative flex gap-1" : "flex gap-1"}>
        <Input
          id={testId}
          value={draft}
          placeholder={placeholder}
          className={`h-8 min-w-0 font-mono text-xs ${compact ? "pr-2" : ""}`}
          data-testid={testId}
          disabled={disabled}
          autoComplete="off"
          aria-expanded={focused && !disabled}
          aria-controls={`suggestions-${testId}`}
          aria-describedby={`description-${testId}`}
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            const suggestions = document.getElementById(`suggestions-${testId}`);
            if (!suggestions?.contains(event.relatedTarget as Node | null)) {
              setFocused(false);
            }
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setFocused(true);
            setValidationMessage(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setFocused(false);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              addValue(draft);
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={compact ? "h-8 w-8 shrink-0 p-0" : "h-8 shrink-0 px-2"}
          aria-label={`Add ${label}`}
          title={`Add ${label}`}
          data-testid={`button-add-${testId}`}
          disabled={disabled || !draft.trim()}
          onClick={() => addValue(draft)}
        >
          <Plus className={compact ? "h-3.5 w-3.5" : "mr-1 h-3.5 w-3.5"} />
          {!compact && "Add"}
        </Button>
        {focused && !disabled && (
          <div
            id={`suggestions-${testId}`}
            className={compact
              ? `absolute left-0 top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-lg sm:w-[calc(200%+0.75rem)] ${popoverSide === "right" ? "sm:left-auto sm:right-0" : "sm:right-auto"}`
              : "max-h-28 overflow-y-auto rounded-md border bg-popover p-1 shadow-sm"}
            data-testid={`suggestions-${testId}`}
          >
            {suggestions.length > 0 ? (
              <div className="space-y-0.5">
                {suggestions.map((option) => {
                  const [primaryLabel, secondaryLabel] = compact
                    ? option.label.split(" — ", 2)
                    : [option.label, ""];
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:bg-accent"
                      data-testid={`suggestion-${testId}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addValue(option.value)}
                    >
                      <span className="min-w-0 flex-1 truncate">{primaryLabel}</span>
                      {compact && secondaryLabel ? (
                        <span className="max-w-[45%] shrink-0 truncate text-[10px] text-muted-foreground">
                          {secondaryLabel}
                        </span>
                      ) : option.value !== primaryLabel && (
                        <span className="max-w-[45%] shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                          {option.value}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                {loading ? "Loading suggestions…" : "No matching suggestions. You can add a value manually."}
              </p>
            )}
            {loading && suggestions.length > 0 && (
              <p role="status" className="flex items-center gap-1 px-2 pt-1 text-[10px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading more suggestions…
              </p>
            )}
          </div>
        )}
      </div>

      <p id={`description-${testId}`} className={compact ? "sr-only" : "text-[10px] text-muted-foreground"}>
        {description}
      </p>
      {loading && !focused && (
        <p role="status" className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading lookup…
        </p>
      )}
      {lookupMessage && (
        <p role="status" className="text-[10px] text-amber-600 dark:text-amber-400">{lookupMessage}</p>
      )}
      {validationMessage && (
        <p role="alert" className="text-[10px] text-destructive">{validationMessage}</p>
      )}

      {!compact && (
        <div className="flex min-h-5 flex-wrap gap-1" data-testid={`chips-${testId}`}>
          {values.length === 0 ? (
            <span className="text-[10px] text-muted-foreground">None selected.</span>
          ) : values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center rounded-full border bg-secondary/60 pl-2 text-[10px]"
            data-testid={`chip-${testId}`}
            data-value={value}
          >
            {value}
            <button
              type="button"
              className="ml-1 rounded-full p-1 hover:bg-accent disabled:opacity-50"
              aria-label={`Remove ${label} ${value}`}
              data-testid={`remove-${testId}`}
              disabled={disabled}
              onClick={() => onChange(values.filter((selected) => selected !== value))}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function DataspaceMetadataLookups({
  enabled,
  disabled,
  values,
  compact = false,
  onChange,
}: DataspaceMetadataLookupsProps) {
  const legalTagsQuery = useListOsduLegalTags(
    { valid: true },
    {
      query: {
        queryKey: getListOsduLegalTagsQueryKey({ valid: true }),
        enabled,
      },
    },
  );
  const [groups, setGroups] = useState<LookupOption[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setGroups([]);
    setGroupsError(null);
    setGroupsLoading(true);

    void fetch("/api/osdu/entitlements/groups", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(errorMessageFrom(body) ?? `Group lookup failed (HTTP ${response.status}).`);
        }
        if (!Array.isArray(body?.groups)) throw new Error("Group lookup returned an unexpected response.");
        const groupOptions = body.groups
          .filter((group: unknown): group is Record<string, unknown> => !!group && typeof group === "object")
          .filter((group: Record<string, unknown>) => typeof group.email === "string" && group.email.trim())
          .map((group: Record<string, unknown>) => {
            const email = (group.email as string).trim();
            const name = typeof group.name === "string" && group.name.trim() ? group.name.trim() : email;
            const description = typeof group.description === "string" ? group.description : "";
            return {
              value: email,
              label: name === email ? email : `${name} — ${email}`,
              searchText: `${email} ${name} ${description}`,
            };
          });
        setGroups(groupOptions);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setGroupsError(error instanceof Error ? error.message : "Group lookup failed.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setGroupsLoading(false);
      });

    return () => controller.abort();
  }, [enabled]);

  const legalTagOptions = useMemo(() => (
    (legalTagsQuery.data?.legalTags ?? [])
      .filter((tag) => typeof tag.name === "string" && tag.name.trim())
      .map((tag) => {
        const value = tag.name!.trim();
        const description = typeof tag.description === "string" ? tag.description : "";
        return {
          value,
          label: description ? `${value} — ${description}` : value,
          searchText: `${value} ${description}`,
        };
      })
  ), [legalTagsQuery.data]);

  const updateField = (field: DataspaceMetadataField) => (nextValues: string[]) => onChange(field, nextValues);
  const legalTagLookupMessage = legalTagsQuery.isError
    ? "Legal tags could not be loaded. You can enter a known tag manually."
    : undefined;
  const groupLookupMessage = groupsError
    ? `Groups could not be loaded (${groupsError}). You can enter a group email manually.`
    : groups.length === 0 && !groupsLoading && enabled
      ? "No groups were returned. You can enter a group email manually."
      : undefined;

  return (
    <div className={compact ? "relative grid gap-x-3 gap-y-2 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2"}>
      <LookupField
        label="Legal tags"
        description="Search available tags or enter a known legal tag."
        testId="input-new-dataspace-legal-tags"
        placeholder="Search legal tags…"
        values={values.legalTags}
        options={legalTagOptions}
        loading={enabled && legalTagsQuery.isLoading}
        lookupMessage={legalTagLookupMessage}
        disabled={disabled}
        compact={compact}
        popoverSide="left"
        onChange={updateField("legalTags")}
      />
      <LookupField
        label="Other relevant data countries"
        description="Search by country name or ISO alpha-2 code."
        testId="input-new-dataspace-countries"
        placeholder="Search countries…"
        values={values.countries}
        options={COUNTRY_OPTIONS}
        disabled={disabled}
        compact={compact}
        popoverSide="right"
        normalizeValue={(value) => {
          const normalized = normalizeIsoCountryCode(value);
          return isIsoAlpha2CountryCode(normalized) ? normalized : null;
        }}
        invalidValueMessage="Choose a country from the list or enter a valid ISO alpha-2 code."
        onChange={updateField("countries")}
      />
      <LookupField
        label="Owner groups"
        description="Search available groups or enter a valid group email."
        testId="input-new-dataspace-owners"
        placeholder="Search owner groups…"
        values={values.owners}
        options={groups}
        loading={enabled && groupsLoading}
        lookupMessage={groupLookupMessage}
        disabled={disabled}
        compact={compact}
        popoverSide="left"
        normalizeValue={(value) => isValidGroup(value) ? value : null}
        invalidValueMessage="Enter a valid entitlements group email or choose a group from the list."
        onChange={updateField("owners")}
      />
      <LookupField
        label="Viewer groups"
        description="Search available groups or enter a valid group email."
        testId="input-new-dataspace-viewers"
        placeholder="Search viewer groups…"
        values={values.viewers}
        options={groups}
        loading={enabled && groupsLoading}
        lookupMessage={groupLookupMessage}
        disabled={disabled}
        compact={compact}
        popoverSide="right"
        normalizeValue={(value) => isValidGroup(value) ? value : null}
        invalidValueMessage="Enter a valid entitlements group email or choose a group from the list."
        onChange={updateField("viewers")}
      />
    </div>
  );
}