/**
 * The arena is lit by torchlight, not neon: everything is white through
 * charcoal, and emphasis comes from brightness, weight and glyphs rather
 * than hue. Colours are hex strings understood by Ink's <Text color> prop.
 */
export const theme = {
  bg: '#0a0a0b',

  // The greyscale ramp, brightest first.
  white: '#ffffff',
  bright: '#ededf0',
  text: '#c9c9d0',
  muted: '#a0a0a8',
  faint: '#78787f',
  dim: '#56565c',
  charcoal: '#3a3a3f',
  ghost: '#2a2a2e',

  // Semantic names kept from the coloured days, now all monochrome.
  gold: '#ededf0', // headings and ornament
  blood: '#ffffff', // alarm, carried by glyph and weight
  accent: '#a0a0a8',
  win: '#ffffff',
  lose: '#56565c',

  // The two gladiators are told apart by brightness and by their marks.
  left: '#ededf0',
  right: '#a0a0a8',
} as const;

/** Top-to-bottom shading for ASCII art, brightest first. */
export const RAMP = [
  '#ffffff',
  '#ededf0',
  '#d4d4da',
  '#b9b9c1',
  '#9d9da5',
  '#84848c',
  '#6c6c73',
  '#56565c',
  '#43434a',
] as const;

/** Pick a shade for row `i` of `n`, across a slice of the ramp. */
export function shade(i: number, n: number, from = 0, to = RAMP.length - 1): string {
  if (n <= 1) return RAMP[from];
  const t = i / (n - 1);
  const idx = Math.round(from + t * (to - from));
  return RAMP[Math.max(0, Math.min(RAMP.length - 1, idx))];
}

export type SideColor = typeof theme.left | typeof theme.right;
