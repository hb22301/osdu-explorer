import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, X } from "lucide-react";

interface ValueOption {
  value: string;
  label: string;
}

// A generic "chips + autocompleting add-input" multi-value editor. The caller
// supplies the value list, the suggestion options, and the add/remove callbacks,
// plus a normalize + isValid pair so each field can decide what counts as a
// valid entry (a free-text group email, a known legal tag, an ISO code…).
export function ChipListInput({
  label,
  hint,
  icon: Icon,
  values,
  options,
  placeholder,
  inputLabel,
  disabled,
  testIdPrefix,
  normalize,
  isValid,
  formatValue,
  onAdd,
  onRemove,
}: {
  label: string;
  hint?: string;
  icon: typeof Plus;
  values: string[];
  options: ValueOption[];
  placeholder: string;
  inputLabel: string;
  disabled: boolean;
  testIdPrefix: string;
  normalize: (value: string) => string;
  isValid: (value: string) => boolean;
  formatValue: (value: string) => string;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [entry, setEntry] = useState("");
  const listId = `${testIdPrefix}-options`;
  const available = useMemo(
    () => options.filter((option) => !values.includes(option.value)),
    [options, values],
  );
  const candidate = normalize(entry);
  const canAdd = candidate.length > 0 && isValid(candidate) && !values.includes(candidate) && !disabled;

  const commit = () => {
    if (!canAdd) return;
    onAdd(candidate);
    setEntry("");
  };

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-editor`}>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>

      <div className="flex flex-wrap gap-1.5" data-testid={`${testIdPrefix}-list`}>
        {values.length === 0 && (
          <span className="text-xs italic text-muted-foreground">None selected.</span>
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
              aria-label={`Remove ${label} ${value}`}
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
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
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
          disabled={!canAdd}
          onClick={commit}
          aria-label={`${inputLabel} button`}
          data-testid={`${testIdPrefix}-add`}
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}
