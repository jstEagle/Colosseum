import { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Setup } from './components/Setup.js';
import { Arena, type SidePaneData } from './components/Arena.js';
import { Result } from './components/Result.js';
import { Backdrop } from './components/Backdrop.js';
import { Referee, type BattleConfig, type BattleOutcome } from './referee.js';
import { envKeyFor } from './agent/provider.js';
import { theme } from './theme.js';
import type { AgentEvent, AgentStatus, FeedEntry, Side } from './protocol.js';

type Phase = 'setup' | 'keyerror' | 'countdown' | 'fighting' | 'result';

const FEED_CAP = 400;

function hasKey(provider: string): boolean {
  const v = process.env[envKeyFor(provider)];
  return typeof v === 'string' && v.length > 0;
}

export function App() {
  const { exit } = useApp();
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

  const handleComplete = (cfg: BattleConfig) => {
    const miss: string[] = [];
    if (!hasKey(cfg.left.provider)) miss.push(cfg.left.provider);
    if (!hasKey(cfg.right.provider) && cfg.right.provider !== cfg.left.provider) miss.push(cfg.right.provider);
    setConfig(cfg);
    if (miss.length) {
      setMissing([...new Set(miss)]);
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
    ref.start(config);
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
    if (input === 'q' || (key.ctrl && input === 'c')) {
      refereeRef.current?.cleanup();
      exit();
    }
    if (phase === 'result' && (input === 'r')) restart();
    if (phase === 'keyerror' && input === 'r') setPhase('setup');
  });

  if (phase === 'setup') {
    return <Setup onComplete={handleComplete} keyStatus={hasKey} />;
  }

  if (phase === 'keyerror') {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={2}>
        <Backdrop showArt={false} subtitle="An API key is missing." />
        <Text color={theme.blood} bold>
          No API key for: {missing.join(', ')}
        </Text>
        <Box flexDirection="column" marginTop={1} alignItems="center">
          {missing.map((p) => (
            <Text key={p} color={theme.faint}>
              export {envKeyFor(p)}=your-key
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
      <Box flexDirection="column" alignItems="center" justifyContent="center" paddingY={4}>
        <Backdrop showArt={false} />
        <Text color={theme.blood} bold>
          {countdown > 0 ? String(countdown) : 'FIGHT!'}
        </Text>
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
        <Arena left={left} right={right} elapsedMs={elapsedMs} />
        <Result outcome={outcome} leftTitle={paneTitle('left')} rightTitle={paneTitle('right')} />
      </Box>
    );
  }

  return <Arena left={left} right={right} elapsedMs={elapsedMs} />;
}
