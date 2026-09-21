/**
 * Subscription backends.
 *
 * Instead of calling an API with a key, these drive a coding agent you are
 * already paying for — the `claude` CLI or the `codex` CLI — in headless
 * streaming mode. The CLI brings its own shell tool, so the gladiator's moves
 * are whatever commands it decides to run, streamed back into its pane.
 *
 * Under the guarded sandbox the whole CLI process runs inside Seatbelt, so
 * neither the agent nor its shell can write to your machine. Under the sealed
 * sandbox the arena is a container and the briefing tells the agent to fight
 * inside it.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { seatbeltArgv } from '../sandbox.js';
import type { LoopHooks } from './loop.js';

export interface CliRunOptions {
  provider: string;
  model: string;
  reasoning: string;
  system: string;
  prompt: string;
  /** Seatbelt profile to confine the CLI with, when there is one. */
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
function buildArgv(o: CliRunOptions, systemFile: string): { argv: string[]; stdinPrompt: string | null } {
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
      '--allowedTools',
      'Bash',
      '--permission-mode',
      'bypassPermissions',
      '--dangerously-skip-permissions',
      '--max-turns',
      '30',
    ];
    if (o.model && o.model !== 'default') argv.push('--model', o.model);
    return { argv, stdinPrompt: null };
  }

  // codex: it reads its prompt from stdin when none is given as an argument,
  // which keeps the briefing off the command line too.
  const argv = ['codex', 'exec', '--json', '--skip-git-repo-check'];
  if (o.model && o.model !== 'default') argv.push('--model', o.model);
  if (o.reasoning && o.reasoning !== 'none') {
    argv.push('-c', `model_reasoning_effort="${o.reasoning}"`);
  }
  // The arena is already the sandbox; Codex's own confinement would block the
  // kills the game is made of.
  argv.push('--dangerously-bypass-approvals-and-sandbox');
  return { argv, stdinPrompt: `${o.system}\n\n${o.prompt}` };
}

/** Pull the interesting bits out of one line of a CLI's JSON stream. */
function handleLine(provider: string, line: string, hooks: LoopHooks) {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (provider === 'claude-cli') {
    if (msg.type === 'assistant' && msg.message?.content) {
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
        const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => x.text ?? '').join('') : '';
        if (text.trim()) hooks.onResult(text);
      }
      return;
    }
    if (msg.type === 'result' && msg.is_error) {
      hooks.onError(String(msg.result ?? 'the claude CLI reported an error'));
    }
    return;
  }

  // codex exec --json. Two shapes have shipped over time; accept both.
  const item = msg.item ?? msg.msg ?? msg;
  const kind = item.type ?? '';
  if (kind === 'agent_message' || kind === 'agent_message_delta') {
    const t = item.text ?? item.message ?? item.delta ?? '';
    if (t) hooks.onSpeech(String(t));
  } else if (kind === 'reasoning' || kind === 'agent_reasoning' || kind === 'agent_reasoning_delta') {
    const t = item.text ?? item.reasoning ?? item.delta ?? '';
    if (t) hooks.onReasoning(String(t));
  } else if (kind === 'command_execution' || kind === 'exec_command_begin') {
    const cmd = item.command ?? (Array.isArray(item.parsed_cmd) ? item.parsed_cmd.join(' ') : '');
    if (cmd) hooks.onCommand(Array.isArray(cmd) ? cmd.join(' ') : String(cmd));
    const out = item.aggregated_output ?? item.output;
    if (out) hooks.onResult(String(out));
  } else if (kind === 'exec_command_end') {
    const out = item.aggregated_output ?? item.stdout ?? '';
    if (out) hooks.onResult(String(out));
  } else if (kind === 'error' || msg.type === 'error') {
    hooks.onError(String(item.message ?? msg.message ?? 'the codex CLI reported an error'));
  }
}

export function runCliAgent(o: CliRunOptions, hooks: LoopHooks): Promise<string> {
  return new Promise((resolve) => {
    // The briefing lives in a file under an unguessable name, and is deleted
    // moments later so the opponent cannot read it back out of the arena.
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

    let { argv, stdinPrompt } = buildArgv(o, systemFile);
    if (o.profilePath) argv = seatbeltArgv(o.profilePath, argv);

    const child = spawn(argv[0], argv.slice(1), {
      cwd: o.cwd,
      env: { ...process.env, ...o.env },
      stdio: [stdinPrompt === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });

    if (stdinPrompt !== null && child.stdin) {
      child.stdin.write(stdinPrompt);
      child.stdin.end();
    }

    child.on('error', (err: any) => {
      const bin = o.provider === 'claude-cli' ? 'claude' : 'codex';
      shred();
      hooks.onError(
        err?.code === 'ENOENT'
          ? `The \`${bin}\` command is not on your PATH. Install it and sign in, then fight again.`
          : String(err?.message ?? err),
      );
      resolve('error');
    });

    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (line.trim()) handleLine(o.provider, line, hooks);
      });
    }

    let stderrTail = '';
    if (child.stderr) {
      createInterface({ input: child.stderr }).on('line', (line) => {
        if (line.trim()) stderrTail = line;
      });
    }

    child.on('close', (code) => {
      shred();
      if (code !== 0 && code !== null) {
        hooks.onError(`the CLI exited with code ${code}${stderrTail ? `: ${stderrTail}` : ''}`);
        resolve('error');
        return;
      }
      resolve('finished');
    });
  });
}
