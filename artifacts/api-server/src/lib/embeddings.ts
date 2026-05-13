import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const TEXT_INDEX_FILE = path.join(DATA_DIR, "text-index.json");
const EMBEDDINGS_FILE = path.join(DATA_DIR, "embeddings.json");

export interface EmbeddingChunk {
  guest: string;
  filename: string;
  episode: string;
  title: string;
  timestamp: string;
  text: string;
  /** Sparse TF-IDF term weights (BM25 fallback) */
  tfidf?: Record<string, number>;
  /** Dense vector embedding — cosine-comparable (L2-normalised) */
  embedding?: number[];
}

interface StoredEmbeddings {
  model: string;
  dims: number;
  vocabSize?: number;
  seed?: number;
  description?: string;
  chunks: EmbeddingChunk[];
}

// ── Caches ────────────────────────────────────────────────────────────────────

let cachedChunks: EmbeddingChunk[] | null = null;
let idfMap: Record<string, number> | null = null;
let embeddingsByGuest: Map<string, EmbeddingChunk[]> | null = null;
let embeddingsAvailable = false;

// ── Tokeniser ─────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

// ── Loaders ───────────────────────────────────────────────────────────────────

export function loadEmbeddings(): EmbeddingChunk[] {
  if (cachedChunks) return cachedChunks;

  if (!fs.existsSync(TEXT_INDEX_FILE)) {
    throw new Error("text-index.json not found. Run build-index first.");
  }

  const stored = JSON.parse(fs.readFileSync(TEXT_INDEX_FILE, "utf-8")) as {
    chunks: EmbeddingChunk[];
    idf: Record<string, number>;
  };
  cachedChunks = stored.chunks;
  idfMap = stored.idf;

  // Load dense embeddings if available
  if (fs.existsSync(EMBEDDINGS_FILE)) {
    try {
      const embData = JSON.parse(
        fs.readFileSync(EMBEDDINGS_FILE, "utf-8"),
      ) as StoredEmbeddings;
      embeddingsByGuest = new Map();
      for (const chunk of embData.chunks) {
        if (!embeddingsByGuest.has(chunk.guest)) {
          embeddingsByGuest.set(chunk.guest, []);
        }
        embeddingsByGuest.get(chunk.guest)!.push(chunk);
      }
      embeddingsAvailable = true;
      console.log(
        `[embeddings] Loaded ${embData.chunks.length} dense vectors (${embData.model}, ${embData.dims}d) across ${embeddingsByGuest.size} guests.`,
      );
    } catch (err) {
      console.warn(
        "[embeddings] Failed to parse embeddings.json, falling back to BM25:",
        err,
      );
    }
  } else {
    console.log(
      "[embeddings] embeddings.json not found — using BM25 retrieval. " +
        "Run `pnpm --filter @workspace/scripts run build-embeddings` to generate dense vectors.",
    );
  }

  return cachedChunks;
}

export function getIdf(): Record<string, number> {
  if (!idfMap) loadEmbeddings();
  return idfMap!;
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── BM25 scorer ───────────────────────────────────────────────────────────────

export function scoreBM25(
  queryTokens: string[],
  chunk: EmbeddingChunk,
  idf: Record<string, number>,
): number {
  const k1 = 1.5;
  const b = 0.75;
  const avgDL = 300;
  const tf = chunk.tfidf ?? {};
  const dl =
    Object.values(tf).reduce((a, v) => a + v, 0) *
    (chunk.text.split(/\s+/).length || 300);

  let score = 0;
  const seen = new Set<string>();
  for (const term of queryTokens) {
    if (seen.has(term)) continue;
    seen.add(term);
    const termTF = (tf[term] ?? 0) * (chunk.text.split(/\s+/).length || 300);
    const idfScore = idf[term] ?? 0;
    const bm25num = termTF * (k1 + 1);
    const bm25den = termTF + k1 * (1 - b + b * (dl / avgDL));
    score += idfScore * (bm25num / bm25den);
  }
  return score;
}

// ── OpenRouter client for query-time embeddings ───────────────────────────────

import OpenAI from "openai";

const EMBED_MODEL = "openai/text-embedding-3-small";

let _openrouterClient: OpenAI | null = null;

function getOpenRouterClient(): OpenAI | null {
  if (_openrouterClient) return _openrouterClient;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  _openrouterClient = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
  return _openrouterClient;
}

function l2normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/**
 * Embeds a query string using the same OpenRouter model used to build
 * embeddings.json (openai/text-embedding-3-small).
 * Returns [] when the API key is missing or the API is unavailable, allowing
 * the caller to fall back to BM25 retrieval.
 */
export async function embed(text: string): Promise<number[]> {
  if (!embeddingsAvailable) return [];
  const client = getOpenRouterClient();
  if (!client) {
    console.warn("[embeddings] OPENROUTER_API_KEY not set — BM25 fallback.");
    return [];
  }
  try {
    const response = await client.embeddings.create({
      model: EMBED_MODEL,
      input: text,
    });
    return l2normalize(response.data[0].embedding);
  } catch (err) {
    console.warn("[embeddings] embed() failed, BM25 fallback:", err);
    return [];
  }
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

export function getTopChunksByGuest(
  queryEmbedding: number[],
  chunks: EmbeddingChunk[],
  topKPerGuest = 5,
  query?: string,
  idf?: Record<string, number>,
): Map<string, (EmbeddingChunk & { score: number })[]> {
  // Dense cosine path
  if (embeddingsAvailable && embeddingsByGuest && queryEmbedding.length > 0) {
    const result = new Map<string, (EmbeddingChunk & { score: number })[]>();
    for (const [guest, guestChunks] of embeddingsByGuest) {
      const scored = guestChunks
        .map((c) => ({
          ...c,
          score: c.embedding
            ? cosineSimilarity(queryEmbedding, c.embedding)
            : 0,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topKPerGuest);
      result.set(guest, scored);
    }
    return result;
  }

  // BM25 fallback
  const queryTokens = query ? tokenize(query) : [];
  const scored: (EmbeddingChunk & { score: number })[] = chunks.map((c) => ({
    ...c,
    score:
      queryTokens.length > 0 && idf ? scoreBM25(queryTokens, c, idf) : 0,
  }));

  const byGuest = new Map<string, (EmbeddingChunk & { score: number })[]>();
  for (const chunk of scored) {
    if (!byGuest.has(chunk.guest)) byGuest.set(chunk.guest, []);
    byGuest.get(chunk.guest)!.push(chunk);
  }

  const result = new Map<string, (EmbeddingChunk & { score: number })[]>();
  for (const [guest, guestChunks] of byGuest) {
    result.set(
      guest,
      guestChunks.sort((a, b) => b.score - a.score).slice(0, topKPerGuest),
    );
  }
  return result;
}

export function searchByQuery(
  query: string,
  chunks: EmbeddingChunk[],
  idf: Record<string, number>,
  topK = 50,
): (EmbeddingChunk & { score: number })[] {
  const queryTokens = tokenize(query);
  return chunks
    .map((chunk) => ({ ...chunk, score: scoreBM25(queryTokens, chunk, idf) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
