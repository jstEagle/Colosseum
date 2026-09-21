import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { SKULL } from '../ascii.js';
import type { BattleOutcome } from '../referee.js';

interface Props {
  outcome: BattleOutcome;
  leftTitle: string;
  rightTitle: string;
}

export function Result({ outcome, leftTitle, rightTitle }: Props) {
  const isDraw = outcome.kind === 'draw';
  const winnerTitle =
    outcome.kind === 'winner' ? (outcome.winner === 'left' ? leftTitle : rightTitle) : '';
  const winnerColor =
    outcome.kind === 'winner' ? (outcome.winner === 'left' ? theme.left : theme.right) : theme.gold;

  return (
    <Box flexDirection="column" alignItems="center" paddingY={2}>
      <Text color={theme.dim}>{SKULL}</Text>
      {isDraw ? (
        <Text color={theme.gold} bold>
          {'⚔  A DRAW  ⚔'}
        </Text>
      ) : (
        <>
          <Text color={theme.win} bold>
            {'✦  VICTOR  ✦'}
          </Text>
          <Text color={winnerColor} bold>
            {winnerTitle}
          </Text>
        </>
      )}
      <Box marginTop={1}>
        <Text color={theme.faint}>{outcome.reason}</Text>
      </Box>
      <Box marginTop={2}>
        <Text color={theme.dim}>{'press  r  to fight again  ·  q  to leave the arena'}</Text>
      </Box>
    </Box>
  );
}
