import { Box, Text, useStdout } from 'ink';
import { GladiatorPane } from './GladiatorPane.js';
import { arcade, MARK } from '../ascii.js';
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
  /** A line describing the match: sandbox, difficulty, arena. */
  meta?: string;
  /** Rows this component may use. Defaults to the whole terminal. */
  rows?: number;
}

/**
 * The line between the two gladiators: a hanging chain with the blades set
 * into the middle of it.
 */
function Divider({ height }: { height: number }) {
  const middle = Math.floor(height / 2);
  return (
    <Box flexDirection="column" width={3} height={height}>
      {Array.from({ length: height }, (_, i) => (
        <Box key={i} width={3}>
          {i === middle ? (
            // The blades are a wide glyph, so one space ahead of them centres
            // the pair in a three-column gutter.
            <Text color={theme.muted} bold>
              {' ⚔'}
            </Text>
          ) : (
            <Text color={theme.ghost}>{i === 0 || i === height - 1 ? '   ' : ' ┊ '}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}

export function Arena({ left, right, elapsedMs, meta, rows }: Props) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 100;
  const available = rows ?? stdout?.rows ?? 30;

  const paneWidth = Math.floor((cols - 3) / 2);
  // Rows go to: arcade, title, the panes, and the footer rule.
  const paneHeight = Math.max(8, available - (meta ? 5 : 4));
  const seconds = (elapsedMs / 1000).toFixed(1);

  return (
    <Box flexDirection="column" width={cols}>
      <Box justifyContent="center">
        <Text color={theme.charcoal}>{arcade(Math.min(cols, 120))}</Text>
      </Box>

      <Box justifyContent="center">
        <Text color={theme.white} bold>
          {'C O L O S S E U M'}
        </Text>
        <Text color={theme.dim}>{'   ·   '}</Text>
        <Text color={theme.faint}>{'fight to the death'}</Text>
        <Text color={theme.dim}>{'   ·   '}</Text>
        <Text color={theme.bright} bold>
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
        <Divider height={paneHeight} />
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

      {meta ? (
        <Box justifyContent="center">
          <Text color={theme.charcoal}>{meta}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
