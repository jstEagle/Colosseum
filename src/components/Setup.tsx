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
import { describeConfig, lastConfig, listPresets } from '../presets.js';
import { ago, listReplays } from '../replays.js';
import { getDifficulty } from '../difficulty.js';

interface Option {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  onComplete: (cfg: BattleConfig) => void;
  /** Open the hall of champions. */
  onHall: () => void;
  /** Watch a recorded match again. */
  onReplay: (id: string) => void;
  providerHint: (provider: string) => string;
  /** Terminal size, so the title plate can shrink instead of overflowing. */
  rows?: number;
  cols?: number;
}

/** Rows the wizard itself needs below the title plate. */
const WIZARD_ROWS = 31;

type StepKey =
  | 'start'
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
  'start',
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

/** One line under each step's title: what is being chosen, and why it matters. */
const HELP: Record<StepKey, (side: string) => string> = {
  start: () => 'Fight the last matchup again, load a saved one, watch a replay, or set up a new match.',
  leftProvider: (s) => `Who powers the ${s} gladiator? An API key, a subscription you are signed in to, or the training dummy.`,
  rightProvider: (s) => `Who powers the ${s} gladiator? Pick the training dummy to watch one model hunt alone.`,
  leftKey: (s) => `The ${s} gladiator's provider needs a key. Paste it; it is checked, then stored for next time.`,
  rightKey: (s) => `The ${s} gladiator's provider needs a key. Paste it; it is checked, then stored for next time.`,
  leftModel: (s) => `Which model fights on the ${s}? Type to filter the list.`,
  rightModel: (s) => `Which model fights on the ${s}? Type to filter the list.`,
  leftReasoning: (s) => `How long the ${s} gladiator thinks before it acts. More thought is not always better: speed wins races.`,
  rightReasoning: (s) => `How long the ${s} gladiator thinks before it acts. More thought is not always better: speed wins races.`,
  sandbox: () => 'Where the fight happens. Either way the models are confined; sealed keeps them off your machine entirely.',
  difficulty: () => 'How hard it is to find the enemy among the decoys. Hard is where models really differ.',
  setting: () => 'The flavour of the briefing. Standard Rules is neutral; the others change the mood, not the rules.',
};

/** The values a fixed-choice step offers, to put the cursor on the current one. */
function optionValues(key: StepKey, _sel: Selection): string[] {
  switch (key) {
    case 'leftProvider':
    case 'rightProvider':
      return PROVIDERS.map((p) => p.id);
    case 'leftReasoning':
    case 'rightReasoning':
      return [...REASONING_LEVELS];
    case 'sandbox':
      return SANDBOXES.map((s) => s.id);
    case 'difficulty':
      return DIFFICULTIES.map((d) => d.id);
    case 'setting':
      return SETTINGS.map((s) => s.id);
    default:
      return [];
  }
}

/** Start from the last matchup fought, so a tweak is one step, not eleven. */
function initialSelection(): Selection {
  const last = lastConfig();
  if (!last) {
    return {
      start: '',
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
    };
  }
  return {
    start: '',
    leftProvider: last.left.provider,
    leftKey: '',
    leftModel: last.left.model,
    leftReasoning: last.left.reasoning,
    rightProvider: last.right.provider,
    rightKey: '',
    rightModel: last.right.model,
    rightReasoning: last.right.reasoning,
    sandbox: last.sandbox,
    difficulty: last.difficultyId,
    setting: last.settingId,
  };
}

const PRESET = 'preset:';
const REPLAY = 'replay:';

export function Setup({ onComplete, onHall, onReplay, providerHint, rows = 40, cols = 100 }: Props) {
  const [sel, setSel] = useState<Selection>(initialSelection);
  const [presets] = useState(() => listPresets());
  const [replays] = useState(() => listReplays(5));
  const [last] = useState(() => lastConfig());
  const hasStart = Boolean(last || presets.length || replays.length);
  const [stepKey, setStepKey] = useState<StepKey>(hasStart ? 'start' : 'leftProvider');
  const [cursor, setCursor] = useState(() => (hasStart ? 0 : Math.max(0, PROVIDERS.findIndex((p) => p.id === sel.leftProvider))));

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
      if (k === 'start') return hasStart;
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
    PROVIDERS.map((p) => ({
      value: p.id,
      label: p.label,
      hint: `${providerState(p.id).ready ? '✓' : '✗'}  ${providerHint(p.id)}`,
    }));

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

  const startOptions = (): Option[] => [
    ...(last ? [{ value: 'rematch', label: '⟲  Rematch', hint: describeConfig(last) }] : []),
    ...presets.map(([name, cfg]) => ({ value: PRESET + name, label: `★  ${name}`, hint: describeConfig(cfg) })),
    { value: 'new', label: '+  New match', hint: last ? 'starts from the last matchup; change anything' : 'set up both gladiators' },
    ...replays.map((r) => {
      const verdict = r.outcome.kind === 'winner' ? `${r.outcome.winner.toUpperCase()} won` : 'draw';
      return {
        value: REPLAY + r.id,
        label: `▶  Replay`,
        hint: `${describeConfig(r.config)} · ${verdict} in ${(r.durationMs / 1000).toFixed(0)}s · ${ago(r.savedAt)}`,
      };
    }),
  ];

  const options = (): Option[] => {
    switch (stepKey) {
      case 'start':
        return startOptions();
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

  const isSideStep = isProviderStep || isKeyStep || isModelStep || stepKey.endsWith('Reasoning');

  /** The step's heading: whose gladiator, and which part of it. */
  const title = (): string => {
    const who = `${side(stepKey).toUpperCase()} GLADIATOR`;
    switch (stepKey) {
      case 'start':
        return 'WHAT WILL IT BE?';
      case 'leftProvider':
      case 'rightProvider':
        return `${who}  ·  PROVIDER`;
      case 'leftKey':
      case 'rightKey':
        return `${who}  ·  ${getProvider(providerOf(stepKey)).label.toUpperCase()} KEY`;
      case 'leftModel':
      case 'rightModel':
        return `${who}  ·  MODEL`;
      case 'leftReasoning':
      case 'rightReasoning':
        return `${who}  ·  REASONING EFFORT`;
      case 'sandbox':
        return 'THE MATCH  ·  SANDBOX';
      case 'difficulty':
        return 'THE MATCH  ·  DIFFICULTY';
      case 'setting':
        return 'THE MATCH  ·  ARENA';
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

  const goto = (key: StepKey, current: Selection = sel) => {
    setStepKey(key);
    // Open each list on what is already chosen, so ⏎ keeps it.
    const values = optionValues(key, current);
    setCursor(Math.max(0, values.indexOf(current[key])));
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
    else goto(nextKey, next);
  };

  const retreat = () => {
    const here = ORDER.indexOf(stepKey);
    const prev = [...visible].reverse().find((k) => ORDER.indexOf(k) < here);
    if (prev) goto(prev);
  };

  const commit = (value: string) => {
    if (stepKey === 'start') {
      if (value === 'rematch' && last) onComplete(last);
      else if (value.startsWith(PRESET)) {
        const cfg = presets.find(([n]) => n === value.slice(PRESET.length))?.[1];
        if (cfg) onComplete(cfg);
      } else if (value.startsWith(REPLAY)) onReplay(value.slice(REPLAY.length));
      else advance('start', sel);
      return;
    }
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
    if (isKeyStep) return 'paste, then ⏎ to save   ·   esc  back';
    if (isModelStep) return 'type to filter   ·   ↑↓ move   ·   ⏎ choose   ·   ← back';
    if (isProviderStep) return '↑↓ move   ·   ⏎ choose   ·   ← back   ·   r  replace a stored key   ·   l  hall of champions';
    if (stepKey === 'start') return '↑↓ move   ·   ⏎ choose   ·   l  hall of champions';
    return '↑↓ move   ·   ⏎ choose   ·   ← back   ·   l  hall of champions';
  };

  const width = Math.min(cols - 2, 96);
  const cardWidth = Math.floor((width - 3) / 2);

  return (
    <Box flexDirection="column">
      <Backdrop rows={Math.max(1, rows - WIZARD_ROWS)} cols={cols} subtitle="Two agents enter. One process leaves." />

      <Box justifyContent="center" marginTop={1}>
        <Box flexDirection="column" width={width}>
          <Box>
            <RosterCard side="left" sel={sel} stepKey={stepKey} width={cardWidth} />
            <Box width={3} alignItems="center">
              <Text color={theme.dim}>{' ⚔'}</Text>
            </Box>
            <RosterCard side="right" sel={sel} stepKey={stepKey} width={cardWidth} />
          </Box>
          <MatchLine sel={sel} stepKey={stepKey} />

          <Box marginTop={1}>
            <Text color={theme.dim}>{stepKey === 'start' ? '' : `STEP ${position + (hasStart ? 0 : 1)} OF ${visible.length - (hasStart ? 1 : 0)}   `}</Text>
            <Text color={isSideStep ? color : theme.white} bold>
              {title()}
            </Text>
          </Box>
          <Text color={theme.faint} wrap="truncate-end">
            {HELP[stepKey](side(stepKey).toUpperCase())}
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
            <Box marginTop={1}>
              <Text color={theme.bright}>{`> ${text} _`}</Text>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              {isModelStep ? (
                <Text color={theme.faint}>
                  {loadingCatalog
                    ? 'asking the provider for its catalogue…'
                    : `${opts.length - 1} models${catalogLive ? ' (live)' : ' (built-in list)'}${
                        query ? `  ·  filter: ${query}` : '  ·  type to filter'
                      }`}
                </Text>
              ) : null}
              {shown.map((opt, i) => {
                const active = i + offset === cursor;
                return (
                  <Box key={opt.value}>
                    <Box flexShrink={0}>
                      <Text color={active ? (isSideStep ? color : theme.white) : theme.faint} bold={active}>
                        {active ? '❯ ' : '  '}
                        {opt.label}
                      </Text>
                    </Box>
                    {opt.hint ? (
                      <Text color={active ? theme.muted : theme.dim} wrap="truncate-end">
                        {'   ' + opt.hint}
                      </Text>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          )}

          {saved ? <Text color={theme.win}>{saved}</Text> : null}
          <Box marginTop={1}>
            <Text color={theme.dim}>{footer()}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/** Which field of which card a step is editing. */
const FIELD: Partial<Record<StepKey, ['left' | 'right', 'provider' | 'model' | 'effort']>> = {
  leftProvider: ['left', 'provider'],
  leftKey: ['left', 'provider'],
  leftModel: ['left', 'model'],
  leftReasoning: ['left', 'effort'],
  rightProvider: ['right', 'provider'],
  rightKey: ['right', 'provider'],
  rightModel: ['right', 'model'],
  rightReasoning: ['right', 'effort'],
};

/**
 * One gladiator's card: provider, model and effort as chosen so far. The card
 * being edited is lit, and the field being chosen carries the cursor.
 */
function RosterCard({ side, sel, stepKey, width }: { side: 'left' | 'right'; sel: Selection; stepKey: StepKey; width: number }) {
  const editing = FIELD[stepKey];
  const active = editing?.[0] === side;
  const info = getProvider(sel[`${side}Provider` as StepKey]);
  const model = info.backend === 'dummy' ? '—' : sel[`${side}Model` as StepKey];
  const effort = info.supportsReasoning ? sel[`${side}Reasoning` as StepKey] : '—';
  const rows: ['provider' | 'model' | 'effort', string][] = [
    ['provider', info.label],
    ['model', model],
    ['effort', effort],
  ];
  const heading = side === 'left' ? '◀  LEFT GLADIATOR' : 'RIGHT GLADIATOR  ▶';
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={active ? theme.bright : theme.charcoal}
      paddingX={1}
    >
      <Box justifyContent={side === 'left' ? 'flex-start' : 'flex-end'}>
        <Text color={active ? theme.white : theme.faint} bold>
          {heading}
        </Text>
      </Box>
      {rows.map(([field, value]) => {
        const here = active && editing?.[1] === field;
        return (
          <Box key={field}>
            <Box width={10} flexShrink={0}>
              <Text color={here ? theme.bright : theme.dim}>{field}</Text>
            </Box>
            <Text color={here ? theme.white : active ? theme.text : theme.muted} bold={here} wrap="truncate-end">
              {here ? `❯ ${value}` : value}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/** The match settings under the cards, with the one being chosen lit. */
function MatchLine({ sel, stepKey }: { sel: Selection; stepKey: StepKey }) {
  const parts: [StepKey, string, string][] = [
    ['sandbox', 'sandbox', sel.sandbox],
    ['difficulty', 'difficulty', getDifficulty(sel.difficulty).id],
    ['setting', 'arena', SETTINGS.find((x) => x.id === sel.setting)?.name ?? sel.setting],
  ];
  return (
    <Box justifyContent="center">
      {parts.map(([key, label, value], i) => (
        <Box key={key}>
          <Text color={theme.dim}>{`${i ? '    ·    ' : ''}${label}  `}</Text>
          <Text color={stepKey === key ? theme.white : theme.muted} bold={stepKey === key}>
            {stepKey === key ? `❯ ${value}` : value}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
