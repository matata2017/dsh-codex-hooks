# dsh-codex-hooks

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）用的生命周期钩子，管理方式照 Codex 那套来。

dsh 自己没有钩子配置：它只暴露拦截 seam。这个插件把一份很小的 `hooks.json` 变成可审查、可批准、可单独关掉、能看到运行情况的钩子。

English: [README.md](README.md)

## 它到底做了什么

- **发现**三个来源的 `hooks.json`，界面上分组显示：
  - **来自配置** —— `$DSH_HOME/hooks.json`（默认 `~/.dsh/hooks.json`）。
  - **来自插件** —— 当前 profile 里自带 `hooks.json` 的每个包。
  - **来自项目配置文件** —— 本会话碰过的 workspace 里的 `<workspace>/.dsh/hooks.json`（最多记 32 个）。
- **指纹**：把钩子定义规范化成 JSON，再对它 UTF-8 字节做 `sha256:`。信任就钉在这个指纹上，所以改掉一条钩子的命令，它的信任会自动失效，不会悄悄跑新代码。
- **逐个审查信任**：新钩子处于*待审核*；你在设置页批准当前指纹，状态存在 `$DSH_HOME/hooks.state.json`，同时每条钩子有独立的启用开关。
- **执行**：只有既启用又可信的 `command`、`mcp_tool` 处理器才会跑，带自己的超时、`cwd`、环境变量，以及 `command`/`commandWindows` 平台拆分。
- **注入上下文**：处理器返回的 `additionalContext` 会追加到模型输入，适用于 `agent/pre-step`、`tools/pre-execute`、`tools/post-execute`、`agent/created`（默认上限 2500 字符）。
- **匹配**：工具类 seam（`tools/pre-execute`、`tools/post-execute`、`approval/request`）支持 matcher：`*`、精确名、`A|B` 多选或正则。

### 事件

| 事件 | 何时触发 | 可拦截 |
| --- | --- | --- |
| `agent/pre-step` | 用户提交提示、步骤开始之前 | 可以 |
| `agent/request` | 模型请求发出之前 | 不可以 |
| `tools/pre-execute` | 工具调用执行之前 | 可以 |
| `tools/post-execute` | 工具调用结束之后 | 可以 |
| `approval/request` | 工具调用向用户申请权限之前 | 可以 |
| `agent/created` | 会话开始 | 不可以 |
| `agent/turn-stopping` | 本轮响应结束之前 | 不可以 |
| `session/disposed` | 会话销毁 | 不可以 |

默认超时 600 秒；`session/disposed` 例外（默认 1 秒，最多 3 秒），免得退出时卡住。

## 审查、运行记录与 `/hooks`

- **输入框工具栏的钩子图标** —— 输入框工具栏（权限/专家控件旁边）有一个钩子图标，待审核时右上角只有一个红点、不带数字（数字一被别处信任就会过期）；点它打开**审查钩子**弹窗：每条钩子一行，带复选框、名称、*新建*徽标和 chevron，展开是*来源 / Hook 类型 / 命令 / 超时*；底部提示「你可以稍后在设置中更改此选项」，其中*设置*会真的跳到**设置 → 钩子**（先点开设置按钮，再点「钩子」导航项；两步都对不上才回退到插件自己的钩子面板）；三个按钮是*以后再说 / 全部允许 / 允许所选项*。点工具图标就打开，不自动弹。批准即把当前指纹钉进 `$DSH_HOME/hooks.state.json`；其余情况到 **设置 → Hooks** 里逐个处理。
- **`/hooks` 打开钩子浏览器** —— 第一页按事件列出 `生效/已安装` 计数，待审核的事件行尾带 `!`；第二页列出该事件的处理器，带信任状态、启用开关和*信任*/*撤销*按钮。它是标准的 dsh 斜杠命令（宿主组合了 `commands` 服务时注册），不会发给模型。
- **消息操作行的钩子图标 → 钩子统计弹窗** —— 助手消息的操作行有一个钩子图标，点开是统计弹窗：最近 200 次执行的 `运行 / 拦截 / 失败` 计数，以及*运行历史*列表（形如 `Completed  agent/pre-step  User`）。钩子输出**不会**打印进对话，模型只会看到处理器的 `additionalContext`。运行记录只放在内存里，不落盘。
- **浮层**：所有面板都用 portal 渲到 `document.body` 上并固定定位，不会被输入框或消息列裁掉。

## 安装

需要 dsh `0.1.0-rc.6` 或更新版本，Node 20+。

```bash
# 从 GitHub
dsh plugin --profile desktop add github:matata2017/dsh-codex-hooks

# 或者本地开发目录，本项目就是这么用的
dsh plugin --profile desktop add /path/to/dsh-codex-hooks
```

装完重启 dsh 的 web/desktop 宿主，然后打开 **设置 → Hooks**。

## 配置

`~/.dsh/hooks.json`：

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

一条钩子一个对象：`command`（或 `type: "mcp_tool"` 加 `server` + `tool`），可选 `matcher`、`timeout`、`statusMessage`、`additionalContextLimit`、`async`。

处理器类型：`command`、`mcp_tool`（可执行）；`prompt`、`agent`（可解析、可审查，暂不执行）。

## 验证状态

- `node test/run-tests.mjs` → **86 passed, 0 failed, 0 skipped**。
- `node selftest/host-e2e.mjs` → 对着真实 profile 跑 **14 passed, 0 failed**。
- `agent/pre-step` 在真实 dsh 会话里跑通：每提交一次提示，示例钩子打印一行 `echo-hook received event=…`。

## 安全

钩子以 dsh 进程的权限执行真实命令。所以信任钉在每条钩子的 sha256 指纹上：批准一条钩子＝批准这一行具体的命令，任何改动都要重新批准。只启用你读过的钩子。

## License

MIT
