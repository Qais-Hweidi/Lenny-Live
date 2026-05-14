import { Router, type IRouter, type Request, type Response } from "express";
import { loadEmbeddings, getIdf, getTopChunksByGuest, embed } from "../lib/embeddings.js";
import { chat } from "../lib/openrouter.js";
import { getGuestColor, resetColors, buildPersonaContext } from "../lib/personas.js";
import fs from "fs";
import path from "path";

function resolveDataDir(): string {
  const cwd = process.cwd();
  const local = path.join(cwd, "data");
  if (fs.existsSync(path.join(local, "index.json"))) return local;
  return path.join(cwd, "artifacts/api-server/data");
}
const INDEX_FILE = path.join(resolveDataDir(), "index.json");

interface IndexEntry {
  title: string;
  filename: string;
  word_count: number;
  date: string;
  description: string;
  guest: string;
  post_url?: string;
}

interface Index {
  podcasts: IndexEntry[];
  newsletters: IndexEntry[];
}

const router: IRouter = Router();

function getEpisodeFromFilename(filename: string): string {
  return path.basename(filename, ".md");
}

const FEATURED_GUESTS = new Set([
  "Marc Andreessen",
  "Ben Horowitz",
  "Evan Spiegel",
  "Melanie Perkins",
  "Stewart Butterfield",
  "Dr. Fei Fei Li",
  "Brian Halligan",
  "Keith Rabois",
  "Jason M Lemkin",
  "Howie Liu",
]);

router.get("/guests", (_req: Request, res: Response) => {
  try {
    const index: Index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
    const guests = index.podcasts
      .map((p) => ({
        name: p.guest,
        filename: p.filename,
        title: p.title,
      }))
      .filter((g) => FEATURED_GUESTS.has(g.name));
    res.json({ guests });
  } catch (err) {
    res.status(500).json({ error: "Failed to load guest list" });
  }
});

router.post("/panel", async (req: Request, res: Response) => {
  const byokKey = req.headers["x-openrouter-key"] as string | undefined;
  try {
    const { question, panelSize = 3 } = req.body as {
      question: string;
      panelSize?: number;
    };

    if (!question?.trim()) {
      res.status(400).json({ error: "question is required" });
      return;
    }

    const size = Math.min(Math.max(Number(panelSize) || 3, 2), 3);
    const chunks = loadEmbeddings();
    const idf = getIdf();
    // Use dense cosine retrieval when embeddings.json is available,
    // otherwise fall back to BM25 automatically inside getTopChunksByGuest.
    const queryEmbedding = await embed(question);
    const topByGuest = getTopChunksByGuest(queryEmbedding, chunks, 5, question, idf);

    // Get top guests by their best chunk score
    const guestScores: { guest: string; topScore: number }[] = [];
    for (const [guest, guestChunks] of topByGuest) {
      const topScore = guestChunks[0]?.score ?? 0;
      if (topScore > 0) {
        guestScores.push({ guest, topScore });
      }
    }
    guestScores.sort((a, b) => b.topScore - a.topScore);
    const topCandidates = guestScores.slice(0, 8);

    if (topCandidates.length < 2) {
      res.status(500).json({ error: "Not enough relevant guests found for this question" });
      return;
    }

    // Get stance summaries for ALL candidates in parallel
    const stanceSummaries = await Promise.all(
      topCandidates.map(async ({ guest }) => {
        const guestChunks = topByGuest.get(guest)!;
        const context = buildPersonaContext(guest, guestChunks);
        const stance = await chat("mistralai/mistral-large", [
          {
            role: "user",
            content: `Based on these excerpts from ${guest}'s podcast appearance with Lenny Rachitsky, write ONE sentence (max 25 words) summarizing their specific stance on this question: "${question}"\n\nExcerpts:\n${context}\n\nRespond with only the one-sentence stance, no preamble.`,
          },
        ], undefined, byokKey);
        return { guest, stance: stance.trim(), chunks: guestChunks };
      })
    );

    // Pick the most opposing guests
    const stanceList = stanceSummaries
      .map((s, i) => `${i + 1}. ${s.guest}: "${s.stance}"`)
      .join("\n");

    const selectionPrompt = `You are selecting a debate panel. Pick ${size} guests from this list whose stances on "${question}" are most DIVERGENT and would create the most interesting debate.\n\nCandidates:\n${stanceList}\n\nReturn ONLY a JSON array of the guest names in the order they should appear, e.g. ["Name A", "Name B", "Name C"]. No other text.`;

    const selectionRaw = await chat("mistralai/mistral-large", [
      { role: "user", content: selectionPrompt },
    ], undefined, byokKey);

    let selectedNames: string[];
    try {
      const match = selectionRaw.match(/\[[\s\S]*\]/);
      selectedNames = JSON.parse(match ? match[0] : selectionRaw);
    } catch {
      selectedNames = stanceSummaries.slice(0, size).map((s) => s.guest);
    }

    resetColors();
    const guests = selectedNames.slice(0, size).map((name) => {
      const summary = stanceSummaries.find((s) => s.guest === name) ?? stanceSummaries[0];
      const topChunk = summary.chunks[0];
      return {
        name,
        stance: summary.stance,
        episode: topChunk ? getEpisodeFromFilename(topChunk.filename) : "unknown",
        title: topChunk?.title ?? "",
        timestamp: topChunk?.timestamp ?? "00:00",
        color: getGuestColor(name),
        relevantChunks: summary.chunks.slice(0, 3).map((c) => c.text),
      };
    });

    res.json({ guests });
  } catch (err) {
    console.error("Panel selection error:", err);
    res.status(500).json({ error: String(err) });
  }
});

router.post("/panel/manual", async (req: Request, res: Response) => {
  const byokKey = req.headers["x-openrouter-key"] as string | undefined;
  try {
    const { question, guestNames } = req.body as {
      question: string;
      guestNames: string[];
    };

    if (!question?.trim() || !guestNames?.length) {
      res.status(400).json({ error: "question and guestNames are required" });
      return;
    }

    const chunks = loadEmbeddings();
    const idf = getIdf();
    const queryEmbedding = await embed(question);
    const topByGuest = getTopChunksByGuest(queryEmbedding, chunks, 5, question, idf);

    resetColors();
    const guests = await Promise.all(
      guestNames.slice(0, 3).map(async (name) => {
        const guestChunks = topByGuest.get(name);
        if (!guestChunks || guestChunks.length === 0) {
          return {
            name,
            stance: "Has shared perspectives on this topic.",
            episode: "unknown",
            title: "",
            timestamp: "00:00",
            color: getGuestColor(name),
            relevantChunks: [] as string[],
          };
        }
        const context = buildPersonaContext(name, guestChunks);
        const stance = await chat("mistralai/mistral-large", [
          {
            role: "user",
            content: `Based on these excerpts from ${name}'s podcast with Lenny Rachitsky, write ONE sentence (max 25 words) summarizing their specific stance on: "${question}"\n\nExcerpts:\n${context}\n\nRespond with only the one-sentence stance.`,
          },
        ], undefined, byokKey);
        const topChunk = guestChunks[0];
        return {
          name,
          stance: stance.trim(),
          episode: topChunk ? path.basename(topChunk.filename, ".md") : "unknown",
          title: topChunk?.title ?? "",
          timestamp: topChunk?.timestamp ?? "00:00",
          color: getGuestColor(name),
          relevantChunks: guestChunks.slice(0, 3).map((c) => c.text),
        };
      })
    );

    res.json({ guests });
  } catch (err) {
    console.error("Manual panel error:", err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
