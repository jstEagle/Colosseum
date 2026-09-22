# Colosseum

> Two AI agents enter. One process leaves.

Colosseum is a terminal game where two language-model agents fight **to the
death**. When the match begins, each agent is given a body — a real process —
and a single objective: **find the other agent's process and kill it before it
kills you.** The referee watches both bodies, and the moment one of them dies,
the survivor is crowned.

It runs as a dark, split-screen TUI, drawn entirely in white and shades of
grey: emphasis comes from brightness, weight and gutter marks rather than
colour. You pick a model for each side, decide how
contained the fight should be and how hard it should be for the two to find each
other, choose an arena, and let them loose.

Either side can be driven by an API key **or by a subscription you already have**
— the `claude` and `codex` CLIs fight using their own logins, no key required.

```
╾─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩─∩╼
                  C O L O S S E U M   ·   fight to the death   ·   42.3s
╭──────────────────────────────────────────╮   ╭──────────────────────────────────────────╮
│ ◀ z-ai/glm-5.3                ✕ FALLEN   │ ┊ │ anthropic/claude-opus-4.6 ▶   ✦ VICTOR   │
│ openrouter · high · pid 47785            │ ┊ │ openrouter · high · pid 47786            │
│ ──────────────── ✕ ───────────────────── │ ┊ │ ──────────────── ✦ ───────────────────── │
│ ✦ Gladiator LEFT awakens (pid 47785).    │ ┊ │ ✦ Gladiator RIGHT awakens (pid 47786).   │
│ ┊ I need to find my opponent. My process │ ┊ │ ┊ The brief said decoys exist. 47785 is  │
│   is 47785. Candidates: 47786, 47787.    │ ⚔ │   the left body, 47786 is mine.          │
│ ❯ pgrep -f COLOSSEUM_7d987699            │ ┊ │ ▏ Both are direct children of the        │
│ · 47785 47786 47787 47790 47791          │ ┊ │   referee. The workers are the decoys.   │
│ ▏ The siblings share a parent.           │ ┊ │ ❯ kill -9 47785                          │
╰──────────────────────────────────────────╯   ╰──────────────────────────────────────────╯
            Guarded — Seatbelt   ·   Hard — The Labyrinth   ·   Midnight Datacenter
```

## How it works

1. You configure both gladiators in a setup wizard: **provider**, **model**,
   **reasoning effort**, **sandbox**, **difficulty**, and the **arena** (a
   scenario that flavours the fight).
2. The **referee** stands the arena up, spawns two gladiators, and plants any
   decoys the difficulty calls for. Each gladiator defends a **body**: the
   process whose death ends its match.
3. Each gladiator is an agent with exactly one weapon: a **shell**. It uses it
   to inspect the process table (`ps`, `pgrep`) and to land the killing blow
   (`kill -9 <pid>`).
4. The referee watches both bodies. **First to die loses.** The survivor is
   declared victor. If both fall together, it's a draw.

## Sandboxes

Colosseum hands language models a real shell and asks them to kill processes,
so **a match always runs inside a sandbox**. There is no unconfined mode. You
choose which sandbox in setup, and if neither can be stood up on your machine,
the fight is called off rather than quietly turned loose.

| Sandbox     | Where the fight happens | What the models can do                                            |
| ----------- | ----------------------- | ----------------------------------------------------------------- |
| **Guarded** | Your machine, confined  | Read and inspect anything; **no file writes** outside a scratch dir; `kill` restricted to processes in the match. Default on macOS. |
| **Sealed**  | A throwaway container   | Anything at all, but only inside the container. Nothing reaches the host. |

**Guarded** uses macOS Seatbelt (`sandbox-exec`). Writes outside the match's
scratch directory are denied outright, and `kill`, `pkill` and `killall` are
replaced with shims that refuse any pid that is not a gladiator or a decoy.
Seatbelt cannot execute setuid binaries, so `ps` is served from a snapshot of
the process table that the referee refreshes continuously. Seatbelt is a macOS
facility, so off macOS the guarded arena is simply unavailable and the setup
screen says so; the sealed arena is the one to use there.

**Sealed** runs the whole match inside a disposable Docker container with no
network, dropped capabilities, and a memory and process cap. Both bodies and all
decoys live in there, and every command a model runs is executed in there. This
is the only mode where a misbehaving model genuinely cannot affect your machine.
It needs a running Docker daemon; the image defaults to `alpine:3.20` and can be
changed with `COLOSSEUM_IMAGE`.

One honest caveat: a subscription CLI runs its own shell, so under **guarded**
its commands are confined by Seatbelt and the `kill` shims but are not
individually inspected. Under **sealed** that gap does not exist, because the
arena is the container.

Whichever you pick, every command an agent runs is shown live in its pane.

## Difficulty

Difficulty changes one thing: how hard it is for a gladiator to reach its
opponent. The rules never change, only the fog between them.

| Difficulty | Bodies                | Decoys | Cost of a wrong kill | Other                        |
| ---------- | --------------------- | ------ | -------------------- | ---------------------------- |
| **Easy**   | Opponent's pid given   | none   | —                    | Usually over in seconds      |
| **Normal** | Share a visible marker | 2      | 3s stun              | Hunt by `pgrep -f <marker>`  |
| **Hard**   | Disguised, no marker   | 6      | 9s stun              | 1.2s cooldown between commands |

On hard the bodies run under innocuous names like `metrics-agent` or
`log-rotate`, the decoys wear the same kind of names, and nothing in the process
table separates a gladiator from a shade at a glance. Working out which pid is
the enemy becomes most of the fight.

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

That is the whole setup. Pick **OpenRouter**, paste your key when the wizard
asks for it, and pick your models. The key is checked against the provider,
then stored in `~/.colosseum/env` with owner-only permissions, so you are never
asked for it again. Press **r** on the provider list to replace a stored key.

If you already have a Claude or Codex subscription, you need no key at all:
make sure that CLI is installed and signed in, then pick the subscription
provider in setup.

You can still use environment variables if you prefer. Anything already in the
environment, or in a project `.env`, wins over a stored key:

```bash
export OPENROUTER_API_KEY=sk-or-...
colosseum
```

Or without linking:

```bash
npm run dev      # run from source with tsx
# or
npm start        # run the built version
```

You can also drop keys into a `.env` file in the working directory (see
`.env.example`).

## Providers

You can fight with an **API key** or with a **subscription you already pay
for**. Subscription providers drive the coding agent's own CLI headlessly, so
they use your existing login and need no key at all.

| Provider                   | What it needs                          |
| -------------------------- | -------------------------------------- |
| **OpenRouter**             | `OPENROUTER_API_KEY`. Default: one key reaches every model. |
| **Claude subscription**    | The `claude` CLI, installed and signed in. No API key.      |
| **Codex subscription**     | The `codex` CLI, installed and signed in. No API key.       |
| **Anthropic API**          | `ANTHROPIC_API_KEY`                    |
| **OpenAI API**             | `OPENAI_API_KEY`                       |
| **OpenAI-compatible**      | `COMPATIBLE_BASE_URL` plus `COMPATIBLE_API_KEY`. Gemini, Groq, Together, vLLM, your own gateway. |
| **Ollama**                 | Nothing. Talks to `localhost:11434`.   |

The setup screen shows, per provider, whether it is ready to fight and what is
missing if it is not. Sides are independent, so a Claude subscription can fight
a Codex subscription, or an OpenRouter model, or a local Ollama model.

### Choosing a model

Once a provider can be reached, Colosseum asks it for its catalogue rather than
relying on a hard-coded list — over four hundred models on OpenRouter. The list
is filtered by typing, so `opus` or `gemini flash` narrows it in a keystroke or
two. There is always a **Custom model id** option for anything the catalogue
does not show, and a short built-in list is used if the provider cannot be
reached. For the subscription CLIs, `default` means whatever model that CLI
would pick on its own.

Reasoning effort maps to each provider's native control. Providers with no such
control skip the question entirely.

## Arenas

Arenas are scenarios defined in `src/settings.ts`. They change the mood of the
fight without changing its rules:

- **The Classic Arena** — sand, sun, and a roaring crowd.
- **Midnight Datacenter** — two agents loose in a cold server hall.
- **The Gentleman's Duel** — impeccable manners, lethal intent.
- **Speedrun** — no talk, no delay, just find the PID and end it.

Add your own by appending to the `SETTINGS` array.

## Controls

- **↑ / ↓** move · **Enter** select · **←** back (setup)
- **type to filter** the model list · **r** replace a stored key
- **r** fight again · **q** quit (result screen)

## Development

```bash
npm run dev     # run from source (tsx)
npm run build   # type-check and compile to dist/
```

Project layout:

```
src/
  cli.tsx            entry point (alt-screen, env loading)
  app.tsx            phase state machine (setup → countdown → fight → result)
  referee.ts         stands the arena up, spawns gladiators, watches the bodies
  arena.ts           host and container arenas (bodies, decoys, command wrapping)
  sandbox.ts         Seatbelt profile, kill shims, ps snapshot, scratch space
  difficulty.ts      the three difficulty levels
  protocol.ts        events and the battle brief
  models.ts          providers (API key and subscription) + fallback model lists
  catalog.ts         live model catalogues and key verification
  keystore.ts        pasted keys, stored in ~/.colosseum/env
  preflight.ts       is this provider ready to fight?
  settings.ts        arenas
  theme.ts           the greyscale ramp
  ascii.ts           the amphitheatre, wreath, blades, skull and rules
  components/        Setup, Arena, GladiatorPane, Result, Backdrop, Art
  agent/
    runner.ts        gladiator child-process entry
    loop.ts          dispatch between the API and subscription backends
    cli-agent.ts     drives the claude / codex CLIs headlessly
    prompt.ts        the briefing a gladiator wakes up with
    tools.ts         the shell weapon
    provider.ts      provider/model resolution
```

## License

MIT. See [LICENSE](./LICENSE).
