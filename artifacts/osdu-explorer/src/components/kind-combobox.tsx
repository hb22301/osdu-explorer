import { useState, useMemo } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ANY_KIND = "*:*:*:*";

interface KindComboboxProps {
  value: string;
  onChange: (value: string) => void;
  kinds: string[];
  className?: string;
}

export function KindCombobox({ value, onChange, kinds, className }: KindComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const options = useMemo(() => [ANY_KIND, ...kinds], [kinds]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((k) => k.toLowerCase().includes(term));
  }, [options, search]);

  const label = value === ANY_KIND ? "Any kind (*:*:*:*)" : value;
  const trimmed = search.trim();
  const canUseCustom =
    trimmed.length > 0 && !options.some((k) => k.toLowerCase() === trimmed.toLowerCase());

  const select = (kind: string) => {
    onChange(kind);
    setOpen(false);
    setSearch("");
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
              <CommandGroup heading="Custom">
                <CommandItem
                  value={`__custom__${trimmed}`}
                  onSelect={() => select(trimmed)}
                  className="font-mono"
                >
                  <Check className="mr-2 h-4 w-4 opacity-0" />
                  Use “<span className="text-neon">{trimmed}</span>”
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {filtered.map((k) => (
                <CommandItem
                  key={k}
                  value={k}
                  onSelect={() => select(k)}
                  className="font-mono"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === k ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">
                    {k === ANY_KIND ? "Any kind (*:*:*:*)" : k}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
