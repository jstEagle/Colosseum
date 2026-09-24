import { Box, Text } from 'ink';
import { Art } from './Art.js';
import { Picture, fitPicture } from './Picture.js';
import { CROSSED_SWORDS, LAUREL, LAUREL_LOWER, MARK, rule } from '../ascii.js';
import { theme } from '../theme.js';
import type { BattleOutcome, Herald, MatchRecord, SideStats } from '../referee.js';
import type { Side } from '../protocol.js';

interface Props {
  outcome: BattleOutcome;
  record: MatchRecord | null;
  heralds: Herald[];
  titles: Record<Side, string>;
  /** Where the match was written down, if it was. */
  ledger: string | null;
  rows: number;
  cols: number;
}

const secs = (ms: number | null | undefined) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

const FINISH: Record<string, string> = {
  kill: 'by the sword',
  self: 'by its own hand',
  collapse: 'the body gave out',
  double: 'both fell together',
  timeout: 'the sand ran out',
  truce: 'both laid down their arms',
  void: 'the match was never held',
};

/** The two sides' numbers, row by row, so the difference is easy to see. */
function Tally({ record, titles, width }: { record: MatchRecord; titles: Record<Side, string>; width: number }) {
  const s = record.stats;
  const tokens = (x: SideStats) => x.inputTokens + x.outputTokens;
  const rows: [string, string, string][] = [
    ['first blow', secs(s.left.firstStrikeMs), secs(s.right.firstStrikeMs)],
    ['commands', String(s.left.commands), String(s.right.commands)],
    ['wrong blows', String(s.left.decoyHits), String(s.right.decoyHits)],
    ['refused', String(s.left.refused), String(s.right.refused)],
    ['stunned', secs(s.left.stunnedMs || null), secs(s.right.stunnedMs || null)],
    ['tokens', tokens(s.left) ? kilo(tokens(s.left)) : '—', tokens(s.right) ? kilo(tokens(s.right)) : '—'],
  ];
  if (s.left.costUsd || s.right.costUsd) {
    rows.push(['cost', s.left.costUsd ? `$${s.left.costUsd.toFixed(3)}` : '—', s.right.costUsd ? `$${s.right.costUsd.toFixed(3)}` : '—']);
  }
  const col = Math.max(12, Math.floor((width - 16) / 2));
  const cut = (t: string) => (t.length > col - 2 ? t.slice(0, col - 3) + '…' : t);
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={16} />
        <Box width={col} justifyContent="flex-end">
          <Text color={theme.bright} bold>{`${MARK.left} ${cut(titles.left)}`}</Text>
        </Box>
        <Box width={col} justifyContent="flex-end">
          <Text color={theme.muted} bold>{`${cut(titles.right)} ${MARK.right}`}</Text>
        </Box>
      </Box>
      {rows.map(([label, l, r]) => (
        <Box key={label}>
          <Box width={16}>
            <Text color={theme.dim}>{label}</Text>
          </Box>
          <Box width={col} justifyContent="flex-end">
            <Text color={theme.text}>{l}</Text>
          </Box>
          <Box width={col} justifyContent="flex-end">
            <Text color={theme.text}>{r}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** The match, told as the herald told it. */
function Timeline({ heralds, limit }: { heralds: Herald[]; limit: number }) {
  if (!heralds.length || limit <= 0) return null;
  const shown = heralds.length > limit ? heralds.slice(-limit) : heralds;
  return (
    <Box flexDirection="column">
      {heralds.length > limit ? <Text color={theme.charcoal}>{`  … ${heralds.length - limit} earlier`}</Text> : null}
      {shown.map((h, i) => (
        <Box key={i}>
          <Text color={theme.dim}>{`${(h.at / 1000).toFixed(1).padStart(6)}s  `}</Text>
          <Text color={h.tone === 'death' ? theme.white : h.tone === 'strike' ? theme.bright : theme.muted}>
            {h.text}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/** The victor's name inside the wreath. */
function Crowned({ name, finish }: { name: string; finish: string }) {
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
      <Text color={theme.dim}>{finish}</Text>
    </Box>
  );
}

export function Result({ outcome, record, heralds, titles, ledger, rows, cols }: Props) {
  const draw = outcome.kind === 'draw';
  const winner = outcome.kind === 'winner' ? titles[outcome.winner] : '';
  const loser = outcome.kind === 'winner' ? titles[outcome.loser] : '';
  const finish = FINISH[outcome.finish] ?? outcome.finish;

  // Everything but the pictures: rules, tally, timeline, footer.
  const tallyRows = record ? 8 : 0;
  const footer = 4;
  const timelineRows = Math.min(heralds.length, Math.max(0, Math.min(6, rows - tallyRows - footer - 16)));
  const picRows = rows - tallyRows - footer - timelineRows - 3;
  const third = Math.floor((cols - 8) / 3);
  const victor = !draw ? fitPicture('borghese', third, picRows) : null;
  const fallen = !draw ? fitPicture('gaul', third + 8, Math.min(picRows, 14)) : null;

  return (
    <Box flexDirection="column" alignItems="center" width={cols} height={rows}>
      <Box flexGrow={1} />
      <Text color={theme.charcoal}>{rule(Math.min(cols - 4, 96), draw ? '⚔' : '✦')}</Text>

      {draw ? (
        <Box flexDirection="column" alignItems="center" marginY={1}>
          {picRows >= 12 ? <Art art={CROSSED_SWORDS} from={2} to={7} /> : null}
          <Text color={theme.white} bold>
            {'A   D R A W'}
          </Text>
          <Text color={theme.dim}>{finish}</Text>
        </Box>
      ) : (
        <Box alignItems="flex-end" marginY={1}>
          {victor ? <Picture name="borghese" maxCols={third} maxRows={picRows} /> : null}
          <Box flexDirection="column" alignItems="center" marginX={3} marginBottom={1}>
            <Crowned name={winner} finish={finish} />
          </Box>
          {fallen ? (
            <Box flexDirection="column" alignItems="center">
              <Picture name="gaul" maxCols={third + 8} maxRows={Math.min(picRows, 14)} />
              <Text color={theme.dim}>{`${MARK.dead}  ${loser}`}</Text>
            </Box>
          ) : (
            <Text color={theme.dim}>{`fallen: ${loser}`}</Text>
          )}
        </Box>
      )}

      <Text color={theme.faint}>{outcome.reason}</Text>

      {record ? (
        <Box marginTop={1}>
          <Tally record={record} titles={titles} width={Math.min(cols - 4, 72)} />
        </Box>
      ) : null}

      {timelineRows > 0 ? (
        <Box marginTop={1}>
          <Timeline heralds={heralds} limit={timelineRows} />
        </Box>
      ) : null}

      <Box flexGrow={1} />
      {ledger ? <Text color={theme.charcoal}>{`recorded in ${ledger}`}</Text> : null}
      <Text color={theme.dim}>{'r  fight again   ·   a  the arena   ·   l  hall of champions   ·   q  leave'}</Text>
    </Box>
  );
}
