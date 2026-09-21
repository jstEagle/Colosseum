import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Backdrop } from './Backdrop.js';
import { theme } from '../theme.js';
import { MODELS, PROVIDERS, REASONING_LEVELS, defaultModel, getProvider } from '../models.js';
import { SETTINGS } from '../settings.js';
import { DIFFICULTIES } from '../difficulty.js';
import { SANDBOXES } from '../sandbox.js';
import type { BattleConfig } from '../referee.js';
import type { SandboxMode } from '../sandbox.js';

interface Option {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  onComplete: (cfg: BattleConfig) => void;
  /** Whether a provider is usable right now (key present, CLI installed). */
  providerHint: (provider: string) => string;
}

type StepKey =
  | 'leftProvider'
  | 'leftModel'
  | 'leftReasoning'
  | 'rightProvider'
  | 'rightModel'
  | 'rightReasoning'
  | 'sandbox'
  | 'difficulty'
  | 'setting';

const CUSTOM = '__custom__';

export function Setup({ onComplete, providerHint }: Props) {
  const [sel, setSel] = useState<Record<StepKey, string>>({
    leftProvider: 'openrouter',
    leftModel: defaultModel('openrouter'),
    leftReasoning: 'medium',
    rightProvider: 'openrouter',
    rightModel: defaultModel('openrouter'),
    rightReasoning: 'medium',
    sandbox: 'guarded',
    difficulty: 'normal',
    setting: 'classic',
  });
  const [stepIdx, setStepIdx] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');

  const providerOptions = (): Option[] =>
    PROVIDERS.map((p) => ({
      value: p.id,
      label: p.label,
      hint: providerHint(p.id),
    }));

  const modelOptions = (provider: string): Option[] => [
    ...(MODELS[provider] ?? []).map((m) => ({
      value: m,
      label: m,
      hint: m === 'default' ? "the CLI's own default" : undefined,
    })),
    { value: CUSTOM, label: 'Custom model id…', hint: 'type your own' },
  ];

  const reasoningOptions = (): Option[] =>
    REASONING_LEVELS.map((r) => ({ value: r, label: r }));

  const settingOptions = (): Option[] =>
    SETTINGS.map((s) => ({ value: s.id, label: s.name, hint: s.blurb }));

  const difficultyOptions = (): Option[] =>
    DIFFICULTIES.map((d) => ({ value: d.id, label: d.name, hint: d.blurb }));

  const sandboxOptions = (): Option[] =>
    SANDBOXES.map((s) => ({ value: s.id, label: s.name, hint: s.blurb }));

  // Reasoning is skipped for providers that have no such control.
  const wantsReasoning = (provider: string) => getProvider(provider).supportsReasoning;

  const allSteps: { key: StepKey; title: string; color: string; options: Option[]; skip?: boolean }[] = [
    { key: 'leftProvider', title: 'LEFT — provider', color: theme.left, options: providerOptions() },
    { key: 'leftModel', title: 'LEFT — model', color: theme.left, options: modelOptions(sel.leftProvider) },
    {
      key: 'leftReasoning',
      title: 'LEFT — reasoning effort',
      color: theme.left,
      options: reasoningOptions(),
      skip: !wantsReasoning(sel.leftProvider),
    },
    { key: 'rightProvider', title: 'RIGHT — provider', color: theme.right, options: providerOptions() },
    { key: 'rightModel', title: 'RIGHT — model', color: theme.right, options: modelOptions(sel.rightProvider) },
    {
      key: 'rightReasoning',
      title: 'RIGHT — reasoning effort',
      color: theme.right,
      options: reasoningOptions(),
      skip: !wantsReasoning(sel.rightProvider),
    },
    { key: 'sandbox', title: 'How contained should the fight be?', color: theme.gold, options: sandboxOptions() },
    { key: 'difficulty', title: 'How hard is it to reach each other?', color: theme.gold, options: difficultyOptions() },
    { key: 'setting', title: 'Choose the arena', color: theme.gold, options: settingOptions() },
  ];

  const steps = allSteps.filter((s) => !s.skip);
  const step = steps[Math.min(stepIdx, steps.length - 1)];

  const finish = (next: Record<StepKey, string>) => {
    onComplete({
      left: { provider: next.leftProvider, model: next.leftModel, reasoning: next.leftReasoning },
      right: { provider: next.rightProvider, model: next.rightModel, reasoning: next.rightReasoning },
      settingId: next.setting,
      difficultyId: next.difficulty,
      sandbox: next.sandbox as SandboxMode,
    });
  };

  const commit = (value: string) => {
    const next = { ...sel, [step.key]: value };
    // Changing a provider resets that side's model to a sensible default.
    if (step.key === 'leftProvider') {
      next.leftModel = defaultModel(value);
      if (!wantsReasoning(value)) next.leftReasoning = 'none';
    }
    if (step.key === 'rightProvider') {
      next.rightModel = defaultModel(value);
      if (!wantsReasoning(value)) next.rightReasoning = 'none';
    }
    setSel(next);

    if (stepIdx >= steps.length - 1) {
      finish(next);
      return;
    }
    setStepIdx(stepIdx + 1);
    setCursor(0);
  };

  useInput((input, key) => {
    if (customMode) {
      if (key.return) {
        if (customText.trim()) {
          setCustomMode(false);
          const v = customText.trim();
          setCustomText('');
          commit(v);
        }
        return;
      }
      if (key.escape) {
        setCustomMode(false);
        setCustomText('');
        return;
      }
      if (key.backspace || key.delete) {
        setCustomText((t) => t.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) setCustomText((t) => t + input);
      return;
    }

    if (key.upArrow || input === 'k') {
      setCursor((c) => (c - 1 + step.options.length) % step.options.length);
    } else if (key.downArrow || input === 'j') {
      setCursor((c) => (c + 1) % step.options.length);
    } else if (key.return) {
      const opt = step.options[cursor];
      if (opt.value === CUSTOM) {
        setCustomMode(true);
        setCustomText('');
      } else {
        commit(opt.value);
      }
    } else if (key.leftArrow || key.backspace) {
      if (stepIdx > 0) {
        setStepIdx(stepIdx - 1);
        setCursor(0);
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Backdrop showArt={false} subtitle="Two agents enter. One process leaves." />
      <Box justifyContent="center" marginBottom={1}>
        <Text color={theme.faint}>
          {`step ${stepIdx + 1}/${steps.length}   ↑↓ move · ⏎ select · ← back`}
        </Text>
      </Box>
      <Box flexDirection="column" paddingX={2}>
        <Text color={step.color} bold>
          {step.title}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {customMode ? (
            <Text color={theme.bright}>
              {'> '}
              {customText}
              <Text color={theme.gold}>{'█'}</Text>
            </Text>
          ) : (
            step.options.map((opt, i) => {
              const active = i === cursor;
              return (
                <Box key={opt.value}>
                  <Text color={active ? step.color : theme.faint} bold={active}>
                    {active ? '❯ ' : '  '}
                    {opt.label}
                  </Text>
                  {opt.hint ? <Text color={theme.dim}>{'   ' + opt.hint}</Text> : null}
                </Box>
              );
            })
          )}
        </Box>
      </Box>
      <Box marginTop={1} paddingX={2} flexDirection="column">
        <Text color={theme.dim}>
          LEFT: {sel.leftProvider}/{sel.leftModel} [{sel.leftReasoning}]
        </Text>
        <Text color={theme.dim}>
          RIGHT: {sel.rightProvider}/{sel.rightModel} [{sel.rightReasoning}]
        </Text>
        <Text color={theme.dim}>
          sandbox: {sel.sandbox} · difficulty: {sel.difficulty}
        </Text>
      </Box>
    </Box>
  );
}
