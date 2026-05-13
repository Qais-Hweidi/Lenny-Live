import { Router, type IRouter, type Request, type Response } from "express";
import { loadEmbeddings, getIdf, getTopChunksByGuest } from "../lib/embeddings.js";
import { chatStream } from "../lib/openrouter.js";
import { buildPersonaContext } from "../lib/personas.js";
import path from "path";

const router: IRouter = Router();

interface DebateGuest {
  name: string;
  stance: string;
  episode: string;
  title: string;
  timestamp: string;
  color: string;
  relevantChunks?: string[];
}

interface DebateRequest {
  question: string;
  guests: DebateGuest[];
  interjection?: string;
}

router.post("/debate", async (req: Request, res: Response) => {
  const { question, guests, interjection } = req.body as DebateRequest;

  if (!question?.trim() || !guests?.length) {
    res.status(400).json({ error: "question and guests are required" });
    return;
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Get relevant context for each guest using BM25
    const chunks = loadEmbeddings();
    const idf = getIdf();
    const topByGuest = getTopChunksByGuest([], chunks, 5, question, idf);

    const guestContexts = guests.map((g) => {
      const guestChunks = topByGuest.get(g.name) ?? [];
      const context =
        g.relevantChunks?.length
          ? g.relevantChunks.map((t, i) => `[Chunk ${i + 1}]\n${t}`).join("\n\n---\n\n")
          : buildPersonaContext(g.name, guestChunks);
      return { guest: g, context };
    });

    const guestList = guests.map((g) => `"${g.name}"`).join(", ");
    const guestContextBlocks = guestContexts
      .map(
        ({ guest, context }) =>
          `=== ${guest.name} (color: ${guest.color}) ===\nKnown stance: ${guest.stance}\nReal transcript excerpts:\n${context}`
      )
      .join("\n\n");

    const interjectionBlock = interjection
      ? `\nMid-debate interjection from the audience: "${interjection}"\nLenny should acknowledge this and use it as his next follow-up question.\n`
      : "";

    const systemPrompt = `You are orchestrating a live debate between ${guestList} about: "${question}".

Lenny Rachitsky moderates in his real interviewing style — calm, probing, asks "but why" and "what would you tell a founder" follow-ups, surfaces tensions, stays curious.

Each panelist is grounded in real quotes from their podcast appearances:

${guestContextBlocks}
${interjectionBlock}
Rules:
- Produce exactly 7-8 debate turns total
- Lenny opens with a framing statement, then asks a probing follow-up at turn 3-4 and after turn 6
- Panelists MUST disagree at least twice — real intellectual tension
- When a panelist makes a strong claim grounded in their transcript, set source to that episode/timestamp
- If a turn cannot be grounded, set source to null — never fabricate a quote
- Keep each turn under 60 words
- Return ONLY a valid JSON array starting with [ and ending with ], one object per turn
- No markdown, no preamble, no explanation — pure JSON array

JSON format for each turn:
{
  "speaker": "Name",
  "text": "...",
  "color": "#hexcolor",
  "source": { "episode": "slug", "title": "Episode title", "timestamp": "MM:SS" } | null
}

Lenny's color is always "#e2e8f0". Use the exact colors provided for each panelist.`;

    const userMsg = interjection
      ? `Continue the debate incorporating this audience question: "${interjection}"`
      : `Start the debate now.`;

    const stream = await chatStream("anthropic/claude-3.5-haiku", [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMsg },
    ], { max_tokens: 4000 });

    let turnBuffer = "";
    let inArray = false;
    let depth = 0;

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? "";

      for (const char of token) {
        if (char === "[" && !inArray && depth === 0) {
          inArray = true;
          continue;
        }
        if (!inArray) continue;

        if (char === "{") {
          depth++;
          turnBuffer += char;
        } else if (char === "}") {
          depth--;
          turnBuffer += char;
          if (depth === 0) {
            try {
              const turn = JSON.parse(turnBuffer);
              sendEvent({ type: "turn", ...turn });
            } catch {
              // malformed partial — skip
            }
            turnBuffer = "";
          }
        } else if (depth > 0) {
          turnBuffer += char;
        }
      }
    }

    sendEvent({ type: "done" });
    res.end();
  } catch (err) {
    console.error("Debate stream error:", err);
    sendEvent({ type: "error", message: "Failed to generate debate" });
    res.end();
  }
});

export default router;
