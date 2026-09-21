import { Box, Text } from 'ink';
import type { FeedEntry } from '../protocol.js';
import type { AgentStatus } from '../protocol.js';
import { theme } from '../theme.js';

interface Props {
  side: 'left' | 'right';
  title: string;
  subtitle: string;
  color: string;
  status: AgentStatus;
  feed: FeedEntry[];
  width: number;
  height: number;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  booting: 'BOOTING',
  thinking: 'THINKING',
  acting: 'ACTING',
  waiting: 'WAITING',
  dead: 'DEAD',
  victor: 'VICTOR',
};

function kindStyle(kind: FeedEntry['kind']): { color: string; prefix: string; dim?: boolean; italic?: boolean } {
  switch (kind) {
    case 'reasoning':
      return { color: theme.faint, prefix: '… ', italic: true, dim: true };
    case 'speech':
      return { color: theme.text, prefix: '' };
    case 'command':
      return { color: theme.gold, prefix: '$ ' };
    case 'result':
      return { color: theme.dim, prefix: '  ', dim: true };
    case 'system':
      return { color: theme.accent, prefix: '† ' };
    case 'error':
      return { color: theme.blood, prefix: '! ' };
  }
}

function statusColor(status: AgentStatus): string {
  if (status === 'dead') return theme.lose;
  if (status === 'victor') return theme.win;
  if (status === 'acting') return theme.gold;
  return theme.faint;
}

export function GladiatorPane({ side, title, subtitle, color, status, feed, width, height }: Props) {
  const bodyHeight = Math.max(3, height - 4);
  const visible = feed.slice(-bodyHeight);

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} borderStyle="round" borderColor={color}>
      <Box justifyContent="space-between">
        <Text color={color} bold>
          {side === 'left' ? '◀ ' : ''}
          {title}
          {side === 'right' ? ' ▶' : ''}
        </Text>
        <Text color={statusColor(status)} bold>
          {STATUS_LABEL[status]}
        </Text>
      </Box>
      <Text color={theme.faint}>{subtitle}</Text>
      <Box flexDirection="column" marginTop={1} height={bodyHeight} overflow="hidden">
        {visible.map((entry, i) => {
          const s = kindStyle(entry.kind);
          return (
            <Text key={i} color={s.color} dimColor={s.dim} italic={s.italic} wrap="truncate-end">
              {s.prefix}
              {entry.text}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
