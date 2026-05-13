import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  useSelectPanel,
  useGetManualPanelStances,
  useListGuests,
} from "@workspace/api-client-react";
import type { GuestInfo } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import {
  Mic,
  ChevronRight,
  RefreshCw,
  Send,
  Sparkles,
  Radio,
  Users,
  Search,
  X,
  Check,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DebateTurn {
  speaker: string;
  text: string;
  color: string;
  source: { episode: string; title: string; timestamp: string } | null;
}

type AppState = "idle" | "selecting" | "ready" | "debating" | "done";
type PanelMode = "auto" | "manual";

const LENNY_COLOR = "#e2e8f0";

// ─── Sub-components ──────────────────────────────────────────────────────────

function GlowOrb({
  color,
  size = 120,
  float: doFloat = true,
  pulse = false,
  speaking = false,
}: {
  color: string;
  size?: number;
  float?: boolean;
  pulse?: boolean;
  speaking?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-full flex-shrink-0",
        doFloat && "orb-float",
        pulse && "orb-pulse",
      )}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 35% 35%, ${color}cc 0%, ${color}66 50%, ${color}11 100%)`,
        boxShadow: speaking
          ? `0 0 ${size * 0.4}px ${color}99, 0 0 ${size * 0.8}px ${color}44, 0 0 ${size * 1.2}px ${color}22`
          : `0 0 ${size * 0.25}px ${color}55, 0 0 ${size * 0.5}px ${color}22`,
        transition: "box-shadow 0.4s ease",
      }}
    />
  );
}

function SourcePill({
  source,
  guestColor,
}: {
  source: DebateTurn["source"];
  guestColor: string;
}) {
  if (!source) return null;
  return (
    <a
      href={`https://www.lennysnewsletter.com/p/${source.episode}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium mt-1.5 opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
      style={{
        backgroundColor: `${guestColor}18`,
        border: `1px solid ${guestColor}40`,
        color: guestColor,
      }}
      data-testid={`source-pill-${source.episode}`}
    >
      <Radio size={8} />
      {source.title || source.episode} · {source.timestamp}
    </a>
  );
}

function TurnBubble({ turn, isNew }: { turn: DebateTurn; isNew: boolean }) {
  return (
    <div
      className="flex gap-3 items-start caption-in"
      data-testid={`turn-bubble-${turn.speaker.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <GlowOrb color={turn.color} size={36} float={false} pulse={isNew} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
          <span
            className="text-xs font-semibold tracking-wide uppercase"
            style={{ color: turn.color }}
          >
            {turn.speaker}
          </span>
          {turn.source && (
            <SourcePill source={turn.source} guestColor={turn.color} />
          )}
        </div>
        <p className="text-sm text-foreground/90 leading-relaxed">
          {turn.text}
          {isNew && <span className="typing-cursor" />}
        </p>
      </div>
    </div>
  );
}

function PanelOrb({
  guest,
  speaking,
}: {
  guest: GuestInfo;
  speaking: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center gap-2"
      data-testid={`panel-orb-${guest.name.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="relative">
        {speaking && (
          <div
            className="absolute inset-0 rounded-full speaking-ring"
            style={{ color: guest.color }}
          />
        )}
        <GlowOrb
          color={guest.color}
          size={56}
          float={!speaking}
          speaking={speaking}
        />
      </div>
      <span className="text-[11px] font-medium text-center max-w-[80px] leading-tight text-foreground/80">
        {guest.name.split(" ").slice(0, 2).join(" ")}
      </span>
    </div>
  );
}

// ─── Guest picker ────────────────────────────────────────────────────────────

function GuestPicker({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useListGuests();

  const filtered = useMemo(() => {
    if (!data?.guests) return [];
    const q = search.toLowerCase();
    return data.guests.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.title.toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <div className="w-full max-w-xl border border-border rounded-2xl bg-card overflow-hidden">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Search size={13} className="text-muted-foreground flex-shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search guests..."
          className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
          data-testid="input-guest-search"
        />
        {search && (
          <button onClick={() => setSearch("")}>
            <X size={12} className="text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      {/* Guest list */}
      <div className="max-h-52 overflow-y-auto">
        {isLoading && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Loading guests...
          </p>
        )}
        {!isLoading && filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No guests found
          </p>
        )}
        {filtered.map((g) => {
          const isSelected = selected.has(g.name);
          const maxReached = selected.size >= 3 && !isSelected;
          return (
            <button
              key={g.name}
              onClick={() => !maxReached && onToggle(g.name)}
              disabled={maxReached}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
                isSelected
                  ? "bg-primary/10"
                  : maxReached
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:bg-muted/50",
              )}
              data-testid={`guest-option-${g.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div
                className={cn(
                  "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors",
                  isSelected
                    ? "bg-primary border-primary"
                    : "border-border",
                )}
              >
                {isSelected && <Check size={10} className="text-primary-foreground" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {g.name}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {g.title}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground">
        {selected.size}/3 selected · Pick 2–3 guests
      </div>
    </div>
  );
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  "Should PMs write code in the AI era?",
  "Is product-led growth still the best GTM strategy?",
  "When should a startup hire its first PM?",
  "Does moving fast and breaking things still work?",
  "Is 'jobs to be done' overrated?",
];

const TURN_REVEAL_MS = 750; // delay between revealing queued turns

// ─── Main component ───────────────────────────────────────────────────────────

export default function Home() {
  const [state, setState] = useState<AppState>("idle");
  const [panelMode, setPanelMode] = useState<PanelMode>("auto");
  const [question, setQuestion] = useState("");
  const [panel, setPanel] = useState<GuestInfo[]>([]);
  const [selectedGuests, setSelectedGuests] = useState<Set<string>>(new Set());

  // Displayed turns (drip-fed from queue)
  const [visibleTurns, setVisibleTurns] = useState<DebateTurn[]>([]);
  // Queue of turns received from SSE not yet shown
  const turnQueueRef = useRef<DebateTurn[]>([]);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [latestTurnIdx, setLatestTurnIdx] = useState<number | null>(null);

  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [interjection, setInterjection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Drip-feed turns from the queue one at a time
  const drainQueue = useCallback(() => {
    if (turnQueueRef.current.length === 0) return;
    const next = turnQueueRef.current.shift()!;
    setVisibleTurns((prev) => {
      const idx = prev.length;
      setLatestTurnIdx(idx);
      setTimeout(() => setLatestTurnIdx(null), 1200);
      return [...prev, next];
    });
    setCurrentSpeaker(next.speaker);
    revealTimerRef.current = setTimeout(drainQueue, TURN_REVEAL_MS);
  }, []);

  const enqueueTurn = useCallback(
    (turn: DebateTurn) => {
      turnQueueRef.current.push(turn);
      // Start draining if not already running
      if (!revealTimerRef.current) {
        revealTimerRef.current = setTimeout(drainQueue, TURN_REVEAL_MS);
      }
    },
    [drainQueue],
  );

  // Flush any remaining queued turns immediately (used on abort/done)
  const flushQueue = useCallback(() => {
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    if (turnQueueRef.current.length > 0) {
      setVisibleTurns((prev) => [...prev, ...turnQueueRef.current]);
      turnQueueRef.current = [];
    }
  }, []);

  // ── API hooks ──────────────────────────────────────────────────────────────

  const { mutate: selectPanel, isPending: isAutoSelecting } = useSelectPanel({
    mutation: {
      onSuccess: (data) => {
        setPanel(data.guests);
        setState("ready");
      },
      onError: () => {
        setError("Couldn't build a panel for that question. Try rephrasing.");
        setState("idle");
      },
    },
  });

  const { mutate: selectManualPanel, isPending: isManualSelecting } =
    useGetManualPanelStances({
      mutation: {
        onSuccess: (data) => {
          setPanel(data.guests);
          setState("ready");
        },
        onError: () => {
          setError("Couldn't load stances for those guests. Try again.");
          setState("idle");
        },
      },
    });

  const isSelecting = isAutoSelecting || isManualSelecting;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAsk = useCallback(() => {
    if (!question.trim() || isSelecting) return;
    setError(null);
    setVisibleTurns([]);
    turnQueueRef.current = [];
    setPanel([]);
    setState("selecting");

    if (panelMode === "manual") {
      if (selectedGuests.size < 2) {
        setError("Please select at least 2 guests.");
        setState("idle");
        return;
      }
      selectManualPanel({
        data: { question: question.trim(), guestNames: [...selectedGuests] },
      });
    } else {
      selectPanel({ data: { question: question.trim(), panelSize: 3 } });
    }
  }, [question, isSelecting, panelMode, selectedGuests, selectPanel, selectManualPanel]);

  const startDebate = useCallback(
    async (interject?: string) => {
      if (!panel.length || !question) return;

      setState("debating");
      setIsStreaming(true);
      setError(null);
      if (interject) setInterjection("");

      // Clear queue but keep visible turns so follow-ups append
      turnQueueRef.current = [];
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch("/api/debate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            guests: panel,
            ...(interject ? { interjection: interject } : {}),
          }),
          signal: ctrl.signal,
        });

        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "turn") {
                enqueueTurn({
                  speaker: event.speaker,
                  text: event.text,
                  color: event.color ?? LENNY_COLOR,
                  source: event.source ?? null,
                });
              } else if (event.type === "done") {
                // Wait for queue to drain naturally, then mark done
                const waitForDrain = () => {
                  if (turnQueueRef.current.length === 0) {
                    setState("done");
                    setCurrentSpeaker(null);
                    setIsStreaming(false);
                  } else {
                    setTimeout(waitForDrain, TURN_REVEAL_MS);
                  }
                };
                setTimeout(waitForDrain, TURN_REVEAL_MS);
              } else if (event.type === "error") {
                setError(event.message);
                flushQueue();
                setState("done");
                setIsStreaming(false);
              }
            } catch {}
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setError("Debate stream interrupted. Please try again.");
          flushQueue();
          setState("done");
          setIsStreaming(false);
        }
      }
    },
    [panel, question, enqueueTurn, flushQueue],
  );

  const handleReset = useCallback(() => {
    abortRef.current?.abort();
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    turnQueueRef.current = [];
    setState("idle");
    setQuestion("");
    setPanel([]);
    setVisibleTurns([]);
    setError(null);
    setCurrentSpeaker(null);
    setIsStreaming(false);
    setInterjection("");
  }, []);

  const toggleGuest = useCallback((name: string) => {
    setSelectedGuests((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else if (next.size < 3) next.add(name);
      return next;
    });
  }, []);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleTurns]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const showDebateFeed = state === "debating" || state === "done";
  const showInterjection =
    (state === "done" || (state === "debating" && visibleTurns.length > 0));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-border/50 px-6 py-4 flex items-center justify-between sticky top-0 z-10 bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <GlowOrb color="#8b5cf6" size={32} float={false} pulse />
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-1.5">
              Lenny Live
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/20">
                BUILDATHON
              </span>
            </h1>
            <p className="text-[11px] text-muted-foreground">
              AI debate room · 50 Lenny podcasts
            </p>
          </div>
        </div>
        {state !== "idle" && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted"
            data-testid="button-reset"
          >
            <RefreshCw size={12} />
            New question
          </button>
        )}
      </header>

      <main className="flex-1 flex flex-col max-w-3xl mx-auto w-full px-4 py-6 gap-6">

        {/* ── IDLE / SELECTING ── */}
        {(state === "idle" || state === "selecting") && (
          <div className="flex flex-col gap-5 items-center pt-6">
            {/* Hero orbs */}
            <div className="flex items-end justify-center gap-6 h-24">
              <GlowOrb color="#f59e0b" size={68} float />
              <GlowOrb color="#e2e8f0" size={90} float />
              <GlowOrb color="#06b6d4" size={68} float />
            </div>

            <div className="text-center space-y-1.5">
              <h2 className="text-2xl font-bold text-foreground font-serif">
                Ask Lenny's guests anything
              </h2>
              <p className="text-sm text-muted-foreground max-w-md">
                AI personas grounded in real transcripts argue your product &amp;
                career questions
              </p>
            </div>

            {/* Mode toggle */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted text-xs font-medium">
              <button
                onClick={() => setPanelMode("auto")}
                className={cn(
                  "px-3 py-1.5 rounded-lg transition-all",
                  panelMode === "auto"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid="tab-auto"
              >
                <span className="flex items-center gap-1.5">
                  <Sparkles size={11} />
                  AI picks the panel
                </span>
              </button>
              <button
                onClick={() => setPanelMode("manual")}
                className={cn(
                  "px-3 py-1.5 rounded-lg transition-all",
                  panelMode === "manual"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid="tab-manual"
              >
                <span className="flex items-center gap-1.5">
                  <Users size={11} />
                  I choose the guests
                </span>
              </button>
            </div>

            {/* Question input */}
            <div className="w-full max-w-xl">
              <div className="relative rounded-2xl border border-border bg-card shadow-md focus-within:border-primary/50 focus-within:shadow-lg transition-all">
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAsk();
                    }
                  }}
                  placeholder="Ask a product or career question..."
                  rows={2}
                  className="w-full bg-transparent px-4 pt-4 pb-12 text-sm resize-none outline-none text-foreground placeholder:text-muted-foreground"
                  disabled={state === "selecting"}
                  data-testid="input-question"
                />
                <div className="absolute bottom-3 right-3">
                  <button
                    onClick={handleAsk}
                    disabled={
                      !question.trim() ||
                      state === "selecting" ||
                      (panelMode === "manual" && selectedGuests.size < 2)
                    }
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all",
                      question.trim() &&
                        state !== "selecting" &&
                        !(panelMode === "manual" && selectedGuests.size < 2)
                        ? "bg-primary text-primary-foreground hover:opacity-90 shadow-md shadow-primary/20"
                        : "bg-muted text-muted-foreground cursor-not-allowed",
                    )}
                    data-testid="button-ask"
                  >
                    {state === "selecting" ? (
                      <>
                        <div className="w-3 h-3 border-2 border-primary-foreground/50 border-t-primary-foreground rounded-full animate-spin" />
                        Building panel...
                      </>
                    ) : (
                      <>
                        <Sparkles size={12} />
                        Debate this
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Suggested questions */}
              <div className="mt-3 flex flex-wrap gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuestion(q)}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all bg-card/50"
                    data-testid={`suggestion-${q.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Manual guest picker */}
            {panelMode === "manual" && (
              <div className="w-full max-w-xl">
                {selectedGuests.size > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {[...selectedGuests].map((name) => (
                      <span
                        key={name}
                        className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25"
                      >
                        {name.split(" ").slice(0, 2).join(" ")}
                        <button
                          onClick={() => toggleGuest(name)}
                          className="hover:opacity-70"
                          data-testid={`remove-guest-${name.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          <X size={9} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <GuestPicker selected={selectedGuests} onToggle={toggleGuest} />
              </div>
            )}

            {error && (
              <p className="text-xs text-destructive bg-destructive/10 px-4 py-2 rounded-xl border border-destructive/20">
                {error}
              </p>
            )}
          </div>
        )}

        {/* ── READY: Panel preview ── */}
        {state === "ready" && panel.length > 0 && (
          <div className="flex flex-col gap-5 items-center pt-4">
            <div className="text-center space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
                Tonight's panel
              </p>
              <h2 className="text-lg font-semibold text-foreground max-w-md">
                {question}
              </h2>
            </div>

            {/* Orbs */}
            <div className="flex items-end justify-center gap-8">
              <div className="flex flex-col items-center gap-2">
                <GlowOrb color={LENNY_COLOR} size={52} float />
                <span className="text-xs font-medium text-foreground/80">
                  Lenny
                </span>
              </div>
              {panel.map((g) => (
                <div key={g.name} className="flex flex-col items-center gap-2">
                  <GlowOrb color={g.color} size={68} float />
                  <span className="text-xs font-medium text-center max-w-[90px] leading-tight text-foreground/80">
                    {g.name.split(" ").slice(0, 2).join(" ")}
                  </span>
                </div>
              ))}
            </div>

            {/* Stance cards */}
            <div className="w-full max-w-xl space-y-3">
              {panel.map((g) => (
                <div
                  key={g.name}
                  className="flex gap-3 items-start p-3 rounded-xl border bg-card/50"
                  style={{ borderColor: `${g.color}30` }}
                  data-testid={`stance-card-${g.name.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <GlowOrb color={g.color} size={28} float={false} />
                  <div>
                    <p
                      className="text-xs font-semibold mb-0.5"
                      style={{ color: g.color }}
                    >
                      {g.name}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {g.stance}
                    </p>
                    {g.title && (
                      <span className="text-[10px] text-muted-foreground/50 mt-1 block">
                        {g.title}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => startDebate()}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-2xl font-medium text-sm hover:opacity-90 shadow-lg shadow-primary/20 transition-all"
              data-testid="button-start-debate"
            >
              <Mic size={16} />
              Start the debate
            </button>
          </div>
        )}

        {/* ── DEBATE & DONE: Feed ── */}
        {showDebateFeed && panel.length > 0 && (
          <div className="flex flex-col gap-4">
            {/* Sticky panel strip */}
            <div className="sticky top-16 z-10 bg-background/80 backdrop-blur-md pb-3 pt-1 border-b border-border/30 mb-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground italic truncate max-w-xs">
                  {question}
                </p>
                {isStreaming && (
                  <div className="flex items-center gap-1.5 text-[11px] text-primary animate-pulse">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    Live
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4">
                <PanelOrb
                  guest={{
                    name: "Lenny",
                    episode: "",
                    title: "",
                    timestamp: "",
                    stance: "",
                    color: LENNY_COLOR,
                  }}
                  speaking={
                    currentSpeaker === "Lenny" ||
                    currentSpeaker === "Lenny Rachitsky"
                  }
                />
                {panel.map((g) => (
                  <PanelOrb
                    key={g.name}
                    guest={g}
                    speaking={currentSpeaker === g.name}
                  />
                ))}
              </div>
            </div>

            {/* Turn feed */}
            <div
              className="flex flex-col gap-4 pb-2"
              data-testid="debate-feed"
            >
              {visibleTurns.map((turn, i) => (
                <TurnBubble
                  key={i}
                  turn={turn}
                  isNew={i === latestTurnIdx}
                />
              ))}
              {isStreaming && visibleTurns.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse pl-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                  The debate is starting...
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Interjection + done actions — visible once turns start coming in */}
            {showInterjection && (
              <div className="flex flex-col gap-3 items-center pt-3 border-t border-border/30">
                {!isStreaming && (
                  <p className="text-xs text-muted-foreground">
                    Debate complete · Push back or ask a follow-up
                  </p>
                )}

                <div className="relative w-full max-w-xl rounded-2xl border border-border bg-card focus-within:border-primary/50 transition-all">
                  <input
                    type="text"
                    value={interjection}
                    onChange={(e) => setInterjection(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && interjection.trim() && !isStreaming)
                        startDebate(interjection.trim());
                    }}
                    placeholder={
                      isStreaming
                        ? "Debate in progress..."
                        : "Ask a follow-up or push back on a point..."
                    }
                    disabled={isStreaming}
                    className="w-full bg-transparent px-4 py-3 pr-12 text-sm outline-none text-foreground placeholder:text-muted-foreground disabled:opacity-50"
                    data-testid="input-interjection"
                  />
                  <button
                    onClick={() =>
                      interjection.trim() &&
                      !isStreaming &&
                      startDebate(interjection.trim())
                    }
                    disabled={!interjection.trim() || isStreaming}
                    className={cn(
                      "absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all",
                      interjection.trim() && !isStreaming
                        ? "bg-primary text-primary-foreground hover:opacity-90"
                        : "text-muted-foreground cursor-not-allowed",
                    )}
                    data-testid="button-interject"
                  >
                    {isStreaming ? (
                      <div className="w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                    ) : (
                      <Send size={13} />
                    )}
                  </button>
                </div>

                {!isStreaming && (
                  <button
                    onClick={handleReset}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="button-new-question"
                  >
                    <ChevronRight size={12} />
                    Ask a new question
                  </button>
                )}
              </div>
            )}

            {error && (
              <p className="text-xs text-destructive bg-destructive/10 px-4 py-2 rounded-xl border border-destructive/20">
                {error}
              </p>
            )}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border/30 px-6 py-3 text-center">
        <p className="text-[10px] text-muted-foreground/50">
          AI personas grounded in real transcripts · Not affiliated with Lenny
          Rachitsky · Built for the Buildathon
        </p>
      </footer>
    </div>
  );
}
