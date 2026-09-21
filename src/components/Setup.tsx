import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Backdrop } from './Backdrop.js';
import { theme } from '../theme.js';
import { MODELS, PROVIDERS, REASONING_LEVELS, defaultModel } from '../models.js';
import { SETTINGS } from '../settings.js';
import type { BattleConfig } from '../referee.js';

interface Option {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  onComplete: (cfg: BattleConfig) => void;
  keyStatus: (provider: string) => boolean;
}

type StepKey =
  | 'leftProvider'
  | 'leftModel'
  | 'leftReasoning'
  | 'rightProvider'
  | 'rightModel'
  | 'rightReasoning'
  | 'setting';

const CUSTOM = '__custom__';

export function Setup({ onComplete, keyStatus }: Props) {
  const [sel, setSel] = useState<Record<StepKey, string>>({
    leftProvider: 'openrouter',
    leftModel: defaultModel('openrouter'),
    leftReasoning: 'medium',
    rightProvider: 'openrouter',
    rightModel: defaultModel('openrouter'),
    rightReasoning: 'medium',
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
      hint: keyStatus(p.id) ? 'key found' : `set ${p.envKey}`,
    }));

  const modelOptions = (provider: string): Option[] => [
    ...(MODELS[provider] ?? []).map((m) => ({ value: m, label: m })),
    { value: CUSTOM, label: 'Custom model id…', hint: 'type your own' },
  ];

  const reasoningOptions = (): Option[] =>
    REASONING_LEVELS.map((r) => ({ value: r, label: r }));

  const settingOptions = (): Option[] =>
    SETTINGS.map((s) => ({ value: s.id, label: s.name, hint: s.blurb }));

  const steps: { key: StepKey; title: string; color: string; options: Option[] }[] = [
    { key: 'leftProvider', title: 'LEFT — provider', color: theme.left, options: providerOptions() },
    { key: 'leftModel', title: 'LEFT — model', color: theme.left, options: modelOptions(sel.leftProvider) },
    { key: 'leftReasoning', title: 'LEFT — reasoning effort', color: theme.left, options: reasoningOptions() },
    { key: 'rightProvider', title: 'RIGHT — provider', color: theme.right, options: providerOptions() },
    { key: 'rightModel', title: 'RIGHT — model', color: theme.right, options: modelOptions(sel.rightProvider) },
    { key: 'rightReasoning', title: 'RIGHT — reasoning effort', color: theme.right, options: reasoningOptions() },
    { key: 'setting', title: 'Choose the arena', color: theme.gold, options: settingOptions() },
  ];

  const step = steps[stepIdx];

  const commit = (value: string) => {
    const next = { ...sel, [step.key]: value };
    // Changing a provider resets that side's model to a sensible default.
    if (step.key === 'leftProvider') next.leftModel = defaultModel(value);
    if (step.key === 'rightProvider') next.rightModel = defaultModel(value);
    setSel(next);

    if (stepIdx === steps.length - 1) {
      onComplete({
        left: { provider: next.leftProvider, model: next.leftModel, reasoning: next.leftReasoning },
        right: { provider: next.rightProvider, model: next.rightModel, reasoning: next.rightReasoning },
        settingId: next.setting,
      });
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
      </Box>
    </Box>
  );
}
