/**
 * build-index.ts
 * One-time script: reads all podcast/newsletter markdown files, chunks them,
 * computes TF-IDF weights for BM25 search, saves to text-index.json.
 *
 * No API calls needed — purely local computation.
 *
 * Usage: pnpm --filter scripts run build-index
 *   or:  npx tsx scripts/src/build-index.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "artifacts/api-server/data");
const OUTPUT_FILE = path.join(DATA_DIR, "text-index.json");

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

interface ChunkRecord {
  guest: string;
  filename: string;
  episode: string;
  title: string;
  timestamp: string;
  text: string;
  tfidf: Record<string, number>;
}

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

function estimateTimestamp(chunkIndex: number, totalChunks: number): string {
  const totalSeconds = 60 * 60;
  const seconds = Math.floor((chunkIndex / totalChunks) * totalSeconds);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function stripFrontmatter(content: string): string {
  if (content.startsWith("---")) {
    const end = content.indexOf("---", 3);
    if (end !== -1) return content.slice(end + 3).trim();
  }
  return content;
}

function chunkText(text: string, chunkWords = 350, overlapWords = 75): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkWords, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
    start = end - overlapWords;
  }
  return chunks.filter((c) => c.trim().length > 50);
}

async function main() {
  console.log("Loading index...");
  const index: Index = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "index.json"), "utf-8")
  );

  const rawChunks: Omit<ChunkRecord, "tfidf">[] = [];

  for (const entry of [...index.podcasts, ...index.newsletters]) {
    const filePath = path.join(DATA_DIR, entry.filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`Missing file: ${filePath}`);
      continue;
    }
    const rawContent = fs.readFileSync(filePath, "utf-8");
    const content = stripFrontmatter(rawContent);
    const chunks = chunkText(content);
    const guestName = entry.guest ?? path.basename(entry.filename, ".md");
    console.log(`  ${guestName}: ${chunks.length} chunks`);
    chunks.forEach((text, i) => {
      rawChunks.push({
        guest: guestName,
        filename: entry.filename,
        episode: path.basename(entry.filename, ".md"),
        title: entry.title,
        timestamp: estimateTimestamp(i, chunks.length),
        text,
      });
    });
  }

  console.log(`\nTotal chunks: ${rawChunks.length}`);
  console.log("Computing TF-IDF...");

  // Compute TF for each chunk
  const tokenizedChunks = rawChunks.map((c) => tokenize(c.text));

  // Compute IDF across all chunks
  const N = rawChunks.length;
  const dfMap: Record<string, number> = {};
  for (const tokens of tokenizedChunks) {
    const seen = new Set(tokens);
    for (const t of seen) {
      dfMap[t] = (dfMap[t] ?? 0) + 1;
    }
  }

  const idfMap: Record<string, number> = {};
  for (const [term, df] of Object.entries(dfMap)) {
    idfMap[term] = Math.log((N - df + 0.5) / (df + 0.5) + 1);
  }

  // Build chunks with TF maps (drop zero-IDF terms to save space)
  const chunks: ChunkRecord[] = rawChunks.map((chunk, i) => {
    const tf = computeTF(tokenizedChunks[i]);
    // Only keep terms with meaningful IDF (drops very common words)
    const tfidf: Record<string, number> = {};
    for (const [term, weight] of Object.entries(tf)) {
      if ((idfMap[term] ?? 0) > 0.1) {
        tfidf[term] = weight;
      }
    }
    return { ...chunk, tfidf };
  });

  const result = { chunks, idf: idfMap };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result));
  const sizeMB = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`\nSaved to ${OUTPUT_FILE} (${sizeMB} MB)`);
  console.log("Done! No API keys required.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
