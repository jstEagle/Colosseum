import { Box, Text } from 'ink';
import { Art } from './Art.js';
import { Picture, fitPicture } from './Picture.js';
import { TITLE, WORDMARK, rule } from '../ascii.js';
import { theme } from '../theme.js';

interface Props {
  /** Rows the whole plate may take. The picture gets whatever is left. */
  rows: number;
  cols: number;
  subtitle?: string;
}

const TITLE_WIDTH = TITLE.split('\n')[0].length;

/** Rows the plate needs besides the picture: wordmark, rule, subtitle. */
function chrome(cols: number, subtitle?: string) {
  const title = cols >= TITLE_WIDTH + 2 ? 6 : 1;
  return title + 1 + (subtitle ? 2 : 0);
}

/**
 * The title plate: the amphitheatre in dithered light, the wordmark beneath
 * it, and a line of subtitle. Everything shrinks, then drops away, rather
 * than overflowing a small terminal.
 */
export function Backdrop({ rows, cols, subtitle }: Props) {
  const reserved = chrome(cols, subtitle);
  const pic = fitPicture('colosseum', cols - 2, rows - reserved);
  const bigTitle = cols >= TITLE_WIDTH + 2 && rows >= reserved;

  return (
    <Box flexDirection="column" alignItems="center">
      {pic ? <Picture name="colosseum" maxCols={cols - 2} maxRows={rows - reserved} /> : null}
      {bigTitle ? (
        <Art art={TITLE} from={0} to={5} />
      ) : (
        <Text color={theme.white} bold>
          {WORDMARK}
        </Text>
      )}
      <Text color={theme.dim}>{rule(Math.min(44, cols - 4), '✦')}</Text>
      {subtitle ? (
        <Box marginTop={1}>
          <Text color={theme.faint}>{subtitle}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** How many rows a Backdrop will actually use, for callers laying out around it. */
export function backdropHeight(rows: number, cols: number, subtitle?: string): number {
  const reserved = chrome(cols, subtitle);
  const pic = fitPicture('colosseum', cols - 2, rows - reserved);
  return (pic?.rows ?? 0) + reserved;
}
