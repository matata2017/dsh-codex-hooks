# VERIFY.md — @local/dsh-hooks 安装后验证清单

> 适用范围：DSH 原生插件 `dsh-codex-hooks`（DSH 自己的生命周期钩子，管理方式照 Codex）安装并重载 profile **之后**。
> 本文件里的每一条都是**待执行**的检查，不是已经验证过的结论。执行者：Lead。
> 自动化自检脚本见 [`test/run-tests.mjs`](test/run-tests.mjs)（与安装无关，可随时跑）。

---

## 0. 前置条件

| 项 | 值 | 说明 |
|---|---|---|
| DSH Web UI | <http://127.0.0.1:61621> | 已在本机运行 |
| `DSH_HOME` | `C:\Users\Admin\.dsh`（env 可覆盖，默认 `~/.dsh`） | 插件的用户级配置与状态都放这里 |
| 用户级 hooks 配置 | `$DSH_HOME/hooks.json` | 对应 UI 的 **From Config** |
| 项目级 hooks 配置 | `<会话 cwd>/.dsh/hooks.json` | 对应 UI 的 **From Projects** |
| 插件级 hooks 配置 | profile 的 `node_modules/<pkg>/hooks.json` | 对应 UI 的 **From Plugins** |
| 状态文件 | `$DSH_HOME/hooks.state.json` | `{version:1, states:{"<key>":{enabled, trustedHash}}}` |
| 状态 key 格式 | `<配置绝对路径>:<事件小写下划线>:<group>:<handler>` | 例：`C:\Users\Admin\.dsh\hooks.json:user_prompt_submit:0:0` |

**安装后的第一步**：确认插件已被 profile 加载（`dsh --dump-config` 里能看到 `dsh-codex-hooks`，或 Web UI 设置里出现 Hooks 页）。若设置页没出现，先看 `VERIFY.md` 末尾的排查表，别急着排查 hook 本身。

---

## 1. 准备：放三份示例配置

用仓库里的 [`examples/hooks.json`](examples/hooks.json) 作为模板。**先把它里的绝对路径改成实际路径**（`D:/work/huanghao/dsh-hoos/examples/echo-hook.mjs`）。

```bash
# 1) 用户级（From Config）——DSH_HOME 本机为 C:/Users/Admin/.dsh
cp D:/work/huanghao/dsh-hoos/examples/hooks.json C:/Users/Admin/.dsh/hooks.json

# 2) 项目级（From Projects）——在会话工作区里
mkdir -p D:/work/huanghao/dsh-hoos/.dsh
cp D:/work/huanghao/dsh-hoos/examples/hooks.json D:/work/huanghao/dsh-hoos/.dsh/hooks.json

# 3) 插件级（From Plugins）——造一个只带 hooks.json 的假插件
mkdir -p C:/Users/Admin/.dsh/profiles/web/node_modules/@local/fake-hook-plugin
cp D:/work/huanghao/dsh-hoos/examples/hooks.json \
   C:/Users/Admin/.dsh/profiles/web/node_modules/@local/fake-hook-plugin/hooks.json
```

> 插件级这一条要改 profile 目录，只有 Lead 能做。**做不了就跳过 C2.3**，其余检查照做。

---

## 2. 检查项

每项给四样东西：**怎么做 / 预期 / 判定标准 / 证据在哪**。
"通过"和"失败"都写成可观察的事实，不写"看起来正常"。

### C1 — 设置页出现 Hooks 入口

- **怎么做**：打开 <http://127.0.0.1:61621>，点左侧边栏底部的 **Settings**（或按 `Ctrl+,`），在弹出的设置面板左侧导航里找 **Hooks**。
- **预期**：导航里多出一项 `Hooks`（文案可本地化为「Hooks」/「钩子」，含 Hook 字样即可）。
- **通过**：导航项存在，点击后右侧渲染出 Hooks 页面（有标题 "Hooks" 和三个分组卡片）。
- **失败**：导航里没有 Hooks 项，或点击后是空白页。
- **证据**：截图（导航项 + 页面主体）。

### C2 — 三组分组正确

- **怎么做**：在 Hooks 页面看三张分组卡片。
- **预期**：
  - `From Config` → 指向 `$DSH_HOME/hooks.json`（用户级）
  - `From Plugins` → 指向 profile 里插件自带的 `hooks.json`
  - `From Projects` → 指向 `<会话 cwd>/.dsh/hooks.json`（项目级）
- **通过**：三组都出现；每组显示 hook 数量；点开某组，列表里能看到该文件里的事件（agent/pre-step / tools/pre-execute）与命令摘要。
- **失败**：缺任意一组；或分组归属错（例如把用户级文件显示成 From Projects）；或组里数量与文件里的 handler 条数对不上。
- **判定数量**：`examples/hooks.json` 每个事件各 1 个 handler，所以每组应显示 **2 hooks**（agent/pre-step 1 + tools/pre-execute 1）。若 UI 按事件计数，以 UI 文案为准但需与文件一致。
- **证据**：三张分组卡片的截图 + 展开后的列表。

### C3 — 每条 hook 显示事件名与描述

- **怎么做**：展开任一分组，看每行。
- **预期**：每行显示事件名（`agent/pre-step`、`tools/pre-execute`）、事件描述（"When the user submits a prompt, before the step runs" / "Before a tool runs" 之类）、以及 hook 标识（`statusMessage` 或命令 basename）。
- **通过**：事件名 + 描述 + 标识三者齐全，且事件描述与 `lib/events.js` 里的 EVENT_DESCRIPTIONS 一致。
- **失败**：只有命令没有事件名；或事件描述缺失/串台。
- **证据**：展开列表截图。

### C4 — 信任状态与 "needs review"

- **怎么做**：新放进去的 hooks.json 还没有 trustedHash，此时应处于未信任状态。在 Hooks 页面看该分组的徽标；对该 hook 执行审核/信任操作。
- **预期**：
  - 首次发现 → `Untrusted`，分组上出现 "N needs review" 徽标，**hook 不执行**。
  - 点信任/审核通过 → 该条变 `Trusted`，徽标消失或计数减一。
- **通过**：状态从 Untrusted → Trusted 可切换，且徽标计数随信任操作变化。
- **失败**：未信任的 hook 照样执行；或点信任后状态不变；或徽标计数与实际未信任条数对不上。
- **附带检查**：`$DSH_HOME/hooks.state.json` 里出现对应 key，且 `trustedHash` 形如 `sha256:<64 位 hex>`。key 格式必须是 `<路径>:<事件小写下划线>:<group>:<handler>`。
- **证据**：徽标截图 + `hooks.state.json` 片段。

### C5 — 开关（启用/禁用）生效并持久化

- **怎么做**：把某条 hook 的开关关掉，刷新页面；再打开；最后重启 DSH（重载 profile）再看。
- **预期**：`enabled` 落到 `hooks.state.json` 的 `states[key].enabled`；刷新与重启后开关状态保持；关闭时该 hook 不再被触发。
- **通过**：关 → 状态文件 `enabled:false` → 刷新后仍是关 → 该 hook 不再出现在触发证据里 → 再打开后恢复。
- **失败**：开关只是 UI 假动作（状态文件没变，或刷新后复原）；或禁用后 hook 仍然执行。
- **证据**：`hooks.state.json` 前后对比 + 触发证据的有/无。

### C6 — hook 真的被触发（核心）

`examples/echo-hook.mjs` 会把收到的 stdin payload 追加写到日志文件，默认路径：

```
Windows: %TEMP%\dsh-hooks-echo.log     (node -p "require('os').tmpdir()")
```

- **怎么做**：
  1. 记下日志文件当前行数：`node -p "require('fs').readFileSync(require('path').join(require('os').tmpdir(),'dsh-hooks-echo.log'),'utf8').trim().split('\n').length"`（文件不存在就算 0 行）
  2. 在 Web UI 里发一条普通消息（例如「hook 验证 1234」）。
  3. 再看一眼行数。
  4. 调一次工具（例如让它读一个文件）以触发 tools/pre-execute。
- **预期**：发消息后 agent/pre-step 触发 1 次；调工具后 tools/pre-execute 触发 1 次。日志里每行是一个 JSON，含 `rawStdin` / `parsedStdin` / `time` / `pid`。
- **通过**：行数增加了，且新增行的 `parsedStdin.hook_event_name` 分别是 `agent/pre-step` 与 `tools/pre-execute`；`parsedStdin` 里能读到本次 prompt。
- **失败**：行数不变（hook 没跑）；或事件名不对（映射错）；或 `parsedStdin` 为 null（stdin 没收到合法 JSON）。
- **证据**：`dsh-hooks-echo.log` 的新增行原文（这就是"hook 真的被触发"的硬证据，不依赖 UI 文案）。

### C7 — 阻断语义

把某条 hook 的命令改成 `... echo-hook.mjs --block`（stderr 出一行原因，exit 2），或在示例里加一条 `--decision-block` 的 hook。

- **预期**：`exit 2` + stderr 非空 → 阻断；`exit 2` + stderr 空 → 失败（不是阻断）；其它退出码 → 失败。
- **通过**：agent/pre-step 被阻断时，**这一轮没有真正发出去**，且 UI/会话里出现 hook 给出的原因文本。
- **失败**：hook 说 block 但消息照发；或 block 之后没有任何原因文本。
- **证据**：界面截图 + 会话里出现的原因文案 + 日志里该次 `pid` 的记录。
- **注意**：只有控制类事件能阻断（agent/pre-step / tools/pre-execute / Stop）。PostToolUse 之类的后置事件阻断没有意义，若 UI 允许在那里阻断属于实现偏差。

### C8 — additionalContext 注入

echo hook 默认输出 `hookSpecificOutput.additionalContext`，内容里含 `echo-hook received event=... | prompt=...`。

- **预期**：这段 additionalContext 出现在**送给模型的上下文**里。
- **通过**：模型回答里能引用出 `echo-hook received event=agent/pre-step` 这类片段，或该文本出现在会话的上下文/消息记录里。
- **失败**：hook 跑成功了（日志有记录）但 additionalContext 没进上下文 —— 说明解析或注入链路断了。
- **证据**：模型回复截图（里面含该字符串）+ 日志行。

### C9 — 配置被改后状态变 Modified

- **怎么做**：改 `hooks.json` 里任意一条 command 的一个字符，保存；在 UI 里刷新该分组。
- **预期**：该条从 `Trusted` 变 `Modified`（"needs review" 重新出现），且**在重新信任之前不再执行**。
- **通过**：徽标重新出现 + 日志不再新增该 hook 的记录。
- **失败**：改完仍显示 Trusted（哈希没重算）；或显示 Modified 但仍照跑。
- **证据**：状态文件里 `trustedHash` 与当前哈希不一致 + 徽标截图 + 日志无新增。

### C10 — 状态持久化

- **怎么做**：改完信任/开关状态后，完全重启 DSH（重载 profile），再打开 Hooks 页面。
- **预期**：状态全部保持。
- **通过**：`hooks.state.json` 里的 `enabled` / `trustedHash` 与重启前一致，UI 显示一致。
- **失败**：状态丢失（state 文件没落盘或路径不对）。

---

## 3. 无 UI 的旁路验证（可选）

如果 UI 挂了、但不想卡在渲染上，优先用这两条：

1. **宿主侧**：`/hooks` 斜杠命令（`list` / `enable` / `disable` / `trust` / `test`）应能列出同一批 hook。命令不存在说明 `lib/index.js` 没注册该命令。
2. **浏览器控制台**：页面已加载时，客户端的 remote 调用是 `ctx.remote`（`@deepseek-ai/dsh-api-gateway/client`）。在设置页的组件里临时打一行，拿到 `{result:{ok,value}}` 后台返回的分组 JSON，再和 UI 对照——**若返回成功但 UI 空白，问题在渲染层，不在插件逻辑**。

---

## 4. 判定标准速查

| 检查 | 通过 | 失败 |
|---|---|---|
| C1 Hooks 入口 | 导航有 Hooks，点开有内容 | 没有入口 / 空白页 |
| C2 三组分组 | From Config / From Plugins / From Projects 齐全且归属正确 | 缺组 / 归属错 / 数量对不上 |
| C3 事件信息 | 事件名 + 描述 + 标识齐全 | 缺事件名或描述串台 |
| C4 信任 | Untrusted→Trusted 可切换，徽标跟随变化 | 未信任也执行 / 点了没反应 |
| C5 开关 | 落盘、刷新后保持、禁用后不触发 | 只改 UI 不落盘 / 禁用仍执行 |
| C6 真触发 | echo 日志新增行且事件名正确 | 日志不增长 / 事件名错 / stdin 非 JSON |
| C7 阻断 | block 时消息真的没发出去且有原因文本 | block 了但照发 / 无原因 |
| C8 additionalContext | 进了模型上下文 | hook 跑了但上下文里没有 |
| C9 Modified | 改配置后变 Modified 且停跑 | 仍 Trusted / 仍照跑 |
| C10 持久化 | 重启后状态不变 | 状态丢失 |

---

## 5. 排查表

| 症状 | 先查 |
|---|---|
| 设置页没有 Hooks 项 | 插件有没有进 profile 的 `dsh.profile.bundles`；`lib/client.js` 有没有 `ctx.slots.inject('settings.section', ...)`；`cordis.patch.yml` 有没有把客户端插件注进去；重载 profile 了没 |
| 页面有但分组全空 | `$DSH_HOME/hooks.json` 是不是被读到了；文件是不是合法 JSON（`node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$DSH_HOME/hooks.json"`） |
| 分组有了但 hook 不跑 | 信任状态是不是 Untrusted/Modified；`hooks.state.json` 里的 key 是不是和 `list` 返回的 key 完全一致；命令路径在当前 OS 下能不能执行（Windows 需 `commandWindows`） |
| hook 跑了但没有 additionalContext | 输出是不是合法 JSON（必须是对象，且只含该事件允许的字段）；`hookSpecificOutput.hookEventName` 在不在 |
| 日志里 `parsedStdin` 是 null | 插件是不是把 payload 写到了 stdout 而不是 stdin；或 payload 不是 JSON |
| 一切正常但模型没看到上下文 | `additionalContextLimit`（默认 2500）超限会落盘只注入预览；检查 `hooks.json` 里是否被改小 |

---

## 6. 自动化自检（与安装无关，可随时跑）

```bash
node test/run-tests.mjs            # 全部；退出码 0 = 全过，1 = 有失败
node test/run-tests.mjs --quiet    # 只看失败与汇总
```

覆盖：指纹稳定性与变更检测、hooks.json 解析与归一化（DSH 原生格式）、matcher 四种形态、状态文件读写、四种信任状态、hook 输出 JSON 与退出码语义、echo hook 端到端、运行记录与 /hooks 文本、客户端 bundle 渲染。
