// Round category badges (emoji on the category colour) for MapLibre maps, drawn to a canvas.
// Image ids encode what to draw ("b|🍸|#9333ea|1"), so a map can redraw them itself after a style switch.
import type { Map as MLMap } from "maplibre-gl";

export const badgeId = (emoji: string, color: string, star = false) => `b|${emoji}|${color}|${star ? 1 : 0}`;

export function drawBadge(emoji: string, color: string, star: boolean): ImageData {
  const ratio = 2;
  const size = 34 * ratio;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = size / 2;
  g.shadowColor = "rgba(0,0,0,.28)";
  g.shadowBlur = 3 * ratio;
  g.fillStyle = star ? "#f5a524" : "#ffffff";
  g.beginPath(); g.arc(r, r, r - 2 * ratio, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  g.fillStyle = color;
  g.beginPath(); g.arc(r, r, r - (star ? 5 : 4) * ratio, 0, Math.PI * 2); g.fill();
  g.font = `${17 * ratio}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, r, r + 1.5 * ratio);
  return g.getImageData(0, 0, size, size);
}

export function ensureBadge(m: MLMap, emoji: string, color: string, star = false): string {
  const id = badgeId(emoji, color, star);
  if (!m.hasImage(id)) m.addImage(id, drawBadge(emoji, color, star), { pixelRatio: 2 });
  return id;
}

function addFromId(m: MLMap, id: string) {
  const [kind, emoji, color, star] = id.split("|");
  if (kind === "b" && emoji && color && !m.hasImage(id)) m.addImage(id, drawBadge(emoji, color, star === "1"), { pixelRatio: 2 });
}

/** Draw every badge a set of features needs (call before setData). */
export function ensureBadgeIds(m: MLMap, ids: Iterable<string>) {
  for (const id of new Set(ids)) addFromId(m, id);
}

/** Redraw badges the style doesn't have (e.g. after switching Detailed/Light/Night). */
export function autoBadges(m: MLMap) {
  const anyMap = m as unknown as { setMissingStyleImageResolver?: (fn: (id: string) => void) => void };
  // MapLibre 6 resolves missing images through a resolver; older versions fire "styleimagemissing".
  if (typeof anyMap.setMissingStyleImageResolver === "function") anyMap.setMissingStyleImageResolver((id) => addFromId(m, id));
  else m.on("styleimagemissing", (e: { id: string }) => addFromId(m, e.id));
}
