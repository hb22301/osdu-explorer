import { useEffect, useLayoutEffect, useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DataspaceMetadataLookups } from "./_DataspaceMetadataLookups";

type Field = "legalTags" | "countries" | "owners" | "viewers";
type Values = Record<Field, string[]>;

const GROUP_FIXTURES = [
  {
    name: "Subsurface Data Owners",
    email: "data.default.owners@opendes.dataservices.energy",
    description: "Default owners for the partition",
  },
  {
    name: "Exploration Reviewers",
    email: "exploration.reviewers@opendes.dataservices.energy",
    description: "Review access for exploration teams",
  },
  {
    name: "Geoscience Analytics",
    email: "geoscience.analytics@opendes.dataservices.energy",
    description: "Shared geoscience analysis group",
  },
  {
    name: "North Sea Project Team",
    email: "north-sea.project@opendes.dataservices.energy",
    description: "North Sea project contributors",
  },
  {
    name: "Reservoir Engineering",
    email: "reservoir.engineering@opendes.dataservices.energy",
    description: "Reservoir engineering contributors",
  },
  {
    name: "Data Stewards",
    email: "data.stewards@opendes.dataservices.energy",
    description: "Partition data stewardship",
  },
  {
    name: "Well Data Viewers",
    email: "well-data.viewers@opendes.dataservices.energy",
    description: "Read access to well data",
  },
  {
    name: "Research Partners",
    email: "research.partners@opendes.dataservices.energy",
    description: "Approved external research teams",
  },
  {
    name: "Data Platform Administrators",
    email: "data.platform.admins@opendes.dataservices.energy",
    description: "Platform operations group",
  },
];

const INITIAL_VALUES: Values = {
  legalTags: ["demo-public-data"],
  countries: ["US", "NO"],
  owners: ["data.default.owners@opendes.dataservices.energy"],
  viewers: [],
};

export function PreviewShell({ compact = false }: { compact?: boolean }) {
  const [values, setValues] = useState<Values>(INITIAL_VALUES);
  const [readOnly, setReadOnly] = useState(false);

  useLayoutEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      if (url.endsWith("/api/osdu/entitlements/groups")) {
        return new Response(JSON.stringify({ groups: GROUP_FIXTURES }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      document.getElementById("input-new-dataspace-owners")?.focus();
    }, 160);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="dark flex min-h-screen items-center justify-center bg-black/75 p-4">
      <section className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-md border bg-background p-5 text-foreground shadow-2xl">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-base font-semibold">
              <FolderPlus className="h-4 w-4 text-emerald-500" />
              New dataspace
            </h1>
            <p className="max-w-[470px] text-xs leading-relaxed text-muted-foreground">
              Register a new Reservoir DDMS dataspace. The entered name is used for both
              DataspaceId and Path. Search the custom-data lookups or add values valid
              for the active data partition.
            </p>
          </div>
          <button type="button" aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="mock-dataspace-name" className="text-xs font-medium">
              Dataspace ID / path
            </label>
            <Input id="mock-dataspace-name" value="dev/release_150" readOnly className="h-8 font-mono text-xs" />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium">Custom data</p>
            <p className="text-[11px] text-muted-foreground">
              Legal tags, countries, and owners are required. Viewers are optional.
            </p>
          </div>

          <DataspaceMetadataLookups
            enabled
            disabled={false}
            values={values}
            compact={compact}
            onChange={(field, nextValues) => setValues((current) => ({ ...current, [field]: nextValues }))}
          />

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <p className="text-xs font-medium">Read-only dataspace</p>
              <p className="text-[11px] text-muted-foreground">Saved as the string value "true" or "false".</p>
            </div>
            <Switch checked={readOnly} onCheckedChange={setReadOnly} aria-label="Read-only dataspace" />
          </div>

          <footer className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" className="h-8 text-xs">Cancel</Button>
            <Button size="sm" className="h-8 text-xs">Create</Button>
          </footer>
        </div>
      </section>
    </div>
  );
}