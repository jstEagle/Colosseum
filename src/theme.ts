/**
 * Dark, minimal colour palette for the arena.
 * Colours are hex strings understood by Ink's <Text color> prop.
 */
export const theme = {
  bg: '#0a0a0b',
  dim: '#3a3a3f',
  faint: '#5a5a62',
  text: '#d7d7db',
  bright: '#f4f4f6',
  gold: '#d4af37',
  blood: '#b5303a',
  left: '#4aa3df', // cool blue gladiator
  right: '#e0603a', // warm ember gladiator
  win: '#5fbf6a',
  lose: '#8a3b40',
  accent: '#c9a227',
} as const;

export type SideColor = typeof theme.left | typeof theme.right;
