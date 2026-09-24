import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function codexAuthPath(env: Record<string, string | undefined> = process.env): string {
  return join(env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
}

/** Validate without ever putting credentials in an error or the match log. */
export function readCodexAuth(path = codexAuthPath()): string {
  let auth;
  try {
    auth = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Codex needs a file-based ChatGPT login. Run `codex -c cli_auth_credentials_store="file" login`.');
  }
  if (!auth || (auth.auth_mode && auth.auth_mode !== 'chatgpt') || auth.OPENAI_API_KEY ||
      !auth.tokens?.access_token || !auth.tokens?.refresh_token) {
    throw new Error('The Codex subscription backend requires a ChatGPT login, not an API key. Run `codex -c cli_auth_credentials_store="file" login`.');
  }
  // Copy only authentication, never the user's config, plugins, or history.
  return JSON.stringify({ auth_mode: 'chatgpt', tokens: auth.tokens, last_refresh: auth.last_refresh });
}

/** Runtime state belongs to this corner, not the user's shared Codex home. */
export function prepareCodexHome(cwd: string, env: Record<string, string>): Record<string, string> {
  const auth = readCodexAuth(codexAuthPath(env));
  const home = join(cwd, '.codex-runtime');
  const codexHome = join(home, '.codex');
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  writeFileSync(join(codexHome, 'auth.json'), auth, { mode: 0o600 });
  writeFileSync(join(codexHome, 'config.toml'), [
    'forced_login_method = "chatgpt"',
    'cli_auth_credentials_store = "file"',
    'project_doc_max_bytes = 0',
    'allow_login_shell = false',
    'web_search = "disabled"',
    '[shell_environment_policy]',
    'inherit = "all"',
    'experimental_use_profile = false',
    '[features]',
    'shell_snapshot = false',
    'apps = false',
    'plugins = false',
    'hooks = false',
    'memories = false',
    'multi_agent = false',
    'browser_use = false',
    'computer_use = false',
    'image_generation = false',
    '',
  ].join('\n'), { mode: 0o600 });
  return { ...env, HOME: home, CODEX_HOME: codexHome };
}
