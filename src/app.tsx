import { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { Setup } from './components/Setup.js';
import { Arena, type SidePaneData } from './components/Arena.js';
import { Result } from './components/Result.js';
import { Backdrop } from './components/Backdrop.js';
import { Leaderboard } from './components/Leaderboard.js';
import { Picture } from './components/Picture.js';
import { Art } from './components/Art.js';
import {
  Referee,
  DEFAULT_TIME_LIMIT_MS,
  type BattleConfig,
  type BattleOutcome,
  type Herald,
  type MatchRecord,
  type SideStats,
} from './referee.js';
import { blockers, providerState } from './preflight.js';
import { getDifficulty } from './difficulty.js';
import { getSandbox } from './sandbox.js';
import { getSetting } from './settings.js';
import { appendMatch } from './results.js';
import { rememberLast, savePreset } from './presets.js';
import { loadReplay, saveReplay, type Replay, type ReplayEvent } from './replays.js';
import { NUMERALS } from './ascii.js';
import { Series } from './series.js';
import { SeriesView } from './components/SeriesView.js';
import { theme } from './theme.js';
import type { AgentEvent, AgentStatus, FeedEntry, Side } from './protocol.js';

type Phase = 'setup' | 'keyerror' | 'countdown' | 'fighting' | 'replay' | 'result' | 'review' | 'hall' | 'series';

const FEED_CAP = 400;
const COUNT_FROM = 3;
const SPEEDS = [0.5, 1, 2, 4, 8, 16];

export interface AppProps {
  /** Skip the wizard and fight this at once. */
  preset?: BattleConfig;
  /** Open straight onto a replay. */
  replayId?: string;
}

/** Where a replay is up to. Kept in a ref: it changes ten times a second. */
interface Playback {
  replay: Replay;
  index: number;
  clock: number;
}

export function App({ preset, replayId }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 30;
  const termCols = stdout?.columns ?? 100;
  const [phase, setPhase] = useState<Phase>('setup');
  const [hallFrom, setHallFrom] = useState<Phase>('setup');
  const [config, setConfig] = useState<BattleConfig | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [countdown, setCountdown] = useState(COUNT_FROM);

  const [leftFeed, setLeftFeed] = useState<FeedEntry[]>([]);
  const [rightFeed, setRightFeed] = useState<FeedEntry[]>([]);
  const [leftStatus, setLeftStatus] = useState<AgentStatus>('booting');
  const [rightStatus, setRightStatus] = useState<AgentStatus>('booting');
  const [pids, setPids] = useState<{ left?: number; right?: number }>({});
  const [stats, setStats] = useState<Record<Side, SideStats> | null>(null);
  const [heralds, setHeralds] = useState<Herald[]>([]);
  const [outcome, setOutcome] = useState<BattleOutcome | null>(null);
  const [record, setRecord] = useState<MatchRecord | null>(null);
  const [ledger, setLedger] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Replays.
  const [speed, setSpeed] = useState(2);
  const [paused, setPaused] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const playback = useRef<Playback | null>(null);

  // How much of each gladiator's output the panes show.
  const [detail, setDetail] = useState<'compact' | 'full'>('compact');

  // Naming a preset from the verdict screen.
  const [naming, setNaming] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  // A series of fights at once, while it runs and after, for its charts.
  const [series, setSeries] = useState<Series | null>(null);

  const refereeRef = useRef<Referee | null>(null);
  const startRef = useRef<number>(0);
  const recording = useRef<ReplayEvent[]>([]);

  const titleOf = (side: Side): string => {
    if (!config) return side;
    const sc = config[side];
    return sc.model || sc.provider;
  };
  const subtitleOf = (side: Side): string => {
    if (!config) return '';
    const sc = config[side];
    const pid = pids[side];
    const reasoning = sc.reasoning && sc.reasoning !== 'none' ? ` · ${sc.reasoning}` : '';
    return `${sc.provider}${reasoning}${pid ? ` · pid ${pid}` : ''}`;
  };

  const matchMeta = (): string => {
    if (!config) return '';
    return [
      getSandbox(config.sandbox).name,
      getDifficulty(config.difficultyId).name,
      getSetting(config.settingId).name,
    ].join('   ·   ');
  };

  const handleComplete = (cfg: BattleConfig, count = 1) => {
    setConfig(cfg);
    const miss = blockers([cfg.left.provider, cfg.right.provider], cfg.sandbox);
    if (miss.length) {
      setMissing(miss);
      setPhase('keyerror');
      return;
    }
    if (count > 1) {
      startSeries(cfg, count);
      return;
    }
    setPhase('countdown');
    setCountdown(COUNT_FROM);
  };

  const startSeries = (cfg: BattleConfig, count: number) => {
    series?.stop();
    rememberLast(cfg);
    // Eight at a time: each fight is two gladiators and up to nine decoys.
    const next = new Series({ config: cfg, count, parallel: Math.min(count, 8), swap: true }).start();
    setSeries(next);
    setPhase('series');
  };

  const leaveSeries = () => {
    series?.stop();
    setSeries(null);
    reset();
    setPhase('setup');
  };

  const reset = () => {
    refereeRef.current?.cleanup();
    refereeRef.current = null;
    playback.current = null;
    recording.current = [];
    setLeftFeed([]);
    setRightFeed([]);
    setLeftStatus('booting');
    setRightStatus('booting');
    setPids({});
    setStats(null);
    setHeralds([]);
    setOutcome(null);
    setRecord(null);
    setLedger(null);
    setElapsedMs(0);
    setNaming(null);
    setNotice('');
    setReplaying(false);
  };

  /* ------------------------------------------------------ what happened -- */

  // The same handlers serve a live match and a replay: a replay is only the
  // referee's words, played back.
  const applyEvent = (side: Side, ev: AgentEvent) => {
    if (ev.type === 'ready') {
      setPids((p) => ({ ...p, [side]: ev.pid }));
    } else if (ev.type === 'status') {
      (side === 'left' ? setLeftStatus : setRightStatus)(ev.status);
    } else if (ev.type === 'feed') {
      const push = (prev: FeedEntry[]) => {
        const next = [...prev, ev.entry];
        return next.length > FEED_CAP ? next.slice(next.length - FEED_CAP) : next;
      };
      (side === 'left' ? setLeftFeed : setRightFeed)(push);
    }
  };
  const applyStats = (s: Record<Side, SideStats>) => setStats({ left: { ...s.left }, right: { ...s.right } });
  const applyHerald = (h: Herald) => setHeralds((prev) => [...prev, h]);
  const applyOutcome = (o: BattleOutcome, r: MatchRecord | null) => {
    setOutcome(o);
    setRecord(r);
    if (r) applyStats(r.stats);
    if (o.kind === 'winner') {
      (o.winner === 'left' ? setLeftStatus : setRightStatus)('victor');
      (o.loser === 'left' ? setLeftStatus : setRightStatus)('dead');
    }
  };

  /* ----------------------------------------------------------- the fight -- */

  // Countdown then launch.
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown < 0) {
      launch();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown]);

  const launch = () => {
    if (!config) return;
    reset();
    rememberLast(config);
    const ref = new Referee();
    refereeRef.current = ref;
    startRef.current = Date.now();
    const t = () => Date.now() - startRef.current;

    ref.on('event', (side: Side, ev: AgentEvent) => {
      recording.current.push({ t: t(), type: 'event', side, event: ev });
      applyEvent(side, ev);
    });
    ref.on('stats', (s: Record<Side, SideStats>) => {
      recording.current.push({ t: t(), type: 'stats', stats: structuredClone(s) });
      applyStats(s);
    });
    ref.on('herald', (h: Herald) => {
      recording.current.push({ t: t(), type: 'herald', herald: h });
      applyHerald(h);
    });

    ref.on('outcome', (o: BattleOutcome, r: MatchRecord) => {
      applyOutcome(o, r);
      // Every match that was actually fought goes in the ledger, so casual
      // play feeds the same leaderboard as a benchmark — and on the reel.
      if (o.finish !== 'void') {
        try {
          setLedger(appendMatch(r, 'arena'));
          saveReplay({
            id: r.id,
            savedAt: new Date().toISOString(),
            config,
            outcome: o,
            record: r,
            events: recording.current,
          });
        } catch {
          /* a full disk should not spoil the ending */
        }
      }
      // Let the final blow sit on screen for a moment before the verdict.
      setTimeout(() => setPhase('result'), 1400);
    });

    setPhase('fighting');
    void ref.start(config).catch((err: any) => {
      setOutcome({ kind: 'draw', finish: 'void', reason: err?.message ?? String(err) });
      setPhase('result');
    });
  };

  // Elapsed timer during the fight.
  useEffect(() => {
    if (phase !== 'fighting') return;
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 100);
    return () => clearInterval(id);
  }, [phase]);

  /* ------------------------------------------------------------- replays -- */

  const startReplay = (id: string) => {
    const replay = loadReplay(id);
    if (!replay) {
      setNotice(`No replay called ${id}.`);
      setPhase('setup');
      return;
    }
    reset();
    setConfig(replay.config);
    setReplaying(true);
    setPaused(false);
    playback.current = { replay, index: 0, clock: 0 };
    if (series) setNotice('esc  back to the series');
    setPhase('replay');
  };

  useEffect(() => {
    if (phase !== 'replay') return;
    const TICK = 100;
    const id = setInterval(() => {
      const pb = playback.current;
      if (!pb || paused) return;
      pb.clock += TICK * speed;
      const { events } = pb.replay;
      while (pb.index < events.length && events[pb.index].t <= pb.clock) {
        const e = events[pb.index++];
        if (e.type === 'event') applyEvent(e.side, e.event);
        else if (e.type === 'stats') applyStats(e.stats);
        else applyHerald(e.herald);
      }
      setElapsedMs(pb.clock);
      if (pb.index >= events.length) {
        applyOutcome(pb.replay.outcome, pb.replay.record);
        playback.current = null;
        setTimeout(() => setPhase('result'), 1200);
      }
    }, TICK);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, speed]);

  /** Jump to the end of a replay. */
  const skipReplay = () => {
    const pb = playback.current;
    if (!pb) return;
    pb.clock = Number.MAX_SAFE_INTEGER;
    setPaused(false);
  };

  // Straight from the command line.
  useEffect(() => {
    if (replayId) startReplay(replayId);
    else if (preset) handleComplete(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => refereeRef.current?.cleanup(), []);
  useEffect(() => () => series?.stop(), [series]);

  const openHall = () => {
    setHallFrom(phase);
    setPhase('hall');
  };

  /* --------------------------------------------------------------- input -- */

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      refereeRef.current?.cleanup();
      series?.stop();
      exit();
      return;
    }

    // Typing a preset's name: every key belongs to the prompt.
    if (naming !== null) {
      if (key.escape) setNaming(null);
      else if (key.return) {
        const name = naming.trim();
        if (name && config) {
          try {
            savePreset(name, config);
            setNotice(`Saved as “${name}”. It waits on the start menu.`);
          } catch (err: any) {
            setNotice(`Could not save: ${err?.message ?? err}`);
          }
        }
        setNaming(null);
      } else if (key.backspace || key.delete) setNaming((n) => (n ?? '').slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setNaming((n) => ((n ?? '') + input.replace(/[^\w .-]/g, '')).slice(0, 40));
      return;
    }

    // During setup every letter belongs to the wizard: typing "qwen" into the
    // model filter must not quit the game.
    if (input === 'q' && phase !== 'setup') {
      refereeRef.current?.cleanup();
      series?.stop();
      exit();
      return;
    }
    // A fight watched from a series goes back to the series.
    if (series && key.escape && (phase === 'result' || phase === 'replay')) {
      reset();
      setPhase('series');
      return;
    }
    if ((phase === 'fighting' || phase === 'replay' || phase === 'review') && input === 'v') {
      setDetail((d) => (d === 'compact' ? 'full' : 'compact'));
      return;
    }
    if (phase === 'result') {
      if (input === 'r' && config) {
        reset();
        handleComplete(config);
      } else if (input === 'n') {
        series?.stop();
        setSeries(null);
        reset();
        setPhase('setup');
      } else if (input === 's' && config) setNaming('');
      else if (input === 'a') setPhase('review');
      else if (input === 'l') openHall();
    } else if (phase === 'replay') {
      if (input === ' ') setPaused((p) => !p);
      else if (key.rightArrow || input === '+' || input === '.') setSpeed((s) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s) + 1)]);
      else if (key.leftArrow || input === '-' || input === ',') setSpeed((s) => SPEEDS[Math.max(0, SPEEDS.indexOf(s) - 1)]);
      else if (input === 's') skipReplay();
      else if (key.escape) {
        reset();
        setPhase('setup');
      }
    } else if (phase === 'review' && (key.escape || input === 'a' || key.return)) {
      setPhase('result');
    } else if (phase === 'hall' && (key.escape || key.return || input === 'l')) {
      setPhase(hallFrom);
    } else if (phase === 'keyerror' && input === 'r') {
      setPhase('setup');
    }
  });

  /* -------------------------------------------------------------- screens -- */

  if (phase === 'setup') {
    return (
      <Setup
        onComplete={handleComplete}
        onHall={openHall}
        onReplay={startReplay}
        onQuit={exit}
        providerHint={(id) => providerState(id).hint}
        rows={termRows}
        cols={termCols}
      />
    );
  }

  if (phase === 'hall') return <Leaderboard rows={termRows} cols={termCols} />;

  if (phase === 'series' && series) {
    return (
      <SeriesView
        series={series}
        rows={termRows}
        cols={termCols}
        onReplay={startReplay}
        onRerun={() => startSeries(series.options.config, series.options.count)}
        onLeave={leaveSeries}
        onHall={openHall}
      />
    );
  }

  if (phase === 'keyerror') {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={1}>
        <Backdrop rows={Math.max(8, termRows - missing.length - 8)} cols={termCols} subtitle="A gladiator cannot take the field." />
        <Text color={theme.white} bold>
          {'✗  The roster is not ready'}
        </Text>
        <Box flexDirection="column" marginTop={1} alignItems="center">
          {missing.map((m) => (
            <Text key={m} color={theme.faint}>
              {m}
            </Text>
          ))}
        </Box>
        <Box marginTop={2}>
          <Text color={theme.dim}>{'press  r  to edit the roster  ·  q  to quit'}</Text>
        </Box>
      </Box>
    );
  }

  if (phase === 'countdown') {
    const n = String(countdown);
    const fight = countdown <= 0;
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" height={termRows}>
        <Picture name="colosseum" maxCols={termCols - 2} maxRows={termRows - 16} />
        <Box marginTop={1} height={5} alignItems="center">
          {fight ? (
            <Text color={theme.white} bold>
              {'F   I   G   H   T'}
            </Text>
          ) : (
            <Art art={NUMERALS[n] ?? n} from={0} to={4} />
          )}
        </Box>
        {config ? (
          <>
            <Box marginTop={1}>
              <Text color={theme.dim}>{'◀ LEFT  '}</Text>
              <Text color={theme.bright} bold>{`${titleOf('left')}  `}</Text>
              <Text color={theme.dim}>{'⚔'}</Text>
              <Text color={theme.bright} bold>{`  ${titleOf('right')}`}</Text>
              <Text color={theme.dim}>{'  RIGHT ▶'}</Text>
            </Box>
            <Text color={theme.dim}>{matchMeta()}</Text>
          </>
        ) : null}
        <Box marginTop={1}>
          <Text color={theme.charcoal} italic>
            {'ave, imperator — morituri te salutant'}
          </Text>
        </Box>
      </Box>
    );
  }

  const pane = (side: Side): SidePaneData => ({
    title: titleOf(side),
    subtitle: subtitleOf(side),
    color: side === 'left' ? theme.left : theme.right,
    status: side === 'left' ? leftStatus : rightStatus,
    feed: side === 'left' ? leftFeed : rightFeed,
    stats: stats?.[side],
  });
  const timeLimitMs = config?.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  // The herald says when the gates closed; the difficulty says for how long.
  const gatesOpenAt = () => {
    const closed = heralds.find((h) => h.text.startsWith('The gates are closed'));
    return closed && config ? closed.at + getDifficulty(config.difficultyId).preparationMs : undefined;
  };

  if (phase === 'result' && outcome) {
    return (
      <Result
        outcome={outcome}
        record={record}
        heralds={heralds}
        titles={{ left: titleOf('left'), right: titleOf('right') }}
        ledger={ledger}
        replayed={replaying}
        naming={naming}
        notice={notice}
        rows={termRows}
        cols={termCols}
      />
    );
  }

  const view = `v  ${detail === 'compact' ? 'full output' : 'compact'}`;
  const meta =
    phase === 'replay'
      ? `▶ REPLAY  ${paused ? 'paused' : `${speed}×`}   ·   space  pause   ·   ← →  speed   ·   s  skip   ·   ${view}   ·   esc  leave`
      : phase === 'review'
        ? `esc  back to the verdict   ·   ${view}`
        : `${matchMeta()}   ·   ${view}   ·   q  leave`;

  return (
    <Box flexDirection="column">
      <Arena
        left={pane('left')}
        right={pane('right')}
        elapsedMs={phase === 'review' ? (record?.durationMs ?? elapsedMs) : elapsedMs}
        timeLimitMs={timeLimitMs}
        herald={heralds[heralds.length - 1]}
        gatesOpenAtMs={gatesOpenAt()}
        detail={detail}
        meta={meta}
        rows={termRows}
      />
    </Box>
  );
}
