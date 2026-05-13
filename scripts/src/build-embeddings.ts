/**
 * build-embeddings.ts
 *
 * Generates dense vector embeddings for all transcript chunks using the
 * OpenRouter embeddings API (mistral/mistral-embed).
 *
 * Pipeline:
 *   1. Load BM25 sparse index (text-index.json, 3165 chunks).
 *   2. Batch chunks and POST to https://openrouter.ai/api/v1/embeddings.
 *   3. Save each chunk's embedding alongside its metadata.
 *   4. Write artifacts/api-server/data/embeddings.json.
 *
 * Usage:
 *   OPENROUTER_API_KEY=<key> pnpm --filter @workspace/scripts run build-embeddings
 *
 * The generated file is consumed by the API server's cosine-similarity retrieval path.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const INDEX_FILE = path.join(ROOT, "artifacts/api-server/data/text-index.json");
const OUTPUT_FILE = path.join(ROOT, "artifacts/api-server/data/embeddings.json");

const MODEL = "openai/text-embedding-3-small";
const BATCH_SIZE = 32;
const DIMS = 1536; // text-embedding-3-small output dimensionality

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

// ── L2 normalise ─────────────────────────────────────────────────────────────

function l2normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

// ── Embed a batch of texts via OpenRouter ─────────────────────────────────────

async function embedBatch(
  client: OpenAI,
  texts: string[],
): Promise<number[][]> {
  const response = await client.embeddings.create({
    model: MODEL,
    input: texts,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => l2normalize(d.embedding));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is required.");
  }

  const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });

  console.log("Loading text-index.json…");
  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error(`Not found: ${INDEX_FILE}. Run build-index first.`);
  }

  const stored = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8")) as {
    chunks: RawChunk[];
    idf: Record<string, number>;
  };
  const { chunks } = stored;
  console.log(`  ${chunks.length} chunks loaded.`);

  const embedded: EmbeddedChunk[] = [];
  const total = chunks.length;

  console.log(`Embedding ${total} chunks in batches of ${BATCH_SIZE} (${MODEL})…`);

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.text);

    let vectors: number[][];
    try {
      vectors = await embedBatch(client, texts);
    } catch (err) {
      console.error(`\nBatch ${i}–${i + batch.length - 1} failed:`, err);
      process.exit(1);
    }

    for (let j = 0; j < batch.length; j++) {
      embedded.push({ ...batch[j], embedding: vectors[j] });
    }

    const done = Math.min(i + BATCH_SIZE, total);
    process.stdout.write(`  ${done}/${total}\r`);
  }

  console.log(`\nAll ${embedded.length} chunks embedded.`);

  const out = {
    model: MODEL,
    dims: DIMS,
    description:
      "L2-normalised dense embeddings from mistral/mistral-embed via OpenRouter. " +
      "Dot product equals cosine similarity.",
    chunks: embedded,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out));
  const bytes = fs.statSync(OUTPUT_FILE).size;
  console.log(
    `Saved → ${OUTPUT_FILE} (${(bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
