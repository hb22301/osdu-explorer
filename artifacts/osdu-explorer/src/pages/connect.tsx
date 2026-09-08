import { useEffect, useRef, useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLocation } from "wouter";
import { useSaveOsduConfig, useGetOsduConfig, getGetOsduConfigQueryKey } from "@workspace/api-client-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Terminal, Shield, Key, Link as LinkIcon, User, Upload, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { APP_RELEASE_LABEL } from "@/lib/app-metadata";
import { ThemeToggle } from "@/components/theme-toggle";
import { OsduIcon } from "@/components/osdu-icon";
import { parsePostmanEnvironment, resolvePostmanVariables } from "@/lib/postman-env";

const formSchema = z.object({
  baseUrl: z.string().url({ message: "Please enter a valid URL" }),
  partitionId: z.string().min(1, { message: "Partition ID is required" }),
  tokenEndpoint: z.string().url({ message: "Please enter a valid token endpoint URL" }),
  clientId: z.string().min(1, { message: "Client ID is required" }),
  clientSecret: z.string().min(1, { message: "Client Secret is required" }),
  scope: z.string().optional(),
});

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_\-./]+/g, "");
}

function matchField(key: string): keyof z.infer<typeof formSchema> | null {
  const k = norm(key);
  if (/token(endpoint|url|uri)/.test(k) || /auth(endpoint|url|uri)/.test(k) || /login(url|endpoint)/.test(k) || /oauth(endpoint|url)/.test(k)) return "tokenEndpoint";
  if (/baseurl|baseuri/.test(k) || /^(server|api|host|platform)(url|uri|endpoint)?$/.test(k) || k === "url" || k === "apiurl") return "baseUrl";
  if (/partition/.test(k) || /datatenant/.test(k)) return "partitionId";
  if (/clientsecret|appsecret|clientpassword/.test(k)) return "clientSecret";
  if (/clientid|appid|applicationid/.test(k)) return "clientId";
  if (/^scope/.test(k)) return "scope";
  return null;
}

function getConnectionErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "object" && data !== null) {
      const responseMessage = (data as { error?: unknown }).error;
      if (typeof responseMessage === "string" && responseMessage.trim()) {
        return responseMessage;
      }
    }
  }
  return error instanceof Error ? error.message : "Unable to create an access token";
}

export default function ConnectPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useGetOsduConfig();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      baseUrl: "",
      partitionId: "",
      tokenEndpoint: "",
      clientId: "",
      clientSecret: "",
      scope: "",
    },
  });

  const saveConfig = useSaveOsduConfig({
    mutation: {
      onError: (error) => {
        setConnectionError(getConnectionErrorMessage(error));
      },
      onSuccess: () => {
        setConnectionError(null);
        queryClient.invalidateQueries({ queryKey: getGetOsduConfigQueryKey() });
        setLocation("/dashboard");
      }
    }
  });

  const handlePostmanImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parsePostmanEnvironment(String(ev.target?.result ?? ""));
        const entries = Array.isArray(parsed.values) ? parsed.values : [];
        const resolvedValues = resolvePostmanVariables(entries);
        const mapped: Partial<z.infer<typeof formSchema>> = {};
        for (const entry of entries) {
          if (!entry.key || !resolvedValues.has(entry.key)) continue;
          const field = matchField(entry.key);
          if (field && !mapped[field]) mapped[field] = resolvedValues.get(entry.key);
        }
        for (const [field, value] of Object.entries(mapped)) {
          form.setValue(field as keyof z.infer<typeof formSchema>, value as string, {
            shouldValidate: false,
            shouldDirty: true,
          });
        }
      } catch (error) {
        setConnectionError(
          error instanceof Error
            ? `Unable to import Postman environment: ${error.message}`
            : "Unable to import Postman environment.",
        );
      }
    };
    reader.readAsText(file);
  }, [form]);

  function onSubmit(values: z.infer<typeof formSchema>) {
    setConnectionError(null);
    saveConfig.mutate({ data: values });
  }

  useEffect(() => {
    if (!isLoading && config?.configured) {
      setLocation("/dashboard");
    }
  }, [isLoading, config?.configured, setLocation]);

  if (isLoading || config?.configured) return null;

  return (
    <div className="relative min-h-screen bg-background flex flex-col items-center justify-center p-3 sm:p-4">
      <ThemeToggle className="absolute right-4 top-4 text-muted-foreground hover:text-foreground" />
      <div className="w-full max-w-4xl space-y-4">
        <div className="flex flex-col items-center text-center space-y-1.5">
          <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center mb-1.5">
            <OsduIcon className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">OSDU Navigator</h1>
          <p className="text-sm text-muted-foreground">Connect to your data platform</p>
          <p className="text-[11px] font-mono text-muted-foreground/70">
            {APP_RELEASE_LABEL}
          </p>
        </div>

        <Card className="border-border/50 shadow-2xl bg-card">
          <CardHeader className="p-4 pb-3">
            <CardTitle>Connection Settings</CardTitle>
            <CardDescription>Enter your OAuth2 credentials to begin</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {connectionError && (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{connectionError}</span>
              </div>
            )}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handlePostmanImport}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full text-muted-foreground border-dashed hover:text-foreground sm:col-span-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-4 h-4 mr-2 shrink-0" />
                  Import from Postman Environment
                </Button>

                <div className="relative sm:col-span-2">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">or enter manually</span>
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="baseUrl"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5 sm:col-span-2">
                      <FormLabel>Base URL</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Terminal className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input placeholder="https://osdu.example.com" className="pl-9 font-mono text-sm" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tokenEndpoint"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5 sm:col-span-2">
                      <FormLabel>Token Endpoint</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <LinkIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input placeholder="https://login.microsoftonline.com/..." className="pl-9 font-mono text-sm" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="partitionId"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel>Data Partition ID</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <OsduIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input placeholder="opendes" className="pl-9 font-mono text-sm" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="clientId"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel>Client ID</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input placeholder="Client ID" className="pl-9 font-mono text-sm" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="scope"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel>Scope</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Shield className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input placeholder="api://.../.default" className="pl-9 font-mono text-sm" {...field} />
                        </div>
                      </FormControl>
                      <FormDescription>Defaults to clientId/.default</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="clientSecret"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel>Client Secret</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Key className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input type="password" placeholder="Client Secret" className="pl-9 font-mono text-sm" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full sm:col-span-2" disabled={saveConfig.isPending}>
                  {saveConfig.isPending ? "Connecting..." : "Connect"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}