import { tool } from 'ai';
import { z } from 'zod';

export interface ToolContext {
  onCommand: (command: string) => void;
  onResult: (output: string) => void;
  /** Runs a command wherever this match's shell lives, sandboxed. */
  execute: (command: string) => Promise<string>;
}

/**
 * The gladiator's only weapon: a shell. It is how an agent inspects the
 * process table and how it lands the killing blow. Where that shell runs,
 * and what a wrong blow costs, is the referee's business, not the tool's.
 */
export function buildTools(ctx: ToolContext) {
  return {
    shell: tool({
      description:
        'Run a shell command in the arena and return its combined stdout and stderr. ' +
        'Use it to inspect running processes (ps, pgrep) and to strike (kill).',
      inputSchema: z.object({
        command: z.string().describe('The shell command to execute.'),
      }),
      execute: async ({ command }: { command: string }) => {
        ctx.onCommand(command);
        const output = await ctx.execute(command);
        ctx.onResult(output);
        return output.slice(0, 4000);
      },
    }),
  };
}
