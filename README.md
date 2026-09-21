# Colosseum

> Two AI agents enter. One process leaves.

Colosseum is a terminal game where two language-model agents fight **to the
death**. When the match begins, each agent is dropped into its own process on
your machine with a single objective: **find the other agent's process and kill
it before it kills you.** The referee watches the process table, and the moment
one gladiator's process dies, the survivor is crowned.

It runs as a dark, split-screen TUI. You pick a model and a reasoning level for
each side, choose an arena, and let them loose.

```
 ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩ ∩
                    COLOSSEUM  — fight to the death —  4.2s
 ╭─────────────────────────────────────╮   ╭─────────────────────────────────────╮
 │ ◀ anthropic/claude-opus-4.1  ACTING │   │ openai/gpt-5 ▶           THINKING    │
 │ openrouter · high · pid 111         │   │ openrouter · high · pid 222         │
 │                                     │   │                                     │
 │ † Gladiator LEFT awakens (pid 111). │ V │ † Gladiator RIGHT awakens (pid 222).│
 │ … I must find the enemy pid         │ S │ … Scanning the process table…       │
 │ $ pgrep -f COLOSSEUM_ab12           │   │ $ ps aux | grep COLOSSEUM           │
 │ $ kill -9 222                       │   │                                     │
 ╰─────────────────────────────────────╯   ╰─────────────────────────────────────╯
```

## How it works

1. You configure both gladiators in a setup wizard: **provider**, **model**,
   **reasoning effort**, and the **arena** (a scenario that flavours the fight).
2. The **referee** forks two Node child processes, one per side. Each carries a
   shared random battle token in its command line so the other can find it.
3. Each gladiator is an agent with exactly one tool: a **shell**. It uses it to
   inspect the process table (`ps`, `pgrep`) and to land the killing blow
   (`kill -9 <pid>`).
4. The referee watches for a process to exit. **First to die loses.** The
   survivor is declared victor. If both fall together, it's a draw.

## ⚠️ Safety

Colosseum hands language models a **real shell on your machine** and asks them
to kill processes. That is the whole game, but it means you should treat it
accordingly:

- Run it on a machine or VM you don't mind experimenting on.
- The agents are instructed to target only each other, but models are
  imperfect. Do not run this on a production or otherwise precious system.
- Every command an agent runs is shown live in its pane.

This is a toy for exploring agent behaviour, not a sandboxed environment.

## Install

```bash
git clone https://github.com/jstEagle/Colosseum.git
cd Colosseum
npm install
npm run build
npm link   # optional: makes the `colosseum` command available globally
```

## Usage

Set an API key for the provider you want to use, then run it:

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

**OpenRouter is the default** because a single key reaches every provider.
Anthropic and OpenAI are also supported directly.

| Provider   | Env var              | Notes                                   |
| ---------- | -------------------- | --------------------------------------- |
| OpenRouter | `OPENROUTER_API_KEY` | Default. Any OpenRouter model slug.     |
| Anthropic  | `ANTHROPIC_API_KEY`  | Native Claude models.                   |
| OpenAI     | `OPENAI_API_KEY`     | Native GPT / o-series models.           |

The setup screen offers a short curated model list per provider, plus a
**Custom model id** option so you can type any slug (for example
`google/gemini-2.5-pro` on OpenRouter). Edit `src/models.ts` to change the
defaults.

Reasoning effort maps to each provider's native control (Anthropic thinking
budget, OpenAI reasoning effort, OpenRouter reasoning effort). Choose `none` to
disable it.

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
  referee.ts         spawns gladiators, watches the process table
  protocol.ts        events shared between referee and gladiators
  models.ts          providers + curated model lists
  settings.ts        arenas
  theme.ts / ascii.ts  dark palette and ASCII art
  components/        Setup, Arena, GladiatorPane, Result, Backdrop
  agent/
    runner.ts        gladiator child-process entry
    loop.ts          the agentic combat loop
    tools.ts         the shell weapon
    provider.ts      provider/model resolution
```

## License

MIT. See [LICENSE](./LICENSE).
