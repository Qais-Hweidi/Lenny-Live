import type { EmbeddingChunk } from "./embeddings.js";

export const GUEST_COLORS: Record<string, string> = {};

const COLOR_PALETTE = [
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#ec4899", // magenta/pink
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#f97316", // orange
  "#3b82f6", // blue
  "#ef4444", // red
];

let colorIndex = 0;
const assignedColors = new Map<string, string>();

export function getGuestColor(guestName: string): string {
  if (assignedColors.has(guestName)) return assignedColors.get(guestName)!;
  const color = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length];
  colorIndex++;
  assignedColors.set(guestName, color);
  return color;
}

export function resetColors(): void {
  colorIndex = 0;
  assignedColors.clear();
}

export function buildPersonaContext(
  guestName: string,
  chunks: EmbeddingChunk[]
): string {
  return chunks
    .slice(0, 5)
    .map((c, i) => `[Chunk ${i + 1} | ${c.episode} | ~${c.timestamp}]\n${c.text}`)
    .join("\n\n---\n\n");
}
