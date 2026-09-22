import { Box, Text, useStdout } from 'ink';
import { Art } from './Art.js';
import { CROSSED_SWORDS, LAUREL, LAUREL_LOWER, SKULL, rule } from '../ascii.js';
import { theme } from '../theme.js';
import type { BattleOutcome } from '../referee.js';

interface Props {
  outcome: BattleOutcome;
  leftTitle: string;
  rightTitle: string;
  /** Rows available. Below a threshold the art is dropped rather than cropped. */
  rows?: number;
}

/** The wreath, closed around the name of whoever is still standing. */
function Crowned({ name }: { name: string }) {
  return (
    <Box flexDirection="column" alignItems="center">
      <Art art={LAUREL} from={4} to={2} />
      <Text color={theme.white} bold>
        {'V I C T O R'}
      </Text>
      <Text color={theme.bright} bold>
        {name}
      </Text>
      <Art art={LAUREL_LOWER} from={2} to={4} />
    </Box>
  );
}

/** The skull, over the name of whoever is not. */
function Fallen({ name }: { name: string }) {
  return (
    <Box flexDirection="column" alignItems="center">
      <Art art={SKULL} from={4} to={8} />
      <Text color={theme.dim}>{name}</Text>
    </Box>
  );
}

export function Result({ outcome, leftTitle, rightTitle, rows = 15 }: Props) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 100;

  const draw = outcome.kind === 'draw';
  const winner = outcome.kind === 'winner' ? (outcome.winner === 'left' ? leftTitle : rightTitle) : '';
  const loser = outcome.kind === 'winner' ? (outcome.loser === 'left' ? leftTitle : rightTitle) : '';

  const roomy = rows >= 14;
  // The wreath and the skull only sit side by side if both genuinely fit.
  const wide = roomy && cols >= 86;

  return (
    <Box flexDirection="column" alignItems="center">
      <Text color={theme.charcoal}>{rule(Math.min(cols - 4, 72), draw ? '⚔' : '✦')}</Text>

      {draw ? (
        <>
          {roomy ? <Art art={CROSSED_SWORDS} from={2} to={7} /> : null}
          <Text color={theme.white} bold>
            {'A   D R A W'}
          </Text>
        </>
      ) : wide ? (
        <Box alignItems="center">
          <Crowned name={winner} />
          <Box width={6} />
          <Fallen name={loser} />
        </Box>
      ) : roomy ? (
        <>
          <Crowned name={winner} />
          <Text color={theme.dim}>{`fallen: ${loser}`}</Text>
        </>
      ) : (
        <>
          <Text color={theme.white} bold>
            {'V I C T O R'}
          </Text>
          <Text color={theme.bright} bold>
            {winner}
          </Text>
          <Text color={theme.dim}>{`fallen: ${loser}`}</Text>
        </>
      )}

      <Box marginTop={1}>
        <Text color={theme.faint}>{outcome.reason}</Text>
      </Box>
      <Box>
        <Text color={theme.dim}>{'press  r  to fight again  ·  q  to leave the arena'}</Text>
      </Box>
    </Box>
  );
}
