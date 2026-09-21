import { Box, Text, useStdout } from 'ink';
import { GladiatorPane } from './GladiatorPane.js';
import { theme } from '../theme.js';
import type { AgentStatus, FeedEntry } from '../protocol.js';

export interface SidePaneData {
  title: string;
  subtitle: string;
  color: string;
  status: AgentStatus;
  feed: FeedEntry[];
}

interface Props {
  left: SidePaneData;
  right: SidePaneData;
  elapsedMs: number;
}

function archStrip(width: number): string {
  const unit = '∩';
  const count = Math.max(1, Math.floor(width / 2));
  return ' ' + Array.from({ length: count }, () => unit).join(' ');
}

export function Arena({ left, right, elapsedMs }: Props) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 100;
  const rows = stdout?.rows ?? 30;
  const paneWidth = Math.floor((cols - 2) / 2);
  const paneHeight = Math.max(8, rows - 5);
  const seconds = (elapsedMs / 1000).toFixed(1);

  return (
    <Box flexDirection="column" width={cols}>
      <Box justifyContent="center">
        <Text color={theme.dim} dimColor>
          {archStrip(cols)}
        </Text>
      </Box>
      <Box justifyContent="center">
        <Text color={theme.gold} bold>
          COLOSSEUM
        </Text>
        <Text color={theme.faint}>{'  — fight to the death —  '}</Text>
        <Text color={theme.blood} bold>
          {seconds}s
        </Text>
      </Box>
      <Box>
        <GladiatorPane
          side="left"
          title={left.title}
          subtitle={left.subtitle}
          color={left.color}
          status={left.status}
          feed={left.feed}
          width={paneWidth}
          height={paneHeight}
        />
        <Box width={2} height={paneHeight} alignItems="center" justifyContent="center">
          <Text color={theme.blood} bold>
            VS
          </Text>
        </Box>
        <GladiatorPane
          side="right"
          title={right.title}
          subtitle={right.subtitle}
          color={right.color}
          status={right.status}
          feed={right.feed}
          width={paneWidth}
          height={paneHeight}
        />
      </Box>
    </Box>
  );
}
