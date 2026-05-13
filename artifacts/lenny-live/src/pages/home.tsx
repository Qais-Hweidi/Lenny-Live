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
  Share2,
  Clock,
  ChevronLeft,
  Copy,
  BookOpen,
  Download,
  MessageSquarePlus,
} from "lucide-react";
import html2canvas from "html2canvas";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DebateTurn {
  speaker: string;
  text: string;
  color: string;
  source: { episode: string; title: string; timestamp: string } | null;
}

interface SavedDebate {
  id: string;
  question: string;
  guestNames: string[];
  timestamp: number;
  turns: DebateTurn[];
}

type AppState = "idle" | "selecting" | "ready" | "debating" | "done";
type PanelMode = "auto" | "manual";

const LENNY_COLOR = "#e2e8f0";
const LS_KEY = "lenny-live-debates";
const MAX_SAVED = 20;

// ─── localStorage helpers ─────────────────────────────────────────────────

function loadSavedDebates(): SavedDebate[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveDebate(debate: SavedDebate) {
  try {
    const existing = loadSavedDebates().filter((d) => d.id !== debate.id);
    const next = [debate, ...existing].slice(0, MAX_SAVED);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — silently skip
  }
}

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
  snippet,
}: {
  source: DebateTurn["source"];
  guestColor: string;
  snippet?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!source) return null;

  const hasSnippet = Boolean(snippet);

  return (
    <span className="relative inline-block">
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
        onMouseEnter={() => hasSnippet && setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={(e) => {
          if (hasSnippet) {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <Radio size={8} />
        {source.title || source.episode} · {source.timestamp}
        {hasSnippet && <BookOpen size={7} className="ml-0.5 opacity-60" />}
      </a>

      {/* Hover snippet popover */}
      {open && snippet && (
        <div
          className="absolute bottom-full left-0 mb-2 z-50 w-72 rounded-xl border border-border bg-card shadow-xl p-3"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <p className="text-[10px] text-muted-foreground leading-relaxed italic line-clamp-6">
            &ldquo;{snippet}&rdquo;
          </p>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[9px] text-muted-foreground/50">
              {source.title} · {source.timestamp}
            </span>
            <a
              href={`https://www.lennysnewsletter.com/p/${source.episode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] underline"
              style={{ color: guestColor }}
            >
              Full episode →
            </a>
          </div>
        </div>
      )}
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

function InterjectModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="interject-modal-backdrop"
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Interject the debate
          </h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-close-interject-modal"
          >
            <X size={15} />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Push back on a point, ask a follow-up, or steer the conversation.
          Lenny will introduce your question to the panel.
        </p>

        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onClose();
          }}
          placeholder="But what about..."
          className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-primary/50 text-foreground placeholder:text-muted-foreground transition-colors"
          data-testid="input-interjection"
        />

        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs text-muted-foreground hover:text-foreground border border-border hover:border-border/80 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all",
              text.trim()
                ? "bg-primary text-primary-foreground hover:opacity-90 shadow-md shadow-primary/20"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
            data-testid="button-interject-submit"
          >
            <Send size={11} />
            Send to panel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

/** Extract key insight from debate turns for the summary card. */
function buildDebateSummary(
  turns: DebateTurn[],
  panel: GuestInfo[],
): {
  verbatimQuotes: { speaker: string; color: string; quote: string }[];
  agreementBullets: string[];
  stances: { name: string; color: string; stance: string }[];
} {
  const guestNames = new Set(panel.map((g) => g.name));

  // Per-panelist: find their longest turn as a verbatim quote
  const verbatimQuotes: { speaker: string; color: string; quote: string }[] = [];
  for (const guest of panel) {
    const guestTurns = turns.filter((t) => t.speaker === guest.name && t.text.length > 40);
    const longest = guestTurns.sort((a, b) => b.text.length - a.text.length)[0];
    if (longest) {
      const words = longest.text.split(" ").slice(0, 30).join(" ");
      verbatimQuotes.push({
        speaker: guest.name,
        color: guest.color,
        quote: words + (longest.text.split(" ").length > 30 ? "…" : ""),
      });
    }
  }

  // Per-panelist stance: first substantive turn
  const stances: { name: string; color: string; stance: string }[] = [];
  for (const guest of panel) {
    const first = turns.find((t) => t.speaker === guest.name && t.text.length > 30);
    if (first) {
      const words = first.text.split(" ").slice(0, 20).join(" ");
      stances.push({
        name: guest.name,
        color: guest.color,
        stance: words + (first.text.split(" ").length > 20 ? "…" : ""),
      });
    }
  }

  // Agreement bullets: simple keyword overlap across panelists
  const tokenize = (t: string) =>
    t.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 4);

  const guestTokenSets: Map<string, Set<string>> = new Map();
  for (const name of guestNames) {
    const combined = turns
      .filter((t) => t.speaker === name)
      .map((t) => t.text)
      .join(" ");
    guestTokenSets.set(name, new Set(tokenize(combined)));
  }

  const allGuests = [...guestNames];
  const sharedTerms = new Set<string>();
  if (allGuests.length >= 2) {
    const [first, ...rest] = allGuests;
    const firstSet = guestTokenSets.get(first) ?? new Set<string>();
    for (const term of firstSet) {
      if (rest.every((g) => guestTokenSets.get(g)?.has(term))) {
        sharedTerms.add(term);
      }
    }
  }

  // Map shared terms to readable bullets
  const topicMap: Record<string, string> = {
    product: "product thinking",
    growth: "growth strategy",
    customer: "customer focus",
    hiring: "hiring decisions",
    founder: "founder role",
    market: "market dynamics",
    shipping: "shipping fast",
    engineer: "engineering culture",
    metrics: "measuring success",
    startup: "startup building",
    revenue: "revenue models",
    feedback: "user feedback",
    scale: "scaling challenges",
  };

  const bullets: string[] = [];
  for (const [key, label] of Object.entries(topicMap)) {
    if (sharedTerms.has(key) && bullets.length < 3) {
      bullets.push(`Both sides agreed ${label} is central to this question`);
    }
  }
  if (bullets.length === 0 && sharedTerms.size > 0) {
    const sample = [...sharedTerms].slice(0, 2).join(" and ");
    bullets.push(`Panelists shared common ground on ${sample}`);
  }
  if (bullets.length === 0) {
    bullets.push("Panelists had sharply divergent perspectives throughout");
  }

  return { verbatimQuotes, agreementBullets: bullets, stances };
}

function SummaryCard({
  question,
  panel,
  turns,
  onNewDebate,
}: {
  question: string;
  panel: GuestInfo[];
  turns: DebateTurn[];
  onNewDebate: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const { verbatimQuotes, agreementBullets, stances } = useMemo(
    () => buildDebateSummary(turns, panel),
    [turns, panel],
  );

  /** Save this debate to localStorage so it appears in the past-debates row. */
  const handleSave = useCallback(() => {
    const debate: SavedDebate = {
      id: `${Date.now()}`,
      question,
      guestNames: panel.map((g) => g.name),
      timestamp: Date.now(),
      turns,
    };
    saveDebate(debate);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [question, panel, turns]);

  /** Export the summary card as a PNG via html2canvas. */
  const handleShare = useCallback(async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#0b0f1a",
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement("a");
      link.download = `lenny-live-debate-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setSharing(false);
    }
  }, []);

  return (
    <div
      ref={cardRef}
      className="w-full rounded-2xl border border-border bg-card/60 p-5 flex flex-col gap-4"
      data-testid="summary-card"
    >
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        {panel.map((g) => (
          <div key={g.name} className="flex items-center gap-1.5">
            <GlowOrb color={g.color} size={18} float={false} />
            <span className="text-[11px] text-muted-foreground">
              {g.name.split(" ")[0]}
            </span>
          </div>
        ))}
      </div>

      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
          Debate complete
        </p>
        <p className="text-sm font-semibold text-foreground leading-snug">
          {question}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {turns.length} turns · {panel.length} panelists
        </p>
      </div>

      {/* Per-panelist stances */}
      {stances.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            Where they stood
          </p>
          {stances.map((s) => (
            <div key={s.name} className="flex gap-2 items-start">
              <GlowOrb color={s.color} size={14} float={false} />
              <div>
                <span
                  className="text-[10px] font-semibold uppercase tracking-wide mr-1"
                  style={{ color: s.color }}
                >
                  {s.name.split(" ")[0]}
                </span>
                <span className="text-[11px] text-muted-foreground italic">
                  "{s.stance}"
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Verbatim quotes */}
      {verbatimQuotes.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            Key quotes
          </p>
          {verbatimQuotes.map((q) => (
            <div
              key={q.speaker}
              className="rounded-xl px-3 py-2 text-[11px] leading-relaxed italic text-foreground/80"
              style={{
                backgroundColor: `${q.color}0d`,
                borderLeft: `2px solid ${q.color}60`,
              }}
            >
              &ldquo;{q.quote}&rdquo;
              <span
                className="block not-italic text-[10px] mt-0.5 font-medium"
                style={{ color: q.color }}
              >
                — {q.speaker}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Agreement bullets */}
      {agreementBullets.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            Common ground
          </p>
          {agreementBullets.map((b, i) => (
            <p key={i} className="text-[11px] text-muted-foreground flex gap-1.5 items-start">
              <span className="text-primary mt-0.5">·</span>
              {b}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {/* Save to localStorage */}
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-all shadow-md shadow-primary/20"
          data-testid="button-save"
        >
          {saved ? (
            <>
              <Check size={12} />
              Saved!
            </>
          ) : (
            <>
              <Download size={12} />
              Save
            </>
          )}
        </button>

        {/* Share as PNG via html2canvas */}
        <button
          onClick={handleShare}
          disabled={sharing}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all disabled:opacity-60"
          data-testid="button-share"
        >
          {sharing ? (
            <>
              <div className="w-3 h-3 border-2 border-muted-foreground/40 border-t-muted-foreground rounded-full animate-spin" />
              Exporting…
            </>
          ) : (
            <>
              <Share2 size={12} />
              Share
            </>
          )}
        </button>

        {/* New debate */}
        <button
          onClick={onNewDebate}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
          data-testid="button-new-debate"
        >
          <RefreshCw size={12} />
          New debate
        </button>
      </div>
    </div>
  );
}

// ─── Past debates row ─────────────────────────────────────────────────────────

function PastDebatesRow({ onRestore }: { onRestore: (d: SavedDebate) => void }) {
  const [debates, setDebates] = useState<SavedDebate[]>([]);

  useEffect(() => {
    setDebates(loadSavedDebates());
  }, []);

  if (debates.length === 0) return null;

  return (
    <div className="w-full max-w-xl" data-testid="past-debates">
      <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1">
        <Clock size={9} />
        Past debates
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {debates.map((d) => (
          <button
            key={d.id}
            onClick={() => onRestore(d)}
            className="flex-shrink-0 text-left px-3 py-2 rounded-xl border border-border/60 bg-card/50 hover:border-primary/40 hover:bg-card transition-all max-w-[200px]"
            data-testid={`past-debate-${d.id}`}
          >
            <p className="text-[11px] font-medium text-foreground truncate">
              {d.question}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5 truncate">
              {d.guestNames.slice(0, 2).join(", ")} ·{" "}
              {new Date(d.timestamp).toLocaleDateString()}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_SUGGESTIONS = [
  "Should PMs write code in the AI era?",
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
  const [showInterjectModal, setShowInterjectModal] = useState(false);

  const [visibleTurns, setVisibleTurns] = useState<DebateTurn[]>([]);
  const turnQueueRef = useRef<DebateTurn[]>([]);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [latestTurnIdx, setLatestTurnIdx] = useState<number | null>(null);

  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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
          headers: { "Content-Type": "application/json" },
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
                    saveDebate({
                      id: Date.now().toString(),
                      question,
                      guestNames: panel.map((g) => g.name),
                      timestamp: Date.now(),
                      turns: allTurns,
                    });
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
    setError(null);
    setCurrentSpeaker(null);
    setIsStreaming(false);
    setShowInterjectModal(false);
  }, []);

  const handleRestorePast = useCallback((d: SavedDebate) => {
    setQuestion(d.question);
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
      {/* ── Interject modal ── */}
      {showInterjectModal && (
        <InterjectModal
          onSubmit={(text) => startDebate(text)}
          onClose={() => setShowInterjectModal(false)}
        />
      )}

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

            {/* Past debates */}
            <PastDebatesRow onRestore={handleRestorePast} />

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
              {isStreaming && visibleTurns.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse pl-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                  The debate is starting...
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Summary card — shown when done */}
            {state === "done" && (
              <SummaryCard
                question={question}
                panel={panel}
                turns={visibleTurns}
                onNewDebate={handleReset}
              />
            )}

            {/* Interject button — always active once turns arrive, even during streaming */}
            {showInterjectButton && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setShowInterjectModal(true)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium border border-primary/40 text-primary hover:bg-primary/10 hover:border-primary/60 transition-all"
                  data-testid="button-interject"
                >
                  <MessageSquarePlus size={14} />
                  Interject
                </button>
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
          AI representations grounded in publicly available podcast transcripts.
          Not affiliated with the guests or Lenny's Newsletter.
        </p>
      </footer>
    </div>
  );
}
