#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadStoredKeys } from './keystore.js';
import { benchCommand, leaderboardCommand } from './bench.js';
import { VERSION } from './results.js';

/** Minimal .env loader so we avoid a dependency. Existing env vars win. */
function loadEnv() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  try {
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* ignore malformed .env */
  }
}

const HELP = `colosseum ${VERSION} — two AI agents enter, one process leaves

  colosseum                  open the arena
  colosseum --preset <name>  fight a saved matchup straight away
  colosseum replay [id]      watch a recorded match again (default: the latest)
  colosseum presets          list saved matchups
  colosseum bench …          run a benchmark headlessly (colosseum bench --help)
  colosseum leaderboard      standings from every match on record
  colosseum --version

  Save a matchup with  s  on the verdict screen; rematch with  r .
`;

const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';

/** The TUI is loaded only when it is wanted, so `bench` never pays for it. */
async function arena(props: import('./app.js').AppProps = {}) {
  const [{ render }, { App }] = await Promise.all([import('ink'), import('./app.js')]);
  process.stdout.write(ALT_SCREEN_ON);
  const restore = () => process.stdout.write(ALT_SCREEN_OFF);

  const { waitUntilExit } = render(<App {...props} />, { exitOnCtrlC: false });
  waitUntilExit()
    .then(restore)
    .catch(() => restore());

  process.on('exit', restore);
  process.on('SIGINT', () => {
    restore();
    process.exit(0);
  });
}

async function main() {
  loadEnv();
  // Keys pasted into the setup screen in an earlier session.
  loadStoredKeys();

  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case undefined:
      return arena();
    case '--preset':
    case '-p': {
      const { getPreset, listPresets } = await import('./presets.js');
      const preset = rest[0] ? getPreset(rest[0]) : undefined;
      if (!preset) {
        const names = listPresets().map(([n]) => n);
        process.stderr.write(`colosseum: no preset called "${rest[0] ?? ''}"${names.length ? ` — try: ${names.join(', ')}` : ''}\n`);
        process.exitCode = 1;
        return;
      }
      return arena({ preset });
    }
    case 'replay': {
      const { listReplays } = await import('./replays.js');
      if (!listReplays(1).length) {
        process.stderr.write('colosseum: no replays yet. Fight a match first.\n');
        process.exitCode = 1;
        return;
      }
      return arena({ replayId: rest[0] ?? 'latest' });
    }
    case 'presets': {
      const { describeConfig, listPresets, PRESETS_FILE } = await import('./presets.js');
      const all = listPresets();
      if (!all.length) process.stdout.write('No saved matchups yet. Press  s  on the verdict screen to save one.\n');
      for (const [name, cfg] of all) process.stdout.write(`  ${name.padEnd(20)} ${describeConfig(cfg)}\n`);
      if (all.length) process.stdout.write(`\n  in ${PRESETS_FILE} · fight one with  colosseum --preset <name>\n`);
      return;
    }
    case 'bench':
      process.exitCode = await benchCommand(rest);
      // Gladiators and decoys are gone by now; nothing should hold the loop.
      return process.exit();
    case 'leaderboard':
    case 'standings':
      process.exitCode = await leaderboardCommand(rest);
      return;
    case '-v':
    case '--version':
      process.stdout.write(`${VERSION}\n`);
      return;
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(HELP);
      return;
    default:
      process.stderr.write(`colosseum: unknown command "${command}"\n\n${HELP}`);
      process.exitCode = 1;
  }
}

void main();
