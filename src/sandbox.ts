/**
 * Sandboxing.
 *
 * Colosseum hands language models a real shell, so a match always runs inside
 * a sandbox. There is no unconfined mode: if neither of these can be stood up,
 * the fight does not happen.
 *
 *   guarded — macOS Seatbelt. Commands run on the host but cannot write
 *             outside their own scratch directory, cannot read your home
 *             directory, have no network, and cannot signal any process at
 *             all: every blow is delivered by the referee, which only ever
 *             signals processes that belong to the match.
 *   sealed  — everything happens inside a disposable Docker container. The
 *             gladiators' bodies live in there too, so the fight never
 *             touches the host at all.
 *
 * The scratch space is laid out so neither side can read the other's notes:
 *
 *   root/               the referee's own papers — unreadable to both sides
 *   root/shared/        the process-table snapshot both sides may read
 *   root/c-<tag>/       one side's working directory and request queue
 *   root/c-<tag>-bin/   that side's shims: kill, pkill, killall, ps, arena
 *
 * Tags are random and decoys get corners of their own, because every path
 * here shows up in the process table: a directory called `right/` would tell
 * LEFT exactly whose shell it was looking at.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, relative, sep } from 'node:path';
import type { Side } from './protocol.js';

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
    blurb: 'Host processes; no network, no home dir, and every blow goes through the referee.',
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

/** Seatbelt is a macOS facility; everywhere else `guarded` is unavailable. */
export function seatbeltAvailable(): boolean {
  return process.platform === 'darwin' && existsSync(SANDBOX_EXEC);
}

export function shellQuote(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`;
}

/* ------------------------------------------------------------ environment -- */

/**
 * Variables a sandboxed process may inherit. Everything else — API keys,
 * cloud credentials, tokens a user happens to have exported — stays behind,
 * because a model that runs `env` would otherwise read them all out loud.
 */
const PASS_THROUGH = [
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TZ',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
];

/** A clean environment: the essentials, the PATH, and whatever is added. */
export function cleanEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of PASS_THROUGH) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  env.PATH = process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin';
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  return env;
}

/* ---------------------------------------------------------------- profiles -- */

const esc = (p: string) => p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const sub = (p: string) => `(subpath "${esc(p)}")`;
const lit = (p: string) => `(literal "${esc(p)}")`;

/** Seatbelt matches real paths, so a symlinked temp dir must be resolved. */
function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

interface ProfileSpec {
  /** The referee's scratch root: denied, except for the paths below. */
  root: string;
  /** Readable by this side: the shared snapshot and its own shims. */
  readable: string[];
  /** Readable and writable by this side. */
  own: string;
  /** Paths under $HOME this profile may read (a subscription CLI's install). */
  homeReadable: string[];
  /** Paths under $HOME this profile may write. */
  homeWritable: string[];
  /** `none` for a bare shell; `https` for a CLI that must reach its API. */
  network: 'none' | 'https';
}

/**
 * Build a Seatbelt profile. Seatbelt rules are last-match-wins, so each
 * section denies broadly and then carves out exactly what is needed.
 */
export function seatbeltProfile(spec: ProfileSpec): string {
  const home = real(homedir());
  const inHome = (p: string) => join(home, p);
  const lines = [
    '(version 1)',
    '(allow default)',
    '',
    ';; Writes: nowhere, except the scratch and temp paths tools need to run.',
    '(deny file-write*)',
    '(allow file-write*',
    '    (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper")',
    '    (regex #"^/dev/tty") (regex #"^/dev/fd/")',
    '    (subpath "/private/var/folders") (subpath "/private/tmp"))',
    '',
    ';; Your home directory is off limits: no keys, no ssh, no documents.',
    `(deny file-read* file-write* ${sub(home)})`,
  ];
  if (spec.homeReadable.length) {
    lines.push(`(allow file-read* ${spec.homeReadable.map((p) => sub(inHome(p))).join(' ')})`);
  }
  if (spec.homeWritable.length) {
    lines.push(`(allow file-read* file-write* ${spec.homeWritable.map((p) => sub(inHome(p))).join(' ')})`);
  }
  lines.push(
    '',
    ';; The referee\'s papers, and the other side\'s, are off limits.',
    `(deny file-read* file-write* ${sub(spec.root)})`,
    `(allow file-read* ${spec.readable.map(sub).join(' ')})`,
    `(allow file-read* file-write* ${sub(spec.own)})`,
    ';; Walking a path needs to stat its parents.',
    '(allow file-read-metadata)',
    '',
    ';; No process outside this sandbox can be signalled. Blows are struck',
    ';; by the referee, which only ever signals processes in the match.',
    '(deny signal)',
    '(allow signal (target same-sandbox))',
    '',
  );
  if (spec.network === 'none') {
    lines.push(';; No network at all.', '(deny network*)');
  } else {
    lines.push(
      ';; HTTPS out for the model API, and DNS. No local sockets, so no',
      ';; Docker daemon and no other local service can be reached.',
      '(deny network-outbound)',
      '(allow network-outbound (remote tcp "*:443"))',
      '(allow network-outbound (remote udp "*:53"))',
      '(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))',
    );
  }
  lines.push(
    '',
    ';; Never touch the kernel or system configuration.',
    '(deny system-kext-load)',
    '(deny system-kext-unload)',
    '(deny system-reboot)',
    '(deny system-set-time)',
  );
  return lines.join('\n') + '\n';
}

/**
 * What a subscription CLI needs to read under $HOME: its sign-in state and
 * wherever it is installed. It gets nothing else, and it may write nowhere
 * in $HOME at all, so it cannot plant hooks or MCP servers in its own
 * config for next time. Codex is the exception: it refreshes its login and
 * keeps session logs, so those paths (and only those) stay writable.
 */
function cliHomeAccess(): { readable: string[]; writable: string[] } {
  const home = real(homedir());
  const readable = new Set<string>([
    '.claude',
    '.claude.json',
    '.claude.json.backup',
    '.codex',
    'Library/Keychains',
    '.local',
  ]);
  // Wherever the CLIs were installed from: version managers, bun, cargo…
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const r = real(dir);
    if (!r.startsWith(home + sep)) continue;
    const parts = relative(home, r).split(sep);
    readable.add(parts.slice(0, Math.min(parts.length, 2)).join(sep));
  }
  return {
    readable: [...readable],
    writable: ['.codex/sessions', '.codex/archived_sessions', '.codex/log', '.codex/auth.json'],
  };
}

/* ------------------------------------------------------------------ shims -- */

/** How long a shim waits for the referee before giving up, in 50ms ticks. */
const RPC_TICKS = 1200;

/**
 * A shell function that sends one request to the referee and waits for the
 * answer. Requests are files, which is the one channel Seatbelt leaves
 * open: the side may write in its own directory, and the referee reads it.
 */
function rpcFunction(rpcDir: string): string {
  return `rpc() {
  id="$$-$(date +%s)-$n"; n=$((n+1))
  printf '%s' "$1" > "${rpcDir}/$id.tmp" && mv "${rpcDir}/$id.tmp" "${rpcDir}/$id.req"
  i=0
  while [ ! -f "${rpcDir}/$id.res" ]; do
    sleep 0.05; i=$((i+1))
    if [ $i -gt ${RPC_TICKS} ]; then echo "colosseum: the referee did not answer" >&2; return 1; fi
  done
  code=$(head -n 1 "${rpcDir}/$id.res")
  tail -n +2 "${rpcDir}/$id.res"
  rm -f "${rpcDir}/$id.res"
  return "\${code:-1}"
}
n=0`;
}

function killShim(rpcDir: string): string {
  return `#!/bin/sh
# Colosseum kill. The sandbox forbids signals outright, so this asks the
# referee to strike instead. It refuses anything outside the match.
${rpcFunction(rpcDir)}
sig=TERM
pids=""
while [ $# -gt 0 ]; do
  case "$1" in
    -l|-L) echo "HUP INT QUIT ILL TRAP ABRT EMT FPE KILL BUS SEGV SYS PIPE ALRM TERM URG STOP TSTP CONT CHLD TTIN TTOU IO XCPU XFSZ VTALRM PROF WINCH INFO USR1 USR2"; exit 0 ;;
    -s|-n) sig="$2"; shift 2; continue ;;
    --) shift; pids="$pids $*"; break ;;
    -*) sig="\${1#-}"; shift; continue ;;
    *) pids="$pids $1"; shift ;;
  esac
done
if [ -z "$pids" ]; then echo "usage: kill [-s signal | -signal] pid ..." >&2; exit 2; fi
# pkill and killall sweep up bystanders; they are skipped quietly.
verb=kill
[ -n "$CS_BULK" ] && verb=bulk
status=0
for p in $pids; do
  rpc "$verb $sig $p" || status=1
done
exit $status
`;
}

function pkillShim(binDir: string, exact: boolean): string {
  return `#!/bin/sh
# Colosseum ${exact ? 'killall' : 'pkill'}: find the pids, then strike each through kill.
sig=TERM
args=""
while [ $# -gt 0 ]; do
  case "$1" in
    -[0-9]*|-[A-Z]*|-SIG*) sig="\${1#-}"; shift ;;
    -s) sig="$2"; shift 2 ;;
    *) args="$args $1"; shift ;;
  esac
done
pids=$(/usr/bin/pgrep ${exact ? '-x ' : ''}$args | grep -v "^$$\\$")
[ -z "$pids" ] && { echo "${exact ? 'killall' : 'pkill'}: no matching processes" >&2; exit 1; }
CS_BULK=1 exec "${binDir}/kill" -s "$sig" $pids
`;
}

function psShim(snapshot: string): string {
  return `#!/bin/sh
# Colosseum ps. The real ps is setuid and cannot run under Seatbelt, so this
# serves the match's process table, refreshed continuously by the referee.
snap="${snapshot}"
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
found=1
for p in $pids; do
  awk -v want="$p" '$1 == want { print; f = 1 } END { exit !f }' "$snap" 2>/dev/null && found=0
done
exit $found
`;
}

/** Runs a command inside the sealed container, by way of the referee. */
function arenaShim(rpcDir: string): string {
  return `#!/bin/sh
# Colosseum arena: run a command inside the sealed container.
# usage: arena 'ps -o pid,args'     (or pipe the command on stdin)
${rpcFunction(rpcDir)}
if [ $# -gt 0 ]; then cmd="$*"; else cmd=$(cat); fi
[ -z "$cmd" ] && { echo "usage: arena '<command>'" >&2; exit 2; }
rpc "exec
$cmd"
`;
}

/* ---------------------------------------------------------------- scratch -- */

/** One corner of the scratch space: a gladiator's, or a decoy's. */
export class SideScratch {
  readonly dir: string;
  readonly rpcDir: string;
  readonly binDir: string;
  readonly shellProfile: string;
  readonly agentProfile: string;
  readonly bashEnv: string;
  readonly zdotdir: string;

  constructor(
    readonly side: Side | 'shade',
    root: string,
    shared: string,
    snapshot: string,
  ) {
    const tag = `c-${randomBytes(3).toString('hex')}`;
    this.dir = join(root, tag);
    this.rpcDir = join(this.dir, '.rpc');
    this.binDir = join(root, `${tag}-bin`);
    this.zdotdir = join(this.binDir, 'zsh');
    this.bashEnv = join(this.binDir, 'guard.sh');
    this.shellProfile = join(root, `${tag}.sb`);
    this.agentProfile = join(root, `${tag}-cli.sb`);
    for (const d of [this.dir, this.rpcDir, join(this.dir, 'tmp'), this.binDir, this.zdotdir]) {
      mkdirSync(d, { recursive: true });
    }

    const base = { root, readable: [shared, this.binDir], own: this.dir };
    writeFileSync(
      this.shellProfile,
      seatbeltProfile({ ...base, homeReadable: [], homeWritable: [], network: 'none' }),
    );
    const cli = cliHomeAccess();
    writeFileSync(
      this.agentProfile,
      seatbeltProfile({ ...base, homeReadable: cli.readable, homeWritable: cli.writable, network: 'https' }),
    );

    const exe = (name: string, body: string) => {
      const p = join(this.binDir, name);
      writeFileSync(p, body);
      chmodSync(p, 0o755);
    };
    exe('kill', killShim(this.rpcDir));
    exe('pkill', pkillShim(this.binDir, false));
    exe('killall', pkillShim(this.binDir, true));
    exe('ps', psShim(snapshot));
    exe('arena', arenaShim(this.rpcDir));

    // A shell builtin wins over PATH, so the guard disables `kill` first.
    // bash reads BASH_ENV; zsh reads $ZDOTDIR/.zshenv.
    const guard = [
      '# Loaded by every non-interactive shell so the shims win over the builtins.',
      `export PATH="${this.binDir}:$PATH"`,
    ];
    writeFileSync(this.bashEnv, [...guard, 'enable -n kill 2>/dev/null || true', ''].join('\n'));
    writeFileSync(join(this.zdotdir, '.zshenv'), [...guard, 'disable kill 2>/dev/null || true', ''].join('\n'));
  }

  /** The environment a sandboxed shell or CLI runs with. */
  shellEnv(): Record<string, string> {
    return cleanEnv({
      PATH: `${this.binDir}:${process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'}`,
      BASH_ENV: this.bashEnv,
      ENV: this.bashEnv,
      ZDOTDIR: this.zdotdir,
      SHELL: '/bin/bash',
      TMPDIR: join(this.dir, 'tmp'),
    });
  }
}

/**
 * Per-match scratch space: profiles, shims, the process-table snapshot and
 * each side's working directory. Deleted when the match ends.
 */
export class MatchScratch {
  readonly root: string;
  readonly shared: string;
  readonly psSnapshot: string;
  readonly sides: Record<Side, SideScratch>;

  constructor() {
    this.root = real(mkdtempSync(join(tmpdir(), 'colosseum-')));
    this.shared = join(this.root, 'shared');
    mkdirSync(this.shared, { recursive: true });
    this.psSnapshot = join(this.shared, 'ps.txt');
    writeFileSync(this.psSnapshot, '');
    this.sides = {
      left: new SideScratch('left', this.root, this.shared, this.psSnapshot),
      right: new SideScratch('right', this.root, this.shared, this.psSnapshot),
    };
  }

  /** A corner for a decoy, laid out exactly like a gladiator's. */
  shade(): SideScratch {
    return new SideScratch('shade', this.root, this.shared, this.psSnapshot);
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

  dispose() {
    try {
      rmSync(this.root, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }
}

/** Wrap a command so it runs under Seatbelt. */
export function seatbeltWrap(profilePath: string, command: string): string {
  // bash, not sh: BASH_ENV is what loads the guard that disables the `kill`
  // builtin so the shim on PATH is the one that runs. And stdin must not be
  // a socket — Node's pipes are socketpairs — or bash decides it was started
  // by sshd, reads ~/.bashrc instead, and never loads the guard at all.
  return `${SANDBOX_EXEC} -f ${shellQuote(profilePath)} /bin/bash -c ${shellQuote(command)} </dev/null`;
}

/** Wrap an argv so the whole process runs under Seatbelt. */
export function seatbeltArgv(profilePath: string, argv: string[]): string[] {
  return [SANDBOX_EXEC, '-f', profilePath, ...argv];
}
