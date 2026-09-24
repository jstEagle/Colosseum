import { Box, Text } from 'ink';
import { MARK, rule } from '../ascii.js';
import { theme } from '../theme.js';
import type { AgentStatus, FeedEntry } from '../protocol.js';
import type { SideStats } from '../referee.js';
import { intentOf } from '../intent.js';

interface Props {
  side: 'left' | 'right';
  title: string;
  subtitle: string;
  color: string;
  status: AgentStatus;
  feed: FeedEntry[];
  stats?: SideStats;
  width: number;
  height: number;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  booting: 'BOOTING',
  thinking: 'THINKING',
  acting: 'ACTING',
  waiting: 'WAITING',
  stunned: 'STUNNED',
  idle: 'SPENT',
  dead: 'FALLEN',
  victor: 'VICTOR',
};

interface Style {
  color: string;
  mark: string;
  dim?: boolean;
  italic?: boolean;
  bold?: boolean;
}

function styleFor(kind: FeedEntry['kind']): Style {
  switch (kind) {
    case 'reasoning':
      return { color: theme.dim, mark: MARK.reasoning, italic: true };
    case 'speech':
      return { color: theme.text, mark: MARK.speech };
    case 'command':
      return { color: theme.white, mark: MARK.command, bold: true };
    case 'result':
      return { color: theme.faint, mark: MARK.result };
    case 'system':
      return { color: theme.muted, mark: MARK.system };
    case 'error':
      return { color: theme.bright, mark: MARK.error, bold: true };
  }
}

/** Greedy word wrap that also breaks tokens too long to fit on their own. */
function wrap(text: string, width: number): string[] {
  if (width < 4) return [text.slice(0, Math.max(0, width))];
  const rows: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let token = word;
      // A path or a base64 blob can be longer than the pane is wide.
      while (token.length > width) {
        if (line) {
          rows.push(line);
          line = '';
        }
        rows.push(token.slice(0, width));
        token = token.slice(width);
      }
      if (!line) line = token;
      else if (line.length + 1 + token.length <= width) line += ' ' + token;
      else {
        rows.push(line);
        line = token;
      }
    }
    rows.push(line);
  }
  return rows.length ? rows : [''];
}

interface Row {
  text: string;
  style: Style;
  continuation: boolean;
}

/** Turn the feed into display rows, newest last. */
function layout(feed: FeedEntry[], width: number, limit: number): Row[] {
  const rows: Row[] = [];
  // Only the tail can possibly be visible, so only the tail is laid out.
  for (const entry of feed.slice(-Math.max(limit, 40))) {
    const style = styleFor(entry.kind);
    const lines = wrap(entry.text.replace(/\t/g, '  '), width);
    lines.forEach((text, i) => rows.push({ text, style, continuation: i > 0 }));
  }
  return rows;
}

function statusColor(status: AgentStatus): string {
  if (status === 'victor' || status === 'stunned') return theme.white;
  if (status === 'dead' || status === 'idle') return theme.dim;
  if (status === 'acting') return theme.bright;
  return theme.faint;
}

function statusMark(status: AgentStatus): string {
  if (status === 'victor') return MARK.victor;
  if (status === 'dead') return MARK.dead;
  if (status === 'stunned') return MARK.stunned;
  if (status === 'idle') return MARK.idle;
  return MARK.alive;
}

const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

/** The line under the heading: who this is, and how the fight is going for them. */
function tally(subtitle: string, stats?: SideStats): string {
  if (!stats) return subtitle;
  const parts = [`${stats.commands} cmd`];
  if (stats.decoyHits) parts.push(`${stats.decoyHits} wrong`);
  if (stats.refused) parts.push(`${stats.refused} refused`);
  if (stats.feints) parts.push(`${stats.feints} feint${stats.feints > 1 ? 's' : ''}`);
  if (stats.fooled) parts.push(`fooled ${stats.fooled}`);
  if (stats.disguises) parts.push('disguised');
  const tokens = stats.inputTokens + stats.outputTokens;
  if (tokens) parts.push(`${kilo(tokens)} tok`);
  return `${subtitle}  ·  ${parts.join(' · ')}`;
}

export function GladiatorPane({ side, title, subtitle, color, status, feed, stats, width, height }: Props) {
  // Borders take 2 columns, padding another 2, and the gutter 2 more.
  const inner = Math.max(8, width - 4);
  const bodyWidth = Math.max(4, inner - 2);
  // Rows go to: header, subtitle, doing, thinks, rule, and the two borders.
  const bodyHeight = Math.max(1, height - 7);
  const intent = intentOf(feed, status);

  const rows = layout(feed, bodyWidth, bodyHeight + 20).slice(-bodyHeight);
  const label = STATUS_LABEL[status];
  const heading = `${side === 'left' ? MARK.left + ' ' : ''}${title}${side === 'right' ? ' ' + MARK.right : ''}`;

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      paddingX={1}
      borderStyle="round"
      borderColor={status === 'dead' ? theme.charcoal : color}
    >
      <Box justifyContent="space-between" width={inner}>
        <Text color={status === 'dead' ? theme.dim : theme.bright} bold wrap="truncate-end">
          {heading}
        </Text>
        <Text color={statusColor(status)} bold>
          {statusMark(status)} {label}
        </Text>
      </Box>
      <Text color={theme.dim} wrap="truncate-end">
        {tally(subtitle, stats)}
      </Text>
      <Box width={inner}>
        <Box width={8} flexShrink={0}>
          <Text color={theme.dim}>{'doing'}</Text>
        </Box>
        <Text color={status === 'stunned' ? theme.white : theme.bright} bold wrap="truncate-end">
          {intent.doing}
        </Text>
      </Box>
      <Box width={inner}>
        <Box width={8} flexShrink={0}>
          <Text color={theme.dim}>{'thinks'}</Text>
        </Box>
        <Text color={theme.muted} italic wrap="truncate-start">
          {intent.thought ? `“${intent.thought}”` : '…'}
        </Text>
      </Box>
      <Text color={status === 'dead' || status === 'victor' || status === 'stunned' ? theme.dim : theme.charcoal}>
        {status === 'dead'
          ? rule(inner, MARK.dead)
          : status === 'victor'
            ? rule(inner, MARK.victor)
            : status === 'stunned'
              ? rule(inner, `${MARK.stunned} stunned ${MARK.stunned}`)
              : '─'.repeat(inner)}
      </Text>

      <Box flexDirection="column" height={bodyHeight} overflow="hidden">
        {rows.map((row, i) => (
          <Box key={i} width={inner}>
            <Text color={row.continuation ? theme.charcoal : row.style.color}>
              {(row.continuation ? ' ' : row.style.mark) + ' '}
            </Text>
            <Text
              color={row.style.color}
              bold={row.style.bold}
              italic={row.style.italic}
              dimColor={row.style.dim}
              wrap="truncate-end"
            >
              {row.text}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
