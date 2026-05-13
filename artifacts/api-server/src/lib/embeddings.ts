import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const INDEX_FILE = path.join(DATA_DIR, "text-index.json");

export interface EmbeddingChunk {
  guest: string;
  filename: string;
  episode: string;
  title: string;
  timestamp: string;
  text: string;
  // TF-IDF sparse vector stored as term->weight map for compact storage
  tfidf?: Record<string, number>;
  // Legacy support — unused but kept for type compat
  embedding?: number[];
}

let cachedChunks: EmbeddingChunk[] | null = null;
let idfMap: Record<string, number> | null = null;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function computeTF(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) {
    tf[t] = (tf[t] ?? 0) + 1;
  }
  const total = tokens.length || 1;
  for (const t in tf) tf[t] /= total;
  return tf;
}

export function loadEmbeddings(): EmbeddingChunk[] {
  if (cachedChunks) return cachedChunks;

  if (fs.existsSync(INDEX_FILE)) {
    const stored = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
    cachedChunks = stored.chunks;
    idfMap = stored.idf;
    return cachedChunks!;
  }

  throw new Error(
    "text-index.json not found. Run the build-index script first."
  );
}

export function getIdf(): Record<string, number> {
  if (!idfMap) loadEmbeddings();
  return idfMap!;
}

/**
 * BM25-style similarity between a query string and a chunk.
 * Returns a score in [0, 1].
 */
export function scoreBM25(queryTokens: string[], chunk: EmbeddingChunk, idf: Record<string, number>): number {
  const k1 = 1.5;
  const b = 0.75;
  const avgDL = 300; // approximate avg chunk length in tokens
  const tf = chunk.tfidf ?? {};
  const dl = Object.values(tf).reduce((a, v) => a + v, 0) * (chunk.text.split(/\s+/).length || 300);

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

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function embed(text: string): Promise<number[]> {
  // Not used in BM25 mode — returns placeholder
  return [];
}

export function searchByQuery(
  query: string,
  chunks: EmbeddingChunk[],
  idf: Record<string, number>,
  topK = 50
): (EmbeddingChunk & { score: number })[] {
  const queryTokens = tokenize(query);
  return chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreBM25(queryTokens, chunk, idf),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function getTopChunksByGuest(
  queryEmbedding: number[],
  chunks: EmbeddingChunk[],
  topKPerGuest = 5,
  query?: string,
  idf?: Record<string, number>
): Map<string, (EmbeddingChunk & { score: number })[]> {
  let scored: (EmbeddingChunk & { score: number })[];

  if (query && idf) {
    const queryTokens = tokenize(query);
    scored = chunks.map((chunk) => ({
      ...chunk,
      score: scoreBM25(queryTokens, chunk, idf),
    }));
  } else {
    scored = chunks.map((c) => ({ ...c, score: 0 }));
  }

  const byGuest = new Map<string, (EmbeddingChunk & { score: number })[]>();
  for (const chunk of scored) {
    if (!byGuest.has(chunk.guest)) byGuest.set(chunk.guest, []);
    byGuest.get(chunk.guest)!.push(chunk);
  }

  const result = new Map<string, (EmbeddingChunk & { score: number })[]>();
  for (const [guest, guestChunks] of byGuest) {
    result.set(
      guest,
      guestChunks.sort((a, b) => b.score - a.score).slice(0, topKPerGuest)
    );
  }
  return result;
}
