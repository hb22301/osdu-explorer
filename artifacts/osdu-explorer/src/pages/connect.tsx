import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLocation } from "wouter";
import { useSaveOsduConfig, useGetOsduConfig, getGetOsduConfigQueryKey } from "@workspace/api-client-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Terminal, Shield, Key, Link as LinkIcon, User } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const formSchema = z.object({
  baseUrl: z.string().url({ message: "Please enter a valid URL" }),
  partitionId: z.string().min(1, { message: "Partition ID is required" }),
  tokenEndpoint: z.string().url({ message: "Please enter a valid token endpoint URL" }),
  clientId: z.string().min(1, { message: "Client ID is required" }),
  clientSecret: z.string().min(1, { message: "Client Secret is required" }),
  scope: z.string().optional(),
});

export default function ConnectPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useGetOsduConfig();
  
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
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetOsduConfigQueryKey() });
        setLocation("/dashboard");
      }
    }
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    saveConfig.mutate({ data: values });
  }

  useEffect(() => {
    if (!isLoading && config?.configured) {
      setLocation("/dashboard");
    }
  }, [isLoading, config?.configured, setLocation]);

  if (isLoading || config?.configured) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center mb-4">
            <Database className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">OSDU Navigator</h1>
          <p className="text-muted-foreground">Connect to your data platform</p>
        </div>

        <Card className="border-border/50 shadow-2xl bg-card">
          <CardHeader>
            <CardTitle>Connection Settings</CardTitle>
            <CardDescription>Enter your OAuth2 credentials to begin</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="baseUrl"
                  render={({ field }) => (
                    <FormItem>
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
                  name="partitionId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Data Partition ID</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Database className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input placeholder="opendes" className="pl-9 font-mono text-sm" {...field} />
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
                    <FormItem>
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
                  name="clientId"
                  render={({ field }) => (
                    <FormItem>
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
                  name="clientSecret"
                  render={({ field }) => (
                    <FormItem>
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
                <FormField
                  control={form.control}
                  name="scope"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Scope <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
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
                <Button type="submit" className="w-full" disabled={saveConfig.isPending}>
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