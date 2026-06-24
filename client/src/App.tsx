import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import Dashboard from "@/pages/Dashboard";
import VaultDetail from "@/pages/VaultDetail";
import Explore from "@/pages/Explore";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/vaults/:id" component={VaultDetail} />
      <Route path="/explore" component={Explore} />
      <Route>
        <div className="flex items-center justify-center min-h-screen">
          <h1 className="text-2xl font-semibold text-muted-foreground">404 — Not Found</h1>
        </div>
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="dark min-h-screen bg-background">
        <Router />
      </div>
    </QueryClientProvider>
  );
}
