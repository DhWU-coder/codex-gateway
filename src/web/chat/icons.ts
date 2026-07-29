import type { IconNode, SVGProps } from "lucide";

const SAFE_TAGS = new Set([
  "circle",
  "ellipse",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
]);

const SAFE_ATTRIBUTES = new Set([
  "cx",
  "cy",
  "d",
  "fill",
  "height",
  "opacity",
  "points",
  "r",
  "rx",
  "ry",
  "stroke",
  "stroke-width",
  "transform",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
]);

export function renderWebChatIcon(
  icon: IconNode,
  className = "button-icon"
): string {
  const children = icon.map(renderNode).join("");
  return `<svg class="${escapeAttribute(className)}" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${children}</svg>`;
}

function renderNode([tag, attributes]: [string, SVGProps]): string {
  if (!SAFE_TAGS.has(tag)) {
    throw new Error(`不支持的 Lucide SVG 标签：${tag}`);
  }
  const serialized = Object.entries(attributes)
    .filter(
      (entry): entry is [string, string | number] =>
        SAFE_ATTRIBUTES.has(entry[0]) && entry[1] !== undefined
    )
    .map(([name, value]) => `${name}="${escapeAttribute(String(value))}"`)
    .join(" ");
  return serialized ? `<${tag} ${serialized}></${tag}>` : `<${tag}></${tag}>`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}
