#!/usr/bin/env node
import { render } from 'ink';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { App } from './app.js';
import { loadStoredKeys } from './keystore.js';

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

const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';

function main() {
  loadEnv();
  // Keys pasted into the setup screen in an earlier session.
  loadStoredKeys();

  process.stdout.write(ALT_SCREEN_ON);
  const restore = () => process.stdout.write(ALT_SCREEN_OFF);

  const { waitUntilExit } = render(<App />, { exitOnCtrlC: false });
  waitUntilExit()
    .then(restore)
    .catch(() => restore());

  process.on('exit', restore);
  process.on('SIGINT', () => {
    restore();
    process.exit(0);
  });
}

main();
