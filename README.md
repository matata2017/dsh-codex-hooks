# dsh-codex-hooks

Lifecycle hooks for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), managed the way Codex manages its hooks.

dsh has no hook config of its own: it exposes interception seams, and this plugin turns a small `hooks.json` into hooks you can review, approve, switch off and watch.

中文文档：[README.zh.md](README.zh.md)

## What it actually does

- **Discovers** `hooks.json` from three places, grouped in the UI:
  - **From Config** — `$DSH_HOME/hooks.json` (default `~/.dsh/hooks.json`).
  - **From Plugins** — every package inside the active profile that ships a `hooks.json`.
  - **From Projects** — `<workspace>/.dsh/hooks.json` for the workspaces this session has touched (up to 32 remembered).
- **Fingerprints** each hook: normalized JSON of the hook definition, `sha256:` over its UTF-8 bytes. The fingerprint is what the trust decision is pinned to, so editing a hook's command invalidates its trust instead of silently running new code.
- **Reviews trust per hook** in the settings page: new hooks start in *needs review*; you approve the current fingerprint, and the state lives in `$DSH_HOME/hooks.state.json` together with an independent enabled/disabled switch per hook.
- **Runs** `command` and `mcp_tool` handlers only when they are enabled *and* trusted, with the hook's own timeout, `cwd`, environment and `command`/`commandWindows` split.
- **Injects context**: a handler's `additionalContext` is appended to the model input on `agent/pre-step`, `tools/pre-execute`, `tools/post-execute` and `agent/created` (2500 characters by default).
- **Matches** the tool seams (`tools/pre-execute`, `tools/post-execute`, `approval/request`) with `*`, exact names, `Name|Other` or a regular expression.

### Events

| Event | Fires | Can block |
| --- | --- | --- |
| `agent/pre-step` | a prompt was submitted, before the step runs | yes |
| `agent/request` | before the model request is sent | no |
| `tools/pre-execute` | before a tool call runs | yes |
| `tools/post-execute` | after a tool call finished | yes |
| `approval/request` | before a tool call asks for permission | yes |
| `agent/created` | a session starts | no |
| `agent/turn-stopping` | right before the turn ends | no |
| `session/disposed` | the session is disposed | no |

Default timeout is 600s, except `session/disposed` (1s default, 3s maximum) so shutdown cannot hang.

## Review, run history and `/hooks`

- **Hook button in the composer** — a hook icon sits in the composer's tool row (next to the permission and agent controls), with no badge; clicking it opens the hooks browser. A **Review hooks** dialog opens by itself on the first mount of a session that has hooks needing review: one row per hook with a checkbox, the hook name, a *New* badge and a chevron that expands *Source / Hook type / Command / Timeout*, then the hint "You can change this later in settings" — *settings* opens the same hooks browser (dsh exposes no API for a plugin to jump to a settings section) — and the three choices *Not now / Allow all / Allow selected*. Approving pins the current fingerprints in `$DSH_HOME/hooks.state.json`; everything else is handled later in **Settings → Hooks**, one hook at a time.
- **`/hooks` opens the hooks browser** — the first page lists the events with `active/installed` and a `!` marker on the events that need review, the second page lists the handlers of one event with their trust state, an on/off switch and a *Trust* / *Revoke* button. It is a normal dsh slash command (registered when the host composes the `commands` service), so it never reaches the model.
- **Hook stats in the message action row** — the assistant message action row carries a hook icon; clicking it opens a **Hook stats** dialog with `Runs / Blocked / Failed` for the last 200 executions and a *Run history* list (`Completed  agent/pre-step  User`). Hook output is *not* printed into the conversation; the model only ever sees a handler's `additionalContext`. The run log lives in memory for the session and is not written to disk.
- **Floating panels** — every panel is rendered through a portal on `document.body` with a fixed position, so it is never clipped by the composer or the message column.

## Install

Requires dsh `0.1.0-rc.6` or newer and Node 20+.

```bash
# from GitHub
dsh plugin --profile desktop add github:matata2017/dsh-codex-hooks

# or from a local checkout, which is how this project is developed
dsh plugin --profile desktop add /path/to/dsh-codex-hooks
```

Restart the dsh web/desktop host afterwards, then open **Settings → Hooks**.

## Configure

`~/.dsh/hooks.json`:

```json
{
  "version": 1,
  "description": "my hooks",
  "hooks": {
    "agent/created": [
      {
        "command": "node ./examples/echo-hook.mjs agent/created",
        "commandWindows": "node.exe ./examples/echo-hook.mjs agent/created",
        "timeout": 15,
        "statusMessage": "echo-hook: session started"
      }
    ],
    "tools/pre-execute": [
      {
        "matcher": "Bash",
        "command": "node ./examples/echo-hook.mjs"
      }
    ]
  }
}
```

One object per hook: `command` (or `type: "mcp_tool"` with `server` + `tool`), optional `matcher`, `timeout`, `statusMessage`, `additionalContextLimit`, `async`.

Handler types: `command`, `mcp_tool` (both executable), `prompt`, `agent` (parsed and reviewable, not dispatched yet).

## Verification status

- `node test/run-tests.mjs` → **83 passed, 0 failed, 0 skipped**.
- `node selftest/host-e2e.mjs` → **14 passed, 0 failed** against a real profile.
- `agent/pre-step` runs in a live dsh session: the example hook prints one `echo-hook received event=…` line per submitted prompt.

## Security

Hooks execute real commands with the permissions of the dsh process. That is why trust is pinned to the sha256 fingerprint of each hook: approving a hook approves exactly that command line, and any edit requires a new approval. Only enable hooks you have read.

## License

MIT
