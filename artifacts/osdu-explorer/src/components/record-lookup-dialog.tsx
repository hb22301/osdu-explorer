import { useState } from "react";
import { useGetOsduRecord, getGetOsduRecordQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FileSearch, Loader2, AlertCircle } from "lucide-react";

export function RecordLookupDialog({ initialId = "" }: { initialId?: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(initialId);
  const [recordId, setRecordId] = useState("");

  const { data, isFetching, isError, error, refetch } = useGetOsduRecord(recordId, {
    query: {
      enabled: !!recordId,
      retry: false,
      queryKey: getGetOsduRecordQueryKey(recordId),
    },
  });

  const lookup = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (trimmed === recordId) {
      void refetch();
    } else {
      setRecordId(trimmed);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setInput(initialId);
      setRecordId("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileSearch className="h-4 w-4 mr-1" /> Search Record
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Search Record by ID</DialogTitle>
          <DialogDescription>
            Enter a record ID to fetch and view its complete JSON.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            lookup();
          }}
        >
          <Input
            autoFocus
            placeholder="opendes:work-product-component--…:…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="font-mono text-sm"
          />
          <Button type="submit" disabled={!input.trim() || isFetching}>
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSearch className="h-4 w-4" />
            )}
            <span className="ml-1">Fetch</span>
          </Button>
        </form>

        <div className="flex-1 overflow-auto min-h-0">
          {isError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="break-all">
                {(error as Error | undefined)?.message ?? "Failed to fetch record."}
              </span>
            </div>
          )}
          {!isError && data && (
            <pre className="text-[12px] font-mono bg-muted/50 rounded-lg p-4 border border-border/40 text-foreground/90 whitespace-pre-wrap break-all leading-relaxed">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
          {!isError && !data && !isFetching && recordId === "" && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No record loaded yet. Enter an ID above and click Fetch.
            </div>
          )}
          {!isError && !data && !isFetching && recordId !== "" && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No record returned for this ID.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
