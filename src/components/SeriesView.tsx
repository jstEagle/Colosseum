import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Art } from './Art.js';
import { banner, rule } from '../ascii.js';
import { theme } from '../theme.js';
import { slotLabel, slotOf, summarize, summaryRows, type Series, type SeriesFight, type Tone } from '../series.js';
import { DEFAULT_TIME_LIMIT_MS } from '../referee.js';
import { getDifficulty } from '../difficulty.js';

interface Props {
  series: Series;
  rows: number;
  cols: number;
  /** Watch one fight of the series. */
  onReplay: (id: string) => void;
  /** Fight the same series again. */
  onRerun: () => void;
  /** Back to the main menu (stopping the series if it is still running). */
  onLeave: () => void;
  onHall: () => void;
}

const TONE: Record<Tone, string> = {
  white: theme.white,
  bright: theme.bright,
  text: theme.text,
  muted: theme.muted,
  faint: theme.faint,
  dim: theme.dim,
  ghost: theme.charcoal,
};

const TILE_W = 34;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** One fight of the series, small: who sits where, how it is going. */
function Tile({ fight, timeLimitMs, selected }: { fight: SeriesFight; timeLimitMs: number; selected: boolean }) {
  const o = fight.record?.outcome;
  const running = fight.state === 'running';
  const elapsed = running && fight.startedAt ? Date.now() - fight.startedAt : (fight.record?.durationMs ?? 0);
  const barW = TILE_W - 12;
  const filled = Math.min(barW, Math.round((elapsed / timeLimitMs) * barW));
  const winner = o?.kind === 'winner' ? slotOf(fight, o.winner) : null;
  const border = selected ? theme.white : fight.state === 'done' ? (winner ? theme.charcoal : theme.ghost) : theme.dim;
  return (
    <Box flexDirection="column" width={TILE_W} borderStyle="round" borderColor={border} paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={selected ? theme.white : theme.muted} bold>{`#${fight.index + 1}`}</Text>
        <Text color={theme.dim}>{`A ${fight.leftSlot === 'A' ? '◀' : '▶'}  B ${fight.leftSlot === 'A' ? '▶' : '◀'}`}</Text>
      </Box>
      {fight.state === 'queued' ? (
        <Text color={theme.charcoal}>{'waiting for a free arena'}</Text>
      ) : running ? (
        <Box>
          <Text color={theme.bright}>{`${secs(elapsed).padStart(6)}  `}</Text>
          <Text color={theme.muted}>{'━'.repeat(filled)}</Text>
          <Text color={theme.ghost}>{'─'.repeat(barW - filled)}</Text>
        </Box>
      ) : o?.finish === 'void' ? (
        <Text color={theme.dim}>{'void — the arena would not open'}</Text>
      ) : winner ? (
        <Text color={theme.white} bold>{`✦ ${winner} wins  ·  ${o!.finish}  ·  ${secs(elapsed)}`}</Text>
      ) : (
        <Text color={theme.muted}>{`=  draw  ·  ${o!.finish}  ·  ${secs(elapsed)}`}</Text>
      )}
      <Text color={theme.dim} wrap="truncate-end">
        {fight.lastHerald ?? (running ? 'the gladiators circle' : ' ')}
      </Text>
    </Box>
  );
}

/**
 * A series, live and then summed up. While it runs: a tile per fight and a
 * running tally. When it is over: the verdict, the charts and the tally,
 * with every fight one keypress from its replay.
 */
export function SeriesView({ series, rows, cols, onReplay, onRerun, onLeave, onHall }: Props) {
  const [, setTick] = useState(0);
  const [done, setDone] = useState(() => series.fights.every((f) => f.state === 'done'));
  const [picking, setPicking] = useState(false);
  const [cursor, setCursor] = useState(0);
  const config = series.options.config;
  const timeLimitMs = config.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;

  // Redraw on news, and four times a second for the running clocks.
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const onDone = () => setDone(true);
    series.on('update', bump);
    series.on('done', onDone);
    const clock = setInterval(bump, 250);
    return () => {
      series.off('update', bump);
      series.off('done', onDone);
      clearInterval(clock);
    };
  }, [series]);

  const finished = series.fights.filter((f) => f.state === 'done' && f.record && f.record.outcome.finish !== 'void');

  useInput((input, key) => {
    if (picking) {
      if (key.escape) setPicking(false);
      else if (key.upArrow) setCursor((c) => (c - 1 + finished.length) % Math.max(1, finished.length));
      else if (key.downArrow) setCursor((c) => (c + 1) % Math.max(1, finished.length));
      else if (key.return && finished[cursor]) onReplay(finished[cursor].record!.id);
      return;
    }
    if (!done) {
      if (key.escape) onLeave();
      return;
    }
    if (input === 'r') onRerun();
    else if (input === 'w' && finished.length) {
      setCursor(0);
      setPicking(true);
    } else if (input === 'n' || key.escape) onLeave();
    else if (input === 'l') onHall();
  });

  const sum = summarize(series.fights, config);
  const width = Math.min(cols - 4, 110);
  const difficulty = getDifficulty(config.difficultyId).name;
  const header = (
    <Box flexDirection="column" alignItems="center">
      <Text color={theme.white} bold>
        {'S E R I E S'}
      </Text>
      <Box>
        <Text color={theme.bright}>{slotLabel(sum, 'A', 40)}</Text>
        <Text color={theme.dim}>{'   ⚔   '}</Text>
        <Text color={theme.bright}>{slotLabel(sum, 'B', 40)}</Text>
      </Box>
      <Text color={theme.dim}>
        {`${series.fights.length} fights · ${series.options.parallel} at once · ${difficulty}${series.options.swap ? ' · sides swap every other fight' : ''}`}
      </Text>
    </Box>
  );

  if (picking) {
    return (
      <Box flexDirection="column" alignItems="center" height={rows}>
        <Box flexGrow={1} />
        {header}
        <Box flexDirection="column" marginTop={1} width={Math.min(width, 70)}>
          <Text color={theme.white} bold>
            {'WATCH A FIGHT'}
          </Text>
          <Box marginBottom={1}>
            <Text color={theme.faint}>{'Every fight of the series was recorded.'}</Text>
          </Box>
          {finished.map((f, i) => {
            const o = f.record!.outcome;
            const verdict = o.kind === 'winner' ? `${slotOf(f, o.winner)} wins` : 'draw';
            const active = i === cursor;
            return (
              <Text key={f.index} color={active ? theme.white : theme.muted} bold={active}>
                {`${active ? '❯' : ' '}  #${String(f.index + 1).padEnd(4)}${verdict.padEnd(9)}${o.finish.padEnd(9)}${secs(f.record!.durationMs).padStart(7)}   A sat ${f.leftSlot === 'A' ? 'left' : 'right'}`}
              </Text>
            );
          })}
        </Box>
        <Box flexGrow={1} />
        <Text color={theme.dim}>{'↑↓ move   ·   ⏎ watch   ·   esc  back to the series'}</Text>
      </Box>
    );
  }

  if (!done) {
    const perRow = Math.max(1, Math.floor((cols - 2) / (TILE_W + 1)));
    const tileRows = Math.ceil(series.fights.length / perRow);
    const fitRows = Math.max(1, Math.floor((rows - 12) / 5));
    const shown = series.fights.slice(0, Math.min(tileRows, fitRows) * perRow);
    const a = sum.slots.A.wins;
    const b = sum.slots.B.wins;
    const doneCount = series.fights.filter((f) => f.state === 'done').length;
    const barW = Math.min(60, cols - 30);
    const aW = a + b ? Math.round((a / (a + b)) * barW) : Math.floor(barW / 2);
    return (
      <Box flexDirection="column" alignItems="center" height={rows}>
        {header}
        <Box marginY={1}>
          <Text color={theme.white} bold>{`A  ${a}  `}</Text>
          <Text color={theme.bright}>{'█'.repeat(aW)}</Text>
          <Text color={theme.charcoal}>{'█'.repeat(barW - aW)}</Text>
          <Text color={theme.muted} bold>{`  ${b}  B`}</Text>
          <Text color={theme.dim}>{`     ${doneCount} of ${series.fights.length} decided${sum.draws ? ` · ${sum.draws} drawn` : ''}`}</Text>
        </Box>
        <Box flexWrap="wrap" width={perRow * (TILE_W + 1)}>
          {shown.map((f) => (
            <Box key={f.index} marginRight={1}>
              <Tile fight={f} timeLimitMs={timeLimitMs} selected={false} />
            </Box>
          ))}
        </Box>
        {shown.length < series.fights.length ? (
          <Text color={theme.dim}>{`… and ${series.fights.length - shown.length} more`}</Text>
        ) : null}
        <Box flexGrow={1} />
        <Text color={theme.dim}>{'the fights run on their own   ·   esc  stop the series'}</Text>
      </Box>
    );
  }

  const lead = sum.leader;
  const big = banner(lead ? `${lead} WINS` : 'DRAW');
  const lines = summaryRows(sum, width, timeLimitMs);
  return (
    <Box flexDirection="column" alignItems="center" height={rows}>
      <Box flexGrow={1} />
      {big ? <Art art={big} from={0} to={3} /> : null}
      <Box marginBottom={1}>{header}</Box>
      <Text color={theme.charcoal}>{rule(width, '✦')}</Text>
      <Box flexDirection="column" width={width} marginTop={1}>
        {lines.map((row, i) => (
          <Box key={i}>
            {row.length ? (
              row.map(([text, tone, b], j) => (
                <Text key={j} color={TONE[tone]} bold={b}>
                  {text}
                </Text>
              ))
            ) : (
              <Text> </Text>
            )}
          </Box>
        ))}
      </Box>
      <Box flexGrow={1} />
      <Text color={theme.charcoal}>{`recorded as ${series.id}`}</Text>
      <Text color={theme.dim}>
        {'w  watch a fight   ·   r  run the series again   ·   n  new match   ·   l  hall of champions   ·   q  leave'}
      </Text>
    </Box>
  );
}
