# dsh-codex-hooks

Codex-compatible lifecycle hooks for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

It reads the same `hooks.json` format Codex uses, shows every discovered hook in a **Hooks** section of dsh settings, and runs the ones you trust on the matching dsh lifecycle event.

中文文档：[README.zh.md](README.zh.md)

## What it actually does

- **Discovers** `hooks.json` from three places, grouped in the UI:
  - **From Config** — `$DSH_HOME/hooks.json` (default `~/.dsh/hooks.json`) and `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`).
  - **From Plugins** — every package inside the active profile that ships a `hooks.json`.
  - **From Projects** — `<workspace>/.dsh/hooks.json` for the workspaces this session has touched (up to 32 remembered).
- **Fingerprints** each hook exactly like Codex: normalized JSON of the hook definition, `sha256:` over its UTF-8 bytes. The fingerprint is what the trust decision is pinned to, so editing a hook's command invalidates its trust instead of silently running new code.
- **Reviews trust per hook** in the settings page: new hooks start in *needs review*; you approve the current fingerprint, and the state lives in `$DSH_HOME/hooks.state.json` together with an independent enabled/disabled switch per hook.
- **Runs** `command` and `mcp_tool` handlers only when they are enabled *and* trusted, with the hook's own timeout, `cwd`, environment and `command`/`commandWindows` split.
- **Injects context**: for `PreToolUse`, `PostToolUse`, `SessionStart`, `UserPromptSubmit` and `SubagentStart`, a handler's `additionalContext` is appended to the model input (2500 characters by default).
- **Matches** the events that have a matcher (`PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`), using the same wildcard and regex forms as Codex.

### Events

The 14 Codex events are mapped onto dsh's own runtime events:

| Codex event | dsh event | can block |
| --- | --- | --- |
| `PreModelRequest` | `agent/request` | no |
| `PreToolUse` | `tools/pre-execute` | yes |
| `PostToolUse` | `tools/post-execute` | yes |
| `PermissionRequest` | `approval/request` | yes |
| `UserPromptSubmit` | `agent/pre-step` | yes |
| `SessionStart` | `agent/created` | no |
| `SubagentStart` | `agent/created` | no |
| `Stop` | `agent/turn-stopping` | no |
| `SubagentStop` | `agent/turn-stopping` | no |
| `SessionEnd` | `session/disposed` | no |
| `PostModelRequest`, `PreCompact`, `PostCompact`, `Interrupt` | — parsed and reviewable, not dispatched yet | — |

Default timeout is 600s, except `SessionEnd` (1s default, 3s maximum) so shutdown cannot hang.

## Review, run history and `/hooks`

- **Hook button in the composer** — a hook icon sits in the composer's tool row (next to the permission and agent controls). Its badge counts the hooks that still need review; clicking it opens the **Review hooks** dialog, laid out like Codex's: one row per hook with a checkbox, the hook name, a *New* badge and a chevron that expands *Source / Hook type / Command / Timeout*, then the hint "You can change this later in settings" — *settings* opens the hooks browser — and the three choices *Not now / Allow all / Allow selected*. Approving pins the current fingerprints in `$DSH_HOME/hooks.state.json`; anything else is edited later in **Settings → Hooks**, where trust is granted one hook at a time.
- **`/hooks` opens the hooks browser** — typing `/hooks` in the composer opens the two level view, exactly like Codex: the first page lists the hook events with `active/installed` and a `!` marker on the events that need review, the second page lists the handlers of one event with their trust state, an on/off switch and a *Trust* / *Revoke* button. It is a normal dsh slash command (registered when the host composes the `commands` service), so it never reaches the model.
- **Hook stats in the message action row** — the assistant message action row carries a hook icon; clicking it opens a **Hook stats** dialog with `Runs / Blocked / Failed` for the last 200 executions and a *Run history* list (`Completed  UserPromptSubmit  User`). Hook output is *not* printed into the conversation; the model only ever sees a handler's `additionalContext`. The run log lives in memory for the session, like Codex's, and is not written to disk.
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

`~/.dsh/hooks.json` (same shape as Codex):

```json
{
  "description": "my hooks",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ./examples/echo-hook.mjs SessionStart",
            "commandWindows": "node.exe ./examples/echo-hook.mjs SessionStart",
            "timeout": 15,
            "statusMessage": "echo-hook: session started"
          }
        ]
      }
    ]
  }
}
```

Handler types: `command`, `mcp_tool` (both executable), `prompt`, `agent` (parsed and reviewable, not dispatched yet).

## Verification status

- `node test/run-tests.mjs` → **96 passed, 0 failed, 0 skipped**, including 8 fingerprints captured from a real Codex installation (`test/vectors.json`).
- `UserPromptSubmit` runs in a live dsh session: the example hook prints one `echo-hook received event=…` line per submitted prompt.
- `selftest/host-e2e.mjs` exercises the host side against a real profile.

## Security

Hooks execute real commands with the permissions of the dsh process. That is why trust is pinned to the sha256 fingerprint of each hook: approving a hook approves exactly that command line, and any edit requires a new approval. Only enable hooks you have read.

## License

MIT
