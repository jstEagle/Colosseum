/**
 * Sandboxing.
 *
 * Colosseum hands language models a real shell, so a match always runs inside
 * a sandbox. There is no unconfined mode: if neither of these can be stood up,
 * the fight does not happen.
 *
 *   guarded — macOS Seatbelt: commands may read and inspect, but may not
 *             write outside a throwaway scratch directory, and `kill` is
 *             restricted to the processes that belong to the match.
 *   sealed  — everything happens inside a disposable Docker container. The
 *             gladiators' bodies live in there too, so the fight never
 *             touches the host at all.
 */
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type SandboxMode = 'guarded' | 'sealed';

export interface SandboxInfo {
  id: SandboxMode;
  name: string;
  blurb: string;
}

export const SANDBOXES: SandboxInfo[] = [
  {
    id: 'guarded',
    name: 'Guarded — Seatbelt',
    blurb: 'Host processes, but no file writes and kills limited to the match.',
  },
  {
    id: 'sealed',
    name: 'Sealed — Docker',
    blurb: 'The whole fight happens inside a throwaway container. Safest.',
  },
];

export function getSandbox(id: string): SandboxInfo {
  return SANDBOXES.find((s) => s.id === id) ?? SANDBOXES[0];
}

export const DEFAULT_IMAGE = process.env.COLOSSEUM_IMAGE ?? 'alpine:3.20';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

/** Seatbelt is a macOS facility; everywhere else `guarded` degrades to open. */
export function seatbeltAvailable(): boolean {
  return process.platform === 'darwin' && existsSync(SANDBOX_EXEC);
}

/**
 * A Seatbelt profile that keeps a command from modifying the machine.
 * Reads and process inspection stay allowed so the gladiators can still
 * hunt; writes are confined to the scratch directory plus the temp and
 * cache paths that ordinary tools need in order to run at all.
 */
export function seatbeltProfile(writable: string[], writableFiles: string[] = []): string {
  const esc = (p: string) => p.replace(/"/g, '\\"');
  const subpaths = [
    ...writable.filter(Boolean).map((p) => `    (subpath "${esc(p)}")`),
    ...writableFiles.filter(Boolean).map((p) => `    (literal "${esc(p)}")`),
  ].join('\n');
  return [
    '(version 1)',
    '(allow default)',
    ';; No writing anywhere by default.',
    '(deny file-write*)',
    ';; …except scratch space and the paths tools need to function.',
    '(allow file-write*',
    subpaths,
    '    (literal "/dev/null")',
    '    (literal "/dev/dtracehelper")',
    '    (regex #"^/dev/tty")',
    '    (regex #"^/dev/fd/")',
    '    (subpath "/private/var/folders")',
    '    (subpath "/private/tmp")',
    '    (subpath "/tmp")',
    ')',
    ';; Never touch the kernel or system configuration.',
    '(deny system-kext-load)',
    '(deny system-kext-unload)',
    '(deny system-reboot)',
    '(deny system-set-time)',
  ].join('\n');
}

/**
 * Per-match scratch space. Holds the Seatbelt profile and the `kill` shims
 * that keep a stray command from signalling something that is not part of
 * the fight. Deleted when the match ends.
 */
export class SandboxScratch {
  readonly dir: string;
  readonly binDir: string;
  readonly profilePath: string;
  readonly allowFile: string;
  readonly decoyFile: string;
  readonly penaltyFile: string;
  readonly bashEnvPath: string;
  readonly psSnapshot: string;

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'colosseum-'));
    this.binDir = join(this.dir, 'bin');
    mkdirSync(this.binDir, { recursive: true });
    this.profilePath = join(this.dir, 'arena.sb');
    this.allowFile = join(this.dir, 'targets');
    this.decoyFile = join(this.dir, 'decoys');
    this.penaltyFile = join(this.dir, 'penalty');
    this.bashEnvPath = join(this.dir, 'guard.sh');
    this.psSnapshot = join(this.dir, 'ps.txt');

    const home = process.env.HOME ?? '';
    writeFileSync(
      this.profilePath,
      seatbeltProfile([
        this.dir,
        join(home, '.claude'),
        join(home, '.codex'),
        join(home, '.cache'),
        join(home, 'Library/Caches'),
        join(home, '.npm'),
      ], [
        // The subscription CLIs keep state in single files next to their dirs.
        join(home, '.claude.json'),
        join(home, '.codex.json'),
      ]),
    );
    writeFileSync(this.allowFile, '');
    writeFileSync(this.decoyFile, '');
    writeFileSync(this.penaltyFile, '0');
    writeFileSync(this.psSnapshot, '');
    this.writeShims();
  }

  /** Record which pids a gladiator is permitted to signal. */
  setTargets(pids: number[]) {
    writeFileSync(this.allowFile, pids.join('\n') + '\n');
  }

  /**
   * Decoys are killable, but killing one costs time. Enforcing that in the
   * shim rather than in the tool means a subscription CLI, which runs its own
   * shell, pays the same price as an API-key model.
   */
  setDecoys(pids: number[], penaltyMs: number) {
    writeFileSync(this.decoyFile, pids.join('\n') + '\n');
    writeFileSync(this.penaltyFile, String(Math.round(penaltyMs / 1000)));
  }

  /**
   * Seatbelt refuses to execute setuid binaries, and `ps` is one, so a
   * sandboxed command cannot read the process table directly. The referee
   * keeps this snapshot fresh and the `ps` shim serves it instead.
   */
  writePsSnapshot(text: string) {
    const capped = text
      .split('\n')
      .map((l) => (l.length > 200 ? l.slice(0, 197) + '...' : l))
      .join('\n');
    try {
      writeFileSync(this.psSnapshot, capped);
    } catch {
      /* the match is probably over */
    }
  }

  /**
   * `kill` shims. A shell builtin normally wins over PATH, so the BASH_ENV
   * snippet disables the builtin first. Best effort by design: it narrows
   * accidents, it is not a security boundary. The container does that job.
   */
  private writeShims() {
    const guard = (name: string) => `#!/bin/sh
# Colosseum ${name} shim. Only processes taking part in the match may be
# signalled, and striking a decoy costs the gladiator time.
targets=$(cat "${this.allowFile}" 2>/dev/null)
decoys=$(cat "${this.decoyFile}" 2>/dev/null)
penalty=$(cat "${this.penaltyFile}" 2>/dev/null)
struck=""
for arg in "$@"; do
  case "$arg" in
    ''|*[!0-9]*) continue ;;
  esac
  ok=no
  for t in $targets; do
    [ "$arg" = "$t" ] && ok=yes
  done
  if [ "$ok" = no ]; then
    echo "colosseum: refusing to signal pid $arg — it is not part of this match" >&2
    exit 1
  fi
  for d in $decoys; do
    [ "$arg" = "$d" ] && struck="$arg"
  done
done
if [ -n "$struck" ] && [ "${'$'}{penalty:-0}" -gt 0 ] 2>/dev/null; then
  echo "colosseum: pid $struck was a decoy, not your opponent. Stunned ${'$'}{penalty}s." >&2
  sleep "$penalty"
fi
exec /bin/${name} "$@"
`;

    for (const name of ['kill', 'pkill', 'killall']) {
      const p = join(this.binDir, name);
      writeFileSync(p, guard(name));
      chmodSync(p, 0o755);
    }

    // `ps` shim: prints the referee's snapshot. It understands -p so a
    // gladiator can ask about specific pids instead of reading the whole
    // process table, which would be a waste of everyone's context.
    const psShim = `#!/bin/sh
# Colosseum ps shim. The real ps is setuid and cannot run under Seatbelt,
# so this serves a process-table snapshot refreshed by the referee.
snap="${this.psSnapshot}"
pids=""
prev=""
for arg in "$@"; do
  case "$prev" in
    -p|-q|--pid) pids="$pids $(echo "$arg" | tr ',' ' ')" ;;
  esac
  case "$arg" in
    -p?*) pids="$pids $(echo "\${arg#-p}" | tr ',' ' ')" ;;
  esac
  prev="$arg"
done
if [ -z "$pids" ]; then
  cat "$snap" 2>/dev/null
  exit 0
fi
head -n 1 "$snap" 2>/dev/null
for p in $pids; do
  awk -v want="$p" '$1 == want' "$snap" 2>/dev/null
done
`;
    const psPath = join(this.binDir, 'ps');
    writeFileSync(psPath, psShim);
    chmodSync(psPath, 0o755);
    writeFileSync(
      this.bashEnvPath,
      [
        '# Loaded by non-interactive bash so the shims win over the builtin.',
        'enable -n kill 2>/dev/null || true',
        `export PATH="${this.binDir}:$PATH"`,
        '',
      ].join('\n'),
    );
  }

  env(): Record<string, string> {
    return {
      PATH: `${this.binDir}:${process.env.PATH ?? ''}`,
      BASH_ENV: this.bashEnvPath,
      ENV: this.bashEnvPath,
      // Tells the shell tool that penalties are already handled out here.
      CS_SHIMS_ACTIVE: '1',
    };
  }

  dispose() {
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }
}

/** Wrap a command so it runs under Seatbelt, when Seatbelt is available. */
export function seatbeltWrap(profilePath: string, command: string): string {
  // bash, not sh: BASH_ENV is what loads the guard that disables the `kill`
  // builtin so the shim on PATH is the one that runs.
  return `${SANDBOX_EXEC} -f ${shellQuote(profilePath)} /bin/bash -c ${shellQuote(command)}`;
}

/** Wrap an argv so the whole process runs under Seatbelt. */
export function seatbeltArgv(profilePath: string, argv: string[]): string[] {
  return [SANDBOX_EXEC, '-f', profilePath, ...argv];
}

export function shellQuote(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`;
}
