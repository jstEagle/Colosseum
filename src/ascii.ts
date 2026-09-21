/**
 * The arena's ASCII art.
 *
 * Every block here is rectangular: each line in a piece is exactly as long as
 * the others. That is what lets the renderer shade a piece row by row without
 * its edges going ragged, and it is why these are generated rather than typed.
 */

/** The amphitheatre: three arcaded tiers inside a tapering outer wall. */
export const COLOSSEUM_ART = [
  "      .      ·        ·       .         ·        ·      .       ",
  "       ╷      ╷      ╷      ╷      ╷      ╷      ╷      ╷       ",
  "   ╭──────────────────────────────────────────────────────────╮ ",
  " ╭╯                                                          ╰╮ ",
  "╭╯    ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐    ╰╮",
  "│     │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │     │",
  "│     ├──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┤     │",
  "│     │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │     │",
  "│     ├──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┤     │",
  "│     │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │     │",
  "╰─────┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴─────╯",
  "   ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁   ",
].join('\n');

/** A compact amphitheatre, for screens that cannot spare twelve rows. */
export const COLOSSEUM_SMALL = [
  "╭────────────────────────────────────────────╮",
  "╭╯ ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐ ╰╮",
  "│  │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │  │",
  "│  ├──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┤  │",
  "│  │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │  │",
  "╰──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──╯",
].join('\n');

/** The wordmark, six rows tall. */
export const TITLE = [
  " ██████╗ ██████╗ ██╗      ██████╗ ███████╗███████╗███████╗██╗   ██╗███╗   ███╗",
  "██╔════╝██╔═══██╗██║     ██╔═══██╗██╔════╝██╔════╝██╔════╝██║   ██║████╗ ████║",
  "██║     ██║   ██║██║     ██║   ██║███████╗███████╗█████╗  ██║   ██║██╔████╔██║",
  "██║     ██║   ██║██║     ██║   ██║╚════██║╚════██║██╔══╝  ██║   ██║██║╚██╔╝██║",
  "╚██████╗╚██████╔╝███████╗╚██████╔╝███████║███████║███████╗╚██████╔╝██║ ╚═╝ ██║",
  " ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝╚══════╝╚══════╝ ╚═════╝ ╚═╝     ╚═╝",
].join('\n');

/** The upper half of a wreath, for the one still standing. */
export const LAUREL = [
  "\\   \\    \\    |    /    /   /",
  " ╲   ╲    ╲   |   ╱    ╱   ╱ ",
  " ───────────  ✦  ─────────── ",
].join('\n');

/** The lower half of the same wreath. */
export const LAUREL_LOWER = [
  " ───────────  ✦  ─────────── ",
  " ╱   ╱    ╱   |   ╲    ╲   ╲ ",
  "/   /    /    |    \\    \\   \\",
].join('\n');

/** A skull, for the one who is not. */
export const SKULL = [
  "  .-\"\"\"\"\"\"\"-.  ",
  " /  _     _  \\ ",
  "|  (o)   (o)  |",
  "|      ∧      |",
  "|   '-----'   |",
  " \\  | | | |  / ",
  " '-.._____..-' ",
].join('\n');

/** Crossed blades, for a draw. */
export const CROSSED_SWORDS = [
  "╲╲               ╱╱",
  " ╲╲             ╱╱ ",
  "  ╲╲═══════════╱╱  ",
  "   ╳╳ ─────── ╳╳   ",
  "  ╱╱═══════════╲╲  ",
  " ╱╱             ╲╲ ",
  "╱╱               ╲╲",
].join('\n');

/** Letterspaced wordmark for places a six-row banner will not fit. */
export const WORDMARK = 'C O L O S S E U M';

/** A run of arches, sized to the screen, for headers and rules. */
export function arcade(width: number): string {
  if (width < 8) return '─'.repeat(Math.max(0, width));
  const bays = Math.floor((width - 2) / 2);
  const filler = width - 2 - bays * 2;
  return '╾' + '─∩'.repeat(bays) + '─'.repeat(Math.max(0, filler)) + '╼';
}

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
} as const;
