import { Box, Text } from 'ink';
import { Art } from './Art.js';
import { CROSSED_SWORDS, LAUREL, LAUREL_LOWER, rule } from '../ascii.js';
import { theme } from '../theme.js';
import type { BattleOutcome } from '../referee.js';

interface Props {
  outcome: BattleOutcome;
  leftTitle: string;
  rightTitle: string;
  /** Rows available. Below a threshold the art is dropped rather than cropped. */
  rows?: number;
}

export function Result({ outcome, leftTitle, rightTitle, rows = 14 }: Props) {
  const draw = outcome.kind === 'draw';
  const winner = outcome.kind === 'winner' ? (outcome.winner === 'left' ? leftTitle : rightTitle) : '';
  const loser = outcome.kind === 'winner' ? (outcome.loser === 'left' ? leftTitle : rightTitle) : '';
  const roomy = rows >= 15;

  return (
    <Box flexDirection="column" alignItems="center">
      <Text color={theme.charcoal}>{rule(56, draw ? '⚔' : '✦')}</Text>

      {draw ? (
        <>
          {roomy ? <Art art={CROSSED_SWORDS} from={2} to={6} /> : null}
          <Text color={theme.white} bold>
            {'A   D R A W'}
          </Text>
        </>
      ) : (
        <>
          {roomy ? <Art art={LAUREL} from={4} to={1} /> : null}
          <Text color={theme.white} bold>
            {'V I C T O R'}
          </Text>
          <Text color={theme.bright} bold>
            {winner}
          </Text>
          {roomy ? <Art art={LAUREL_LOWER} from={1} to={4} /> : null}
          <Box marginTop={roomy ? 0 : 1}>
            <Text color={theme.dim}>{`fallen: ${loser}`}</Text>
          </Box>
        </>
      )}

      <Box marginTop={1}>
        <Text color={theme.faint}>{outcome.reason}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.dim}>{'press  r  to fight again  ·  q  to leave the arena'}</Text>
      </Box>
    </Box>
  );
}
