import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Backdrop } from './Backdrop.js';
import { theme } from '../theme.js';
import { MODELS, PROVIDERS, REASONING_LEVELS, defaultModel, getProvider } from '../models.js';
import { SETTINGS } from '../settings.js';
import { DIFFICULTIES } from '../difficulty.js';
import { SANDBOXES } from '../sandbox.js';
import { KEY_FILE, maskKey, saveKey } from '../keystore.js';
import { fetchModels, filterModels, verifyKey } from '../catalog.js';
import { defaultSandbox, providerState, sandboxState } from '../preflight.js';
import type { BattleConfig } from '../referee.js';
import type { SandboxMode } from '../sandbox.js';

interface Option {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  onComplete: (cfg: BattleConfig) => void;
  /** Open the hall of champions. */
  onHall: () => void;
  providerHint: (provider: string) => string;
  /** Terminal size, so the title plate can shrink instead of overflowing. */
  rows?: number;
  cols?: number;
}

/** Rows the wizard itself needs below the title plate. */
const WIZARD_ROWS = 24;

type StepKey =
  | 'leftProvider'
  | 'leftKey'
  | 'leftModel'
  | 'leftReasoning'
  | 'rightProvider'
  | 'rightKey'
  | 'rightModel'
  | 'rightReasoning'
  | 'sandbox'
  | 'difficulty'
  | 'setting';

/** Canonical order. Which of these are actually shown depends on choices. */
const ORDER: StepKey[] = [
  'leftProvider',
  'leftKey',
  'leftModel',
  'leftReasoning',
  'rightProvider',
  'rightKey',
  'rightModel',
  'rightReasoning',
  'sandbox',
  'difficulty',
  'setting',
];

const CUSTOM = '__custom__';
const MODEL_WINDOW = 10;

/**
 * Keep only what a person meant to type. Some terminals wrap a paste in
 * bracketed-paste markers, and those must not end up inside a key.
 */
function printable(input: string): string {
  return input
    .replace(/\u001b\[20[01]~/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '');
}

type Selection = Record<StepKey, string>;

export function Setup({ onComplete, onHall, providerHint, rows = 40, cols = 100 }: Props) {
  const [sel, setSel] = useState<Selection>({
    leftProvider: 'openrouter',
    leftKey: '',
    leftModel: defaultModel('openrouter'),
    leftReasoning: 'medium',
    rightProvider: 'openrouter',
    rightKey: '',
    rightModel: defaultModel('openrouter'),
    rightReasoning: 'medium',
    sandbox: defaultSandbox(),
    difficulty: 'normal',
    setting: 'classic',
  });
  const [stepKey, setStepKey] = useState<StepKey>('leftProvider');
  const [cursor, setCursor] = useState(0);

  // Free-text entry, shared by the key step and the custom-model prompt.
  const [text, setText] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  // The model catalogue for whichever side is being configured.
  const [catalog, setCatalog] = useState<string[]>([]);
  const [catalogLive, setCatalogLive] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [query, setQuery] = useState('');

  // Which sides want to replace a key they already have.
  const [replaceKey, setReplaceKey] = useState<Record<string, boolean>>({});

  const side = (key: StepKey): 'left' | 'right' => (key.startsWith('left') ? 'left' : 'right');
  const providerOf = (key: StepKey) => sel[`${side(key)}Provider` as StepKey];

  const needsKeyStep = (s: Selection, which: 'left' | 'right'): boolean => {
    const info = getProvider(s[`${which}Provider` as StepKey]);
    if (!info.envKey) return false; // subscriptions and local servers need none
    if (replaceKey[which]) return true;
    return !providerState(info.id).ready;
  };

  const visibleSteps = (s: Selection): StepKey[] =>
    ORDER.filter((k) => {
      if (k === 'leftKey') return needsKeyStep(s, 'left');
      if (k === 'rightKey') return needsKeyStep(s, 'right');
      if (k === 'leftReasoning') return getProvider(s.leftProvider).supportsReasoning;
      if (k === 'rightReasoning') return getProvider(s.rightProvider).supportsReasoning;
      // The training dummy has no model to choose.
      if (k === 'leftModel') return getProvider(s.leftProvider).backend !== 'dummy';
      if (k === 'rightModel') return getProvider(s.rightProvider).backend !== 'dummy';
      return true;
    });

  const visible = visibleSteps(sel);
  const position = Math.max(0, visible.indexOf(stepKey));

  /* ------------------------------------------------------------ options -- */

  const providerOptions = (): Option[] =>
    PROVIDERS.map((p) => ({ value: p.id, label: p.label, hint: providerHint(p.id) }));

  const modelOptions = (): Option[] => {
    const base = catalog.length ? catalog : (MODELS[providerOf(stepKey)] ?? []);
    const matches = filterModels(base, query);
    return [
      ...matches.map((m) => ({
        value: m,
        label: m,
        hint: m === 'default' ? "the CLI's own default" : undefined,
      })),
      { value: CUSTOM, label: 'Custom model id…', hint: 'type your own' },
    ];
  };

  const options = (): Option[] => {
    switch (stepKey) {
      case 'leftProvider':
      case 'rightProvider':
        return providerOptions();
      case 'leftModel':
      case 'rightModel':
        return modelOptions();
      case 'leftReasoning':
      case 'rightReasoning':
        return REASONING_LEVELS.map((r) => ({ value: r, label: r }));
      case 'sandbox':
        return SANDBOXES.map((s) => {
          const state = sandboxState(s.id);
          return {
            value: s.id,
            label: s.name,
            hint: state.ready ? s.blurb : `unavailable — ${state.hint}`,
          };
        });
      case 'difficulty':
        return DIFFICULTIES.map((d) => ({ value: d.id, label: d.name, hint: d.blurb }));
      case 'setting':
        return SETTINGS.map((s) => ({ value: s.id, label: s.name, hint: s.blurb }));
      default:
        return [];
    }
  };

  const isKeyStep = stepKey === 'leftKey' || stepKey === 'rightKey';
  const isModelStep = stepKey === 'leftModel' || stepKey === 'rightModel';
  const isProviderStep = stepKey === 'leftProvider' || stepKey === 'rightProvider';

  const title = (): string => {
    const s = side(stepKey).toUpperCase();
    switch (stepKey) {
      case 'leftProvider':
      case 'rightProvider':
        return `${s} — provider`;
      case 'leftKey':
      case 'rightKey':
        return `${s} — paste your ${getProvider(providerOf(stepKey)).label} key`;
      case 'leftModel':
      case 'rightModel':
        return `${s} — model`;
      case 'leftReasoning':
      case 'rightReasoning':
        return `${s} — reasoning effort`;
      case 'sandbox':
        return 'Which sandbox should hold the fight?';
      case 'difficulty':
        return 'How hard is it to reach each other?';
      case 'setting':
        return 'Choose the arena';
    }
  };

  const color = isProviderStep || isKeyStep || isModelStep || stepKey.endsWith('Reasoning')
    ? side(stepKey) === 'left'
      ? theme.left
      : theme.right
    : theme.gold;

  /* --------------------------------------------------------- navigation -- */

  const finish = (next: Selection) => {
    onComplete({
      left: { provider: next.leftProvider, model: next.leftModel, reasoning: next.leftReasoning },
      right: { provider: next.rightProvider, model: next.rightModel, reasoning: next.rightReasoning },
      settingId: next.setting,
      difficultyId: next.difficulty,
      sandbox: next.sandbox as SandboxMode,
    });
  };

  const goto = (key: StepKey) => {
    setStepKey(key);
    setCursor(0);
    setText('');
    setQuery('');
    setError('');
    setCustomMode(false);
  };

  const advance = (from: StepKey, next: Selection) => {
    const vis = visibleSteps(next);
    const here = ORDER.indexOf(from);
    const nextKey = vis.find((k) => ORDER.indexOf(k) > here);
    if (!nextKey) finish(next);
    else goto(nextKey);
  };

  const retreat = () => {
    const here = ORDER.indexOf(stepKey);
    const prev = [...visible].reverse().find((k) => ORDER.indexOf(k) < here);
    if (prev) goto(prev);
  };

  const commit = (value: string) => {
    const next: Selection = { ...sel, [stepKey]: value };
    if (stepKey === 'leftProvider') {
      next.leftModel = defaultModel(value);
      if (!getProvider(value).supportsReasoning) next.leftReasoning = 'none';
    }
    if (stepKey === 'rightProvider') {
      next.rightModel = defaultModel(value);
      if (!getProvider(value).supportsReasoning) next.rightReasoning = 'none';
    }
    setSel(next);
    advance(stepKey, next);
  };

  /* ------------------------------------------------------------ catalog -- */

  // Ask the provider what it offers as soon as a model step opens.
  useEffect(() => {
    if (!isModelStep) return;
    const provider = providerOf(stepKey);
    let cancelled = false;
    setCatalog([]);
    setCatalogLive(false);
    setLoadingCatalog(true);
    void fetchModels(provider).then(({ models, live }) => {
      if (cancelled) return;
      setCatalog(models);
      setCatalogLive(live);
      setLoadingCatalog(false);
      // Open the list on whatever is already chosen rather than at the top
      // of the alphabet; four hundred models is a long way to scroll.
      const current = sel[stepKey];
      const at = models.indexOf(current);
      if (at >= 0) setCursor(at);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  /* ---------------------------------------------------------- key entry -- */

  const submitKey = () => {
    const value = text.trim();
    if (!value || busy) return;
    const provider = getProvider(providerOf(stepKey));
    const which = side(stepKey);
    setBusy(true);
    setError('');
    void verifyKey(provider.id, value).then((problem) => {
      setBusy(false);
      if (problem) {
        setError(problem);
        setText('');
        return;
      }
      const path = saveKey(provider.envKey!, value);
      setSaved(`${provider.label} key saved to ${path}`);
      setReplaceKey((r) => ({ ...r, [which]: false }));
      advance(stepKey, sel);
    });
  };

  /* -------------------------------------------------------------- input -- */

  const opts = options();

  useInput((input, key) => {
    if (busy) return;

    // Free-text modes: the key step and the custom-model prompt.
    if (isKeyStep || customMode) {
      if (key.return) {
        if (isKeyStep) submitKey();
        else if (text.trim()) {
          const v = text.trim();
          setCustomMode(false);
          setText('');
          commit(v);
        }
        return;
      }
      if (key.escape) {
        if (customMode) {
          setCustomMode(false);
          setText('');
        } else {
          retreat();
        }
        return;
      }
      if (key.backspace || key.delete) {
        setText((t) => t.slice(0, -1));
        return;
      }
      // Pasted text arrives as one chunk; keep everything printable.
      if (input && !key.ctrl && !key.meta) setText((t) => t + printable(input));
      return;
    }

    if (key.upArrow) {
      setCursor((c) => (c - 1 + opts.length) % opts.length);
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c + 1) % opts.length);
      return;
    }
    if (key.return) {
      const opt = opts[cursor];
      if (!opt) return;
      if (opt.value === CUSTOM) {
        setCustomMode(true);
        setText('');
      } else {
        commit(opt.value);
      }
      return;
    }
    if (key.leftArrow) {
      retreat();
      return;
    }

    // A model list can be hundreds long, so letters filter it instead of
    // jumping around it.
    if (isModelStep) {
      if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1));
        setCursor(0);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setQuery((q) => q + printable(input));
        setCursor(0);
      }
      return;
    }

    if (key.backspace) {
      retreat();
      return;
    }
    if (input === 'l') {
      onHall();
      return;
    }
    if (input === 'k') setCursor((c) => (c - 1 + opts.length) % opts.length);
    else if (input === 'j') setCursor((c) => (c + 1) % opts.length);
    else if (input === 'r' && isProviderStep) {
      // Replace a key you already have.
      const info = getProvider(opts[cursor]?.value ?? '');
      if (info.envKey) {
        setReplaceKey((rk) => ({ ...rk, [side(stepKey)]: true }));
        commit(info.id);
      }
    }
  });

  /* ------------------------------------------------------------- render -- */

  // Keep the cursor inside a window so a long catalogue stays readable.
  const windowStart = Math.max(0, Math.min(cursor - Math.floor(MODEL_WINDOW / 2), opts.length - MODEL_WINDOW));
  const shown = isModelStep ? opts.slice(Math.max(0, windowStart), Math.max(0, windowStart) + MODEL_WINDOW) : opts;
  const offset = isModelStep ? Math.max(0, windowStart) : 0;

  const footer = () => {
    if (isKeyStep) return 'paste, then ⏎ to save  ·  esc back';
    if (isModelStep) return `type to filter · ↑↓ move · ⏎ select · ← back`;
    if (isProviderStep) return '↑↓ move · ⏎ select · r replace stored key · l hall of champions';
    return '↑↓ move · ⏎ select · ← back · l hall of champions';
  };

  return (
    <Box flexDirection="column">
      <Backdrop rows={Math.max(1, rows - WIZARD_ROWS)} cols={cols} subtitle="Two agents enter. One process leaves." />
      <Box justifyContent="center" marginBottom={1}>
        <Text color={theme.faint}>{`step ${position + 1}/${visible.length}   ${footer()}`}</Text>
      </Box>

      <Box justifyContent="center">
        <Box flexDirection="column" paddingX={2} width={Math.min(cols, 100)}>
          <Text color={color} bold>
            {title()}
          </Text>

          {isKeyStep ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color={theme.faint}>
                {`Nothing is echoed back. The key is stored in ${KEY_FILE}, never in the repo.`}
              </Text>
              <Text color={theme.bright}>
                {`> ${text ? maskKey(text) : ''}${busy ? ' checking…' : ' _'}`}
              </Text>
              {error ? (
                <Box marginTop={1}>
                  <Text color={theme.blood}>{error}</Text>
                </Box>
              ) : null}
            </Box>
          ) : customMode ? (
            <Text color={theme.bright}>{`> ${text} _`}</Text>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              {isModelStep ? (
                <Text color={theme.faint}>
                  {loadingCatalog
                    ? 'asking the provider for its catalogue…'
                    : `${opts.length - 1} models${catalogLive ? ' (live)' : ' (built-in list)'}${
                        query ? `  filter: ${query}` : ''
                      }`}
                </Text>
              ) : null}
              {shown.map((opt, i) => {
                const active = i + offset === cursor;
                return (
                  <Box key={opt.value}>
                    <Box flexShrink={0}>
                      <Text color={active ? color : theme.faint} bold={active}>
                        {active ? '❯ ' : '  '}
                        {opt.label}
                      </Text>
                    </Box>
                    {opt.hint ? (
                      <Text color={theme.dim} wrap="truncate-end">
                        {'   ' + opt.hint}
                      </Text>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          )}

          <Box marginTop={1} flexDirection="column">
            <Text color={theme.dim}>
              LEFT: {sel.leftProvider}/{sel.leftModel} [{sel.leftReasoning}]
            </Text>
            <Text color={theme.dim}>
              RIGHT: {sel.rightProvider}/{sel.rightModel} [{sel.rightReasoning}]
            </Text>
            <Text color={theme.dim}>
              sandbox: {sel.sandbox} · difficulty: {sel.difficulty}
            </Text>
            {saved ? <Text color={theme.win}>{saved}</Text> : null}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
