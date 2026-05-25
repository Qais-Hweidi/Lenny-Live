import { useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import { X } from "lucide-react";

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

const badgeStyle: React.CSSProperties = {
  position: "fixed",
  bottom: "16px",
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
  cursor: "pointer",
};

function App() {
  const [showAbout, setShowAbout] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />

        {/* About button — bottom left */}
        <button
          onClick={() => setShowAbout(true)}
          style={{ ...badgeStyle, left: "16px" }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "0.85")}
        >
          About
        </button>

        {/* By Qais — bottom right */}
        <a
          href="https://x.com/QaisHweidi"
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...badgeStyle, right: "16px" }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "0.85")}
        >
          by Qais
        </a>

        {/* About modal */}
        {showAbout && (
          <div
            className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
            onClick={() => setShowAbout(false)}
          >
            <div
              className="relative max-w-md w-full rounded-2xl border border-white/10 p-8 flex flex-col gap-5"
              style={{ background: "rgba(15,15,20,0.97)" }}
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => setShowAbout(false)}
                className="absolute top-4 right-4 text-white/40 hover:text-white/80 transition-colors"
              >
                <X size={16} />
              </button>

              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold text-white">Lenny Live</h2>
                <p className="text-xs text-white/40">
                  Built for{" "}
                  <a
                    href="https://lennysbuildathon.replit.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/60 underline underline-offset-2 hover:text-white transition-colors"
                  >
                    Lenny's Buildathon
                  </a>
                  {" · Lenny x Replit."}
                </p>
              </div>

              <p className="text-sm text-white/70 leading-relaxed">
                Coming from a technical background, I've seen how having multiple
                agents review the same problem produces significantly better
                output than any single one alone.
              </p>
              <p className="text-sm text-white/70 leading-relaxed">
                I wanted to apply that same idea here — bringing together
                Lenny's podcast guests in a roundtable format, so you can get a
                full 360° perspective on any product or career question, grounded
                in their real words from the show.
              </p>

              <div className="pt-1 border-t border-white/10 flex items-center justify-end">
                <a
                  href="https://x.com/QaisHweidi"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-white/40 hover:text-white/70 transition-colors"
                >
                  @QaisHweidi
                </a>
              </div>
            </div>
          </div>
        )}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
