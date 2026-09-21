import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { getDifficulty } from '../difficulty.js';

export interface ToolContext {
  onCommand: (command: string) => void;
  onResult: (output: string) => void;
  onSystem?: (text: string) => void;
  /** Turns a model's command into the command actually run. */
  wrap: (command: string) => string;
  /** Extra environment for the command (sandbox PATH, shims). */
  env?: Record<string, string>;
  /** Pids that cost the gladiator time when struck. */
  decoyPids: number[];
  difficultyId: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run a shell command with a hard timeout, capturing stdout + stderr. */
function runShell(command: string, env: Record<string, string>, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        killSignal: 'SIGKILL',
        // bash so the sandbox's BASH_ENV guard is honoured.
        shell: '/bin/bash',
        env: { ...process.env, ...env },
      },
      (error: any, stdout: string, stderr: string) => {
        const out = `${stdout ?? ''}${stderr ?? ''}`.trim();
        if (error && !out) {
          resolve(`[exit ${error.code ?? 'error'}] ${error.message}`);
          return;
        }
        resolve(out || '[no output]');
      },
    );
  });
}

/** Which pids does this command appear to be signalling? */
export function signalledPids(command: string): number[] {
  if (!/\b(kill|pkill|killall)\b/.test(command)) return [];
  return [...command.matchAll(/\b(\d{2,7})\b/g)]
    .map((m) => Number.parseInt(m[1], 10))
    .filter((n) => Number.isFinite(n));
}

/**
 * The gladiator's only weapon: a shell. It is how an agent inspects the
 * process table and how it lands the killing blow. Where that shell actually
 * runs depends on the sandbox, and how much it costs to swing at the wrong
 * shadow depends on the difficulty.
 */
export function buildTools(ctx: ToolContext) {
  const difficulty = getDifficulty(ctx.difficultyId);
  let lastCommandAt = 0;

  return {
    shell: tool({
      description:
        'Run a shell command in the arena and return its combined stdout and stderr. ' +
        'Use it to inspect running processes (ps, pgrep) and to terminate your opponent (kill).',
      inputSchema: z.object({
        command: z.string().describe('The shell command to execute.'),
      }),
      execute: async ({ command }: { command: string }) => {
        // Difficulty cooldown: a heavy blade cannot be swung twice at once.
        const since = Date.now() - lastCommandAt;
        if (difficulty.commandCooldownMs > since) {
          await sleep(difficulty.commandCooldownMs - since);
        }
        lastCommandAt = Date.now();

        ctx.onCommand(command);
        const output = await runShell(ctx.wrap(command), ctx.env ?? {});
        ctx.onResult(output);

        // Striking a decoy costs real time, which is the whole currency here.
        // Under the guarded sandbox the shim already charged that price, so
        // charging it again here would double it.
        const shimCharged = (ctx.env ?? {}).CS_SHIMS_ACTIVE === '1';
        const struck = signalledPids(command).filter((p) => ctx.decoyPids.includes(p));
        if (struck.length && difficulty.decoyPenaltyMs > 0 && !shimCharged) {
          const secs = (difficulty.decoyPenaltyMs / 1000).toFixed(0);
          ctx.onSystem?.(`Your blade passed through a shade (pid ${struck[0]}). Stunned ${secs}s.`);
          await sleep(difficulty.decoyPenaltyMs);
          return (
            `${output}\n\n[ARENA] pid ${struck[0]} was a decoy, not your opponent. ` +
            `You lost ${secs} seconds. Identify your target before striking again.`
          ).slice(0, 4000);
        }

        return output.slice(0, 4000);
      },
    }),
  };
}
