import { Box, Text } from 'ink';
import { COLOSSEUM_ART, TITLE } from '../ascii.js';
import { theme } from '../theme.js';

interface Props {
  showArt?: boolean;
  subtitle?: string;
}

/** Title + faint colosseum art used on the setup and result screens. */
export function Backdrop({ showArt = true, subtitle }: Props) {
  return (
    <Box flexDirection="column" alignItems="center">
      <Text color={theme.gold}>{TITLE}</Text>
      {subtitle ? <Text color={theme.faint}>{subtitle}</Text> : null}
      {showArt ? (
        <Text color={theme.dim} dimColor>
          {COLOSSEUM_ART}
        </Text>
      ) : null}
    </Box>
  );
}
