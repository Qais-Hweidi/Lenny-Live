import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000 },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
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
        <a
          href="https://x.com/QaisHweidi"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            position: "fixed",
            bottom: "16px",
            right: "16px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 10px",
            background: "rgba(15, 15, 15, 0.75)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "20px",
            color: "rgba(255,255,255,0.7)",
            fontSize: "12px",
            fontFamily: "inherit",
            textDecoration: "none",
            backdropFilter: "blur(8px)",
            zIndex: 9999,
            opacity: 0.85,
            transition: "opacity 0.2s",
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "0.85")}
        >
          by Qais
        </a>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
