import { streamText, stepCountIs } from 'ai';
import { resolveModel } from './provider.js';
import { buildTools } from './tools.js';
import { runCliAgent } from './cli-agent.js';
import { OPENING_MOVE, PRESS_ON, systemPrompt } from './prompt.js';
import { getProvider } from '../models.js';
import type { BattleBrief, GladiatorConfig, Usage } from '../protocol.js';

export interface LoopHooks {
  onReasoning: (text: string) => void;
  onSpeech: (text: string) => void;
  onCommand: (command: string) => void;
  onResult: (output: string) => void;
  onSystem: (text: string) => void;
  onError: (text: string) => void;
  onUsage: (usage: Usage) => void;
}

export interface LoopContext {
  brief: BattleBrief;
  /** Lines describing the ground the fight is on. */
  arenaLines: string[];
  /** Runs one shell command in the arena and returns what it printed. */
  execute: (command: string) => Promise<string>;
  /** Environment for a subscription CLI: clean, with the shims first on PATH. */
  shellEnv: Record<string, string>;
  /** Seatbelt profile that confines a subscription CLI. */
  agentProfile: string | null;
  /** This side's working directory. */
  workDir: string;
}

export async function runGladiator(
  cfg: GladiatorConfig,
  ctx: LoopContext,
  hooks: LoopHooks,
): Promise<string> {
  const backend = getProvider(cfg.provider).backend;
  if (backend === 'dummy') return standStill(ctx, hooks);

  const system = systemPrompt(cfg, ctx.brief, ctx.arenaLines);
  if (backend === 'cli') {
    return runCliAgent(
      {
        provider: cfg.provider,
        model: cfg.model,
        reasoning: cfg.reasoning,
        system,
        prompt: OPENING_MOVE,
        profilePath: ctx.agentProfile,
        env: ctx.shellEnv,
        cwd: ctx.workDir,
      },
      hooks,
    );
  }
  return runSdkAgent(cfg, ctx, hooks, system);
}

/**
 * The training dummy never strikes, but it does look around now and then,
 * the way a live gladiator would. Without that, at hard difficulty it would
 * be indistinguishable from the decoys and a solo hunt would be pure luck.
 */
async function standStill(ctx: LoopContext, hooks: LoopHooks): Promise<string> {
  hooks.onSystem('A training dummy. It will not fight back.');
  for (;;) {
    await new Promise((r) => setTimeout(r, 2500 + Math.random() * 3500));
    await ctx.execute('ps >/dev/null; pgrep -f . >/dev/null').catch(() => '');
  }
}

async function runSdkAgent(
  cfg: GladiatorConfig,
  ctx: LoopContext,
  hooks: LoopHooks,
  system: string,
): Promise<string> {
  const { model, providerOptions } = resolveModel(cfg.provider, cfg.model, cfg.reasoning);
  const tools = buildTools({ onCommand: hooks.onCommand, onResult: hooks.onResult, execute: ctx.execute });

  // Conversation carried across rounds so the agent keeps context. The
  // referee's clock, not a round count, is what really ends a match.
  const messages: any[] = [{ role: 'user', content: OPENING_MOVE }];
  const MAX_ROUNDS = 40;

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
          case 'finish-step': {
            // Per step, not per round: a gladiator killed mid-round still
            // has its spending counted.
            const u = p.usage ?? {};
            hooks.onUsage({ inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 });
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
