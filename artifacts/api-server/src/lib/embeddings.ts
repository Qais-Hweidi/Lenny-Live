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

// ── Query embedding (projects query to the same dense space) ─────────────────

/**
 * Projects a query string into the same dense embedding space used by
 * build-embeddings.ts (TF-IDF weighted random projection).  Returns [] when
 * embeddings.json has not been built yet.
 */
export async function embed(text: string): Promise<number[]> {
  if (!embeddingsAvailable || !embeddingsByGuest) return [];
  return projectQuery(text);
}

// Projection state (loaded lazily from embeddings.json metadata)
let _projMatrix: Float32Array | null = null;
let _vocabIndex: Map<string, number> | null = null;
let _dims = 256;
let _projReady = false;

function ensureProjectionLoaded(): boolean {
  if (_projReady) return true;
  if (!fs.existsSync(EMBEDDINGS_FILE)) return false;

  try {
    const embData = JSON.parse(
      fs.readFileSync(EMBEDDINGS_FILE, "utf-8"),
    ) as StoredEmbeddings & { vocabSize: number; seed: number };

    if (!embData.vocabSize || !embData.seed) return false;

    _dims = embData.dims;
    const seed = embData.seed;
    const vocabSize = embData.vocabSize;

    // Rebuild the same projection matrix with the same seed
    const scale = 1 / Math.sqrt(_dims);
    _projMatrix = new Float32Array(vocabSize * _dims);
    let s = seed >>> 0;
    const rng = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    for (let i = 0; i < vocabSize * _dims; i++) {
      const u1 = Math.max(rng(), 1e-10);
      const u2 = rng();
      _projMatrix[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * scale;
    }

    // Build vocab index from the first chunk's tfidf keys is not reliable.
    // Instead sort IDF map by weight (same as build-embeddings.ts) and take top vocabSize.
    if (idfMap) {
      const sorted = Object.entries(idfMap)
        .sort(([, a], [, b]) => b - a)
        .slice(0, vocabSize)
        .map(([t]) => t);
      _vocabIndex = new Map(sorted.map((t, i) => [t, i]));
      _projReady = true;
    }
  } catch {
    return false;
  }

  return _projReady;
}

function projectQuery(text: string): number[] {
  if (!ensureProjectionLoaded() || !_projMatrix || !_vocabIndex) return [];

  const tokens = tokenize(text);
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
  const total = tokens.length || 1;
  for (const t in tf) tf[t] /= total;

  const dense = new Float32Array(_dims);
  const idf = idfMap ?? {};

  for (const [term, tfVal] of Object.entries(tf)) {
    const idx = _vocabIndex.get(term);
    if (idx === undefined) continue;
    const weight = tfVal * (idf[term] ?? 0);
    const rowOffset = idx * _dims;
    for (let d = 0; d < _dims; d++) {
      dense[d] += weight * _projMatrix[rowOffset + d];
    }
  }

  let norm = 0;
  for (let d = 0; d < _dims; d++) norm += dense[d] * dense[d];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let d = 0; d < _dims; d++) dense[d] /= norm;

  return Array.from(dense);
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
