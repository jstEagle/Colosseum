import { Box, Text } from 'ink';
import { RAMP, shade } from '../theme.js';

interface Props {
  art: string;
  /** Index into the ramp for the top row. */
  from?: number;
  /** Index into the ramp for the bottom row. */
  to?: number;
  dim?: boolean;
}

/**
 * Renders a block of ASCII art shaded from top to bottom. With no colour to
 * work with, a gradient is what gives a flat drawing depth: the cornice
 * catches the light and the arcades fall away into the dark.
 */
export function Art({ art, from = 0, to = RAMP.length - 2, dim = false }: Props) {
  const lines = art.replace(/^\n+/, '').replace(/\n+$/, '').split('\n');
  return (
    <Box flexDirection="column" alignItems="center">
      {lines.map((line, i) => (
        <Text key={i} color={shade(i, lines.length, from, to)} dimColor={dim}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
