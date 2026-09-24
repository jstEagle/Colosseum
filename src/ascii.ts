/**
 * The arena's line art: the wordmark, ornaments, numerals and rules.
 *
 * Every block here is rectangular: each line is exactly as long as the others.
 * That is what lets the renderer shade a piece row by row without its edges
 * going ragged. The pictures — the amphitheatre and the statues — are
 * dithered from photographs instead; see art.generated.ts.
 */

/** The wordmark, six rows tall. */
export const TITLE = [
  " ██████╗ ██████╗ ██╗      ██████╗ ███████╗███████╗███████╗██╗   ██╗███╗   ███╗",
  "██╔════╝██╔═══██╗██║     ██╔═══██╗██╔════╝██╔════╝██╔════╝██║   ██║████╗ ████║",
  "██║     ██║   ██║██║     ██║   ██║███████╗███████╗█████╗  ██║   ██║██╔████╔██║",
  "██║     ██║   ██║██║     ██║   ██║╚════██║╚════██║██╔══╝  ██║   ██║██║╚██╔╝██║",
  "╚██████╗╚██████╔╝███████╗╚██████╔╝███████║███████║███████╗╚██████╔╝██║ ╚═╝ ██║",
  " ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝╚══════╝╚══════╝ ╚═════╝ ╚═╝     ╚═╝",
].join('\n');

/** Laurel leaves closing in from both sides, for the victor. */
export const LAUREL = [
  "(\\   (\\   (\\   (\\     ✦     /)   /)   /)   /)",
  " \\)   \\)   \\)   \\)         (/   (/   (/   (/ ",
].join('\n');

/** The same wreath, mirrored, to close beneath the name. */
export const LAUREL_LOWER = [
  " /)   /)   /)   /)         (\\   (\\   (\\   (\\ ",
  "(/   (/   (/   (/     ✦     \\)   \\)   \\)   \\)",
].join('\n');

/** Crossed gladii, for a draw. */
export const CROSSED_SWORDS = [
  "╭─╮               ╭─╮",
  "╰┬╯               ╰┬╯",
  " ╲╲               ╱╱ ",
  "   ╲╲           ╱╱   ",
  "     ╲╲       ╱╱     ",
  "       ╲╲   ╱╱       ",
  "         ╳╳          ",
  "        ╱╱ ╲╲        ",
  "      ╱╱     ╲╲      ",
  "     ▽         ▽     ",
].join('\n');

/** Block numerals for the countdown, five rows tall and six wide. */
export const NUMERALS: Record<string, string> = {
  '3': ['█████ ', '    ██', ' ████ ', '    ██', '█████ '].join('\n'),
  '2': ['█████ ', '    ██', ' ████ ', '██    ', '██████'].join('\n'),
  '1': ['  ██  ', ' ███  ', '  ██  ', '  ██  ', ' ████ '].join('\n'),
};

/** A three-row block alphabet, just the letters the verdicts need. */
const BLOCK: Record<string, string[]> = {
  A: ['▄▀▄', '█▀█', '█ █'],
  D: ['█▀▄', '█ █', '█▄▀'],
  E: ['█▀▀', '█▀ ', '█▄▄'],
  F: ['█▀▀', '█▀ ', '█  '],
  G: ['█▀▀', '█ ▄', '█▄█'],
  H: ['█ █', '█▀█', '█ █'],
  I: ['█', '█', '█'],
  L: ['█  ', '█  ', '█▄▄'],
  N: ['█▄ █', '█ ▀█', '█  █'],
  R: ['█▀▄', '█▀▄', '█ █'],
  S: ['█▀▀', '▀▀█', '▄▄█'],
  T: ['▀█▀', ' █ ', ' █ '],
  W: ['█   █', '█ █ █', '▀▄▀▄▀'],
  ' ': ['  ', '  ', '  '],
};

/** Set a word in the block alphabet, or null if a letter is missing. */
export function banner(text: string): string | null {
  const letters = text.toUpperCase().split('').map((c) => BLOCK[c]);
  if (letters.some((l) => !l)) return null;
  return [0, 1, 2].map((row) => letters.map((l) => l[row]).join(' ')).join('\n');
}

/** A bar that empties as the clock runs down. */
export function timeBar(width: number, fraction: number): { spent: string; left: string } {
  const n = Math.max(0, Math.min(width, Math.round(width * (1 - fraction))));
  return { left: '━'.repeat(n), spent: '─'.repeat(width - n) };
}

/** Letterspaced wordmark for places a six-row banner will not fit. */
export const WORDMARK = 'C O L O S S E U M';

/** A plain rule with a mark set into the middle, for section breaks. */
export function rule(width: number, mark = '·'): string {
  if (width < 5) return '─'.repeat(Math.max(0, width));
  const side = Math.floor((width - 3) / 2);
  return `${'─'.repeat(side)} ${mark} ${'─'.repeat(width - 3 - side)}`;
}

/** Gutter marks. In a monochrome arena these do the work colour used to. */
export const MARK = {
  reasoning: '┊',
  speech: '▏',
  command: '❯',
  result: '·',
  system: '✦',
  error: '✗',
  left: '◀',
  right: '▶',
  alive: '◆',
  dead: '✕',
  victor: '✦',
  stunned: '◌',
  idle: '◇',
  strike: '⚔',
  decoy: '◌',
  refused: '⊘',
  death: '✕',
} as const;
