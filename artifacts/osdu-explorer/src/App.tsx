import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import ConnectPage from "@/pages/connect";
import DashboardPage from "@/pages/dashboard";
import SearchPage from "@/pages/search";
import RecordPage from "@/pages/record";
import SchemasPage from "@/pages/schemas";
import LegalTagsPage from "@/pages/legal-tags";
import ConsolePage from "@/pages/console";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={ConnectPage} />
      <Route path="/dashboard">
        <Layout><DashboardPage /></Layout>
      </Route>
      <Route path="/search">
        <Layout><SearchPage /></Layout>
      </Route>
      <Route path="/records/:id">
        <Layout><RecordPage /></Layout>
      </Route>
      <Route path="/schemas">
        <Layout><SchemasPage /></Layout>
      </Route>
      <Route path="/legal-tags">
        <Layout><LegalTagsPage /></Layout>
      </Route>
      <Route path="/console">
        <Layout><ConsolePage /></Layout>
      </Route>
      <Route>
        <Layout><NotFound /></Layout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;