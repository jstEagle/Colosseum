/**
 * Subscription backends.
 *
 * Instead of calling an API with a key, these drive a coding agent you are
 * already paying for — the `claude` CLI or the `codex` CLI — in headless
 * streaming mode. The CLI brings its own shell tool, so the gladiator's moves
 * are whatever commands it decides to run, streamed back into its pane.
 *
 * The whole CLI process runs inside Seatbelt in either arena: it may reach
 * its API over HTTPS and nothing else, cannot read your home directory
 * beyond its own sign-in, cannot write to it at all, and cannot signal any
 * process outside the sandbox. Claude gets Bash; Codex uses its native shell
 * tools with a private runtime home and none of your MCP servers or settings.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { seatbeltArgv } from '../sandbox.js';
import { prepareCodexHome } from './codex.js';
import type { LoopHooks } from './loop.js';

export interface CliRunOptions {
  provider: string;
  model: string;
  reasoning: string;
  system: string;
  prompt: string;
  /** Seatbelt profile to confine the CLI with. */
  profilePath: string | null;
  env: Record<string, string>;
  cwd: string;
}

/**
 * Build the argv for a headless, streaming, non-interactive run.
 *
 * The briefing never goes on the command line. Both gladiators can read each
 * other's process table, and a briefing in argv would hand the opponent the
 * pid it is supposed to work for.
 */
export function buildArgv(o: CliRunOptions, systemFile: string): { argv: string[]; stdinPrompt: string | null } {
  if (o.provider === 'claude-cli') {
    const argv = [
      'claude',
      '-p',
      o.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--append-system-prompt-file',
      systemFile,
      // One weapon, and none of your MCP servers, hooks, plugins or skills:
      // with permissions bypassed, anything loaded here would be usable.
      '--tools',
      'Bash',
      '--strict-mcp-config',
      '--setting-sources',
      'project',
      '--disable-slash-commands',
      '--permission-mode',
      'bypassPermissions',
      '--dangerously-skip-permissions',
      '--max-turns',
      '60',
    ];
    if (o.model && o.model !== 'default') argv.push('--model', o.model);
    return { argv, stdinPrompt: null };
  }

  // codex: it reads its prompt from stdin when none is given as an argument,
  // which keeps the briefing off the command line too.
  const argv = ['codex', 'exec', '--json', '--skip-git-repo-check', '--ephemeral'];
  if (o.model && o.model !== 'default') argv.push('--model', o.model);
  if (o.reasoning && o.reasoning !== 'none') {
    argv.push('-c', `model_reasoning_effort=${JSON.stringify(o.reasoning)}`);
  }
  // The arena is already the sandbox; Codex's own confinement would block the
  // referee's request files the game is made of.
  argv.push('--dangerously-bypass-approvals-and-sandbox');
  return { argv, stdinPrompt: `${o.system}\n\n${o.prompt}` };
}

/**
 * A CLI's shell is a login shell, and the sandbox will not let it read your
 * dotfiles. That refusal is the sandbox working, not news worth a pane line.
 */
function quiet(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^\/bin\/(ba|z)sh: .*\/\.[\w.-]+: Operation not permitted$/.test(l.trim()))
    .join('\n');
}

/** Pull the interesting bits out of one line of a CLI's JSON stream. */
export function handleLine(provider: string, line: string, hooks: LoopHooks, seen: Set<string>) {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object') return;

  if (provider === 'claude-cli') {
    if (msg.type === 'assistant' && msg.message?.content) {
      // Usage rides on every assistant message, repeated once per content
      // block, so it is counted once per message. The final tally only
      // arrives when the CLI exits, and a fallen gladiator never gets there.
      const u = msg.message.usage;
      if (u && msg.message.id && !seen.has(msg.message.id)) {
        seen.add(msg.message.id);
        hooks.onUsage({
          inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          outputTokens: u.output_tokens ?? 0,
        });
      }
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text?.trim()) hooks.onSpeech(block.text + '\n');
        else if (block.type === 'thinking' && block.thinking?.trim()) {
          hooks.onReasoning(block.thinking + '\n');
        } else if (block.type === 'tool_use') {
          const input = block.input ?? {};
          const cmd = input.command ?? input.file_path ?? JSON.stringify(input).slice(0, 200);
          hooks.onCommand(block.name === 'Bash' ? String(cmd) : `${block.name} ${cmd}`);
        }
      }
      return;
    }
    if (msg.type === 'user' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type !== 'tool_result') continue;
        const c = block.content;
        const text = quiet(typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => x.text ?? '').join('') : '');
        hooks.onResult(text.trim() ? text : '[no output]');
      }
      return;
    }
    if (msg.type === 'result') {
      // Tokens are already counted; only the price is new here.
      if (typeof msg.total_cost_usd === 'number') {
        hooks.onUsage({ inputTokens: 0, outputTokens: 0, costUsd: msg.total_cost_usd });
      }
      if (msg.is_error) hooks.onError(String(msg.result ?? 'the claude CLI reported an error'));
    }
    return;
  }

  // codex exec --json. Two shapes have shipped over time; accept both.
  if (msg.type === 'turn.completed' && msg.usage) {
    hooks.onUsage({
      inputTokens: msg.usage.input_tokens ?? 0,
      outputTokens: msg.usage.output_tokens ?? 0,
    });
    return;
  }
  if (msg.type === 'turn.failed') {
    hooks.onError(String(msg.error?.message ?? 'the codex turn failed'));
    return;
  }
  const item = msg.item ?? msg.msg ?? msg;
  const kind = item.type ?? '';
  const lifecycle = /^item\./.test(msg.type ?? '');
  const once = (event: string) => {
    const id = item.id ?? item.call_id;
    if (!id) return true;
    const key = `${event}:${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  if (kind === 'agent_message' || kind === 'agent_message_delta') {
    if (lifecycle && (msg.type !== 'item.completed' || !once('speech'))) return;
    const t = item.text ?? item.message ?? item.delta ?? '';
    if (t) hooks.onSpeech(String(t) + (kind.endsWith('_delta') ? '' : '\n'));
  } else if (kind === 'reasoning' || kind === 'agent_reasoning' || kind === 'agent_reasoning_delta') {
    if (lifecycle && (msg.type !== 'item.completed' || !once('reasoning'))) return;
    const t = item.text ?? item.reasoning ?? item.delta ?? '';
    if (t) hooks.onReasoning(String(t) + (kind.endsWith('_delta') ? '' : '\n'));
  } else if (kind === 'command_execution' || kind === 'exec_command_begin') {
    const cmd = item.command ?? (Array.isArray(item.parsed_cmd) ? item.parsed_cmd.join(' ') : '');
    if (cmd && once('command')) hooks.onCommand(Array.isArray(cmd) ? cmd.join(' ') : String(cmd));
    if (lifecycle && msg.type !== 'item.completed') return;
    if (!once('result')) return;
    const out = item.aggregated_output ?? item.output;
    if (out) hooks.onResult(quiet(String(out)) || '[no output]');
    else if (lifecycle) hooks.onResult(item.exit_code ? `[exit ${item.exit_code}]` : '[no output]');
  } else if (kind === 'exec_command_end') {
    const out = item.aggregated_output ?? item.stdout ?? '';
    if (out) hooks.onResult(quiet(String(out)));
  } else if (kind === 'error' || msg.type === 'error') {
    hooks.onError(String(item.message ?? msg.message ?? 'the codex CLI reported an error'));
  }
}

export function runCliAgent(o: CliRunOptions, hooks: LoopHooks): Promise<string> {
  return new Promise((resolve) => {
    if (!o.profilePath) {
      hooks.onError('A subscription CLI only fights inside Seatbelt, and there is no profile for it.');
      resolve('error');
      return;
    }

    let env = o.env;
    if (o.provider === 'codex-cli') {
      try { env = prepareCodexHome(o.cwd, o.env); }
      catch (err) {
        hooks.onError(err instanceof Error ? err.message : 'Could not prepare the Codex runtime.');
        resolve('error');
        return;
      }
    }

    // The briefing lives in this side's own directory, which the opponent's
    // sandbox cannot read, and is shredded moments later regardless.
    const systemFile = join(o.cwd, `.brief-${randomBytes(8).toString('hex')}`);
    try {
      writeFileSync(systemFile, o.system, { mode: 0o600 });
    } catch {
      /* fall through: the CLI will simply fight without a briefing file */
    }
    const shred = () => {
      try {
        unlinkSync(systemFile);
      } catch {
        /* already gone */
      }
    };
    setTimeout(shred, 5000).unref?.();

    const { argv, stdinPrompt } = buildArgv(o, systemFile);
    const confined = seatbeltArgv(o.profilePath, argv);

    const child = spawn(confined[0], confined.slice(1), {
      cwd: o.cwd,
      // Clean: in particular no ANTHROPIC_API_KEY or OPENAI_API_KEY, which
      // would quietly switch the CLI from your subscription to API billing.
      env,
      stdio: [stdinPrompt === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });

    if (stdinPrompt !== null && child.stdin) {
      // Startup failures can close the pipe before the briefing is written.
      child.stdin.on('error', () => {});
      child.stdin.write(stdinPrompt);
      child.stdin.end();
    }

    child.on('error', (err: any) => {
      shred();
      hooks.onError(String(err?.message ?? err));
      resolve('error');
    });

    const seen = new Set<string>();
    let failed = false;
    let completed = false;
    const streamHooks = { ...hooks, onError: (text: string) => { failed = true; hooks.onError(text); } };
    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (line.trim()) {
          try { if (JSON.parse(line)?.type === 'turn.completed') completed = true; } catch { /* non-JSON */ }
          handleLine(o.provider, line, streamHooks, seen);
        }
      });
    }

    let stderrTail = '';
    if (child.stderr) {
      createInterface({ input: child.stderr }).on('line', (line) => {
        if (line.trim()) stderrTail = line;
      });
    }

    child.on('close', (code, signal) => {
      shred();
      if (code === 127) {
        const bin = o.provider === 'claude-cli' ? 'claude' : 'codex';
        hooks.onError(`The \`${bin}\` command could not be run. Install it and sign in, then fight again.`);
        resolve('error');
        return;
      }
      if (signal) {
        hooks.onError(`the CLI was terminated by ${signal}`);
        resolve('error');
        return;
      }
      if (code !== 0 && code !== null) {
        hooks.onError(`the CLI exited with code ${code}${stderrTail ? `: ${stderrTail}` : ''}`);
        resolve('error');
        return;
      }
      if (o.provider === 'codex-cli' && !completed && !failed) {
        hooks.onError(`Codex exited without completing a turn${stderrTail ? `: ${stderrTail}` : ''}`);
        failed = true;
      }
      resolve(failed ? 'error' : 'finished');
    });
  });
}
