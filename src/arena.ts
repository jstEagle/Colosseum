/**
 * The arena is the ground the fight happens on.
 *
 * A gladiator defends a *body*: the process whose death ends its match. On the
 * host the body is the gladiator's own process, exactly as before. Inside a
 * container the body is a process in that container, which means the models
 * can hunt and kill freely without any of it reaching your machine.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_IMAGE, SandboxScratch, seatbeltWrap, shellQuote, type SandboxMode } from './sandbox.js';

const execFileAsync = promisify(execFile);

export interface ArenaBody {
  pid: number;
  name: string;
}

export interface Arena {
  readonly mode: SandboxMode;
  /** Stand the arena up. Throws with a readable message if it cannot. */
  prepare(): Promise<void>;
  /** Create the process a gladiator must defend, if the arena owns it. */
  createBody(name: string): Promise<ArenaBody | null>;
  /** Plant look-alike processes for the gladiators to waste blows on. */
  createDecoys(names: string[]): Promise<number[]>;
  /** Is this body still breathing? */
  isAlive(pid: number): Promise<boolean>;
  /** Turn a model's command into the command actually executed. */
  wrapCommand(command: string): string;
  /** Extra environment a gladiator process needs. */
  env(): Record<string, string>;
  /** A snapshot of the arena's process table, for the sandboxed `ps` shim. */
  processTable(): Promise<string>;
  /** How the gladiators should be told to look around. */
  briefing(): string[];
  teardown(): Promise<void>;
}

/* ------------------------------------------------------------------ host -- */

/**
 * The guarded arena. The fight happens on the host, but every command the
 * models run is wrapped in Seatbelt first. The gladiator processes themselves
 * are the bodies, so the referee passes their pids in rather than creating
 * anything.
 */
export class HostArena implements Arena {
  readonly mode: SandboxMode;
  private decoyProcs: number[] = [];
  private decoyPipes: ReturnType<typeof spawn>[] = [];

  constructor(private scratch: SandboxScratch) {
    this.mode = 'guarded';
  }

  async prepare() {
    /* nothing to stand up */
  }

  async createBody(): Promise<ArenaBody | null> {
    // The referee's own child process is the body on the host.
    return null;
  }

  async createDecoys(names: string[]): Promise<number[]> {
    for (const name of names) {
      // `cat` with no arguments blocking on a pipe, not `sleep 900`: a
      // decoy that shows an argument in the process table is no decoy at
      // all. Each one also carries a child, so "has children" cannot be
      // used to tell a real gladiator from a shade either.
      const child = spawn(
        '/bin/sh',
        [
          '-c',
          // fd 3 keeps the backgrounded child on the same pipe; a background
          // job in a non-interactive shell otherwise reads EOF and dies.
          `exec 3<&0; { exec -a ${shellQuote(name + '-worker')} /bin/cat 0<&3 ; } & ` +
            `exec -a ${shellQuote(name)} /bin/cat`,
        ],
        { stdio: ['pipe', 'ignore', 'ignore'] },
      );
      child.on('error', () => {
        /* a missing decoy is not worth ending a match over */
      });
      // The pipe stays open for the life of the match; closing it is what
      // reaps the decoys if the referee goes away unexpectedly.
      this.decoyPipes.push(child);
      if (child.pid) this.decoyProcs.push(child.pid);
    }
    return [...this.decoyProcs];
  }

  async isAlive(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  wrapCommand(command: string): string {
    return seatbeltWrap(this.scratch.profilePath, command);
  }

  env(): Record<string, string> {
    return this.scratch.env();
  }

  async processTable(): Promise<string> {
    try {
      const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid,ppid,stat,command'], {
        maxBuffer: 4 * 1024 * 1024,
      });
      return stdout;
    } catch {
      return '';
    }
  }

  briefing(): string[] {
    return [
      'Your shell is confined by a sandbox: you can read and inspect anything,',
      'but you cannot write files outside your scratch directory, and you may',
      'only signal processes that belong to this match.',
      '`ps` serves a snapshot of the process table refreshed continuously by the',
      'referee; `pgrep`, `kill` and the rest behave normally.',
    ];
  }

  async teardown() {
    for (const proc of this.decoyPipes) {
      try {
        proc.stdin?.end();
      } catch {
        /* already closed */
      }
    }
    for (const pid of this.decoyProcs) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    this.decoyProcs = [];
    this.decoyPipes = [];
  }
}

/* ---------------------------------------------------------------- docker -- */

/**
 * The sealed arena. A throwaway container holds both bodies and every decoy,
 * and every command a model runs is executed inside it. Nothing the models do
 * can reach the host.
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
        '--memory', '512m',
        '--pids-limit', '256',
        '--cap-drop', 'ALL',
        '--cap-add', 'KILL',
        this.image,
        '/bin/sh', '-c', 'while true; do sleep 3600; done',
      ],
      { timeout: 60_000 },
    );
    this.started = true;
  }

  private async exec(args: string[], timeout = 15_000): Promise<string> {
    const { stdout, stderr } = await execFileAsync('docker', ['exec', this.container, ...args], {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
    return `${stdout}${stderr}`;
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
    const script = [
      '#!/bin/sh',
      `echo $$ > ${pidFile}`,
      'while true; do sleep 3600; done',
    ].join('\n');

    await this.exec(['/bin/sh', '-c', `cat > ${path} <<'EOF'\n${script}\nEOF\nchmod +x ${path}`]);
    await execFileAsync('docker', ['exec', '-d', this.container, path], { timeout: 20_000 });

    // The script writes its pid as its first act; give it a moment to land.
    for (let attempt = 0; attempt < 20; attempt++) {
      const out = await this.exec(['/bin/sh', '-c', `cat ${pidFile} 2>/dev/null || true`]);
      const pid = Number.parseInt(out.trim(), 10);
      if (Number.isFinite(pid) && pid > 0) return pid;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`could not start arena process ${name}`);
  }

  async isAlive(pid: number): Promise<boolean> {
    if (!this.started) return false;
    try {
      await this.exec(['/bin/sh', '-c', `kill -0 ${pid}`], 10_000);
      return true;
    } catch {
      return false;
    }
  }

  wrapCommand(command: string): string {
    return `docker exec ${this.container} /bin/sh -c ${shellQuote(command)}`;
  }

  env(): Record<string, string> {
    return { CS_CONTAINER: this.container };
  }

  async processTable(): Promise<string> {
    try {
      return await this.exec(['/bin/sh', '-c', 'ps -o pid,ppid,args 2>/dev/null || ps']);
    } catch {
      return '';
    }
  }

  briefing(): string[] {
    return [
      `The fight happens inside a sealed container named ${this.container}.`,
      'Every command you run executes in there, and the bodies live in there too.',
      'The host machine is out of reach and irrelevant: hunt inside the container.',
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

export function createArena(mode: SandboxMode, token: string, scratch: SandboxScratch): Arena {
  return mode === 'sealed' ? new DockerArena(token) : new HostArena(scratch);
}
