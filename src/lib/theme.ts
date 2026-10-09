/**
 * The accent palette of a workspace.
 *
 * `styles/app.css` draws everything interactive from five `--accent*` tokens.
 * The workspace's color is turned into those five, keeping its hue, with the
 * lightness fixed per role so that text on paper keeps its contrast whatever
 * was picked (a pale yellow would otherwise make unreadable links).
 */

const HEX = /^#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/;

function toHsl(hex: string): [number, number, number] {
  const n = Number.parseInt(hex, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

/** The CSS declarations that override the accent, or `""` for an invalid color. */
export function accentStyle(color: string | null | undefined): string {
  const match = color ? HEX.exec(color) : null;
  if (!match?.[1]) return "";
  const [h, s0] = toHsl(match[1]);
  const s = Math.min(Math.max(s0, 0.35), 0.9);
  // A grey stays grey: do not invent a hue out of nothing.
  const grey = s0 < 0.08;
  const sat = (value: number) => (grey ? 0 : value);
  return [
    `--accent:${hsl(h, sat(s), 0.4)}`,
    `--accent-ink:${hsl(h, sat(s), 0.28)}`,
    `--accent-wash:${hsl(h, sat(Math.min(s, 0.8)), 0.95)}`,
    `--accent-line:${hsl(h, sat(Math.min(s, 0.8)), 0.87)}`,
    `--accent-bright:${hsl(h, sat(s), 0.68)}`,
  ].join(";");
}
