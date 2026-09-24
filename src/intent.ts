/**
 * What is a gladiator up to? A shell command is precise but hard to read at
 * a glance, so the panes also say it in words: scanning, probing, striking.
 */
import type { AgentStatus, FeedEntry } from './protocol.js';

/** Describe one command the way a commentator would. */
export function describeCommand(raw: string): string {
  let cmd = raw.trim();
  // The sealed arena's wrapper, and a leading `cd`, say nothing about intent.
  const inner = cmd.match(/^arena\s+(['"])([\s\S]*)\1\s*$/);
  if (inner) cmd = inner[2];
  cmd = cmd.replace(/^cd\s+\S+\s*(&&|;)\s*/, '');

  const pids = (s: string) => [...s.matchAll(/(?<![\w-])(\d{2,7})\b/g)].map((m) => m[1]);
  const listOf = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')}…` : xs.join(', '));

  const strike = cmd.match(/\b(kill|pkill|killall)\b([^|;&]*)/);
  if (strike) {
    const args = strike[2];
    if (/(^|\s)-0\b|-s\s*0\b/.test(args)) {
      const p = pids(args);
      return p.length ? `checking pid ${listOf(p)} still stands` : 'checking a process still stands';
    }
    if (strike[1] !== 'kill') return `striking by name: ${args.replace(/-\w+\s*/g, '').trim().slice(0, 30)}`;
    const p = pids(args);
    return p.length ? `striking pid ${listOf(p)}` : 'striking';
  }
  const feint = cmd.match(/\bfeint\s+(.+)/);
  if (feint) return `planting a feint named ${feint[1].trim().slice(0, 30)}`;
  const disguise = cmd.match(/\bdisguise\s+(.+)/);
  if (disguise) return `slipping into a disguise: ${disguise[1].trim().slice(0, 30)}`;
  if (/\bfor\b.*\bdo\b|\bwhile\b|\bwatch\b|\bseq\b/.test(cmd) && /\bps\b|\bpgrep\b/.test(cmd)) {
    return 'watching the process table over time';
  }
  if (/\bps\b[^|]*-p\s*[\d,]+/.test(cmd)) return `inspecting pid ${listOf(pids(cmd))}`;
  if (/\bpgrep\b/.test(cmd)) return 'searching the process table';
  if (/\bps\b|\btop\b/.test(cmd)) return 'scanning the process table';
  if (/^\s*sleep\b/.test(cmd)) return 'biding its time';
  if (/\b(cat|ls|find|stat|lsof)\b/.test(cmd)) return 'poking around the filesystem';
  return 'running a command';
}

export interface Intent {
  /** What it is doing right now, in words. */
  doing: string;
  /** Its most recent thought, one line. */
  thought: string;
}

/** Summarise a feed into what the gladiator is doing and thinking. */
export function intentOf(feed: FeedEntry[], status: AgentStatus): Intent {
  let doing = '';
  let thought = '';
  for (let i = feed.length - 1; i >= 0 && (!doing || !thought); i--) {
    const e = feed[i];
    if (!doing && e.kind === 'command') doing = describeCommand(e.text);
    if (!thought && (e.kind === 'reasoning' || e.kind === 'speech')) thought = e.text.replace(/\s+/g, ' ').trim();
  }
  if (status === 'stunned') doing = 'stunned — it struck the wrong process';
  else if (status === 'dead') doing = 'fallen';
  else if (status === 'victor') doing = 'victorious';
  else if (status === 'idle') doing = 'has stopped fighting';
  else if (status === 'booting' || status === 'waiting') doing = 'entering the arena';
  else if (status === 'thinking' && doing) doing = `thinking (last: ${doing})`;
  else if (!doing) doing = 'sizing up the arena';
  return { doing, thought };
}
