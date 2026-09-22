/**
 * The arena's ASCII art.
 *
 * Every block here is rectangular: each line is exactly as long as the others.
 * That is what lets the renderer shade a piece row by row without its edges
 * going ragged, and it is why these are generated rather than typed by hand.
 */

/** The amphitheatre: the outer wall still standing on one side, fallen on the other. */
export const COLOSSEUM_ART = [
  "  .          ·             .             ·          .       ·     ",
  "   ╷     ╷     ╷     ╷     ╷     ╷     ╷                          ",
  " ╭───────────────────────────────────────╮                        ",
  "╭╯ ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐ ╰╮                       ",
  "│  │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │  │╭─────────────────────╮",
  "│  ├──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┤  ││ ┌──┬──┬──┬──┬──┬──┐ │",
  "│  │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │  ││ │∩ │∩ │∩ │∩ │∩ │∩ │ │",
  "│  ├──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┤  ││ ├──┼──┼──┼──┼──┼──┤ │",
  "│  │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │  ││ │∩ │∩ │∩ │∩ │∩ │∩ │ │",
  "│  ├──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┤  ││ ├──┼──┼──┼──┼──┼──┤ │",
  "│  │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │  ││ │∩ │∩ │∩ │∩ │∩ │∩ │ │",
  "╰──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──╯╰─┴──┴──┴──┴──┴──┴──┴─╯",
  "░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░",
  " ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ ",
].join('\n');

/** The same ruin, for screens that cannot spare fourteen rows. */
export const COLOSSEUM_SMALL = [
  "  .          ·             .             ·      ",
  "   ╷     ╷     ╷     ╷     ╷                    ",
  " ╭───────────────────────────╮                  ",
  "╭╯ ┌──┬──┬──┬──┬──┬──┬──┬──┐ ╰╮                 ",
  "│  │▯ │▯ │▯ │▯ │▯ │▯ │▯ │▯ │  │╭───────────────╮",
  "│  ├──┼──┼──┼──┼──┼──┼──┼──┤  ││ ┌──┬──┬──┬──┐ │",
  "│  │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │  ││ │∩ │∩ │∩ │∩ │ │",
  "│  ├──┼──┼──┼──┼──┼──┼──┼──┤  ││ ├──┼──┼──┼──┤ │",
  "│  │∩ │∩ │∩ │∩ │∩ │∩ │∩ │∩ │  ││ │∩ │∩ │∩ │∩ │ │",
  "╰──┴──┴──┴──┴──┴──┴──┴──┴──┴──╯╰─┴──┴──┴──┴──┴─╯",
  "░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░",
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

/** A skull, for the one who is not still standing. */
export const SKULL = [
  "    .-\"\"\"\"\"\"\"-.    ",
  "   .'         '.   ",
  "  /  .-.   .-.  \\  ",
  "  | ( o ) ( o ) |  ",
  "  |      ^      |  ",
  "  |  '._____.'  |  ",
  "  \\   |||||||   /  ",
  "   '.._______..'   ",
  "    '-._____.-'    ",
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

/** A rule with turned ends, for framing a panel. */
export function ornateRule(width: number, mark = '✦'): string {
  if (width < 9) return rule(width, mark);
  const inner = rule(width - 4, mark);
  return `╺─${inner}─╸`;
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
