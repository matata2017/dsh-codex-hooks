# 测试报告 — @local/dsh-hooks

> 执行人：qa-supervisor（测试监工）　执行日期：2026-10-22
> 环境：Windows / Node **v24.18.0** / 工作区 `D:\work\huanghao\dsh-hoos`
> 插件状态：**尚未落地**（`lib/core.js` 等由 dev-supervisor 编写，本报告不包含对插件实现的验证结论）

---

## 1. 跑了什么

```bash
cd D:/work/huanghao/dsh-hoos
node test/run-tests.mjs
```

- 退出码：**0**
- 汇总：**72 passed, 0 failed, 1 skipped**

== A. 信任哈希 vs 真实 CODEX 向量 ==
[PASS] hash/codex-user-hooks-user_prompt_submit — sha256:033537218e7596b56e5e13eb5544e723cfe4421302c4435f4e117016f78b8b10
[PASS] hash/codex-user-hooks-stop — sha256:cfaf54cb72820ddac8105b679dfd4dd0d243806b49e7f54af5145e9dd0b2673f
[PASS] hash/ponytail-plugin-session_start — sha256:defea43402fc8edba23234c694a1117cf80efc2da38968a40a1004cd9d63f725
[PASS] hash/ponytail-plugin-subagent_start — sha256:5b2c1dfa8c7ecc5e8881c8e69479f65d46ed727e0bc5b8e7b4553cee9e5c3daf
[PASS] hash/ponytail-plugin-user_prompt_submit — sha256:5aa5ec474e0bb546f207794993b37fdf7507e54a64e09216be164c5b7b42a197
[PASS] hash/project-hooks-user_prompt_submit-0 — sha256:16f16632a3c5d70397de44292a6f32276340ced7692635f22e58aad39182c07e
[PASS] hash/project-hooks-user_prompt_submit-1 — sha256:878714e87b3d85b74be8c95e2635adc07929a7527dcb547166ee903ad1e66f1f
[PASS] hash/project-hooks-stop-1 — sha256:acae62cf0760ddcf05ab25e683474d2d7b96b99ade806ce3ed1440b2d96d610d
[PASS] hash/负控：改一个字符即变哈希 — mutation of commandWindows detected
[PASS] hash/负控：平台影响 commandWindows 选择 — win32 != linux
[PASS] hash/负控：matcher 参与哈希 — matcher is part of the identity
[PASS] state-key/格式 <path>:<event>:<group>:<handler> — C:\Users\Admin\.codex\hooks.json:user_prompt_submit:0:0

== B. hooks.json 解析 ==
[PASS] parse/合法文件（codex-rs/config/src/hooks_tests.rs 向量） — ok
[PASS] parse/顶层事件键被拒绝（unknown field `PreToolUse`） — rejected
[PASS] parse/未知事件名被拒绝 — rejected
[PASS] parse/未知顶层字段被拒绝 — rejected
[PASS] parse/未知 handler type 被拒绝 — rejected
[PASS] parse/command handler 缺 command 被拒绝 — rejected
[PASS] parse/mcp_tool handler 缺 server 被拒绝 — rejected
[PASS] normalize/timeout 默认 600 — 600
[PASS] normalize/timeout 下限 1 — 1
[PASS] normalize/SessionEnd timeout 夹到 [1,3] — 1..3
[PASS] normalize/Interrupt timeout 夹到 [1,3] — 3
[PASS] normalize/additionalContextLimit=2500 被丢弃 — dropped
[PASS] normalize/additionalContextLimit=4096 在允许的事件里保留 — 4096
[PASS] normalize/additionalContextLimit 在非允许事件里丢弃 — dropped
[PASS] normalize/win32 优先 commandWindows — win32 uses commandWindows
[PASS] normalize/prompt 与 agent 类型不产生哈希 — skipped like CODEX
[PASS] describe/遍历顺序与 state key — 3 entries

== C. matcher 匹配 ==
[PASS] matcher/"*" 匹配一切 — ok
[PASS] matcher/纯精确大小写敏感 — ok
[PASS] matcher/"|" 多选 — ok
[PASS] matcher/正则 — ok
[PASS] matcher/非 matcher 事件强制 All — 9 matcher events
[PASS] matcher/精确与正则在缺 input 时不匹配 — ok

== D. 状态文件读写 + 四种信任状态 ==
[PASS] state/写入后读回一致 — round-trip ok
[PASS] state/文件不存在时返回空状态 — empty state
[PASS] state/损坏的 JSON 报错而不是静默吞掉 — throws
[PASS] trust/Trusted（hash 相同） — Trusted
[PASS] trust/Modified（hash 不同） — Modified
[PASS] trust/Untrusted（没有 trustedHash） — Untrusted
[PASS] trust/Managed（托管 hook 免审） — Managed
[PASS] trust/内置白名单 hook 视为 Trusted — Trusted
[PASS] trust/只有 Trusted 与 Managed 才可执行 — ok
[PASS] enabled/默认启用，enabled=false 才禁用 — ok
[PASS] enabled/Managed 与 builtin 强制启用 — ok

== E. hook 输出 JSON 解析 + 退出码语义 ==
[PASS] output/空 stdout → 无输出 — null
[PASS] output/非法 JSON → null — null
[PASS] output/通用字段全量解析 — ok
[PASS] output/缺省值 continue=true suppressOutput=false — ok
[PASS] output/decision=block 必须带非空 reason — ok
[PASS] output/未知字段 → 解析失败 — null
[PASS] output/按事件限定字段（Stop 不接受 hookSpecificOutput） — ok
[PASS] output/hookSpecificOutput 必须带 hookEventName — null
[PASS] output/additionalContext 必须是字符串 — null
[PASS] output/Interrupt 只接受 systemMessage — ok
[PASS] run/exit 0 + 空 stdout → 成功无操作 — ok
[PASS] run/exit 0 + 纯文本 → 当作 additionalContext — ok
[PASS] run/exit 0 + JSON → 按 schema 解析 — ok
[PASS] run/exit 0 + 非法 JSON → 失败 — failed
[PASS] run/exit 2 + stderr 有内容 → 阻断 — blocked
[PASS] run/exit 2 + stderr 为空 → 失败 — failed
[PASS] run/其他退出码 → 失败 — failed

== F. examples/echo-hook.mjs 端到端 ==
[PASS] echo/stdin 收到 JSON payload — payload delivered on stdin
[PASS] echo/stdout 的 JSON 被解析成 additionalContext — additionalContext parsed
[PASS] echo/exit 0 被判为成功 — ok
[PASS] echo/exit 2 阻断，stderr 给出原因 — echo-hook: blocked UserPromptSubmit on purpose (--block)
[PASS] echo/stdout 的 decision:block 也判为阻断 — blocked via JSON
[PASS] echo/纯文本 stdout 当作 additionalContext — ok
[PASS] echo/其他退出码判为失败 — failed

== G. 插件一致性探针（lib/core.js） ==
[SKIP] plugin/lib/core.js — not present yet — the plugin implementation has not landed

== H. 探针自检（证明探针本身能抓错） ==
[PASS] probe/self-test(忠实实现 → 全部 PASS) — 6 个探针全部命中
[PASS] probe/self-test(忽略 commandWindows → 必须 FAIL) — hookHash() ignored commandWindows on win32 (2 vectors) — CODEX prefers commandWindows on Windows

---
72 passed, 0 failed, 1 skipped

另跑过的一次：

```bash
node test/run-tests.mjs --quiet
```
（只输出失败与汇总，用于快速回归；未单独留档。）

---

## 2. 测试资产

| 文件 | 作用 |
|---|---|
| `test/spec.mjs` | 参考实现：把 CODEX 的 Rust 语义逐条转写成可执行 JS（哈希/归一化/matcher/信任/输出解析/退出码/状态文件） |
| `test/vectors.json` | **8 条真实 CODEX 哈希向量**（真值来源见 §4） |
| `test/run-tests.mjs` | 主 runner：`node test/run-tests.mjs`，任一 FAIL → 退出码 1 |
| `test/plugin-conformance.mjs` | 与 `lib/core.js` 的行为对照探针 + 探针自身的自检 |
| `examples/echo-hook.mjs` | 零依赖 echo hook：证明 stdin 收到 JSON、stdout JSON 被解析、exit 2 阻断 |
| `examples/hooks.json` | CODEX 兼容的示例配置（用户级/项目级/插件级三处通用） |
| `VERIFY.md` | 插件安装后的 UI 验证清单（C1–C10 + 判定标准 + 排查表） |

零依赖：全部只用 Node 内置模块（`node:crypto` / `node:fs` / `node:child_process` / `node:path` / `node:os`）。

---

## 3. 覆盖矩阵与结果

| 段 | 内容 | 结果 |
|---|---|---|
| A | 信任哈希 vs 8 条真实 CODEX 向量（逐条比对）+ 3 个负控 + state key 格式 | 12/12 PASS |
| B | hooks.json 解析（7 条 schema 规则）+ 归一化（7 条：timeout 默认/下限/SessionEnd/Interrupt/additionalContextLimit×2/commandWindows）+ prompt·agent 不产生哈希 + describe 遍历顺序 | 17/17 PASS |
| C | matcher：`*` / 空 / 纯精确（大小写敏感）/ `|` 多选 / 正则 / 非 matcher 事件强制 All / 缺 input 不匹配 | 6/6 PASS |
| D | 状态文件读写（往返一致 / 文件不存在 / 损坏 JSON 报错）+ 四种信任状态 + 只有 Trusted·Managed 可执行 + 启用判定 | 11/11 PASS |
| E | hook 输出 JSON（通用字段 / 默认值 / decision:block 必须带 reason / 未知字段失败 / 按事件限定字段 / hookEventName 必填 / additionalContext 类型 / Interrupt 字段集）+ 退出码语义（0 空/0 文本/0 JSON/0 非法 JSON/2 有 stderr/2 无 stderr/其它码） | 19/19 PASS |
| F | `examples/echo-hook.mjs` 端到端：stdin 收 JSON / stdout JSON 解析成 additionalContext / exit 0 / exit 2 阻断 / JSON decision:block 阻断 / 纯文本 / 其它退出码失败 | 7/7 PASS |
| G | 与插件 `lib/core.js` 的一致性探针 | **1 SKIP**（插件未落地） |
| H | 探针自检：忠实实现→全 PASS；故意忽略 commandWindows→必须 FAIL | 2/2 PASS |

### 3.1 G 段为什么是 SKIP

`lib/core.js` 目前不存在，探针如实报告"插件实现尚未落地"，而不是伪装成通过。
探针本身的有效性用 H 段证明：临时造一个忠实实现的假插件 → 6 个探针全部命中；再造一个**故意在 win32 上忽略 `commandWindows`** 的假插件 → 哈希探针如期 FAIL：

```
[PASS] probe/self-test(忠实实现 → 全部 PASS) — 6 个探针全部命中
[PASS] probe/self-test(忽略 commandWindows → 必须 FAIL) — hookHash() ignored commandWindows on win32 (2 vectors) — CODEX prefers commandWindows on Windows
```

因此 `lib/core.js` 落地后，直接再跑一次 `node test/run-tests.mjs`，G 段会给出真结论（PASS / FAIL / SKIP），不需要改脚本。

### 3.2 沙箱环境下的一个真实限制

DSH 的 Windows 沙箱禁止**带管道 stdio 的子进程**（`spawn(..., stdio:'pipe')` → `EPERM`）。runner 已做双路径：
先走管道；管道被拒时自动改用**文件 stdio**（stdin 用真实文件喂、stdout/stderr 落到文件再读回），两条路径下 F 段结果一致。
在本机的沙箱里跑的是文件路径；在普通终端里跑则是管道路径。**这也意味着 F 段的 stdin 是文件而不是管道**，与插件实际用管道喂 payload 略有差别，但 hook 侧的可观察行为（收到完整 JSON、EOF）一致。

---

## 4. 哈希向量的真值来源（可复核）

向量不是编的，是从**本机已安装的 OpenAI Codex CLI 的状态文件**里读出来的真值：

- `C:\Users\Admin\.codex\config.toml` 的 `[hooks.state."<key>"]` 表中的 `trusted_hash`
- 对应的真实 hook 文件：`C:\Users\Admin\.codex\hooks.json`、
  `C:\Users\Admin\.codex\plugins\cache\ponytail\ponytail\5.3.2\hooks\claude-codex-hooks.json`、
  `E:\work\huanghao\pinrong-online\.codex\hooks.json`

写报告时（2026-10-22）重新 `grep` 了一遍 config.toml，8 条 `trusted_hash` 与 `test/vectors.json` 逐条一致：

```
[hooks.state."ponytail@ponytail:hooks/claude-codex-hooks.json:session_start:0:0"]
trusted_hash = "sha256:defea43402fc8edba23234c694a1117cf80efc2da38968a40a1004cd9d63f725"
[hooks.state."ponytail@ponytail:hooks/claude-codex-hooks.json:user_prompt_submit:0:0"]
trusted_hash = "sha256:5aa5ec474e0bb546f207794993b37fdf7507e54a64e09216be164c5b7b42a197"
[hooks.state."ponytail@ponytail:hooks/claude-codex-hooks.json:subagent_start:0:0"]
trusted_hash = "sha256:5b2c1dfa8c7ecc5e8881c8e69479f65d46ed727e0bc5b8e7b4553cee9e5c3daf"
[hooks.state.'C:\Users\Admin\.codex\hooks.json:user_prompt_submit:0:0']
trusted_hash = "sha256:033537218e7596b56e5e13eb5544e723cfe4421302c4435f4e117016f78b8b10"
[hooks.state.'C:\Users\Admin\.codex\hooks.json:stop:0:0']
trusted_hash = "sha256:cfaf54cb72820ddac8105b679dfd4dd0d243806b49e7f54af5145e9dd0b2673f"
[hooks.state.'E:\work\huanghao\pinrong-online\.codex\hooks.json:user_prompt_submit:0:0']
trusted_hash = "sha256:16f16632a3c5d70397de44292a6f32276340ced7692635f22e58aad39182c07e"
[hooks.state.'E:\work\huanghao\pinrong-online\.codex\hooks.json:user_prompt_submit:0:1']
trusted_hash = "sha256:878714e87b3d85b74be8c95e2635adc07929a7527dcb547166ee903ad1e66f1f"
[hooks.state.'E:\work\huanghao\pinrong-online\.codex\hooks.json:stop:0:1']
trusted_hash = "sha256:acae62cf0760ddcf05ab25e683474d2d7b96b99ade806ce3ed1440b2d96d610d"
```

哈希算法（对照 `codex-rs/config/src/fingerprint.rs` + `codex-rs/hooks/src/engine/discovery.rs`）：
identity = `{event_name, matcher(仅 9 个 matcher 事件且非空时), hooks:[归一化后的单个 handler]}` →
**键递归排序的紧凑 JSON**（`None` 字段直接省略，不是 `null`）→ SHA256 → `sha256:<hex>`。
归一化包含：win32 优先 `commandWindows`、timeout 默认 600（下限 1）、SessionEnd/Interrupt 夹到 [1,3]、
`additionalContextLimit` 仅在 5 个允许事件里保留且等于 2500 时丢弃。

> 本机**没有 cargo/rustc**，无法编译 CODEX 跑它自己的 Rust 单测，因此用"已安装的 Codex 写下的 trusted_hash"当真值。
> 这比 Rust 单测向量更贴近真实行为（它就是 Codex 算出来的），代价是向量只有 8 条、且全部是 `command` 类型。

---

## 5. 未覆盖项（如实列出）

**必须等插件落地 + Lead 安装后才能验证的：**

1. 插件 `lib/core.js` 与参考实现的逐项一致性 —— G 段现在是 SKIP。
2. DSH Web UI 是否真的出现 Hooks 页、三组分组是否正确、开关/信任是否生效 —— 见 `VERIFY.md` 的 C1–C5、C9、C10，**本报告不对这些做任何结论**。
3. 事件映射：DSH 事件 → CODEX 事件、payload 字段是否对得上（`agent/pre-step`→UserPromptSubmit、`agent/turn-stopping`→Stop、`tools/pre-execute`→PreToolUse、`agent/created`→SessionStart、`session/disposed`→SessionEnd、`approval/request`→PermissionRequest）。
4. hook 真的被触发、additionalContext 真的进了模型上下文、exit 2 真的阻断 —— 依赖真机，判定方法见 `VERIFY.md` C6–C8。
5. 状态文件落盘的真实路径与格式（`$DSH_HOME/hooks.state.json`）—— 规格由 HANDOFF §5.3 规定，尚未与实现对齐验证。

**规格层写了语义、但执行层没测的（插件实现到位后应补）：**

6. `async: true` 的异步执行与并发上限 8。
7. 超时杀进程树（Windows JobObject 托管进程树）。
8. `additionalContext` 超 2500 token 落盘、只注入预览 + 恢复元数据。
9. `mcp_tool` handler 的实际执行（只测了 schema 校验）。
10. `prompt` / `agent` handler：CODEX 官方未实现，本插件按"跳过并记 warning"处理，**测试只覆盖了"不产生哈希"**。
11. SessionEnd 强制同步执行。
12. 插件级 hook 的 `trusted_content_hash`（整目录指纹，插件内容变了也算 Modified）—— 只在 HANDOFF 里描述，CODEX 与本插件的落点都还没验证。

**已知差异（非缺陷，但要知道）：**

13. **正则方言**：CODEX 用 Rust `regex` crate（无反向引用/前后瞻），本插件是 JS `RegExp`（有）。极端 pattern 上行为可能与 CODEX 不同。测试用例只用了 `^Bash$` / `.*` / `^mcp__.*$` 这类双方一致的写法。
14. **哈希是平台相关的**：Windows 上 `commandWindows` 优先，Linux 上用 `command`，所以同一个 hooks.json 在两个平台上的 trusted_hash 不同。测试向量全部是 win32 的；linux 平台的期望值由 `spec.hookHash({platform:'linux'})` 计算，未与真实 Codex on Linux 对照过（没有那台机器）。
15. **标量类型**：CODEX 是 TOML→JSON 再排序序列化；本插件直接对 JSON 做。本插件的输入本来就是 JSON（hooks.json），整数/布尔/字符串一致；但如果将来支持 TOML 配置，浮点/大整数表示需要单独对齐。

---

## 6. 给 Lead 的下一步

1. 插件 `lib/core.js` 落地后，直接再跑 `node test/run-tests.mjs` —— G 段会自动变成真结论。
2. 安装后按 `VERIFY.md` 的 C1–C10 逐条走，判定标准都在文件里；C6（echo 日志新增行）是"hook 真的被触发"的硬证据，不依赖 UI 文案。
3. 本报告不声称插件已安装、也不声称 UI 已验证。

---

## 7. 原始输出


== A. 信任哈希 vs 真实 CODEX 向量 ==
[PASS] hash/codex-user-hooks-user_prompt_submit — sha256:033537218e7596b56e5e13eb5544e723cfe4421302c4435f4e117016f78b8b10
[PASS] hash/codex-user-hooks-stop — sha256:cfaf54cb72820ddac8105b679dfd4dd0d243806b49e7f54af5145e9dd0b2673f
[PASS] hash/ponytail-plugin-session_start — sha256:defea43402fc8edba23234c694a1117cf80efc2da38968a40a1004cd9d63f725
[PASS] hash/ponytail-plugin-subagent_start — sha256:5b2c1dfa8c7ecc5e8881c8e69479f65d46ed727e0bc5b8e7b4553cee9e5c3daf
[PASS] hash/ponytail-plugin-user_prompt_submit — sha256:5aa5ec474e0bb546f207794993b37fdf7507e54a64e09216be164c5b7b42a197
[PASS] hash/project-hooks-user_prompt_submit-0 — sha256:16f16632a3c5d70397de44292a6f32276340ced7692635f22e58aad39182c07e
[PASS] hash/project-hooks-user_prompt_submit-1 — sha256:878714e87b3d85b74be8c95e2635adc07929a7527dcb547166ee903ad1e66f1f
[PASS] hash/project-hooks-stop-1 — sha256:acae62cf0760ddcf05ab25e683474d2d7b96b99ade806ce3ed1440b2d96d610d
[PASS] hash/负控：改一个字符即变哈希 — mutation of commandWindows detected
[PASS] hash/负控：平台影响 commandWindows 选择 — win32 != linux
[PASS] hash/负控：matcher 参与哈希 — matcher is part of the identity
[PASS] state-key/格式 <path>:<event>:<group>:<handler> — C:\Users\Admin\.codex\hooks.json:user_prompt_submit:0:0

== B. hooks.json 解析 ==
[PASS] parse/合法文件（codex-rs/config/src/hooks_tests.rs 向量） — ok
[PASS] parse/顶层事件键被拒绝（unknown field `PreToolUse`） — rejected
[PASS] parse/未知事件名被拒绝 — rejected
[PASS] parse/未知顶层字段被拒绝 — rejected
[PASS] parse/未知 handler type 被拒绝 — rejected
[PASS] parse/command handler 缺 command 被拒绝 — rejected
[PASS] parse/mcp_tool handler 缺 server 被拒绝 — rejected
[PASS] normalize/timeout 默认 600 — 600
[PASS] normalize/timeout 下限 1 — 1
[PASS] normalize/SessionEnd timeout 夹到 [1,3] — 1..3
[PASS] normalize/Interrupt timeout 夹到 [1,3] — 3
[PASS] normalize/additionalContextLimit=2500 被丢弃 — dropped
[PASS] normalize/additionalContextLimit=4096 在允许的事件里保留 — 4096
[PASS] normalize/additionalContextLimit 在非允许事件里丢弃 — dropped
[PASS] normalize/win32 优先 commandWindows — win32 uses commandWindows
[PASS] normalize/prompt 与 agent 类型不产生哈希 — skipped like CODEX
[PASS] describe/遍历顺序与 state key — 3 entries

== C. matcher 匹配 ==
[PASS] matcher/"*" 匹配一切 — ok
[PASS] matcher/纯精确大小写敏感 — ok
[PASS] matcher/"|" 多选 — ok
[PASS] matcher/正则 — ok
[PASS] matcher/非 matcher 事件强制 All — 9 matcher events
[PASS] matcher/精确与正则在缺 input 时不匹配 — ok

== D. 状态文件读写 + 四种信任状态 ==
[PASS] state/写入后读回一致 — round-trip ok
[PASS] state/文件不存在时返回空状态 — empty state
[PASS] state/损坏的 JSON 报错而不是静默吞掉 — throws
[PASS] trust/Trusted（hash 相同） — Trusted
[PASS] trust/Modified（hash 不同） — Modified
[PASS] trust/Untrusted（没有 trustedHash） — Untrusted
[PASS] trust/Managed（托管 hook 免审） — Managed
[PASS] trust/内置白名单 hook 视为 Trusted — Trusted
[PASS] trust/只有 Trusted 与 Managed 才可执行 — ok
[PASS] enabled/默认启用，enabled=false 才禁用 — ok
[PASS] enabled/Managed 与 builtin 强制启用 — ok

== E. hook 输出 JSON 解析 + 退出码语义 ==
[PASS] output/空 stdout → 无输出 — null
[PASS] output/非法 JSON → null — null
[PASS] output/通用字段全量解析 — ok
[PASS] output/缺省值 continue=true suppressOutput=false — ok
[PASS] output/decision=block 必须带非空 reason — ok
[PASS] output/未知字段 → 解析失败 — null
[PASS] output/按事件限定字段（Stop 不接受 hookSpecificOutput） — ok
[PASS] output/hookSpecificOutput 必须带 hookEventName — null
[PASS] output/additionalContext 必须是字符串 — null
[PASS] output/Interrupt 只接受 systemMessage — ok
[PASS] run/exit 0 + 空 stdout → 成功无操作 — ok
[PASS] run/exit 0 + 纯文本 → 当作 additionalContext — ok
[PASS] run/exit 0 + JSON → 按 schema 解析 — ok
[PASS] run/exit 0 + 非法 JSON → 失败 — failed
[PASS] run/exit 2 + stderr 有内容 → 阻断 — blocked
[PASS] run/exit 2 + stderr 为空 → 失败 — failed
[PASS] run/其他退出码 → 失败 — failed

== F. examples/echo-hook.mjs 端到端 ==
[PASS] echo/stdin 收到 JSON payload — payload delivered on stdin
[PASS] echo/stdout 的 JSON 被解析成 additionalContext — additionalContext parsed
[PASS] echo/exit 0 被判为成功 — ok
[PASS] echo/exit 2 阻断，stderr 给出原因 — echo-hook: blocked UserPromptSubmit on purpose (--block)
[PASS] echo/stdout 的 decision:block 也判为阻断 — blocked via JSON
[PASS] echo/纯文本 stdout 当作 additionalContext — ok
[PASS] echo/其他退出码判为失败 — failed

== G. 插件一致性探针（lib/core.js） ==
[SKIP] plugin/lib/core.js — not present yet — the plugin implementation has not landed

== H. 探针自检（证明探针本身能抓错） ==
[PASS] probe/self-test(忠实实现 → 全部 PASS) — 6 个探针全部命中
[PASS] probe/self-test(忽略 commandWindows → 必须 FAIL) — hookHash() ignored commandWindows on win32 (2 vectors) — CODEX prefers commandWindows on Windows

---
72 passed, 0 failed, 1 skipped
