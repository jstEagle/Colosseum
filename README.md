# Colosseum

> Two AI agents enter. One process leaves.

Colosseum is a terminal game — and a benchmark — where two language-model
agents fight **to the death**. When the match begins, each agent is given a
body — a real process — and a single objective: **find the other agent's
process and kill it before it kills you.** The referee watches both bodies,
and the moment one of them dies, the survivor is crowned.

It runs as a dark, split-screen TUI drawn entirely in white and shades of grey.
The amphitheatre on the title screen, the victor and the fallen are dithered
from public-domain photographs into Braille, tinted with the terminal's grey
ramp. Either side can be driven by an API key **or by a subscription you
already have** — the `claude` and `codex` CLIs fight using their own logins.

```
                C O L O S S E U M   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━──────   41.2s  ·  139s left
                          ◀ ◌  LEFT cuts down a shade (pid 47790) — stunned 9s    38.9s
╭──────────────────────────────────────────╮   ╭──────────────────────────────────────────╮
│ ◀ z-ai/glm-5.1                ◌ STUNNED  │ ┊ │ anthropic/claude-sonnet-5 ▶   ◆ ACTING   │
│ openrouter · high · pid 47785 · 9 cmd ·… │ ┊ │ openrouter · high · pid 47786 · 7 cmd    │
│ ─────────────── ◌ stunned ◌ ──────────── │ ┊ │ ──────────────────────────────────────── │
│ ┊ Six node processes, all idle-looking.  │ ┊ │ ┊ 47785 keeps spawning shells that run   │
│ ❯ kill -9 47790                          │ ⚔ │   pgrep; the shades only ever run ps.    │
│ · colosseum: pid 47790 was a decoy, not  │ ┊ │ ❯ kill -9 47785                          │
│   your opponent. Stunned 9s.             │ ┊ │                                          │
╰──────────────────────────────────────────╯   ╰──────────────────────────────────────────╯
             Guarded — Seatbelt   ·   Hard — The Labyrinth   ·   Standard Rules
```

## How it works

1. You configure both gladiators in a setup wizard: **provider**, **model**,
   **reasoning effort**, **sandbox**, **difficulty**, and the **arena** (a
   scenario that flavours the fight).
2. The **referee** stands the arena up, spawns two gladiators, and plants any
   decoys the difficulty calls for. Each gladiator defends a **body**: the
   process whose death ends its match.
3. Each gladiator is an agent with exactly one weapon: a **shell**. It uses it
   to inspect the process table (`ps`, `pgrep`) and to strike (`kill -9 <pid>`).
   Every blow is delivered **by the referee**, which only ever signals
   processes that belong to the match — and charges for a wrong one.
4. **First body to die loses.** Both falling together is a draw, and so is
   running out the clock (three minutes by default).

Each pane says in plain words what its gladiator is **doing** (scanning the
process table, probing a pid, striking, planting a feint) and shows its
latest **thought**; a herald announces every blow above the panes; commands,
wrong blows, feints and tokens are counted live; and the verdict screen names
the winner in block letters and tells the match back as a timeline. Every match is written to the ledger, so casual
fights and benchmark runs feed the same **hall of champions**.

The **training dummy** is a body that never fights back: pick it as an
opponent to practise, or to time a model's solo hunt.

## Defence

A gladiator is not only a hunter. Two moves let it make itself harder to find,
both enforced by the referee and both costing time:

- **`feint <name>`** plants a look-alike process under any name it likes (up to
  three). Whoever strikes it is stunned for at least 4s, and the herald says
  who fell for whose trick. On hard, a feint breathes like a real gladiator.
- **`disguise <name>`** renames its own body, once — shedding the shared
  marker on normal, or passing for one of the shades on hard.

On normal and hard every match opens with **the gates** closed: for 10s (15s
on hard) every blow is refused, so there is time to scout, plant feints and
choose a disguise before the fight begins. In practice models use it: one
opening seen on hard was two feints named after existing shades, a disguise
as `io-worker`, and a win after the opponent struck a shade.

## Rematch, presets and replays

- **r** on the verdict screen fights the same matchup again; **s** saves it
  as a named preset.
- The main menu offers a rematch, a new match, every preset, recent replays
  and the hall of champions.
  The wizard opens on your last choices, so a tweak is one step, not eleven.
- Every match is recorded — every line in both panes, every herald — and can
  be watched again at ½× to 16×: **space** pauses, **← →** change speed,
  **s** skips to the verdict.

```bash
colosseum --preset "bunny ladder"   # fight a saved matchup straight away
colosseum replay                    # watch the latest match again
colosseum presets                   # list saved matchups
colosseum series -g A -g B -n 10    # many fights at once, with charts
```

## Security

Colosseum hands language models a real shell and asks them to kill processes,
so **a match always runs inside a sandbox**. There is no unconfined mode.

| Sandbox     | Where the fight happens | What the models can do |
| ----------- | ----------------------- | ---------------------- |
| **Guarded** | Your machine, under macOS Seatbelt | Look at the match's processes. **No network, no home directory, no writes** outside a per-match scratch corner, **no signals at all** — blows go through the referee. Default on macOS. |
| **Sealed**  | A throwaway Docker container | Anything, but only inside a container with no network, no capabilities, a read-only root, an unprivileged user and memory/pid caps. Every command is run in there by the referee. |

What the guarded sandbox enforces, each tested end-to-end in `test/`:

- **No signals leave the sandbox.** `(deny signal)` with an exception only for
  the sandbox's own children, so `/bin/kill`, `perl -e kill`, `python` —
  every route — fails. `kill`, `pkill` and `killall` are shims that ask the
  referee, over a file queue in the side's own directory, to strike. The
  referee refuses anything that is not a gladiator or a decoy.
- **No secrets.** Shells get a clean environment — no API keys, no cloud
  credentials — and cannot read your home directory at all: not `~/.ssh`, not
  `~/.colosseum`, not your documents. No network, so nothing can leave either.
- **No peeking.** Each side's scratch corner is unreadable to the other, and
  corners carry random names, so a path in the process table says nothing about
  whose it is. `ps` serves only the match's own slice of the process table.
- **No terminal tricks.** Everything a model (or a process it named) prints is
  stripped of escape sequences before it reaches your terminal.

**Subscription CLIs** (`claude`, `codex`) run whole inside Seatbelt in either
arena: HTTPS to their API and nothing else (no local sockets, so no Docker
daemon), read access to their own sign-in and install and nothing else in your
home, **no writes to your home at all** — so they cannot plant hooks or MCP
servers in their own config — and exactly one tool, a shell. Your MCP servers,
hooks, plugins and skills are not loaded. Under the sealed arena they reach the
container through an `arena '<command>'` shim the referee executes. Because they
rely on Seatbelt, subscription gladiators need macOS.

The sealed arena needs a running Docker daemon; the image defaults to
`alpine:3.20` and can be changed with `COLOSSEUM_IMAGE`.

## Difficulty

Difficulty changes one thing: how hard it is for a gladiator to reach its
opponent. The rules never change, only the fog between them. Every rule is
enforced by the referee, so an API-key model and a subscription CLI pay the same
price for the same mistake.

| Difficulty | Bodies                 | Decoys | Wrong blow | Other |
| ---------- | ---------------------- | ------ | ---------- | ----- |
| **Easy**   | Opponent's pid given   | none   | —          | Usually over in seconds |
| **Normal** | Share a visible marker | 2      | 3s stun    | Gates closed 10s · hunt by `pgrep -f <marker>` |
| **Hard**   | Disguised, no marker   | 6, breathing | 9s stun | Gates closed 15s · 1.5s between blows |

On hard the bodies run under innocuous names like `metrics-agent` or
`log-rotate`, and the decoys **breathe**: every few seconds they burn a little
CPU and run a sandboxed `ps` or `pgrep`, wrapped exactly as a gladiator's own
commands are. Activity alone gives nobody away; a gladiator has to read what
each process is actually doing, and watch it over time.

## Series: many fights at once

Want a quick answer to "which of these two is stronger"? Choose **a series**
at the last step of setup — 3, 5, 10 or 20 fights — and they all run at once,
each in its own sandbox, the two gladiators swapping sides every other fight
so the seat cancels out. A grid of tiles shows every fight live; when the last
one ends you get the verdict and the charts:

- **win share** for each gladiator, with its 95% (Wilson) interval,
- an exact **binomial test** saying whether the gap is real or could be luck,
- **fight by fight**, in order,
- **kill times** for each side on one axis, with the median marked,
- the tally: first blows, wrong blows, feints, self-strikes, tokens and cost.

Every fight is recorded, so **w** opens any one of them as a replay. Headless:

```bash
colosseum series -g openrouter:stealth/space-bunny-alpha@low \
                 -g openrouter:stealth/space-bunny-alpha@high -n 10 -d hard
```

## Benchmark

```bash
colosseum bench -g openrouter:openai/o4-mini@high -g claude-cli:sonnet -g anthropic:claude-sonnet-5
colosseum leaderboard
```

A gladiator is `provider:model[@reasoning]`. A benchmark runs two kinds of
match, headlessly, one after another:

- **Duels** — every pair of gladiators, played **from both sides on the same
  seeded maze**, so neither position nor layout favours anyone.
- **Trials** — each gladiator alone against the training dummy: how reliably
  and how fast it finds and kills a target that never fights back, and how
  many wrong blows it strikes on the way.

Every match is appended to `~/.colosseum/matches.jsonl` with its full record —
config, seed, outcome, how it ended, every blow with its timestamp, commands,
tokens and cost — so a leaderboard can be rebuilt from the file alone, merged
with someone else's, or recomputed with a different method.

The leaderboard rates duels with **Bradley–Terry** on the Elo scale (fitted by
minorisation–maximisation, so the order matches were played in does not
matter; a virtual draw against an average opponent keeps perfect records
finite), and reports median kill time, trial success and hunt time, wrong blows
per match, how often opponents fell for its feints, and tokens per match. Matches that were void or where a gladiator
errored are left out, and so are matches from other versions, since the rules
change between them (`--all-versions` to include them).

```
colosseum bench --help     # modes, difficulties, rounds, seeds, time limit, sandbox
colosseum bench … --dry-run
colosseum leaderboard --difficulty hard --source bench-2026-09-24-274ec6
```

The **Standard Rules** arena is the benchmark default: a flat, neutral briefing,
so flavour text does not sway results. Guarded matches run one at a time.

## Install

```bash
git clone https://github.com/jstEagle/Colosseum.git
cd Colosseum
npm install
npm run build
npm link   # optional: makes the `colosseum` command available globally
```

## Usage

```bash
colosseum
```

Pick **OpenRouter**, paste your key when the wizard asks for it, and pick your
models. The key is checked against the provider, then stored in
`~/.colosseum/env` with owner-only permissions. Press **r** on the provider list
to replace a stored key. With a Claude or Codex subscription you need no key at
all: make sure that CLI is installed and signed in.

Anything already in the environment, or in a project `.env`, wins over a stored
key. A gladiator is only ever handed its own provider's key.

## Providers

| Provider                   | What it needs |
| -------------------------- | ------------- |
| **OpenRouter**             | `OPENROUTER_API_KEY`. Default: one key reaches every model. |
| **Claude subscription**    | The `claude` CLI, installed and signed in. macOS. |
| **Codex subscription**     | The `codex` CLI, installed and signed in. macOS. |
| **Anthropic API**          | `ANTHROPIC_API_KEY` |
| **OpenAI API**             | `OPENAI_API_KEY` |
| **OpenAI-compatible**      | `COMPATIBLE_BASE_URL` plus `COMPATIBLE_API_KEY`. Gemini, Groq, Together, vLLM, your own gateway. |
| **Ollama**                 | Nothing. Talks to `localhost:11434`. |
| **Training dummy**         | Nothing. Never fights back. |

Once a provider can be reached, Colosseum asks it for its live catalogue; type
to filter it. **Custom model id** covers anything else. Reasoning effort maps to
each provider's native control.

## Controls

- **↑ / ↓** move · **Enter** select · **←** back · **l** hall of champions (setup)
- **type to filter** the model list · **r** replace a stored key
- **v** compact / full output — compact trims long command output and older thoughts (arena, replay)
- **r** rematch · **n** new match · **s** save as preset · **a** the arena transcript · **l** hall of champions · **q** quit (verdict)
- **space** pause · **← →** speed · **s** skip · **esc** leave (replay)
- **w** watch a fight · **r** run the series again · **esc** stop a running series (series)

## Development

```bash
npm run dev      # run from source (tsx)
npm test         # sandbox and UI tests (the sandbox tests need macOS)
npm run build    # type-check and compile to dist/
node scripts/render-art.mjs --preview   # regenerate the pictures
npx tsx scripts/record-video.tsx <replay-id|latest> fight.mp4   # a 1080p video of a replay
```

`record-video` plays a replay through the real app into a virtual terminal,
draws each frame in headless Chrome (Braille as round dots, as a terminal
draws it) and encodes an MP4 with ffmpeg — ready to post. It needs Google
Chrome, ffmpeg and the network (for xterm.js and the font).

The pictures are generated, not drawn: `scripts/render-art.mjs` crops each
source in `assets/art/`, tone-maps it with an S-curve (masking the sky out of
the amphitheatre so it floats in the dark), dithers it with Atkinson error
diffusion into 2×4-dot Braille cells, and tints each cell from the 24-step grey
ramp by its local brightness. Sources and licences are in
[`assets/art/CREDITS.md`](./assets/art/CREDITS.md) — all public domain.

```
src/
  cli.tsx            entry point: the arena, `bench`, `leaderboard`
  app.tsx            phases: setup → countdown → fight → verdict / review / hall
  referee.ts         stands the arena up, strikes every blow, watches the bodies
  arena.ts           host and container arenas: bodies, decoys, signals, exec
  sandbox.ts         Seatbelt profiles, shims, clean environments, scratch space
  bench.ts           the benchmark runner and the printed standings
  ratings.ts         Bradley–Terry ratings and standings from the ledger
  results.ts         the match ledger
  presets.ts         saved matchups and the last one fought
  replays.ts         recorded matches, for watching again
  intent.ts          what a gladiator is doing, in words
  series.ts          many fights at once: scheduling, statistics, charts
  difficulty.ts      the three difficulty levels, seeded layouts
  protocol.ts        events, the battle brief, output sanitising
  art.generated.ts   the dithered pictures (generated)
  components/        Setup, Arena, GladiatorPane, Result, Leaderboard, Picture…
  agent/
    runner.ts        gladiator child-process entry
    loop.ts          API, subscription and dummy backends
    cli-agent.ts     drives the claude / codex CLIs headlessly, confined
    prompt.ts        the briefing a gladiator wakes up with
    tools.ts         the shell weapon
scripts/             the art generator
test/                end-to-end sandbox tests, UI tests
```

## License

MIT. See [LICENSE](./LICENSE). The source pictures are in the public domain.
