import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLocation } from "wouter";
import { useSaveOsduConfig, useGetOsduConfig, getGetOsduConfigQueryKey } from "@workspace/api-client-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Terminal, Shield } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const formSchema = z.object({
  baseUrl: z.string().url({ message: "Please enter a valid URL" }),
  partitionId: z.string().min(1, { message: "Partition ID is required" }),
  token: z.string().min(1, { message: "Bearer token is required" }),
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
      token: "",
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

  if (isLoading) return null;

  if (config?.configured) {
    setLocation("/dashboard");
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center mb-4">
            <Database className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">OSDU Explorer</h1>
          <p className="text-muted-foreground">Connect to your data platform</p>
        </div>

        <Card className="border-border/50 shadow-2xl bg-card">
          <CardHeader>
            <CardTitle>Connection Settings</CardTitle>
            <CardDescription>Enter your OSDU credentials to begin</CardDescription>
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
                  name="token"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bearer Token</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Shield className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input type="password" placeholder="ey..." className="pl-9 font-mono text-sm" {...field} />
                        </div>
                      </FormControl>
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