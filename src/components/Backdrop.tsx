import { Box, Text } from 'ink';
import { Art } from './Art.js';
import { COLOSSEUM_ART, COLOSSEUM_SMALL, TITLE, rule } from '../ascii.js';
import { theme } from '../theme.js';

interface Props {
  showArt?: boolean;
  subtitle?: string;
  /** Rows available; the art shrinks rather than overflowing. */
  rows?: number;
}

/** The title plate: amphitheatre, wordmark, and a line of subtitle. */
export function Backdrop({ showArt = true, subtitle, rows = 40 }: Props) {
  const roomy = rows >= 32;
  const art = roomy ? COLOSSEUM_ART : COLOSSEUM_SMALL;

  return (
    <Box flexDirection="column" alignItems="center">
      {showArt ? <Art art={art} from={1} to={7} /> : null}
      <Art art={TITLE} from={0} to={5} />
      <Box marginTop={showArt ? 0 : 0}>
        <Text color={theme.dim}>{rule(44, '✦')}</Text>
      </Box>
      {subtitle ? (
        <Box marginTop={1}>
          <Text color={theme.faint}>{subtitle}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
