import { Box, Text } from 'ink';
import { Art } from './Art.js';
import { Picture, fitPicture } from './Picture.js';
import { CROSSED_SWORDS, LAUREL, LAUREL_LOWER, MARK, banner, rule } from '../ascii.js';
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
  /** This verdict closes a replay rather than a live match. */
  replayed: boolean;
  /** A preset name being typed, or null. */
  naming: string | null;
  notice: string;
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

/** The two sides' numbers, row by row; the victor's column is the lit one. */
function Tally({ record, titles, winner }: { record: MatchRecord; titles: Record<Side, string>; winner: Side | null }) {
  const s = record.stats;
  const LABEL = 16;
  const COL = 30;
  const tokens = (x: SideStats) => x.inputTokens + x.outputTokens;
  const rows: [string, (x: SideStats) => string][] = [
    ['first blow', (x) => secs(x.firstStrikeMs)],
    ['commands', (x) => String(x.commands)],
    ['wrong blows', (x) => String(x.decoyHits)],
    ['feints planted', (x) => (x.feints ? `${x.feints}${x.fooled ? `  (fooled ${x.fooled})` : ''}` : '—')],
    ['disguised', (x) => (x.disguises ? 'yes' : '—')],
    ['stunned', (x) => secs(x.stunnedMs || null)],
    ['tokens', (x) => (tokens(x) ? kilo(tokens(x)) : '—')],
  ];
  if (s.left.costUsd || s.right.costUsd) rows.push(['cost', (x) => (x.costUsd ? `$${x.costUsd.toFixed(3)}` : '—')]);
  const cut = (t: string) => (t.length > COL - 2 ? t.slice(0, COL - 3) + '…' : t);
  const tone = (side: Side) => (winner === null ? theme.text : winner === side ? theme.white : theme.dim);
  const mark = (side: Side) => (winner === null ? '' : winner === side ? `  ${MARK.victor} VICTOR` : `  ${MARK.dead} FALLEN`);

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={LABEL} />
        {(['left', 'right'] as Side[]).map((side) => (
          <Box key={side} width={COL} justifyContent="flex-end">
            <Text color={tone(side)} bold>
              {side === 'left' ? `${MARK.left} LEFT${mark(side)}` : `RIGHT ${MARK.right}${mark(side)}`}
            </Text>
          </Box>
        ))}
      </Box>
      <Box>
        <Box width={LABEL} />
        {(['left', 'right'] as Side[]).map((side) => (
          <Box key={side} width={COL} justifyContent="flex-end">
            <Text color={tone(side)}>{cut(titles[side])}</Text>
          </Box>
        ))}
      </Box>
      <Text color={theme.ghost}>{'─'.repeat(LABEL + COL * 2)}</Text>
      {rows.map(([label, value]) => (
        <Box key={label}>
          <Box width={LABEL}>
            <Text color={theme.dim}>{label}</Text>
          </Box>
          {(['left', 'right'] as Side[]).map((side) => (
            <Box key={side} width={COL} justifyContent="flex-end">
              <Text color={tone(side)}>{value(s[side])}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

/** The match, told as the herald told it. */
function Timeline({ heralds, limit, width }: { heralds: Herald[]; limit: number; width: number }) {
  if (!heralds.length || limit <= 0) return null;
  const shown = heralds.length > limit ? heralds.slice(-limit) : heralds;
  return (
    <Box flexDirection="column" width={width}>
      {heralds.length > limit ? <Text color={theme.charcoal}>{`         … ${heralds.length - limit} earlier`}</Text> : null}
      {shown.map((h, i) => (
        <Box key={i}>
          <Box width={9} flexShrink={0}>
            <Text color={theme.dim}>{`${(h.at / 1000).toFixed(1)}s`.padStart(7)}</Text>
          </Box>
          <Text
            color={h.tone === 'death' ? theme.white : h.tone === 'strike' ? theme.bright : theme.muted}
            bold={h.tone === 'death'}
            wrap="truncate-end"
          >
            {h.text}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function Result({ outcome, record, heralds, titles, ledger, replayed, naming, notice, rows, cols }: Props) {
  const draw = outcome.kind === 'draw';
  const winner = outcome.kind === 'winner' ? outcome.winner : null;
  const loser = outcome.kind === 'winner' ? outcome.loser : null;
  const finish = FINISH[outcome.finish] ?? outcome.finish;
  const headline = draw ? 'DRAW' : `${winner!.toUpperCase()} WINS`;
  const big = banner(headline);
  const width = Math.min(cols - 2, 110);

  // Rows for everything but the pictures.
  const tallyRows = record ? 11 : 0;
  const footer = 4;
  const bannerRows = big ? 5 : 2;
  const timelineRows = Math.min(heralds.length, Math.max(0, Math.min(6, rows - tallyRows - footer - bannerRows - 18)));
  const picRows = Math.max(0, rows - tallyRows - footer - bannerRows - timelineRows - 4);
  // The wreath needs its full width; the statues share what is left
  // equally, so the wreath sits dead centre between them.
  const centre = 48;
  const col = Math.floor((width - centre) / 2);
  const victor = !draw ? fitPicture('borghese', col - 2, picRows) : null;
  const fallen = !draw ? fitPicture('gaul', col - 2, Math.min(picRows, 14)) : null;

  return (
    <Box flexDirection="column" alignItems="center" width={cols} height={rows}>
      <Box flexGrow={1} />

      {/* Who won, before anything else. */}
      {big ? <Art art={big} from={0} to={3} /> : <Text color={theme.white} bold>{headline.split('').join(' ')}</Text>}
      <Box>
        <Text color={theme.bright} bold>
          {draw ? 'neither gladiator stands alone' : titles[winner!]}
        </Text>
        <Text color={theme.dim}>{`   ·   ${finish}${replayed ? '   ·   replay' : ''}`}</Text>
      </Box>

      {draw ? (
        <Box flexDirection="column" alignItems="center" marginY={1}>
          {picRows >= 12 ? <Art art={CROSSED_SWORDS} from={2} to={7} /> : null}
        </Box>
      ) : (
        <Box width={width} alignItems="flex-end" marginY={1}>
          <Box width={col} flexDirection="column" alignItems="center">
            {victor ? <Picture name="borghese" maxCols={col - 2} maxRows={picRows} /> : null}
            <Text color={theme.white} bold>{`${MARK.victor}  ${winner!.toUpperCase()}  ·  victor`}</Text>
          </Box>
          <Box width={centre} flexDirection="column" alignItems="center" marginBottom={1}>
            <Art art={LAUREL} from={4} to={2} />
            <Text color={theme.white} bold>
              {'V I C T O R'}
            </Text>
            <Text color={theme.bright}>{titles[winner!]}</Text>
            <Art art={LAUREL_LOWER} from={2} to={4} />
          </Box>
          <Box width={col} flexDirection="column" alignItems="center">
            {fallen ? <Picture name="gaul" maxCols={col - 2} maxRows={Math.min(picRows, 14)} /> : null}
            <Text color={theme.dim}>{`${MARK.dead}  ${loser!.toUpperCase()}  ·  fallen`}</Text>
          </Box>
        </Box>
      )}

      <Text color={theme.faint}>{outcome.reason}</Text>

      {record ? (
        <Box marginTop={1}>
          <Tally record={record} titles={titles} winner={winner} />
        </Box>
      ) : null}

      {timelineRows > 0 ? (
        <Box marginTop={1}>
          <Timeline heralds={heralds} limit={timelineRows} width={76} />
        </Box>
      ) : null}

      <Box flexGrow={1} />
      <Text color={theme.charcoal}>{rule(Math.min(cols - 4, 96), '·')}</Text>
      {naming !== null ? (
        <Text color={theme.white}>{`save this matchup as:  ${naming}▏    ⏎ save  ·  esc cancel`}</Text>
      ) : notice ? (
        <Text color={theme.bright}>{notice}</Text>
      ) : ledger ? (
        <Text color={theme.charcoal}>{`recorded in ${ledger}  ·  replay it from the start menu`}</Text>
      ) : (
        <Text> </Text>
      )}
      <Text color={theme.dim}>
        {'r  rematch   ·   n  new match   ·   s  save as preset   ·   a  the arena   ·   l  hall of champions   ·   q  leave'}
      </Text>
    </Box>
  );
}
