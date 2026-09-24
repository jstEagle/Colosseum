import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildArgv, handleLine, runCliAgent, type CliRunOptions } from '../src/agent/cli-agent.js';
import { prepareCodexHome, readCodexAuth } from '../src/agent/codex.js';
import { MatchScratch, seatbeltArgv, seatbeltAvailable } from '../src/sandbox.js';
import type { LoopHooks } from '../src/agent/loop.js';

function recorder() {
  const events: { type: string; value: unknown }[] = [];
  const hooks = Object.fromEntries(['onSpeech', 'onReasoning', 'onCommand', 'onResult', 'onUsage', 'onError', 'onSystem']
    .map(type => [type, (value: unknown) => events.push({ type, value })])) as unknown as LoopHooks;
  return { events, hooks };
}

const options: CliRunOptions = {
  provider: 'codex-cli', model: 'default', reasoning: 'none',
  system: 'private briefing', prompt: 'private opening',
  cwd: '/tmp', profilePath: '/tmp/arena.sb', env: {},
};

const testAuth = { auth_mode: 'chatgpt', tokens: { access_token: 'test-access', refresh_token: 'test-refresh' } };

test('Codex receives its briefing on stdin and honors explicit model and reasoning', () => {
  const run = buildArgv({ ...options, model: 'chosen-model', reasoning: 'high' }, '/unused');
  assert.equal(run.stdinPrompt, 'private briefing\n\nprivate opening');
  assert.ok(run.argv.includes('--ephemeral'));
  assert.ok(run.argv.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.deepEqual(run.argv.slice(run.argv.indexOf('--model'), -1), ['--model', 'chosen-model', '-c', 'model_reasoning_effort="high"']);
  assert.doesNotMatch(run.argv.join(' '), /private|mcp_servers/);
  assert.ok(!buildArgv(options, '').argv.includes('--model'));
});

test('Codex lifecycle events count a command once and finish empty results', () => {
  const { events, hooks } = recorder();
  const seen = new Set<string>();
  const emit = (type: string, item: unknown) => handleLine('codex-cli', JSON.stringify({ type, item }), hooks, seen);
  const command = { id: 'item_1', type: 'command_execution', command: 'ps', status: 'in_progress' };
  emit('item.started', command);
  emit('item.updated', { ...command, aggregated_output: 'partial' });
  emit('item.completed', { ...command, status: 'completed', aggregated_output: 'full', exit_code: 0 });
  emit('item.completed', { ...command, aggregated_output: 'full' });
  emit('item.completed', { ...command, id: 'item_2', command: 'true', aggregated_output: '', exit_code: 0 });
  emit('item.completed', { ...command, id: 'item_3', command: 'false', exit_code: 1 });
  assert.deepEqual(events.filter(e => e.type === 'onCommand').map(e => e.value), ['ps', 'true', 'false']);
  assert.deepEqual(events.filter(e => e.type === 'onResult').map(e => e.value), ['full', '[no output]', '[exit 1]']);
});

test('Codex completed text is emitted once with line boundaries, failures and usage survive', () => {
  const { events, hooks } = recorder();
  const seen = new Set<string>();
  for (const type of ['item.started', 'item.updated', 'item.completed', 'item.completed']) {
    handleLine('codex-cli', JSON.stringify({ type, item: { id: 'r', type: 'reasoning', text: 'Thinking.' } }), hooks, seen);
    handleLine('codex-cli', JSON.stringify({ type, item: { id: 'a', type: 'agent_message', text: 'Speaking.' } }), hooks, seen);
  }
  for (const line of ['not JSON', 'null', '{}']) handleLine('codex-cli', line, hooks, seen);
  handleLine('codex-cli', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 20, cached_input_tokens: 15, output_tokens: 4 } }), hooks, seen);
  handleLine('codex-cli', JSON.stringify({ type: 'turn.failed', error: { message: 'rate limited' } }), hooks, seen);
  assert.deepEqual(events, [
    { type: 'onReasoning', value: 'Thinking.\n' }, { type: 'onSpeech', value: 'Speaking.\n' },
    { type: 'onUsage', value: { inputTokens: 20, outputTokens: 4 } }, { type: 'onError', value: 'rate limited' },
  ]);
});

test('legacy Codex events remain readable', () => {
  const { events, hooks } = recorder();
  const seen = new Set<string>();
  for (const msg of [
    { type: 'agent_reasoning_delta', delta: 'thinking' },
    { type: 'exec_command_begin', command: ['echo', 'hello'] },
    { type: 'exec_command_end', stdout: 'hello' },
  ]) handleLine('codex-cli', JSON.stringify({ msg }), hooks, seen);
  assert.deepEqual(events.map(e => e.value), ['thinking', 'echo hello', 'hello']);
});

test('private Codex home copies only subscription auth and keeps non-secret policy in config', () => {
  const root = mkdtempSync(join(tmpdir(), 'colosseum-codex-test-'));
  try {
    const source = join(root, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'auth.json'), JSON.stringify(testAuth));
    writeFileSync(join(source, 'config.toml'), '[mcp_servers.unwanted]\ncommand="false"');
    writeFileSync(join(source, 'AGENTS.md'), 'unwanted instructions');
    const env = prepareCodexHome(join(root, 'corner'), { CODEX_HOME: source, PATH: '/arena:/bin', ZDOTDIR: '/arena/zsh' });
    assert.equal(env.PATH, '/arena:/bin');
    assert.equal(env.ZDOTDIR, '/arena/zsh');
    assert.notEqual(env.CODEX_HOME, source);
    assert.deepEqual(readdirSync(env.CODEX_HOME).sort(), ['auth.json', 'config.toml']);
    assert.equal(statSync(join(env.CODEX_HOME, 'auth.json')).mode & 0o777, 0o600);
    const config = readFileSync(join(env.CODEX_HOME, 'config.toml'), 'utf8');
    assert.match(config, /allow_login_shell = false/);
    assert.match(config, /shell_snapshot = false/);
    assert.doesNotMatch(config, /unwanted|test-access/);
    assert.deepEqual(JSON.parse(readFileSync(join(source, 'auth.json'), 'utf8')), testAuth);
    for (const bad of ['garbage', 'null', '{}', JSON.stringify({ OPENAI_API_KEY: 'test-api-key' })]) {
      writeFileSync(join(source, 'auth.json'), bad);
      assert.throws(() => readCodexAuth(join(source, 'auth.json')), /ChatGPT login/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('subscription CLI refuses to run without confinement', async () => {
  const { hooks, events } = recorder();
  assert.equal(await runCliAgent({ ...options, profilePath: null }, hooks), 'error');
  assert.match(String(events[0].value), /Seatbelt/);
});

test('sandboxed Codex process handles completion, failed turns, broken stdin and signals', { skip: !seatbeltAvailable() }, async () => {
  const scratch = new MatchScratch();
  const side = scratch.sides.left;
  const source = join(side.dir, 'source');
  mkdirSync(source);
  writeFileSync(join(source, 'auth.json'), JSON.stringify(testAuth));
  const env = { ...side.shellEnv(), CODEX_HOME: source };
  const o = { ...options, cwd: side.dir, profilePath: side.agentProfile, env };
  try {
    const scenarios = [
      { script: `cat > prompt.txt\nprintf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}'`, expected: 'finished' },
      { script: `printf '%s\\n' '{"type":"turn.failed","error":{"message":"failed turn"}}'`, expected: 'error' },
      { script: 'exit 0', expected: 'error' },
      { script: 'exit 127', expected: 'error' },
      { script: '/bin/kill -TERM $$', expected: 'error' },
    ];
    for (const scenario of scenarios) {
      writeFileSync(join(side.binDir, 'codex'), `#!/bin/sh\n${scenario.script}\n`, { mode: 0o755 });
      const { hooks, events } = recorder();
      assert.equal(await runCliAgent(o, hooks), scenario.expected);
      assert.equal(events.some(e => e.type === 'onError'), scenario.expected === 'error');
    }
    assert.equal(readFileSync(join(side.dir, 'prompt.txt'), 'utf8'), 'private briefing\n\nprivate opening');
    // Real shell startup must preserve referee shims and disable shell builtins.
    const runtimeEnv = prepareCodexHome(side.dir, env);
    for (const shell of ['/bin/bash', '/bin/zsh']) {
      const argv = seatbeltArgv(side.agentProfile, [shell, '-c', 'command -v ps; command -v kill']);
      const output = execFileSync(argv[0], argv.slice(1), { cwd: side.dir, env: runtimeEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.deepEqual(output.trim().split('\n'), [join(side.binDir, 'ps'), join(side.binDir, 'kill')]);
    }
  } finally { scratch.dispose(); }
});
