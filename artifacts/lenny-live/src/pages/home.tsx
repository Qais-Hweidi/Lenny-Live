import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  useSelectPanel,
  useGetManualPanelStances,
  useListGuests,
  setExtraHeaders,
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
  Clock,
  ChevronLeft,
  Key,
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
  snippet?: string;
}) {
  if (!source) return null;

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium mt-1.5 opacity-70 select-none"
      style={{
        backgroundColor: `${guestColor}18`,
        border: `1px solid ${guestColor}40`,
        color: guestColor,
      }}
      data-testid={`source-pill-${source.episode}`}
    >
      <Radio size={8} />
      {source.title || source.episode} · {source.timestamp}
    </span>
  );
}

/** Word-by-word reveal animation for new caption turns. */
function AnimatedCaption({ text }: { text: string }) {
  const words = text.split(" ");
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    if (revealed >= words.length) return;
    const id = setInterval(() => {
      setRevealed((r) => {
        if (r >= words.length) {
          clearInterval(id);
          return r;
        }
        return r + 1;
      });
    }, 55);
    return () => clearInterval(id);
  }, [words.length]);

  return (
    <p className="text-sm text-foreground/90 leading-relaxed">
      {words.slice(0, revealed).join(" ")}
      {revealed < words.length && <span className="typing-cursor" />}
    </p>
  );
}

function TurnBubble({
  turn,
  isNew,
  guestChunks,
}: {
  turn: DebateTurn;
  isNew: boolean;
  guestChunks?: string[];
}) {
  const snippet = guestChunks?.[0];

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
            <SourcePill
              source={turn.source}
              guestColor={turn.color}
              snippet={snippet}
            />
          )}
        </div>
        {isNew ? (
          <AnimatedCaption text={turn.text} />
        ) : (
          <p className="text-sm text-foreground/90 leading-relaxed">{turn.text}</p>
        )}
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

// ─── Guest picker ─────────────────────────────────────────────────────────────

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
        g.name.toLowerCase().includes(q) || g.title.toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <div className="w-full max-w-xl border border-border rounded-2xl bg-card overflow-hidden">
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
            <X
              size={12}
              className="text-muted-foreground hover:text-foreground"
            />
          </button>
        )}
      </div>

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
                  isSelected ? "bg-primary border-primary" : "border-border",
                )}
              >
                {isSelected && (
                  <Check size={10} className="text-primary-foreground" />
                )}
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

// ─── Interjection modal ───────────────────────────────────────────────────────

/** Inline text box for follow-up questions during / after the debate. */
function InlineInterjectBox({
  onSubmit,
  isStreaming,
  isDone,
  onNewDebate,
}: {
  onSubmit: (text: string) => void;
  isStreaming: boolean;
  isDone: boolean;
  onNewDebate: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    onSubmit(trimmed);
  };

  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex gap-2 items-center">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder="Ask a follow-up or push back…"
          className="flex-1 bg-card border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/50 text-foreground placeholder:text-muted-foreground transition-colors"
          data-testid="input-interjection"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || isStreaming}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-all shadow-md shadow-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="button-interject-submit"
        >
          <Send size={13} />
        </button>
        {isDone && (
          <button
            onClick={onNewDebate}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all whitespace-nowrap"
            data-testid="button-new-debate"
          >
            <RefreshCw size={13} />
            New debate
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_SUGGESTIONS = [
  "Is product-led growth still the best GTM strategy?",
  "When should a startup hire its first PM?",
  "Does moving fast and breaking things still work?",
  "Is 'jobs to be done' overrated?",
  "How do you know when you've found product-market fit?",
  "Should founders do sales themselves?",
  "Is B2B or B2C harder to build?",
];

const TURN_REVEAL_MS = 750;

// ─── Main component ───────────────────────────────────────────────────────────

export default function Home() {
  const [state, setState] = useState<AppState>("idle");
  const [panelMode, setPanelMode] = useState<PanelMode>("auto");
  const [panelSize, setPanelSize] = useState<2 | 3>(3);
  const [question, setQuestion] = useState("");
  const [panel, setPanel] = useState<GuestInfo[]>([]);
  const [selectedGuests, setSelectedGuests] = useState<Set<string>>(new Set());
  const [suggestionOffset, setSuggestionOffset] = useState(0);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);


  const [pendingInterjection, setPendingInterjection] = useState<string | null>(null);
  const [visibleTurns, setVisibleTurns] = useState<DebateTurn[]>([]);
  const turnQueueRef = useRef<DebateTurn[]>([]);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [latestTurnIdx, setLatestTurnIdx] = useState<number | null>(null);

  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [byokKey, setByokKey] = useState<string>(
    () => localStorage.getItem("lenny-live-openrouter-key") ?? "",
  );
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyDraft, setKeyDraft] = useState<string>(
    () => localStorage.getItem("lenny-live-openrouter-key") ?? "",
  );

  useEffect(() => {
    if (byokKey) {
      localStorage.setItem("lenny-live-openrouter-key", byokKey);
      setExtraHeaders({ "x-openrouter-key": byokKey });
    } else {
      localStorage.removeItem("lenny-live-openrouter-key");
      setExtraHeaders({});
    }
  }, [byokKey]);

  const suggestions = useMemo(
    () => ALL_SUGGESTIONS.slice(suggestionOffset, suggestionOffset + 3),
    [suggestionOffset],
  );

  // Cycle placeholder text every 3 seconds when the input is empty and idle
  useEffect(() => {
    if (state !== "idle") return;
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % ALL_SUGGESTIONS.length);
    }, 3000);
    return () => clearInterval(id);
  }, [state]);

  const cycleSuggestions = useCallback(() => {
    setSuggestionOffset((o) => (o + 3) % ALL_SUGGESTIONS.length);
  }, []);

  const guestChunksMap = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const g of panel) {
      if (g.relevantChunks) m[g.name] = g.relevantChunks;
    }
    return m;
  }, [panel]);

  // ── Drip-feed queue ────────────────────────────────────────────────────────

  const drainQueue = useCallback(() => {
    if (turnQueueRef.current.length === 0) {
      revealTimerRef.current = null;
      return;
    }
    const next = turnQueueRef.current.shift()!;
    setVisibleTurns((prev) => {
      const idx = prev.length;
      setLatestTurnIdx(idx);
      setTimeout(() => setLatestTurnIdx(null), 1200);
      return [...prev, next];
    });
    setPendingInterjection(null);
    setCurrentSpeaker(next.speaker);
    revealTimerRef.current = setTimeout(drainQueue, TURN_REVEAL_MS);
  }, []);

  const enqueueTurn = useCallback(
    (turn: DebateTurn) => {
      turnQueueRef.current.push(turn);
      if (!revealTimerRef.current) {
        revealTimerRef.current = setTimeout(drainQueue, TURN_REVEAL_MS);
      }
    },
    [drainQueue],
  );

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
      selectPanel({ data: { question: question.trim(), panelSize } });
    }
  }, [
    question,
    isSelecting,
    panelMode,
    panelSize,
    selectedGuests,
    selectPanel,
    selectManualPanel,
  ]);

  const startDebate = useCallback(
    async (interject?: string) => {
      if (!panel.length || !question) return;

      const isFollowUp = !!interject && visibleTurns.length > 0;

      setState("debating");
      setIsStreaming(true);
      setError(null);

      // For interjections: keep existing turns visible, only clear queue
      // For fresh debates: wipe everything
      if (!isFollowUp) {
        setVisibleTurns([]);
      } else {
        setPendingInterjection(interject!);
      }
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
          headers: {
            "Content-Type": "application/json",
            ...(byokKey ? { "x-openrouter-key": byokKey } : {}),
          },
          body: JSON.stringify({
            question,
            guests: panel,
            ...(interject
              ? {
                  interjection: interject,
                  priorTurns: visibleTurns.map((t) => ({
                    speaker: t.speaker,
                    text: t.text,
                  })),
                }
              : {}),
          }),
          signal: ctrl.signal,
        });

        if (!res.ok) throw new Error(`Server error: ${res.status}`);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const allTurns: DebateTurn[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as {
                type: string;
                speaker?: string;
                text?: string;
                color?: string;
                source?: DebateTurn["source"];
                message?: string;
              };
              if (event.type === "turn") {
                const turn: DebateTurn = {
                  speaker: event.speaker ?? "",
                  text: event.text ?? "",
                  color: event.color ?? LENNY_COLOR,
                  source: event.source ?? null,
                };
                allTurns.push(turn);
                enqueueTurn(turn);
              } else if (event.type === "done") {
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
                setError(event.message ?? "Unknown stream error");
                flushQueue();
                setState("done");
                setIsStreaming(false);
              }
            } catch {
              // malformed SSE line — skip
            }
          }
        }
      } catch (err: unknown) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        if (!isAbort) {
          setError("Debate stream interrupted. Please try again.");
          flushQueue();
          setState("done");
          setIsStreaming(false);
        }
      }
    },
    [panel, question, visibleTurns, enqueueTurn, flushQueue],
  );

  const handleReset = useCallback(() => {
    abortRef.current?.abort();
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    turnQueueRef.current = [];
    setState("idle");
    setQuestion("");
    setPanel([]);
    setVisibleTurns([]);
    setPendingInterjection(null);
    setError(null);
    setCurrentSpeaker(null);
    setIsStreaming(false);
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

  // ── Derived state ──────────────────────────────────────────────────────────

  const showDebateFeed = state === "debating" || state === "done";
  const showInterjectButton =
    state === "done" || (state === "debating" && visibleTurns.length > 0);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-border/50 px-6 py-4 flex items-center justify-between sticky top-0 z-10 bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <GlowOrb color="#8b5cf6" size={32} float={false} pulse />
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground">
              Lenny Live
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          <button
            onClick={() => {
              setKeyDraft(byokKey);
              setShowKeyInput((v) => !v);
            }}
            className={cn(
              "flex items-center gap-1.5 text-xs transition-colors px-3 py-1.5 rounded-lg",
              byokKey
                ? "text-emerald-400 hover:text-emerald-300 bg-emerald-400/10 hover:bg-emerald-400/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
            title={byokKey ? "Your OpenRouter key is active" : "Use your own OpenRouter key"}
            data-testid="button-byok"
          >
            <Key size={12} />
            {byokKey ? "Your key" : "BYOK"}
          </button>
        </div>
      </header>

      {showKeyInput && (
        <div className="border-b border-border/50 bg-muted/20 px-6 py-3 flex items-center gap-3">
          <Key size={13} className="text-muted-foreground flex-shrink-0" />
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="sk-or-v1-… your OpenRouter key"
              className="flex-1 min-w-0 bg-background border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setByokKey(keyDraft.trim());
                  setShowKeyInput(false);
                }
                if (e.key === "Escape") setShowKeyInput(false);
              }}
              autoFocus
            />
            <button
              onClick={() => {
                setByokKey(keyDraft.trim());
                setShowKeyInput(false);
              }}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Save
            </button>
            {byokKey && (
              <button
                onClick={() => {
                  setByokKey("");
                  setKeyDraft("");
                  setShowKeyInput(false);
                }}
                className="flex-shrink-0 text-xs px-2 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground hidden sm:block flex-shrink-0">
            {byokKey ? "Stored locally · never sent to our servers" : "Free while my credits last — add your key to keep it running"}
          </p>
        </div>
      )}

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
                AI personas grounded in real podcast transcripts argue your
                product &amp; career questions
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

            {/* Panel size toggle (auto mode only) */}
            {panelMode === "auto" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Panel size:</span>
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted">
                  {([2, 3] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => setPanelSize(n)}
                      className={cn(
                        "w-7 h-6 rounded-md text-xs font-medium transition-all",
                        panelSize === n
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      data-testid={`panel-size-${n}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <span className="text-muted-foreground/60">guests</span>
              </div>
            )}

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
                  placeholder={question ? "" : ALL_SUGGESTIONS[placeholderIdx]}
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

              {/* 3 suggestion chips + cycle arrows */}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {suggestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuestion(q)}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all bg-card/50"
                    data-testid={`suggestion-${q.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    {q}
                  </button>
                ))}
                <button
                  onClick={cycleSuggestions}
                  className="flex items-center gap-0.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors px-1"
                  data-testid="button-cycle-suggestions"
                  title="More suggestions"
                >
                  <ChevronLeft size={10} />
                  <ChevronRight size={10} />
                </button>
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
            <div className="flex flex-col gap-4 pb-2" data-testid="debate-feed">
              {visibleTurns.map((turn, i) => (
                <TurnBubble
                  key={i}
                  turn={turn}
                  isNew={i === latestTurnIdx}
                  guestChunks={guestChunksMap[turn.speaker]}
                />
              ))}
              {isStreaming && visibleTurns.length === 0 && !pendingInterjection && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse pl-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                  The debate is starting...
                </div>
              )}

              {/* User's follow-up bubble */}
              {pendingInterjection && (
                <div className="flex justify-end">
                  <div className="max-w-[75%] bg-primary/15 border border-primary/25 rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-foreground">
                    {pendingInterjection}
                  </div>
                </div>
              )}

              {/* Generating indicator — shown while waiting for first response turn */}
              {isStreaming && pendingInterjection && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
                  <div className="flex gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  Generating response…
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Inline follow-up input — visible once turns arrive */}
            {showInterjectButton && (
              <InlineInterjectBox
                onSubmit={(text) => startDebate(text)}
                isStreaming={isStreaming}
                isDone={state === "done"}
                onNewDebate={handleReset}
              />
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
          AI representations grounded in publicly available podcast transcripts.
          Not affiliated with the guests or Lenny's Newsletter.
        </p>
      </footer>
    </div>
  );
}
