import { Box, Text, useStdout } from 'ink';
import { GladiatorPane } from './GladiatorPane.js';
import { MARK, timeBar } from '../ascii.js';
import { theme } from '../theme.js';
import type { AgentStatus, FeedEntry } from '../protocol.js';
import type { Herald, SideStats } from '../referee.js';

export interface SidePaneData {
  title: string;
  subtitle: string;
  color: string;
  status: AgentStatus;
  feed: FeedEntry[];
  stats?: SideStats;
}

interface Props {
  left: SidePaneData;
  right: SidePaneData;
  elapsedMs: number;
  timeLimitMs: number;
  /** The latest thing the herald announced, if anything. */
  herald?: Herald;
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

const HERALD_MARK: Record<Herald['tone'], string> = {
  info: MARK.system,
  strike: MARK.strike,
  decoy: MARK.decoy,
  refused: MARK.refused,
  death: MARK.death,
};

/** The herald's line: the last blow struck, announced to the whole arena. */
function HeraldLine({ herald, elapsedMs }: { herald?: Herald; elapsedMs: number }) {
  if (!herald) {
    return (
      <Box justifyContent="center">
        <Text color={theme.charcoal}>{'the gladiators circle, looking for an opening'}</Text>
      </Box>
    );
  }
  // Fresh news is bright; it fades as the fight moves on.
  const age = elapsedMs - herald.at;
  const color = age < 3000 ? theme.white : age < 8000 ? theme.muted : theme.dim;
  const side = herald.side === 'left' ? MARK.left : herald.side === 'right' ? MARK.right : '';
  return (
    <Box justifyContent="center">
      <Text color={color} bold={age < 3000}>
        {`${side ? side + ' ' : ''}${HERALD_MARK[herald.tone]}  ${herald.text}`}
      </Text>
      <Text color={theme.charcoal}>{`   ${(herald.at / 1000).toFixed(1)}s`}</Text>
    </Box>
  );
}

export function Arena({ left, right, elapsedMs, timeLimitMs, herald, meta, rows }: Props) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 100;
  const available = rows ?? stdout?.rows ?? 30;

  const paneWidth = Math.floor((cols - 3) / 2);
  // Rows go to: the header, the clock, the herald, the panes, and the footer.
  const paneHeight = Math.max(8, available - (meta ? 4 : 3));
  const fraction = Math.min(1, elapsedMs / Math.max(1, timeLimitMs));
  const barWidth = Math.max(10, Math.min(cols - 40, 60));
  const bar = timeBar(barWidth, fraction);
  const remaining = Math.max(0, (timeLimitMs - elapsedMs) / 1000);

  return (
    <Box flexDirection="column" width={cols}>
      <Box justifyContent="center">
        <Text color={theme.white} bold>
          {'C O L O S S E U M'}
        </Text>
        <Text color={theme.dim}>{'   '}</Text>
        <Text color={fraction > 0.85 ? theme.white : theme.muted}>{bar.left}</Text>
        <Text color={theme.ghost}>{bar.spent}</Text>
        <Text color={theme.dim}>{'   '}</Text>
        <Text color={theme.bright} bold>
          {(elapsedMs / 1000).toFixed(1)}s
        </Text>
        <Text color={theme.dim}>{`  ·  ${remaining.toFixed(0)}s left`}</Text>
      </Box>

      <HeraldLine herald={herald} elapsedMs={elapsedMs} />

      <Box>
        <GladiatorPane side="left" {...left} width={paneWidth} height={paneHeight} />
        <Divider height={paneHeight} />
        <GladiatorPane side="right" {...right} width={paneWidth} height={paneHeight} />
      </Box>

      {meta ? (
        <Box justifyContent="center">
          <Text color={theme.charcoal}>{meta}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
