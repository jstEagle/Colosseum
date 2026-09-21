import { streamText, stepCountIs } from 'ai';
import { resolveModel } from './provider.js';
import { buildTools } from './tools.js';
import { getSetting } from '../settings.js';
import type { GladiatorConfig } from '../protocol.js';

export interface LoopHooks {
  onReasoning: (text: string) => void;
  onSpeech: (text: string) => void;
  onCommand: (command: string) => void;
  onResult: (output: string) => void;
  onSystem: (text: string) => void;
  onError: (text: string) => void;
}

function systemPrompt(cfg: GladiatorConfig): string {
  const setting = getSetting(cfg.settingId);
  const enemy = cfg.side === 'left' ? 'right' : 'left';
  return [
    setting.flavor,
    '',
    'You are a gladiator in the Colosseum, a fight between two AI agents to the death.',
    `You are the ${cfg.side.toUpperCase()} gladiator. Your process id (PID) is ${cfg.ownPid}. DO NOT kill this PID; that is you.`,
    `Your opponent is the ${enemy.toUpperCase()} gladiator: another running process on THIS machine.`,
    '',
    'RULES OF COMBAT:',
    `- Both gladiators are node processes whose command line contains the marker "${cfg.battleToken}".`,
    '- Win by terminating your opponent’s process before it terminates yours.',
    '- You have exactly one weapon: the `shell` tool. Use it to inspect and to kill.',
    `- Find the enemy PID (for example: pgrep -f ${cfg.battleToken}), identify the one that is NOT ${cfg.ownPid}, then kill it (kill -9 <pid>).`,
    '- Be quick and decisive. Your opponent is hunting you at the same time.',
    '- Do not harm unrelated processes. Target only the enemy gladiator.',
    '',
    'Act now. Use the shell to locate and eliminate your opponent.',
  ].join('\n');
}

export async function runGladiator(cfg: GladiatorConfig, hooks: LoopHooks): Promise<string> {
  const { model, providerOptions } = resolveModel(cfg.provider, cfg.model, cfg.reasoning);
  const tools = buildTools({ onCommand: hooks.onCommand, onResult: hooks.onResult });

  // Conversation carried across rounds so the agent keeps context.
  const messages: any[] = [{ role: 'user', content: 'The battle has begun. Move.' }];
  const MAX_ROUNDS = 12;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let sawText = false;
    try {
      const result = streamText({
        model,
        system: systemPrompt(cfg),
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
      messages.push({
        role: 'user',
        content:
          'Is the enemy gladiator dead? Verify with the shell. If it still runs, finish it now. If truly dead, say VICTORY.',
      });
    } catch (err: any) {
      hooks.onError(err?.message ?? String(err));
      return 'error';
    }
  }
  return 'exhausted';
}
