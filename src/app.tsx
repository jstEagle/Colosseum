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
import { NUMERALS, rule } from './ascii.js';
import { theme } from './theme.js';
import type { AgentEvent, AgentStatus, FeedEntry, Side } from './protocol.js';

type Phase = 'setup' | 'keyerror' | 'countdown' | 'fighting' | 'result' | 'review' | 'hall';

const FEED_CAP = 400;
const COUNT_FROM = 3;

export function App() {
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

  const refereeRef = useRef<Referee | null>(null);
  const startRef = useRef<number>(0);

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

  const handleComplete = (cfg: BattleConfig) => {
    setConfig(cfg);
    const miss = blockers([cfg.left.provider, cfg.right.provider], cfg.sandbox);
    if (miss.length) {
      setMissing(miss);
      setPhase('keyerror');
      return;
    }
    setPhase('countdown');
    setCountdown(COUNT_FROM);
  };

  const reset = () => {
    refereeRef.current?.cleanup();
    refereeRef.current = null;
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
  };

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
    const ref = new Referee();
    refereeRef.current = ref;
    startRef.current = Date.now();

    ref.on('event', (side: Side, ev: AgentEvent) => {
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
    });
    ref.on('stats', (s: Record<Side, SideStats>) => setStats({ left: { ...s.left }, right: { ...s.right } }));
    ref.on('herald', (h: Herald) => setHeralds((prev) => [...prev, h]));

    ref.on('outcome', (o: BattleOutcome, r: MatchRecord) => {
      setOutcome(o);
      setRecord(r);
      setStats({ left: { ...r.stats.left }, right: { ...r.stats.right } });
      if (o.kind === 'winner') {
        (o.winner === 'left' ? setLeftStatus : setRightStatus)('victor');
        (o.loser === 'left' ? setLeftStatus : setRightStatus)('dead');
      }
      // Every match that was actually fought goes in the ledger, so casual
      // play feeds the same leaderboard as a benchmark.
      if (o.finish !== 'void') {
        try {
          setLedger(appendMatch(r, 'arena'));
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

  // Cleanup on unmount.
  useEffect(() => () => refereeRef.current?.cleanup(), []);

  const openHall = () => {
    setHallFrom(phase);
    setPhase('hall');
  };

  useInput((input, key) => {
    // During setup every letter belongs to the wizard: typing "qwen" into the
    // model filter must not quit the game.
    if ((input === 'q' && phase !== 'setup') || (key.ctrl && input === 'c')) {
      refereeRef.current?.cleanup();
      exit();
    }
    if (phase === 'result') {
      if (input === 'r') {
        reset();
        setPhase('setup');
      } else if (input === 'a') setPhase('review');
      else if (input === 'l') openHall();
    } else if (phase === 'review' && (key.escape || input === 'a' || key.return)) {
      setPhase('result');
    } else if (phase === 'hall' && (key.escape || key.return || input === 'l')) {
      setPhase(hallFrom);
    } else if (phase === 'keyerror' && input === 'r') {
      setPhase('setup');
    }
  });

  if (phase === 'setup') {
    return (
      <Setup
        onComplete={handleComplete}
        onHall={openHall}
        providerHint={(id) => providerState(id).hint}
        rows={termRows}
        cols={termCols}
      />
    );
  }

  if (phase === 'hall') return <Leaderboard rows={termRows} cols={termCols} />;

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
              <Text color={theme.bright} bold>{`${titleOf('left')}  `}</Text>
              <Text color={theme.dim}>{'⚔'}</Text>
              <Text color={theme.muted} bold>{`  ${titleOf('right')}`}</Text>
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

  if (phase === 'result' && outcome) {
    return (
      <Result
        outcome={outcome}
        record={record}
        heralds={heralds}
        titles={{ left: titleOf('left'), right: titleOf('right') }}
        ledger={ledger}
        rows={termRows}
        cols={termCols}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Arena
        left={pane('left')}
        right={pane('right')}
        elapsedMs={record?.durationMs ?? elapsedMs}
        timeLimitMs={timeLimitMs}
        herald={heralds[heralds.length - 1]}
        meta={phase === 'review' ? `${rule(12, '·')}  esc  back to the verdict  ${rule(12, '·')}` : matchMeta()}
        rows={termRows}
      />
    </Box>
  );
}
