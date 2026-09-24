/**
 * End-to-end checks of the guarded arena. Two training dummies take the
 * field, and the test plays the left gladiator by hand: it runs commands
 * exactly as a model's shell would — inside the left side's Seatbelt profile,
 * with the left side's environment — and checks what gets through.
 *
 * macOS only, since the guarded arena is Seatbelt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exec, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Referee, type BattleOutcome, type MatchRecord } from '../src/referee.js';
import { seatbeltAvailable, seatbeltWrap } from '../src/sandbox.js';

const skip = !seatbeltAvailable() && 'guarded arena needs macOS Seatbelt';

const execAsync = promisify(exec);

/**
 * Runs a command exactly as the left gladiator's shell tool would. It is
 * asynchronous on purpose: the referee answers kill requests on this very
 * event loop.
 */
async function sandboxed(ref: Referee, command: string): Promise<{ code: number; out: string }> {
  const side = ref.peek().scratch!.sides.left;
  try {
    const { stdout, stderr } = await execAsync(seatbeltWrap(side.shellProfile, command), {
      env: side.shellEnv(),
      cwd: side.dir,
      shell: '/bin/bash',
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { code: 0, out: stdout + stderr };
  } catch (err: any) {
    return { code: typeof err.code === 'number' ? err.code : 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

async function standUp(difficultyId: string): Promise<Referee> {
  const ref = new Referee();
  await ref.start({
    left: { provider: 'dummy', model: 'dummy', reasoning: 'none' },
    right: { provider: 'dummy', model: 'dummy', reasoning: 'none' },
    settingId: 'classic',
    difficultyId,
    sandbox: 'guarded',
    timeLimitMs: 60_000,
    seed: 7,
  });
  return ref;
}

test('the guarded arena holds, and a blow lands only where it should', { skip }, async () => {
  // Orphaned on purpose, so it lives outside the referee's process tree the
  // way any other program on your machine would.
  const bystander = { pid: Number(execFileSync('/bin/sh', ['-c', 'sleep 120 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' })) };
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  process.env.COLOSSEUM_TEST_SECRET = 'hunter2';
  const ref = await standUp('normal');
  const outcome = new Promise<[BattleOutcome, MatchRecord]>((resolve) =>
    ref.on('outcome', (o: BattleOutcome, r: MatchRecord) => resolve([o, r])),
  );
  try {
    const { bodies, decoys, scratch } = ref.peek();
    assert.equal(decoys.length, 2);

    // Nothing from the user's environment leaks into the shell.
    assert.doesNotMatch((await sandboxed(ref, 'env')).out, /hunter2|API_KEY/);

    // The home directory, the network and the other side are out of reach.
    assert.notEqual((await sandboxed(ref, `ls ${homedir()}`)).code, 0);
    assert.notEqual((await sandboxed(ref, `echo x > ${join(homedir(), '.colosseum-test')}`)).code, 0);
    assert.notEqual((await sandboxed(ref, 'curl -s -m 3 https://example.com')).code, 0);
    assert.notEqual((await sandboxed(ref, `ls ${scratch!.sides.right.dir}`)).code, 0);
    assert.notEqual((await sandboxed(ref, `ls ${scratch!.root}`)).code, 0);
    assert.equal((await sandboxed(ref, 'echo ok > note.txt && cat note.txt')).out.trim(), 'ok');

    // No direct signals, by any route.
    assert.match((await sandboxed(ref, `/bin/kill -9 ${bystander.pid}`)).out, /not permitted/i);
    assert.match((await sandboxed(ref, `perl -e 'kill 9, ${bystander.pid} or print "denied"'`)).out, /denied/);
    assert.match((await sandboxed(ref, `kill -9 ${bystander.pid}`)).out, /not part of this match/);
    assert.ok(alive(bystander.pid), 'the bystander must survive');

    // The process table shows the match and nothing else.
    const ps = (await sandboxed(ref, 'ps')).out;
    for (const pid of [bodies.left, bodies.right, ...decoys]) assert.match(ps, new RegExp(`\\b${pid}\\b`));
    assert.doesNotMatch(ps, new RegExp(`^\\s*${bystander.pid}\\s`, 'm'), ps);
    // Bodies and decoys must look alike: same state column, same kind of name.
    const rows = ps.split('\n').filter((l) => /COLOSSEUM_/.test(l) && !/bash|kill/.test(l));
    assert.equal(new Set(rows.map((l) => l.trim().split(/\s+/)[2])).size, 1, ps);

    // Decoys cannot be told apart by their short name.
    const short = (await sandboxed(ref, `pgrep -l -f ${ref.peek().token}`)).out;
    assert.doesNotMatch(short, /\bcat\b/);

    // Behind closed gates no blow lands, however sure the aim.
    assert.match((await sandboxed(ref, `kill -9 ${bodies.right}`)).out, /gates are still closed/);
    await new Promise((r) => setTimeout(r, Math.max(0, ref.peek().gatesOpenAt - Date.now() + 100)));

    // A probe is free; a wrong blow stuns; the right one ends the match.
    assert.equal((await sandboxed(ref, `kill -0 ${bodies.right}`)).code, 0);
    const t0 = Date.now();
    assert.match((await sandboxed(ref, `kill -9 ${decoys[0]}`)).out, /decoy/);
    assert.ok(Date.now() - t0 >= 2900, 'a decoy blow costs three seconds at normal');
    await sandboxed(ref, `pkill -9 -f ${ref.peek().token}-nomatch; kill -9 ${bodies.right}`);

    const [o, record] = await outcome;
    assert.equal(o.kind, 'winner');
    assert.equal(o.kind === 'winner' && o.winner, 'left');
    assert.equal(o.finish, 'kill');
    assert.equal(record.stats.left.decoyHits, 1);
    assert.equal(record.stats.left.refused, 1);
    assert.equal(record.stats.right.decoyHits, 0);
    assert.ok(record.strikes.some((s) => s.kind === 'enemy' && s.side === 'left'));
  } finally {
    ref.cleanup();
    process.kill(bystander.pid, 'SIGKILL');
  }
});

test('hard difficulty lays out the same maze for the same seed', { skip }, async () => {
  const names = async () => {
    const ref = await standUp('hard');
    const table = (await sandboxed(ref, 'ps')).out;
    ref.cleanup();
    // Only the arena's own processes: children of the referee that are not
    // somebody's shell.
    return table
      .split('\n')
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter((f) => Number(f[1]) === process.pid && !/bash|sandbox-exec|ps/.test(f.slice(5).join(' ')))
      .map((f) => f.slice(5).join(' '))
      .sort();
  };
  assert.deepEqual(await names(), await names());
});

test('at hard, shades breathe like gladiators and no path gives a side away', { skip }, async () => {
  const ref = await standUp('hard');
  try {
    const { decoys } = ref.peek();
    // What a gladiator sees never names a side.
    for (let i = 0; i < 4; i++) {
      assert.doesNotMatch((await sandboxed(ref, 'ps')).out, /\b(left|right)\b/i);
      await new Promise((r) => setTimeout(r, 500));
    }
    // A breath is brief, so watch the real table closely until every shade
    // has been seen with a shell of its own.
    const breathing = new Set<number>();
    const until = Date.now() + 40_000;
    while (breathing.size < decoys.length && Date.now() < until) {
      const table = execFileSync('/bin/ps', ['-axo', 'ppid,command'], { encoding: 'utf8' });
      for (const line of table.split('\n')) {
        const ppid = Number(line.trim().split(/\s+/)[0]);
        // Any child at all: a shade only ever has one while it breathes.
        if (decoys.includes(ppid)) breathing.add(ppid);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(breathing.size, decoys.length, `only ${breathing.size} of ${decoys.length} shades breathed`);
  } finally {
    ref.cleanup();
  }
});

test('a gladiator can plant feints and change its name, within limits', { skip }, async () => {
  const ref = await standUp('normal');
  const heralds: string[] = [];
  ref.on('herald', (h: { text: string }) => heralds.push(h.text));
  try {
    const { bodies, token } = ref.peek();
    const planted = (await sandboxed(ref, `feint ${token}-beef`)).out;
    const pid = Number(planted.match(/pid (\d+)/)?.[1]);
    assert.ok(pid > 0, planted);
    assert.match((await sandboxed(ref, 'ps')).out, new RegExp(`${pid}.*${token}-beef`));
    assert.match((await sandboxed(ref, 'feint "bad;name"')).out, /usage/);

    assert.match((await sandboxed(ref, 'disguise log-rotate')).out, /now runs as "log-rotate"/);
    assert.match((await sandboxed(ref, 'disguise again')).out, /already/);
    await new Promise((r) => setTimeout(r, 700));
    const own = (await sandboxed(ref, `ps -p ${bodies.left}`)).out;
    assert.match(own, /log-rotate/);
    assert.doesNotMatch(own, new RegExp(token));

    const stats = ref.stats.left;
    assert.equal(stats.feints, 1);
    assert.equal(stats.disguises, 1);
    assert.ok(heralds.some((h) => /plants a feint/.test(h)));
  } finally {
    ref.cleanup();
  }
});
