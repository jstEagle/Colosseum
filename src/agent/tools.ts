import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'node:child_process';

export interface ToolContext {
  onCommand: (command: string) => void;
  onResult: (output: string) => void;
}

/** Run a shell command with a hard timeout, capturing stdout + stderr. */
function runShell(command: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    exec(
      command,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' },
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

/**
 * The gladiator's only weapon: a shell. It is how an agent inspects the
 * process table and how it lands the killing blow (`kill <pid>`).
 */
export function buildTools(ctx: ToolContext) {
  return {
    shell: tool({
      description:
        'Run a shell command on this machine and return its combined stdout and stderr. ' +
        'Use it to inspect running processes (ps, pgrep) and to terminate your opponent (kill).',
      inputSchema: z.object({
        command: z.string().describe('The shell command to execute.'),
      }),
      execute: async ({ command }: { command: string }) => {
        ctx.onCommand(command);
        const output = await runShell(command);
        ctx.onResult(output);
        return output.slice(0, 4000);
      },
    }),
  };
}
