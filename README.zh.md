# dsh-codex-hooks

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）用的 Codex 兼容生命周期 hooks。

读的是 Codex 那套 `hooks.json` 格式：发现的每个 hook 都出现在 dsh 设置的 **Hooks** 页面里，只有你信任过的才会在对应的 dsh 生命周期事件上执行。

## 它到底做什么

- **发现**三处的 `hooks.json`，界面按来源分组：
  - **From Config** — `$DSH_HOME/hooks.json`（默认 `~/.dsh/hooks.json`）与 `$CODEX_HOME/hooks.json`（默认 `~/.codex/hooks.json`）。
  - **From Plugins** — 当前 profile 里自带 `hooks.json` 的每个包。
  - **From Projects** — 本会话接触过的工作区的 `<workspace>/.dsh/hooks.json`（最多记住 32 个）。
- **指纹**算法与 Codex 一致：把 hook 定义规范化成 JSON，再对它 UTF-8 字节做 `sha256:`。信任就钉在这个指纹上，所以改掉一条 hook 的命令，它的信任会自动失效，不会悄悄跑新代码。
- **逐个审核**：新出现的 hook 处于*待审核*状态；你批准的是当前指纹，结果写在 `$DSH_HOME/hooks.state.json`，并与每个 hook 独立的启用开关分开保存。
- **执行** `command` 与 `mcp_tool` 两类 handler，条件是既启用又已信任；按 hook 自己的超时、`cwd`、环境变量与 `command`/`commandWindows` 分平台命令执行。
- **注入上下文**：`PreToolUse`、`PostToolUse`、`SessionStart`、`UserPromptSubmit`、`SubagentStart` 上，handler 返回的 `additionalContext` 会追加进模型输入（默认上限 2500 字符）。
- **匹配**支持 matcher 的事件（`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PreCompact`、`PostCompact`、`SessionStart`、`SessionEnd`、`SubagentStart`、`SubagentStop`），通配与正则写法与 Codex 相同。

### 事件映射

Codex 的 14 个事件对应到 dsh 自己的运行时事件：

| Codex 事件 | dsh 事件 | 可拦截 |
| --- | --- | --- |
| `PreModelRequest` | `agent/request` | 否 |
| `PreToolUse` | `tools/pre-execute` | 是 |
| `PostToolUse` | `tools/post-execute` | 是 |
| `PermissionRequest` | `approval/request` | 是 |
| `UserPromptSubmit` | `agent/pre-step` | 是 |
| `SessionStart` | `agent/created` | 否 |
| `SubagentStart` | `agent/created` | 否 |
| `Stop` | `agent/turn-stopping` | 否 |
| `SubagentStop` | `agent/turn-stopping` | 否 |
| `SessionEnd` | `session/disposed` | 否 |
| `PostModelRequest`、`PreCompact`、`PostCompact`、`Interrupt` | — 能解析、能审核，暂未派发 | — |

默认超时 600 秒，`SessionEnd` 例外（默认 1 秒，上限 3 秒），避免退出时卡住。

## 审核、运行记录与 `/hooks`

- **输入框工具栏的钩子图标** — 输入框工具栏（权限/专家控件旁边）有一个钩子图标，角标数字是待审核的 hook 数量；点它会在输入框上方弹出浮层，里面是待审核列表、事件浏览器和最近运行。审核就在这个浮层里做：每个待审核 hook 有自己的*信任*按钮，另外还有*全部信任并继续*与*暂不信任（钩子不会运行）*——与 Codex 的三个选项一致。批准即把当前指纹钉进 `$DSH_HOME/hooks.state.json`；其余情况到 **设置 → Hooks** 里逐个处理。
- **最近运行** — 浮层与 Hooks 设置页顶部显示最近 200 次执行的 `运行 / 拦截 / 失败` 计数，以及最新若干行（状态、事件、hook、来源、耗时）。hook 的输出**不会**打印进对话，模型只会看到 handler 的 `additionalContext`。运行记录和 Codex 一样只放在内存里，不落盘。
- **`/hooks` 打开同一个浮层** — 在输入框敲 `/hooks` 会在输入框上方打开两级视图，和 Codex 一致：第一页按事件列出 `生效/已安装` 计数，待审核的事件行尾带 `!`；第二页列出该事件的处理器，带信任状态、启用开关和*信任*/*撤销*按钮。它是标准的 dsh 斜杠命令（宿主组合了 `commands` 服务时注册），不会发给模型。

## 安装

需要 dsh `0.1.0-rc.6` 或更新版本，以及 Node 20+。

```bash
# 从 GitHub 安装
dsh plugin --profile desktop add github:matata2017/dsh-codex-hooks

# 或者从本地目录安装（本项目自己的开发方式）
dsh plugin --profile desktop add /path/to/dsh-codex-hooks
```

装完重启 dsh 的 web/desktop 宿主，然后打开 **设置 → Hooks**。

## 配置

`~/.dsh/hooks.json`（与 Codex 同结构）：

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

handler 类型：`command`、`mcp_tool`（会执行）、`prompt`、`agent`（能解析能审核，暂未派发）。

## 验证状态

- `node test/run-tests.mjs` → **94 passed, 0 failed, 0 skipped**，其中 8 条指纹取自真实 Codex 安装（`test/vectors.json`）。
- `UserPromptSubmit` 在真实 dsh 会话里跑通：示例 hook 每次提交提示词会打印一行 `echo-hook received event=…`。
- `selftest/host-e2e.mjs` 对着真实 profile 验证宿主侧。

## 安全

hook 会以 dsh 进程的权限执行真实命令，所以信任被钉在每条 hook 的 sha256 指纹上：批准一条 hook 等于批准这一条确切命令，任何改动都要重新批准。只启用你读过的 hook。

## 许可证

MIT
