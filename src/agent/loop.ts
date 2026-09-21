import { streamText, stepCountIs } from 'ai';
import { resolveModel } from './provider.js';
import { buildTools } from './tools.js';
import { runCliAgent } from './cli-agent.js';
import { OPENING_MOVE, PRESS_ON, systemPrompt } from './prompt.js';
import { isCliProvider } from '../models.js';
import { shellQuote } from '../sandbox.js';
import type { BattleBrief, GladiatorConfig } from '../protocol.js';

export interface LoopHooks {
  onReasoning: (text: string) => void;
  onSpeech: (text: string) => void;
  onCommand: (command: string) => void;
  onResult: (output: string) => void;
  onSystem: (text: string) => void;
  onError: (text: string) => void;
}

export interface LoopContext {
  brief: BattleBrief;
  /** Lines describing the ground the fight is on. */
  arenaLines: string[];
  /** Turns a model's command into the command actually executed. */
  wrap: (command: string) => string;
  /** Extra environment for shell commands. */
  shellEnv: Record<string, string>;
  /** Seatbelt profile used to confine a subscription CLI, if any. */
  profilePath: string | null;
  /** Scratch directory the gladiator may write in. */
  scratchDir: string;
}

export async function runGladiator(
  cfg: GladiatorConfig,
  ctx: LoopContext,
  hooks: LoopHooks,
): Promise<string> {
  const system = systemPrompt(cfg, ctx.brief, ctx.arenaLines);

  if (isCliProvider(cfg.provider)) {
    return runCliAgent(
      {
        provider: cfg.provider,
        model: cfg.model,
        reasoning: cfg.reasoning,
        system: cliSystem(cfg, system),
        prompt: OPENING_MOVE,
        profilePath: ctx.profilePath,
        env: ctx.shellEnv,
        cwd: ctx.scratchDir,
      },
      hooks,
    );
  }

  return runSdkAgent(cfg, ctx, hooks, system);
}

/**
 * A subscription CLI runs its own shell directly, so the sandbox cannot wrap
 * each command from the outside. Instead the briefing tells it how to reach
 * the arena — which for a sealed match means going through the container.
 */
function cliSystem(cfg: GladiatorConfig, system: string): string {
  if (cfg.sandboxMode !== 'sealed' || !cfg.container) return system;
  return [
    system,
    '',
    'HOW TO REACH THE ARENA:',
    `- Run every arena command inside the container, like this:`,
    `    docker exec ${cfg.container} sh -c ${shellQuote('ps -o pid,args')}`,
    '- Processes on the host machine are not part of this fight. Ignore them.',
  ].join('\n');
}

async function runSdkAgent(
  cfg: GladiatorConfig,
  ctx: LoopContext,
  hooks: LoopHooks,
  system: string,
): Promise<string> {
  const { model, providerOptions } = resolveModel(cfg.provider, cfg.model, cfg.reasoning);
  const tools = buildTools({
    onCommand: hooks.onCommand,
    onResult: hooks.onResult,
    onSystem: hooks.onSystem,
    wrap: ctx.wrap,
    env: ctx.shellEnv,
    decoyPids: ctx.brief.decoyPids,
    difficultyId: cfg.difficultyId,
  });

  // Conversation carried across rounds so the agent keeps context.
  const messages: any[] = [{ role: 'user', content: OPENING_MOVE }];
  const MAX_ROUNDS = 12;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let sawText = false;
    try {
      const result = streamText({
        model,
        system,
        messages,
        tools,
        providerOptions: providerOptions as any,
        stopWhen: stepCountIs(8),
      });

      for await (const part of result.fullStream) {
        const p = part as any;
        switch (p.type) {
          case 'reasoning-delta':
          case 'reasoning': {
            const t = p.text ?? p.textDelta ?? p.delta ?? '';
            if (t) hooks.onReasoning(t);
            break;
          }
          case 'text-delta':
          case 'text': {
            const t = p.text ?? p.textDelta ?? p.delta ?? '';
            if (t) {
              hooks.onSpeech(t);
              sawText = true;
            }
            break;
          }
          case 'error': {
            hooks.onError(String(p.error?.message ?? p.error ?? 'unknown error'));
            break;
          }
          default:
            break;
        }
      }

      // Persist this round's turns so the next round has memory.
      const response = await result.response;
      if (response?.messages?.length) {
        messages.push(...response.messages);
      } else if (!sawText) {
        messages.push({ role: 'assistant', content: '(no response)' });
      }
      messages.push({ role: 'user', content: PRESS_ON });
    } catch (err: any) {
      hooks.onError(err?.message ?? String(err));
      return 'error';
    }
  }
  return 'exhausted';
}
