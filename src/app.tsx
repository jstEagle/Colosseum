import { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { Setup } from './components/Setup.js';
import { Arena, type SidePaneData } from './components/Arena.js';
import { Result } from './components/Result.js';
import { Backdrop } from './components/Backdrop.js';
import { Referee, type BattleConfig, type BattleOutcome } from './referee.js';
import { blockers, providerState } from './preflight.js';
import { getDifficulty } from './difficulty.js';
import { getSandbox } from './sandbox.js';
import { getSetting } from './settings.js';
import { Art } from './components/Art.js';
import { rule } from './ascii.js';
import { theme } from './theme.js';
import type { AgentEvent, AgentStatus, FeedEntry, Side } from './protocol.js';

type Phase = 'setup' | 'keyerror' | 'countdown' | 'fighting' | 'result';

const FEED_CAP = 400;
/** Rows the result panel needs; the arena gives up exactly that many. */
const RESULT_ROWS = 15;

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 30;
  const [phase, setPhase] = useState<Phase>('setup');
  const [config, setConfig] = useState<BattleConfig | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [countdown, setCountdown] = useState(3);

  const [leftFeed, setLeftFeed] = useState<FeedEntry[]>([]);
  const [rightFeed, setRightFeed] = useState<FeedEntry[]>([]);
  const [leftStatus, setLeftStatus] = useState<AgentStatus>('booting');
  const [rightStatus, setRightStatus] = useState<AgentStatus>('booting');
  const [pids, setPids] = useState<{ left?: number; right?: number }>({});
  const [outcome, setOutcome] = useState<BattleOutcome | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const refereeRef = useRef<Referee | null>(null);
  const startRef = useRef<number>(0);

  const paneTitle = (side: Side): string => {
    if (!config) return side;
    const sc = side === 'left' ? config.left : config.right;
    return sc.model || sc.provider;
  };
  const paneSubtitle = (side: Side): string => {
    if (!config) return '';
    const sc = side === 'left' ? config.left : config.right;
    const pid = pids[side];
    return `${sc.provider} · ${sc.reasoning}${pid ? ` · pid ${pid}` : ''}`;
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
    setCountdown(3);
  };

  const restart = () => {
    refereeRef.current?.cleanup();
    refereeRef.current = null;
    setLeftFeed([]);
    setRightFeed([]);
    setLeftStatus('booting');
    setRightStatus('booting');
    setPids({});
    setOutcome(null);
    setElapsedMs(0);
    setPhase('setup');
  };

  // Countdown then launch.
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      launch();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown]);

  const launch = () => {
    if (!config) return;
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

    ref.on('outcome', (o: BattleOutcome) => {
      setOutcome(o);
      if (o.kind === 'winner') {
        (o.winner === 'left' ? setLeftStatus : setRightStatus)('victor');
        (o.loser === 'left' ? setLeftStatus : setRightStatus)('dead');
      }
      setTimeout(() => setPhase('result'), 900);
    });

    setPhase('fighting');
    void ref.start(config).catch((err: any) => {
      setOutcome({ kind: 'draw', reason: err?.message ?? String(err) });
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

  useInput((input, key) => {
    // During setup every letter belongs to the wizard: typing "qwen" into the
    // model filter must not quit the game.
    if ((input === 'q' && phase !== 'setup') || (key.ctrl && input === 'c')) {
      refereeRef.current?.cleanup();
      exit();
    }
    if (phase === 'result' && (input === 'r')) restart();
    if (phase === 'keyerror' && input === 'r') setPhase('setup');
  });

  if (phase === 'setup') {
    return (
      <Setup onComplete={handleComplete} providerHint={(id) => providerState(id).hint} rows={termRows} />
    );
  }

  if (phase === 'keyerror') {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={2}>
        <Backdrop showArt={false} subtitle="A gladiator cannot take the field." rows={termRows} />
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
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" paddingY={2}>
        <Backdrop showArt={termRows >= 28} rows={termRows} />
        <Box marginTop={1}>
          <Text color={theme.charcoal}>{rule(40, countdown > 0 ? '·' : '✦')}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.white} bold>
            {countdown > 0 ? `·  ${countdown}  ·` : 'F I G H T'}
          </Text>
        </Box>
        {config ? (
          <Box marginTop={1}>
            <Text color={theme.dim}>{matchMeta()}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  const left: SidePaneData = {
    title: paneTitle('left'),
    subtitle: paneSubtitle('left'),
    color: theme.left,
    status: leftStatus,
    feed: leftFeed,
  };
  const right: SidePaneData = {
    title: paneTitle('right'),
    subtitle: paneSubtitle('right'),
    color: theme.right,
    status: rightStatus,
    feed: rightFeed,
  };

  if (phase === 'result' && outcome) {
    return (
      <Box flexDirection="column">
        <Arena
          left={left}
          right={right}
          elapsedMs={elapsedMs}
          rows={Math.max(12, termRows - RESULT_ROWS)}
        />
        <Result
          outcome={outcome}
          leftTitle={paneTitle('left')}
          rightTitle={paneTitle('right')}
          rows={RESULT_ROWS}
        />
      </Box>
    );
  }

  return <Arena left={left} right={right} elapsedMs={elapsedMs} meta={matchMeta()} rows={termRows} />;
}
