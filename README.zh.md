# dsh-codex-hooks

**把 CODEX 的钩子管理方式移植到 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）。**

CODEX 里每条钩子都有：一次审查、钉在指纹上的一次批准、设置页、`/hooks` 浏览器，还有运行统计。dsh 一样都没有——它只暴露拦截 seam，其余全空。这个插件把这一整套管理搬过来，于是 dsh 上的钩子也能按 CODEX 那套审查、批准、单独关掉、看运行情况。

配置文件是 dsh 自己的（`hooks.json` + dsh 事件名）——移植的是围绕钩子的那套行为，不是 CODEX 的文件格式。

English: [README.md](README.md)

## 截图

审查就发生在干活的地方：输入框工具栏一个钩子图标，有待审核时右上角一个红点：

![输入框工具栏的钩子图标，待审核时红点](docs/screenshots/composer-hook-button.png)

点开就是审查弹窗：一条钩子一行，带*新建*徽标，chevron 展开细节，底部*以后再说 / 全部允许 / 允许所选项*：

![审查钩子弹窗](docs/screenshots/review-dialog.png)

其余都在 **设置 → Hooks** 里管：按来源分组，每条带信任状态、启用开关、*信任*/*撤销*和一次性的*测试*：

![设置页里的钩子列表、信任状态与操作](docs/screenshots/settings-hooks.png)

截图取自本地运行的 dsh，钩子就是 `~/.dsh/hooks.json` 里那两条 `echo-hook` —— 和本仓库示例用的是同一份配置。

## 兼容性

| 插件版本 | 验证过的 dsh |
| --- | --- |
| 0.3.x | dsh `0.1.0-rc.6`（开发与自测宿主，web 与 desktop） |

更新的 dsh 版本没有验证过：插件读的是 dsh 的插槽、命令与远程方法契约，宿主改掉其中任何一个，插件在跟进之前就会坏。

## 它到底做了什么

- **发现**三个来源的 `hooks.json`，界面上分组显示：
  - **来自配置** —— `$DSH_HOME/hooks.json`（默认 `~/.dsh/hooks.json`）。
  - **来自插件** —— 当前 profile 里自带 `hooks.json` 的每个包。
  - **来自项目配置文件** —— 本会话碰过的 workspace 里的 `<workspace>/.dsh/hooks.json`（最多记 32 个）。
- **指纹**：把钩子定义规范化成 JSON，再对它 UTF-8 字节做 `sha256:`。信任就钉在这个指纹上，所以改掉一条钩子的命令，它的信任会自动失效，不会悄悄跑新代码。
- **逐个审查信任**：新钩子处于*待审核*；你在设置页批准当前指纹，状态存在 `$DSH_HOME/hooks.state.json`，同时每条钩子有独立的启用开关。
- **执行**：只有既启用又可信的 `command` 处理器才会跑，带自己的超时、`cwd`、环境变量，以及 `command`/`commandWindows` 平台拆分。`approval/request` 钩子可以返回 `{"decision":"allow"}` 直接放行待审批的工具调用，或返回 `deny`；任何一条钩子 deny 都压过 allow。
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

- **输入框工具栏的钩子图标** —— 输入框工具栏（权限/专家控件旁边）有一个钩子图标，待审核时右上角只有一个红点、不带数字（数字一被别处信任就会过期）；点它打开**审查钩子**弹窗：每条钩子一行，带复选框、名称、*新建*徽标和 chevron，展开是*来源 / Hook 类型 / 命令 / 超时*；底部提示「你可以稍后在 设置 → 钩子 里更改此选项」（纯文字，dsh 没有给插件打开设置页的接口，所以不假装能跳）；三个按钮是*以后再说 / 全部允许 / 允许所选项*。点工具图标就打开，不自动弹。批准即把当前指纹钉进 `$DSH_HOME/hooks.state.json`；其余情况到 **设置 → Hooks** 里逐个处理。
- **`/hooks` 打开钩子浏览器** —— 第一页按事件列出 `生效/已安装` 计数，待审核的事件行尾带 `!`；第二页列出该事件的处理器，带信任状态、启用开关和*信任*/*撤销*按钮。它是标准的 dsh 斜杠命令（宿主组合了 `commands` 服务时注册），不会发给模型。
- **消息操作行的钩子图标 → 钩子统计弹窗** —— 助手消息的操作行有一个钩子图标，点开是统计弹窗。与 CODEX 一致，每次运行都归属触发它的那一轮，所以弹窗**一次只看一轮**（`运行 / 拦截 / 失败`，慢钩子运行中另有 `运行中` 计数），带轮次切换器可回看更早的轮次，底部是本会话累计。*运行历史*列表只列这一轮的运行（形如 `Completed  agent/pre-step  User`）；弹窗打开期间每 1.5 秒刷新一次。钩子输出**不会**打印进对话，模型只会看到处理器的 `additionalContext`。运行记录只放在内存里，不落盘——重载即清空，与 CODEX 相同（它的 `HookStarted`/`HookCompleted` 通知同样是瞬态的）。会话级视角看 `/hooks`。轮次切换器只列**当前会话**的轮次——日志是进程级的，而轮次标签就是数字，换会话后旧轮次会撞编号；弹窗也总是打开最新一轮，不是你所点那条消息所属的轮：DSH 给这个插槽的只有 `messageId`，没有轮次。
- **试跑** —— 设置页的*测试*会用样例输入把一条钩子跑一次，报告 通过/拦截/失败 和耗时；未批准的钩子拒绝试跑。
- **浮层**：所有面板都用 portal 渲到 `document.body` 上并固定定位，不会被输入框或消息列裁掉。

### 自动放行一次工具调用

`approval/request` 钩子可以自己决定待审批的那次调用：

```json
{
  "hooks": {
    "approval/request": [{ "command": "node examples/approval-allow.mjs", "timeout": 10 }]
  }
}
```

钩子打印 `{"decision":"allow"}` 就是放行这一次；打印 `{"decision":"deny","reason":"…"}` 是拒绝；
什么都不打印就交回正常的审批提示。任一钩子 deny 压过别的钩子的 allow。
`examples/approval-allow.mjs` 只放行 `APPROVAL_ALLOW_TOOL` 指定的那个工具——把什么都放行的钩子，
等于把你装钩子本来想收紧的那道提示给拆了。

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

处理器类型：只有 `command` 会被执行。`mcp_tool`、`prompt`、`agent` 可以解析、可以审查，但暂不派发——它们显示为“已安装”而不是“生效”，宁可说清楚，也不要让一条钩子静默地什么都不做。

## 验证状态

- `node test/run-tests.mjs` → **92 passed, 0 failed, 0 skipped**。
- `node selftest/host-e2e.mjs` → 对着真实 profile 跑 **16 passed, 0 failed**。
- `agent/pre-step` 在真实 dsh 会话里跑通：每提交一次提示，示例钩子打印一行 `echo-hook received event=…`。

## 这里做不到的事

下面几条是 dsh 的边界，不是我们没写：需要一个宿主没开放的接缝。CODEX 有这些，dsh 没有，所以移植到这里为止。

- **上下文只能以 user 角色注入**：`agent/pre-step` 收的是 `UserMessage[]`，也没有对外的「追加 developer 消息」接口，所以 `additionalContext` 拿不到 developer 消息那种分量。
- **改不了工具入参**：`tools/pre-execute` 只能 allow / deny / ask / cancel，dsh 明确排除入参改写（参数已经记日志并展示给用户）。
- **压缩、中断、模型请求这三类事件没有接缝**，最接近「压缩后」的只有 `agent/created` 的 `source: "compact"`。
- **`mcp_tool`、`prompt`、`agent` 处理器可以审查但不会执行**，所以它们永远不会显示为生效。

## 安全

钩子以 dsh 进程的权限执行真实命令。所以信任钉在每条钩子的 sha256 指纹上：批准一条钩子＝批准这一行具体的命令，任何改动都要重新批准。只启用你读过的钩子。

## License

MIT
