/**
 * build-embeddings.ts
 *
 * Generates dense vector embeddings for transcript chunks using TF-IDF
 * weighted random projections (Johnson-Lindenstrauss transform).  This is a
 * standard dimensionality-reduction technique that produces real cosine-
 * comparable dense vectors from sparse bag-of-words representations without
 * any API calls or native binaries.
 *
 * Pipeline:
 *   1. Load the BM25 sparse index (text-index.json, 3165 chunks).
 *   2. Build a vocabulary of the top-N terms by IDF weight.
 *   3. Derive a deterministic random projection matrix R ∈ R^{vocab × dims}
 *      (seeded, so the same matrix is produced on every run).
 *   4. For each chunk, compute the TF-IDF sparse vector, project it to
 *      R^{dims}, and L2-normalise — yielding cosine-comparable dense vectors.
 *   5. Save to artifacts/api-server/data/embeddings.json.
 *
 * Runtime: ~10 seconds for all 3165 chunks (pure JS, no native deps).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run build-embeddings
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const INDEX_FILE = path.join(ROOT, "artifacts/api-server/data/text-index.json");
const OUTPUT_FILE = path.join(
  ROOT,
  "artifacts/api-server/data/embeddings.json",
);

// ── Config ────────────────────────────────────────────────────────────────────

const DIMS = 256;          // output embedding dimensionality
const VOCAB_SIZE = 4096;   // top terms by IDF to include in projection
const SEED = 0xdeadbeef;   // deterministic RNG seed

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawChunk {
  guest: string;
  filename: string;
  episode: string;
  title: string;
  timestamp: string;
  text: string;
  tfidf?: Record<string, number>;
}

export interface EmbeddedChunk extends RawChunk {
  embedding: number[];
}

// ── Deterministic PRNG (xorshift32) ──────────────────────────────────────────

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Box-Muller: returns a standard normal sample using two uniform draws. */
function sampleNormal(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-10);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ── Random projection matrix ──────────────────────────────────────────────────

/**
 * Builds a Gaussian random projection matrix R of shape [vocabSize × dims].
 * Each column is independently drawn from N(0, 1/dims) so that the projection
 * approximately preserves dot products (JL lemma).
 */
function buildProjectionMatrix(
  vocabSize: number,
  dims: number,
  seed: number,
): Float32Array {
  const rng = makeRng(seed);
  const scale = 1 / Math.sqrt(dims);
  const mat = new Float32Array(vocabSize * dims);
  for (let i = 0; i < vocabSize * dims; i++) {
    mat[i] = sampleNormal(rng) * scale;
  }
  return mat;
}

// ── Projection + L2 normalisation ────────────────────────────────────────────

function project(
  sparse: Record<string, number>,
  vocab: string[],
  vocabIndex: Map<string, number>,
  projMatrix: Float32Array,
  dims: number,
): number[] {
  const dense = new Float32Array(dims);

  for (const [term, weight] of Object.entries(sparse)) {
    const idx = vocabIndex.get(term);
    if (idx === undefined) continue;
    const rowOffset = idx * dims;
    for (let d = 0; d < dims; d++) {
      dense[d] += weight * projMatrix[rowOffset + d];
    }
  }

  // L2 normalise
  let norm = 0;
  for (let d = 0; d < dims; d++) norm += dense[d] * dense[d];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let d = 0; d < dims; d++) dense[d] /= norm;
  }

  return Array.from(dense);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Loading text-index.json…");
  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error(`Not found: ${INDEX_FILE}. Run build-index first.`);
  }

  const stored = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8")) as {
    chunks: RawChunk[];
    idf: Record<string, number>;
  };

  const { chunks, idf } = stored;
  console.log(`  ${chunks.length} chunks, ${Object.keys(idf).length} IDF terms`);

  // Select the top-VOCAB_SIZE terms by IDF weight
  const sortedTerms = Object.entries(idf)
    .sort(([, a], [, b]) => b - a)
    .slice(0, VOCAB_SIZE)
    .map(([t]) => t);

  const vocabIndex = new Map(sortedTerms.map((t, i) => [t, i]));
  const vocabSize = sortedTerms.length;
  console.log(`  Vocabulary: ${vocabSize} terms (top by IDF)`);

  console.log(`Building ${vocabSize}×${DIMS} random projection matrix (seed ${SEED.toString(16)})…`);
  const projMatrix = buildProjectionMatrix(vocabSize, DIMS, SEED);

  console.log(`Embedding ${chunks.length} chunks…`);
  const embedded: EmbeddedChunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const sparse = chunk.tfidf ?? {};
    const embedding = project(sparse, sortedTerms, vocabIndex, projMatrix, DIMS);
    embedded.push({ ...chunk, embedding });

    if ((i + 1) % 500 === 0) {
      process.stdout.write(`  ${i + 1}/${chunks.length}\r`);
    }
  }

  console.log(`\nAll ${embedded.length} chunks embedded.`);

  const out = {
    model: "tfidf-random-projection-jl",
    dims: DIMS,
    vocabSize,
    seed: SEED,
    description:
      "TF-IDF weighted Gaussian random projection (Johnson-Lindenstrauss). " +
      "Vectors are L2-normalised; dot product equals cosine similarity.",
    chunks: embedded,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out));
  const bytes = fs.statSync(OUTPUT_FILE).size;
  console.log(`Saved → ${OUTPUT_FILE} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
