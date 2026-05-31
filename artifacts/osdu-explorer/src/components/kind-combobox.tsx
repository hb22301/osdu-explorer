import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ANY_KIND = "*:*:*:*";
const RECENT_KINDS_KEY = "osdu-navigator:recent-kinds";
const MAX_RECENT = 5;

function loadRecentKinds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KINDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((k) => typeof k === "string").slice(0, MAX_RECENT);
  } catch { /* ignore */ }
  return [];
}

function saveRecentKinds(kinds: string[]): void {
  try { localStorage.setItem(RECENT_KINDS_KEY, JSON.stringify(kinds)); } catch { /* ignore */ }
}

function pushRecentKind(kind: string, prev: string[]): string[] {
  const next = [kind, ...prev.filter((k) => k !== kind)].slice(0, MAX_RECENT);
  saveRecentKinds(next);
  return next;
}

interface KindComboboxProps {
  value: string;
  onChange: (value: string) => void;
  kinds: string[];
  className?: string;
}

export function KindCombobox({ value, onChange, kinds, className }: KindComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [recentKinds, setRecentKinds] = useState<string[]>(loadRecentKinds);

  const sortedKinds = useMemo(() => [...kinds].sort((a, b) => a.localeCompare(b)), [kinds]);

  const label = value === ANY_KIND ? "Any kind (*:*:*:*)" : value;
  const trimmed = search.trim();
  const allOptions = useMemo(() => [ANY_KIND, ...kinds], [kinds]);
  const canUseCustom =
    trimmed.length > 0 && !allOptions.some((k) => k.toLowerCase() === trimmed.toLowerCase());

  const recentFiltered = useMemo(
    () => recentKinds.filter((k) => kinds.includes(k)),
    [recentKinds, kinds],
  );

  const filtered = useMemo(() => {
    const term = trimmed.toLowerCase();
    if (!term) return null;
    return [ANY_KIND, ...sortedKinds].filter((k) => k.toLowerCase().includes(term));
  }, [sortedKinds, trimmed]);

  const select = (kind: string) => {
    onChange(kind);
    setOpen(false);
    setSearch("");
    if (kind !== ANY_KIND) {
      setRecentKinds((prev) => pushRecentKind(kind, prev));
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label="Kind"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-mono text-sm font-normal",
            value === ANY_KIND && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type to filter kinds…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No kinds found.</CommandEmpty>

            {canUseCustom && (
              <>
                <CommandGroup heading="Custom">
                  <CommandItem
                    value={`__custom__${trimmed}`}
                    onSelect={() => select(trimmed)}
                    className="font-mono"
                  >
                    <Check className="mr-2 h-4 w-4 opacity-0" />
                    Use "<span className="text-neon">{trimmed}</span>"
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {filtered ? (
              <CommandGroup>
                {filtered.map((k) => (
                  <CommandItem
                    key={k}
                    value={k}
                    onSelect={() => select(k)}
                    className="font-mono"
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === k ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{k === ANY_KIND ? "Any kind (*:*:*:*)" : k}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <>
                <CommandGroup>
                  <CommandItem
                    value={ANY_KIND}
                    onSelect={() => select(ANY_KIND)}
                    className="font-mono"
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === ANY_KIND ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">Any kind (*:*:*:*)</span>
                  </CommandItem>
                </CommandGroup>

                {recentFiltered.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading={
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Recent
                      </span>
                    }>
                      {recentFiltered.map((k) => (
                        <CommandItem
                          key={`recent-${k}`}
                          value={`__recent__${k}`}
                          onSelect={() => select(k)}
                          className="font-mono"
                        >
                          <Check className={cn("mr-2 h-4 w-4", value === k ? "opacity-100" : "opacity-0")} />
                          <span className="truncate">{k}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                <CommandSeparator />
                <CommandGroup heading="All kinds">
                  {sortedKinds.map((k) => (
                    <CommandItem
                      key={k}
                      value={k}
                      onSelect={() => select(k)}
                      className="font-mono"
                    >
                      <Check className={cn("mr-2 h-4 w-4", value === k ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{k}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
