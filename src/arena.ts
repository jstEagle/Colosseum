/**
 * The arena is the ground the fight happens on.
 *
 * A gladiator defends a *body*: the process whose death ends its match. On the
 * host the body is the gladiator's own process. Inside a container the body is
 * a process in that container, which means the models can hunt and kill
 * freely without any of it reaching your machine.
 *
 * Either way, blows are struck by the referee through `signal`, never by the
 * models directly, so nothing outside the match can be hit.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_IMAGE, cleanEnv, seatbeltWrap, type SandboxMode, type SideScratch } from './sandbox.js';

const execFileAsync = promisify(execFile);

export interface ArenaBody {
  pid: number;
  name: string;
}

export interface ExecResult {
  code: number;
  output: string;
}

export type SignalResult = 'ok' | 'gone' | 'error';

export interface Arena {
  readonly mode: SandboxMode;
  /** Stand the arena up. Throws with a readable message if it cannot. */
  prepare(): Promise<void>;
  /** Create the process a gladiator must defend, if the arena owns it. */
  createBody(name: string): Promise<ArenaBody | null>;
  /**
   * Plant look-alike processes for the gladiators to waste blows on. With
   * `corners`, one per decoy, they breathe: see Difficulty.activeDecoys.
   */
  createDecoys(names: string[], corners?: SideScratch[]): Promise<number[]>;
  /** Which of these pids are still breathing? */
  alive(pids: number[]): Promise<Set<number>>;
  /** Deliver a signal. Only the referee calls this, and only for targets. */
  signal(pid: number, signal: string): Promise<SignalResult>;
  /** Run a model's command in the arena (sealed only). */
  exec(command: string, timeoutMs: number): Promise<ExecResult>;
  /**
   * The match's slice of the process table, for the sandboxed `ps`: the
   * given roots (bodies, decoys) and everything beneath them.
   */
  processTable(roots: number[]): Promise<string>;
  /** How the gladiators should be told to look around. */
  briefing(): string[];
  teardown(): Promise<void>;
}

/** Signal names the arena understands, keyed by number. */
const SIGNALS: Record<string, string> = {
  '0': '0', '1': 'HUP', '2': 'INT', '3': 'QUIT', '6': 'ABRT', '9': 'KILL', '10': 'BUS',
  '11': 'SEGV', '13': 'PIPE', '14': 'ALRM', '15': 'TERM', '17': 'STOP', '18': 'TSTP',
  '19': 'CONT', '30': 'USR1', '31': 'USR2',
};

/** Normalise `9`, `-9`, `KILL`, `SIGKILL`, `sigkill` to a bare name, or null. */
export function parseSignal(raw: string): string | null {
  const s = raw.trim().replace(/^-/, '').toUpperCase().replace(/^SIG/, '');
  if (/^\d+$/.test(s)) return SIGNALS[String(Number(s))] ?? null;
  return Object.values(SIGNALS).includes(s) ? s : null;
}

/* ------------------------------------------------------------------ host -- */

/**
 * A decoy is a small node process under a borrowed name. It has to be node:
 * the kernel's short process name (what `pgrep -l` prints) is `node` for a
 * gladiator whatever its title says, so a decoy that ran `cat` could be told
 * apart in one command.
 */
const DECOY_SCRIPT = (name: string, breath: { commands: string[]; cwd: string; env: Record<string, string> } | null) =>
  `process.title=${JSON.stringify(name)};` +
  // A gladiator spends a few hundred milliseconds of CPU loading its SDK, and
  // `ps` shows accumulated CPU time, so a decoy pays a similar entry fee.
  `{const t=Date.now(),n=150+Math.random()*300;while(Date.now()-t<n);}` +
  `process.stdin.on('end',()=>process.exit(0));process.stdin.resume();` +
  `setInterval(()=>{},1<<30);` +
  (breath
    ? // Now and then: think (a burst of CPU), then look around (a sandboxed
      // shell, wrapped exactly as a gladiator's own commands are).
      `const {spawn}=require('child_process');const B=${JSON.stringify(breath)};` +
      `const breathe=()=>setTimeout(()=>{const t=Date.now(),n=120+Math.random()*420;while(Date.now()-t<n);` +
      `const c=B.commands[Math.floor(Math.random()*B.commands.length)];` +
      `const p=spawn('/bin/bash',['-c',c],{stdio:'ignore',cwd:B.cwd,env:B.env});` +
      `p.on('exit',breathe);p.on('error',breathe);},first?(first=0,300+Math.random()*2000):1500+Math.random()*4500);` +
      // The first breath comes as the gates open, when every gladiator is
      // busy too: a decoy that sat still then would stand out.
      `let first=1;breathe();`
    : '');

/** What a breathing decoy pretends to be doing. */
const BREATHS = [
  'ps',
  'ps -o pid,ppid,stat',
  'ps -eo pid,ppid,stat,etime,comm,args',
  'ps -eo pid,ppid,stat,%cpu,time,comm',
  'pgrep -l .',
  'pgrep -af .',
  'pgrep -f node',
  'ps | sort -k4 -nr | head -5',
  'ps | grep -v grep | wc -l',
  'ps -p $PPID',
  'for i in 1 2 3; do ps >/dev/null; sleep 0.2; done',
  'ps -A | head -20',
];

/**
 * The guarded arena. The fight happens on the host, but every command the
 * models run is wrapped in Seatbelt first. The gladiator processes themselves
 * are the bodies, so the referee passes their pids in rather than creating
 * anything.
 */
export class HostArena implements Arena {
  readonly mode: SandboxMode = 'guarded';
  private decoys: ChildProcess[] = [];

  async prepare() {
    /* nothing to stand up */
  }

  async createBody(): Promise<ArenaBody | null> {
    // The referee's own child process is the body on the host.
    return null;
  }

  async createDecoys(names: string[], corners?: SideScratch[]): Promise<number[]> {
    const pids: number[] = [];
    for (const [i, name] of names.entries()) {
      const corner = corners?.[i];
      const breath = corner
        ? {
            commands: BREATHS.map((c) => seatbeltWrap(corner.shellProfile, c)),
            cwd: corner.dir,
            env: corner.shellEnv(),
          }
        : null;
      const child = spawn(process.execPath, ['-e', DECOY_SCRIPT(name, breath)], {
        // The pipe stays open for the life of the match; its closing is what
        // reaps the decoys if the referee goes away unexpectedly.
        stdio: ['pipe', 'ignore', 'ignore'],
        env: cleanEnv(),
        // Session leaders, like the gladiators, or `ps` would tell them apart.
        detached: true,
      });
      child.on('error', () => {
        /* a missing decoy is not worth ending a match over */
      });
      this.decoys.push(child);
      if (child.pid) pids.push(child.pid);
    }
    // Give the titles a moment to land before anyone looks.
    await new Promise((r) => setTimeout(r, 60));
    return pids;
  }

  async alive(pids: number[]): Promise<Set<number>> {
    const out = new Set<number>();
    for (const pid of pids) {
      try {
        process.kill(pid, 0);
        out.add(pid);
      } catch {
        /* gone */
      }
    }
    return out;
  }

  async signal(pid: number, signal: string): Promise<SignalResult> {
    try {
      process.kill(pid, signal === '0' ? 0 : (`SIG${signal}` as NodeJS.Signals));
      return 'ok';
    } catch (err: any) {
      return err?.code === 'ESRCH' ? 'gone' : 'error';
    }
  }

  async exec(): Promise<ExecResult> {
    return { code: 1, output: 'arena: there is no container in a guarded match; run commands directly.' };
  }

  /**
   * Only this match: its bodies, its decoys and whatever the gladiators are
   * running. The rest of your machine is none of their business — nor is any
   * other match fought from the same process, as in a series.
   */
  async processTable(roots: number[]): Promise<string> {
    let stdout = '';
    try {
      // CPU columns on purpose: a gladiator that is thinking burns CPU and a
      // decoy does not, which is the honest way to tell them apart.
      ({ stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid,ppid,stat,%cpu,time,command'], {
        maxBuffer: 8 * 1024 * 1024,
      }));
    } catch {
      return '';
    }
    const [header, ...rows] = stdout.split('\n');
    const parsed = rows
      .map((line) => {
        const m = line.match(/^\s*(\d+)\s+(\d+)\s/);
        return m ? { pid: Number(m[1]), ppid: Number(m[2]), line } : null;
      })
      .filter((r): r is { pid: number; ppid: number; line: string } => r !== null);

    const inMatch = new Set<number>(roots);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of parsed) {
        if (!inMatch.has(r.pid) && inMatch.has(r.ppid)) {
          inMatch.add(r.pid);
          grew = true;
        }
      }
    }
    const lines = parsed
      // tsx's compiler service only exists when running from source.
      .filter((r) => inMatch.has(r.pid))
      .map((r) => r.line);
    return [header, ...lines].join('\n') + '\n';
  }

  briefing(): string[] {
    return [
      'Your shell is confined by a sandbox: no network, no files outside your',
      'working directory, and no direct signals. `kill`, `pkill` and `killall`',
      'ask the referee to strike for you, and it only strikes processes in the match.',
      '`ps` serves the match\'s process table, refreshed continuously; `pgrep` works too.',
    ];
  }

  async teardown() {
    for (const child of this.decoys) {
      try {
        child.stdin?.end();
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
    this.decoys = [];
  }
}

/* ---------------------------------------------------------------- docker -- */

/**
 * The sealed arena. A throwaway container holds both bodies and every decoy,
 * and every command a model runs is executed inside it by the referee.
 * Nothing the models do can reach the host.
 */
export class DockerArena implements Arena {
  readonly mode: SandboxMode = 'sealed';
  readonly container: string;
  private started = false;

  constructor(token: string, private image: string = DEFAULT_IMAGE) {
    const slug = token.replace(/^COLOSSEUM_/i, '').toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    this.container = `colosseum-${slug}`;
  }

  async prepare() {
    try {
      await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 15_000 });
    } catch {
      throw new Error(
        'Docker is not reachable. Start Docker Desktop (or the daemon) and try again, ' +
          'or choose a different sandbox in setup.',
      );
    }

    try {
      await execFileAsync('docker', ['image', 'inspect', this.image], { timeout: 15_000 });
    } catch {
      await execFileAsync('docker', ['pull', this.image], { timeout: 180_000 });
    }

    await execFileAsync(
      'docker',
      [
        'run', '--rm', '-d',
        '--name', this.container,
        '--network', 'none',
        '--memory', '256m',
        '--cpus', '1',
        '--pids-limit', '256',
        // Everyone in here is the same unprivileged user, so the gladiators
        // can kill each other without any capability at all.
        '--user', '65534:65534',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '--read-only',
        '--tmpfs', '/tmp:rw,size=16m,mode=1777',
        '--tmpfs', '/usr/local/bin:rw,exec,size=1m,mode=1777',
        this.image,
        '/bin/sh', '-c', 'while true; do sleep 3600; done',
      ],
      { timeout: 60_000 },
    );
    this.started = true;
  }

  private async sh(script: string, timeout = 15_000): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['exec', this.container, '/bin/sh', '-c', script],
        { timeout, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' },
      );
      return { code: 0, output: `${stdout}${stderr}` };
    } catch (err: any) {
      const out = `${err?.stdout ?? ''}${err?.stderr ?? ''}`;
      if (err?.killed) return { code: 124, output: `${out}\n[timed out]`.trim() };
      return { code: typeof err?.code === 'number' ? err.code : 1, output: out };
    }
  }

  async createBody(name: string): Promise<ArenaBody> {
    return { pid: await this.spawnInside(name), name };
  }

  async createDecoys(names: string[]): Promise<number[]> {
    const pids: number[] = [];
    for (const name of names) {
      try {
        pids.push(await this.spawnInside(name));
      } catch {
        /* a missing decoy is not worth ending a match over */
      }
    }
    return pids;
  }

  /**
   * Start a long-lived process in the container under a chosen name and
   * return its pid.
   *
   * Busybox has no `exec -a`, and a backgrounded process dies with the exec
   * session that started it, so the name comes from a small script on disk
   * and the process is started detached. Bodies and decoys are created the
   * same way on purpose: in the process table they are indistinguishable.
   */
  private async spawnInside(name: string): Promise<number> {
    const safe = name.replace(/[^A-Za-z0-9_.-]/g, '') || 'arena';
    const path = `/usr/local/bin/${safe}`;
    const pidFile = `/tmp/.pid-${safe}`;
    const script = ['#!/bin/sh', `echo $$ > ${pidFile}`, 'while true; do sleep 3600; done'].join('\n');

    await this.sh(`cat > ${path} <<'EOF'\n${script}\nEOF\nchmod +x ${path}`);
    await execFileAsync('docker', ['exec', '-d', this.container, path], { timeout: 20_000 });

    // The script writes its pid as its first act; give it a moment to land.
    for (let attempt = 0; attempt < 20; attempt++) {
      const { output } = await this.sh(`cat ${pidFile} 2>/dev/null`);
      const pid = Number.parseInt(output.trim(), 10);
      if (Number.isFinite(pid) && pid > 0) {
        await this.sh(`rm -f ${pidFile}`);
        return pid;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`could not start arena process ${name}`);
  }

  async alive(pids: number[]): Promise<Set<number>> {
    if (!this.started || !pids.length) return new Set();
    const { output } = await this.sh(
      `for p in ${pids.join(' ')}; do kill -0 $p 2>/dev/null && echo $p; done; true`,
      10_000,
    );
    return new Set(
      output
        .split('\n')
        .map((l) => Number.parseInt(l, 10))
        .filter((n) => Number.isFinite(n)),
    );
  }

  async signal(pid: number, signal: string): Promise<SignalResult> {
    if (!this.started) return 'gone';
    const { code, output } = await this.sh(`kill -${signal} ${pid}`, 10_000);
    if (code === 0) return 'ok';
    return /no such process/i.test(output) ? 'gone' : 'error';
  }

  async exec(command: string, timeoutMs: number): Promise<ExecResult> {
    if (!this.started) return { code: 1, output: 'the arena is closed' };
    return this.sh(command, timeoutMs);
  }

  async processTable(): Promise<string> {
    const { output } = await this.sh('ps -o pid,ppid,args 2>/dev/null || ps');
    return output;
  }

  briefing(): string[] {
    return [
      'The fight happens inside a sealed container. Every command you run executes',
      'in there, and the bodies live in there too. The host is out of reach.',
    ];
  }

  async teardown() {
    if (!this.started) return;
    this.started = false;
    try {
      await execFileAsync('docker', ['kill', this.container], { timeout: 20_000 });
    } catch {
      /* already stopped */
    }
  }
}

export function createArena(mode: SandboxMode, token: string): Arena {
  return mode === 'sealed' ? new DockerArena(token) : new HostArena();
}
