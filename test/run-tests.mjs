#!/usr/bin/env node
/**
 * test/run-tests.mjs — zero-dependency self-check for the @local/dsh-hooks plugin.
 *
 *   node test/run-tests.mjs            # run every section
 *   node test/run-tests.mjs --quiet    # only print failures and the summary
 *
 * Exit code 0  = every check passed (SKIP is allowed, FAIL is not).
 * Exit code 1  = at least one check failed.
 * Exit code 2  = the test harness itself could not run (missing files, bad JSON).
 *
 * Sections
 *   A  信任哈希 — stable sha256 fingerprint, one changed character changes it
 *   B  hooks.json 解析 — DSH schema, normalization, timeout / additionalContextLimit rules
 *   C  matcher — '*' / 精确 / '|' 多选 / 正则
 *   D  状态文件读写 + 四种信任状态
 *   E  hook 输出 JSON 解析 + 退出码语义
 *   F  examples/echo-hook.mjs 端到端（stdin → stdout → exit 2）
 *   G  运行记录与 /hooks 文本（lib/runs.js）
 *   H  客户端 bundle 渲染（test/client-bundle.mjs）
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, openSync, closeSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import * as spec from '../lib/core.js'
import { runClientBundleCheck } from './client-bundle.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const ECHO_HOOK = join(ROOT, 'examples', 'echo-hook.mjs')
const QUIET = process.argv.includes('--quiet')

const results = []
let currentSection = ''

function section(name) {
  currentSection = name
  if (!QUIET) process.stdout.write(`\n== ${name} ==\n`)
}

function record(status, name, detail) {
  results.push({ section: currentSection, status, name, detail })
  if (QUIET && status === 'PASS') return
  process.stdout.write(`[${status}] ${name}${detail ? ` — ${detail}` : ''}\n`)
}

function test(name, fn) {
  try {
    const detail = fn()
    record('PASS', name, typeof detail === 'string' ? detail : '')
  } catch (error) {
    record('FAIL', name, error && error.message ? error.message : String(error))
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message ?? 'value mismatch'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertThrows(fn, message, pattern) {
  let thrown = null
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  if (!thrown) throw new Error(`${message ?? 'expected a throw'} but nothing was thrown`)
  if (pattern && !pattern.test(thrown.message)) {
    throw new Error(`${message ?? 'wrong error'}: "${thrown.message}"`)
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// A. 信任哈希：归一化后算 sha256，改一处即变
// ---------------------------------------------------------------------------
section('A. 信任哈希')

const baseHook = { type: 'command', command: 'node hook.mjs', timeout: 15, statusMessage: 'checking' }

test('hash/同一钩子两次哈希一致且是 sha256 指纹', () => {
  const first = spec.hookHash({ eventName: 'agent/pre-step', handler: baseHook })
  const second = spec.hookHash({ eventName: 'agent/pre-step', handler: { ...baseHook } })
  assertEqual(first, second, 'hash must be stable')
  assert(/^sha256:[0-9a-f]{64}$/.test(first), `not a sha256 fingerprint: ${first}`)
  return first.slice(0, 19)
})

test('hash/负控：改一个字符即变哈希', () => {
  const original = spec.hookHash({ eventName: 'agent/pre-step', handler: baseHook })
  const changed = spec.hookHash({ eventName: 'agent/pre-step', handler: { ...baseHook, command: 'node hook.mjs ' } })
  assert(original !== changed, 'mutating command produced the same hash')
  return 'mutation detected'
})

test('hash/负控：平台影响 commandWindows 选择', () => {
  const handler = { type: 'command', command: 'node a.js', commandWindows: 'node.exe a.js' }
  const win = spec.hookHash({ eventName: 'tools/pre-execute', handler, platform: 'win32' })
  const linux = spec.hookHash({ eventName: 'tools/pre-execute', handler, platform: 'linux' })
  assert(win !== linux, 'commandWindows was ignored on win32')
  return 'win32 != linux'
})

test('hash/负控：matcher 只在支持 matcher 的事件上参与哈希', () => {
  const withMatcher = spec.hookHash({ eventName: 'tools/pre-execute', matcher: 'Bash', handler: baseHook })
  const withoutMatcher = spec.hookHash({ eventName: 'tools/pre-execute', matcher: null, handler: baseHook })
  assert(withMatcher !== withoutMatcher, 'matcher did not change the hash')
  const promptA = spec.hookHash({ eventName: 'agent/pre-step', matcher: 'Bash', handler: baseHook })
  const promptB = spec.hookHash({ eventName: 'agent/pre-step', matcher: null, handler: baseHook })
  assertEqual(promptA, promptB, 'agent/pre-step has no matcher, so the hash must not change')
  return 'matcher is part of the identity'
})

test('state-key/格式 <path>:<event>:<group>:<handler>', () => {
  const key = spec.hookStateKey('C:\\Users\\Admin\\.dsh\\hooks.json', 'agent/pre-step', 0, 0)
  assertEqual(key, 'C:\\Users\\Admin\\.dsh\\hooks.json:agent_pre_step:0:0', 'state key format')
  return key
})

// ---------------------------------------------------------------------------
// B. hooks.json 解析（DSH 自己的格式）
// ---------------------------------------------------------------------------
section('B. hooks.json 解析')

const validDoc = {
  version: 1,
  description: 'demo',
  hooks: {
    'tools/pre-execute': [
      {
        matcher: '^Bash$',
        command: 'python3 /tmp/pre.py',
        timeout: 10,
        statusMessage: 'checking',
        additionalContextLimit: 4096,
      },
    ],
  },
}

test('parse/合法文件（每行一个 hook，带命令与 matcher）', () => {
  const parsed = spec.parseHooksFile(JSON.stringify(validDoc))
  assertEqual(parsed.description, 'demo', 'description')
  const group = parsed.events['tools/pre-execute'][0]
  assertEqual(group.matcher, '^Bash$', 'matcher')
  assertEqual(group.hooks.length, 1, 'handler count')
  assertEqual(group.hooks[0].command, 'python3 /tmp/pre.py', 'command')
  assertEqual(group.hooks[0].timeout, 10, 'timeout')
  assertEqual(group.hooks[0].statusMessage, 'checking', 'statusMessage')
  return 'ok'
})

test('parse/事件名必须用 DSH 的事件，Codex 的名字被拒绝', () => {
  assertThrows(
    () => spec.parseHooksFile(JSON.stringify({ hooks: { PreToolUse: [{ command: 'x' }] } })),
    'a Codex event name must be rejected',
    /unknown event/,
  )
  return 'rejected'
})

test('parse/Codex 的 matcher 分组形状被拒绝并给出迁移提示', () => {
  assertThrows(
    () =>
      spec.parseHooksFile(
        JSON.stringify({ hooks: { 'tools/pre-execute': [{ matcher: '*', hooks: [{ type: 'command', command: 'x' }] }] } }),
      ),
    'a matcher group must be rejected',
    /matcher group/,
  )
  return 'rejected'
})

test('parse/未知顶层字段被拒绝', () => {
  assertThrows(
    () => spec.parseHooksFile(JSON.stringify({ hooks: {}, bogus: 1 })),
    'unknown top-level field must be rejected',
    /unknown field/,
  )
  return 'rejected'
})

test('parse/未知 handler type 被拒绝', () => {
  assertThrows(
    () => spec.parseHooksFile(JSON.stringify({ hooks: { 'agent/turn-stopping': [{ type: 'wat', command: 'x' }] } })),
    'unknown handler type must be rejected',
    /must be one of/,
  )
  return 'rejected'
})

test('parse/command 缺失被拒绝', () => {
  assertThrows(
    () => spec.parseHooksFile(JSON.stringify({ hooks: { 'agent/turn-stopping': [{ type: 'command' }] } })),
    'command hook without command must be rejected',
    /command/,
  )
  return 'rejected'
})

test('parse/mcp_tool 缺 server 被拒绝', () => {
  assertThrows(
    () =>
      spec.parseHooksFile(JSON.stringify({ hooks: { 'agent/turn-stopping': [{ type: 'mcp_tool', tool: 'x' }] } })),
    'mcp_tool without server must be rejected',
    /server/,
  )
  return 'rejected'
})

test('parse/缺省 type 视为 command', () => {
  const parsed = spec.parseHooksFile(JSON.stringify({ hooks: { 'agent/pre-step': [{ command: 'node x.mjs' }] } }))
  assertEqual(parsed.events['agent/pre-step'][0].hooks[0].type, 'command', 'default type')
  return 'command'
})

test('normalize/timeout 默认 600', () => {
  const handler = spec.normalizeHandler({ type: 'command', command: 'x' }, { eventName: 'tools/pre-execute' })
  assertEqual(handler.timeout, 600, 'default timeout')
  return '600'
})

test('normalize/timeout 下限 1', () => {
  const handler = spec.normalizeHandler({ type: 'command', command: 'x', timeout: 0 }, { eventName: 'tools/pre-execute' })
  assertEqual(handler.timeout, 1, 'timeout floor')
  return '1'
})

test('normalize/session/disposed timeout 夹到 [1,3]', () => {
  const high = spec.normalizeHandler({ type: 'command', command: 'x', timeout: 60 }, { eventName: 'session/disposed' })
  assertEqual(high.timeout, 3, 'upper clamp')
  const low = spec.normalizeHandler({ type: 'command', command: 'x', timeout: 0 }, { eventName: 'session/disposed' })
  assertEqual(low.timeout, 1, 'lower clamp')
  const none = spec.normalizeHandler({ type: 'command', command: 'x' }, { eventName: 'session/disposed' })
  assertEqual(none.timeout, 1, 'default')
  return '1..3'
})

test('normalize/additionalContextLimit=2500 被丢弃', () => {
  const handler = spec.normalizeHandler(
    { type: 'command', command: 'x', additionalContextLimit: 2500 },
    { eventName: 'tools/pre-execute' },
  )
  assert(!('additionalContextLimit' in handler), '2500 must be dropped')
  return 'dropped'
})

test('normalize/additionalContextLimit=4096 在允许的事件里保留', () => {
  const handler = spec.normalizeHandler(
    { type: 'command', command: 'x', additionalContextLimit: 4096 },
    { eventName: 'tools/pre-execute' },
  )
  assertEqual(handler.additionalContextLimit, 4096, 'limit kept')
  return '4096'
})

test('normalize/additionalContextLimit 在非允许事件里丢弃', () => {
  const handler = spec.normalizeHandler(
    { type: 'command', command: 'x', additionalContextLimit: 4096 },
    { eventName: 'agent/turn-stopping' },
  )
  assert(!('additionalContextLimit' in handler), 'limit must be dropped for agent/turn-stopping')
  return 'dropped'
})

test('normalize/win32 优先 commandWindows', () => {
  const handler = spec.normalizeHandler(
    { type: 'command', command: 'node a.js', commandWindows: 'node.exe a.js' },
    { eventName: 'tools/pre-execute', platform: 'win32' },
  )
  assertEqual(handler.command, 'node.exe a.js', 'win32 command')
  const linux = spec.normalizeHandler(
    { type: 'command', command: 'node a.js', commandWindows: 'node.exe a.js' },
    { eventName: 'tools/pre-execute', platform: 'linux' },
  )
  assertEqual(linux.command, 'node a.js', 'linux command')
  return 'win32 uses commandWindows'
})

test('normalize/prompt 与 agent 类型不产生哈希', () => {
  assertEqual(spec.normalizeHandler({ type: 'prompt' }, { eventName: 'tools/pre-execute' }), null, 'prompt')
  assertEqual(spec.normalizeHandler({ type: 'agent' }, { eventName: 'tools/pre-execute' }), null, 'agent')
  return 'skipped'
})

test('describe/遍历顺序与 state key', () => {
  const parsed = spec.parseHooksFile(
    JSON.stringify({
      hooks: {
        'agent/turn-stopping': [{ command: 'a' }, { command: 'b' }],
        'tools/pre-execute': [{ matcher: '*', command: 'c' }],
      },
    }),
  )
  const entries = spec.describeHooks(parsed, { sourceKey: 'C:/x/hooks.json', platform: 'linux' })
  assertEqual(entries.length, 3, 'entry count')
  assertEqual(entries[0].key, 'C:/x/hooks.json:tools_pre_execute:0:0', 'first key')
  assertEqual(entries[1].key, 'C:/x/hooks.json:agent_turn_stopping:0:0', 'second key')
  assertEqual(entries[2].key, 'C:/x/hooks.json:agent_turn_stopping:1:0', 'third key')
  return '3 entries'
})

// ---------------------------------------------------------------------------
// C. matcher
// ---------------------------------------------------------------------------
section('C. matcher 匹配')

test('matcher/"*" 匹配一切', () => {
  assert(spec.matchMatcher('*', 'Bash'), 'star must match')
  assert(spec.matchMatcher('*', ''), 'star must match empty')
  assert(spec.matchMatcher('', 'Bash'), 'empty pattern is All')
  return 'ok'
})

test('matcher/纯精确大小写敏感', () => {
  assert(spec.matchMatcher('Bash', 'Bash'), 'exact must match')
  assert(!spec.matchMatcher('Bash', 'bash'), 'exact must not match other case')
  assert(!spec.matchMatcher('Bash', 'BashTool'), 'exact must not match prefix')
  return 'ok'
})

test('matcher/"|" 多选', () => {
  assert(spec.matchMatcher('Bash|Read', 'Read'), 'multi must match second')
  assert(spec.matchMatcher('Bash|Read', 'Bash'), 'multi must match first')
  assert(!spec.matchMatcher('Bash|Read', 'Write'), 'multi must not match other')
  return 'ok'
})

test('matcher/正则', () => {
  assert(spec.matchMatcher('^Bash$', 'Bash'), 'regex must match')
  assert(!spec.matchMatcher('^Bash$', 'BashTool'), 'regex must not match')
  assert(spec.matchMatcher('.*', 'anything'), 'regex .* must match')
  assert(spec.matchMatcher('^mcp__.*$', 'mcp__mem__search'), 'regex prefix must match')
  return 'ok'
})

test('matcher/只有工具类 seam 支持 matcher', () => {
  const compiled = spec.compileMatcher('Bash')
  assertEqual(compiled.kind, 'exact', 'classification')
  assert(spec.MATCHER_EVENTS.has('tools/pre-execute'), 'tools/pre-execute supports a matcher')
  assert(spec.MATCHER_EVENTS.has('tools/post-execute'), 'tools/post-execute supports a matcher')
  assert(spec.MATCHER_EVENTS.has('approval/request'), 'approval/request supports a matcher')
  assert(!spec.MATCHER_EVENTS.has('agent/pre-step'), 'agent/pre-step takes no matcher')
  assert(!spec.MATCHER_EVENTS.has('agent/turn-stopping'), 'agent/turn-stopping takes no matcher')
  assertEqual(spec.MATCHER_EVENTS.size, 3, '3 seams support a matcher')
  return '3 matcher seams'
})

test('matcher/精确与正则在缺 input 时不匹配', () => {
  assert(!spec.matchMatcher('Bash', null), 'exact without input')
  assert(!spec.matchMatcher('^Bash$', undefined), 'regex without input')
  return 'ok'
})

// ---------------------------------------------------------------------------
// D. 状态文件 + 信任状态
// ---------------------------------------------------------------------------
section('D. 状态文件读写 + 四种信任状态')

const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-hooks-test-'))

try {
  test('state/写入后读回一致', () => {
    const path = join(tmpDir, 'hooks.state.json')
    const written = spec.writeStateFile(path, {
      states: {
        'C:/x/hooks.json:stop:0:0': { enabled: false, trustedHash: 'sha256:abc' },
      },
    })
    assertEqual(written.version, 1, 'version')
    const back = spec.readStateFile(path)
    assertEqual(back.states['C:/x/hooks.json:stop:0:0'].enabled, false, 'enabled')
    assertEqual(back.states['C:/x/hooks.json:stop:0:0'].trustedHash, 'sha256:abc', 'trustedHash')
    return 'round-trip ok'
  })

  test('state/文件不存在时返回空状态', () => {
    const back = spec.readStateFile(join(tmpDir, 'nope.json'))
    assertEqual(back.version, 1, 'version')
    assertEqual(Object.keys(back.states).length, 0, 'states')
    return 'empty state'
  })

  test('state/损坏的 JSON 报错而不是静默吞掉', () => {
    const path = join(tmpDir, 'broken.json')
    spec.writeStateFile(path, { states: {} })
    writeFileSync(path, '{not json', 'utf8')
    assertThrows(() => spec.readStateFile(path), 'corrupt state file must throw', /not valid JSON/)
    return 'throws'
  })
} finally {
  rmSync(tmpDir, { recursive: true, force: true })
}

test('trust/Trusted（hash 相同）', () => {
  assertEqual(spec.trustStatus({ currentHash: 'h', trustedHash: 'h' }), 'Trusted', 'trusted')
  return 'Trusted'
})

test('trust/Modified（hash 不同）', () => {
  assertEqual(spec.trustStatus({ currentHash: 'h', trustedHash: 'other' }), 'Modified', 'modified')
  return 'Modified'
})

test('trust/Untrusted（没有 trustedHash）', () => {
  assertEqual(spec.trustStatus({ currentHash: 'h', trustedHash: null }), 'Untrusted', 'untrusted')
  assertEqual(spec.trustStatus({ currentHash: 'h' }), 'Untrusted', 'untrusted without key')
  return 'Untrusted'
})

test('trust/Managed（托管 hook 免审）', () => {
  assertEqual(spec.trustStatus({ isManaged: true, currentHash: 'h', trustedHash: 'other' }), 'Managed', 'managed')
  return 'Managed'
})

test('trust/内置白名单 hook 视为 Trusted', () => {
  assertEqual(spec.trustStatus({ isBuiltin: true, currentHash: 'h' }), 'Trusted', 'builtin')
  return 'Trusted'
})

test('trust/只有 Trusted 与 Managed 才可执行', () => {
  assert(spec.isRunnable('Trusted'), 'trusted runs')
  assert(spec.isRunnable('Managed'), 'managed runs')
  assert(!spec.isRunnable('Modified'), 'modified must not run')
  assert(!spec.isRunnable('Untrusted'), 'untrusted must not run')
  return 'ok'
})

test('enabled/默认启用，enabled=false 才禁用', () => {
  assertEqual(spec.hookEnabled({}), true, 'default enabled')
  assertEqual(spec.hookEnabled({ state: { enabled: true } }), true, 'explicit enabled')
  assertEqual(spec.hookEnabled({ state: { enabled: false } }), false, 'explicit disabled')
  return 'ok'
})

test('enabled/Managed 与 builtin 强制启用', () => {
  assertEqual(spec.hookEnabled({ isManaged: true, state: { enabled: false } }), true, 'managed')
  assertEqual(spec.hookEnabled({ isBuiltin: true, state: { enabled: false } }), true, 'builtin')
  return 'ok'
})

// ---------------------------------------------------------------------------
// E. hook 输出 JSON + 退出码
// ---------------------------------------------------------------------------
section('E. hook 输出 JSON 解析 + 退出码语义')

test('output/空 stdout → 无输出', () => {
  assertEqual(spec.parseHookOutput(''), null, 'empty stdout')
  assertEqual(spec.parseHookOutput('   \n '), null, 'blank stdout')
  return 'null'
})

test('output/非法 JSON → null', () => {
  assertEqual(spec.parseHookOutput('{not json'), null, 'invalid json')
  assertEqual(spec.parseHookOutput('[1,2]'), null, 'array is not an object')
  return 'null'
})

test('output/通用字段全量解析', () => {
  const parsed = spec.parseHookOutput(
    JSON.stringify({
      continue: false,
      stopReason: 'stopped by hook',
      systemMessage: 'heads up',
      suppressOutput: true,
    }),
    { eventName: 'agent/turn-stopping' },
  )
  assertEqual(parsed.continue, false, 'continue')
  assertEqual(parsed.stopReason, 'stopped by hook', 'stopReason')
  assertEqual(parsed.systemMessage, 'heads up', 'systemMessage')
  assertEqual(parsed.suppressOutput, true, 'suppressOutput')
  return 'ok'
})

test('output/缺省值 continue=true suppressOutput=false', () => {
  const parsed = spec.parseHookOutput('{}', { eventName: 'agent/turn-stopping' })
  assertEqual(parsed.continue, true, 'default continue')
  assertEqual(parsed.suppressOutput, false, 'default suppressOutput')
  assertEqual(parsed.decision, null, 'default decision')
  return 'ok'
})

test('output/decision=block 必须带非空 reason', () => {
  const good = spec.parseHookOutput(JSON.stringify({ decision: 'block', reason: 'nope' }), { eventName: 'tools/pre-execute' })
  assertEqual(good.decision, 'block', 'decision')
  assertEqual(good.invalidReason, null, 'no invalid reason')
  const bad = spec.parseHookOutput(JSON.stringify({ decision: 'block' }), { eventName: 'tools/pre-execute' })
  assert(bad.invalidReason && /non-empty reason/.test(bad.invalidReason), 'missing reason must be flagged')
  return 'ok'
})

test('output/未知字段 → 解析失败', () => {
  assertEqual(spec.parseHookOutput(JSON.stringify({ nope: 1 }), { eventName: 'agent/turn-stopping' }), null, 'unknown field')
  return 'null'
})

test('output/按事件限定字段（Stop 不接受 hookSpecificOutput）', () => {
  const withSpecific = JSON.stringify({
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'x' },
  })
  assertEqual(spec.parseHookOutput(withSpecific, { eventName: 'agent/turn-stopping' }), null, 'Stop rejects hookSpecificOutput')
  const userPrompt = spec.parseHookOutput(withSpecific, { eventName: 'agent/pre-step' })
  assert(userPrompt !== null, 'agent/pre-step accepts hookSpecificOutput')
  assertEqual(userPrompt.additionalContext, 'x', 'additionalContext')
  return 'ok'
})

test('output/hookSpecificOutput 必须带 hookEventName', () => {
  const parsed = spec.parseHookOutput(
    JSON.stringify({ hookSpecificOutput: { additionalContext: 'x' } }),
    { eventName: 'agent/pre-step' },
  )
  assertEqual(parsed, null, 'missing hookEventName')
  return 'null'
})

test('output/additionalContext 必须是字符串', () => {
  const parsed = spec.parseHookOutput(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'agent/pre-step', additionalContext: 42 } }),
    { eventName: 'agent/pre-step' },
  )
  assertEqual(parsed, null, 'non-string additionalContext')
  return 'null'
})

test('output/session/disposed 只接受 systemMessage', () => {
  assertEqual(spec.parseHookOutput(JSON.stringify({ continue: true }), { eventName: 'session/disposed' }), null, 'continue rejected')
  const ok = spec.parseHookOutput(JSON.stringify({ systemMessage: 'hi' }), { eventName: 'session/disposed' })
  assertEqual(ok.systemMessage, 'hi', 'systemMessage')
  return 'ok'
})

test('output/approval/request 接受 allow 与 deny，其他事件不接受', () => {
  const allow = spec.parseHookOutput(JSON.stringify({ decision: 'allow' }), { eventName: 'approval/request' })
  assertEqual(allow.decision, 'allow', 'allow parsed')
  const deny = spec.parseHookOutput(JSON.stringify({ decision: 'deny', reason: 'not in CI' }), { eventName: 'approval/request' })
  assertEqual(deny.reason, 'not in CI', 'deny reason')
  assertEqual(
    spec.parseHookOutput(JSON.stringify({ decision: 'allow' }), { eventName: 'tools/pre-execute' }),
    null,
    'non-approval events still only block',
  )
  const allowed = spec.classifyRun({ exitCode: 0, stdout: '{"decision":"allow"}', stderr: '' }, { eventName: 'approval/request' })
  assertEqual(allowed.status, 'ok', 'allow keeps the run ok')
  assertEqual(allowed.decision, 'allow', 'allow surfaced for the approval seam')
  const denied = spec.classifyRun({ exitCode: 0, stdout: '{"decision":"deny"}', stderr: '' }, { eventName: 'approval/request' })
  assertEqual(denied.status, 'blocked', 'deny blocks')
  assertEqual(denied.reason, 'approval/request hook denied approval', 'deny gets a default reason')
  return 'ok'
})

test('parse/mcp_tool 可解析但不可执行（不会假装 runnable）', () => {
  assertEqual(spec.EXECUTABLE_HANDLER_TYPES.includes('mcp_tool'), false, 'mcp_tool is not dispatched')
  const parsed = spec.parseHooksFile(
    JSON.stringify({ hooks: { 'tools/pre-execute': [{ type: 'mcp_tool', server: 'kb', tool: 'log' }] } }),
  )
  const [described] = spec.describeHooks(parsed, { sourceKey: 'C:/x/hooks.json', platform: 'linux' })
  assertEqual(described.executable, false, 'shown as reviewable, not runnable')
  return 'ok'
})

test('run/exit 0 + 空 stdout → 成功无操作', () => {
  const result = spec.classifyRun({ exitCode: 0, stdout: '', stderr: '' }, { eventName: 'agent/turn-stopping' })
  assertEqual(result.status, 'ok', 'status')
  assertEqual(result.output, null, 'no output')
  return 'ok'
})

test('run/exit 0 + 纯文本 → 当作 additionalContext', () => {
  const result = spec.classifyRun({ exitCode: 0, stdout: 'hello context', stderr: '' }, { eventName: 'agent/turn-stopping' })
  assertEqual(result.status, 'ok', 'status')
  assertEqual(result.additionalContext, 'hello context', 'additionalContext')
  return 'ok'
})

test('run/exit 0 + JSON → 按 schema 解析', () => {
  const result = spec.classifyRun(
    { exitCode: 0, stdout: JSON.stringify({ systemMessage: 'warn' }), stderr: '' },
    { eventName: 'agent/turn-stopping' },
  )
  assertEqual(result.status, 'ok', 'status')
  assertEqual(result.output.systemMessage, 'warn', 'systemMessage')
  return 'ok'
})

test('run/exit 0 + 非法 JSON → 失败', () => {
  const result = spec.classifyRun({ exitCode: 0, stdout: '{"unknown":1}', stderr: '' }, { eventName: 'agent/turn-stopping' })
  assertEqual(result.status, 'failed', 'status')
  assert(/invalid/.test(result.error), 'error mentions invalid output')
  return 'failed'
})

test('run/exit 2 + stderr 有内容 → 阻断', () => {
  const result = spec.classifyRun({ exitCode: 2, stdout: '', stderr: 'do not commit' }, { eventName: 'tools/pre-execute' })
  assertEqual(result.status, 'blocked', 'status')
  assertEqual(result.reason, 'do not commit', 'reason')
  return 'blocked'
})

test('run/exit 2 + stderr 为空 → 失败', () => {
  const result = spec.classifyRun({ exitCode: 2, stdout: '', stderr: '  ' }, { eventName: 'tools/pre-execute' })
  assertEqual(result.status, 'failed', 'status')
  assert(/blocking reason/.test(result.error), 'error mentions missing reason')
  return 'failed'
})

test('run/其他退出码 → 失败', () => {
  const result = spec.classifyRun({ exitCode: 3, stdout: '', stderr: 'boom' }, { eventName: 'agent/turn-stopping' })
  assertEqual(result.status, 'failed', 'status')
  assert(/exited with code 3/.test(result.error), 'error message')
  return 'failed'
})

// ---------------------------------------------------------------------------
// F. examples/echo-hook.mjs 端到端
// ---------------------------------------------------------------------------
section('F. examples/echo-hook.mjs 端到端')

function runHookWithPipes(args, input, env) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(process.execPath, [ECHO_HOOK, ...args], {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      // Windows sandboxes can refuse a piped spawn synchronously.
      resolve({ exitCode: -1, stdout: '', stderr: '', error })
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => resolve({ exitCode: -1, stdout, stderr, error }))
    child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }))
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

/**
 * Fallback for sandboxes that forbid named pipes (child_process stdio: 'pipe' → EPERM):
 * hand the child regular files instead. stdin is a real file, stdout/stderr are captured
 * through files, so the child still receives its payload on stdin.
 */
function runHookWithFiles(args, input, env) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-run-'))
  const inPath = join(dir, 'stdin.json')
  const outPath = join(dir, 'stdout.txt')
  const errPath = join(dir, 'stderr.txt')
  writeFileSync(inPath, input ?? '', 'utf8')
  return new Promise((resolve) => {
    const inFd = openSync(inPath, 'r')
    const outFd = openSync(outPath, 'w')
    const errFd = openSync(errPath, 'w')
    let child
    try {
      child = spawn(process.execPath, [ECHO_HOOK, ...args], {
        env: { ...process.env, ...env },
        stdio: [inFd, outFd, errFd],
        windowsHide: true,
      })
    } catch (error) {
      closeSync(inFd)
      closeSync(outFd)
      closeSync(errFd)
      resolve({ exitCode: -1, stdout: '', stderr: '', error, via: 'files' })
      rmSync(dir, { recursive: true, force: true })
      return
    }
    let spawnError = null
    child.on('error', (error) => {
      spawnError = error
    })
    child.on('close', (code) => {
      closeSync(inFd)
      closeSync(outFd)
      closeSync(errFd)
      resolve({
        exitCode: spawnError ? -1 : code,
        stdout: existsSync(outPath) ? readFileSync(outPath, 'utf8') : '',
        stderr: existsSync(errPath) ? readFileSync(errPath, 'utf8') : '',
        error: spawnError,
        via: 'files',
      })
      rmSync(dir, { recursive: true, force: true })
    })
  })
}

async function runHook(args, input, env = {}) {
  const piped = await runHookWithPipes(args, input, env)
  if (!piped.error) return piped
  if (piped.error.code !== 'EPERM' && piped.error.code !== 'EINVAL' && piped.error.code !== 'EACCES') return piped
  return runHookWithFiles(args, input, env)
}

const payload = {
  session_id: 'sess-1',
  turn_id: 'turn-1',
  cwd: 'D:/work/huanghao/dsh-hoos',
  hook_event_name: 'agent/pre-step',
  model: 'test-model',
  permission_mode: 'default',
  prompt: 'hello from the self-test',
}

const logDir = mkdtempSync(join(tmpdir(), 'dsh-hooks-echo-'))
const logFile = join(logDir, 'echo.log')
const hookEnv = { HOOK_ECHO_LOG: logFile }

try {
  const echoRun = await runHook([], JSON.stringify(payload), hookEnv)

  test('echo/stdin 收到 JSON payload', () => {
    assertEqual(echoRun.exitCode, 0, 'exit code')
    const log = JSON.parse(readFileSync(logFile, 'utf8').trim().split('\n')[0])
    assertEqual(log.parsedStdin.prompt, 'hello from the self-test', 'prompt seen by the hook')
    assertEqual(log.parsedStdin.hook_event_name, 'agent/pre-step', 'event name seen by the hook')
    return 'payload delivered on stdin'
  })

  test('echo/stdout 的 JSON 被解析成 additionalContext', () => {
    const parsed = spec.parseHookOutput(echoRun.stdout, { eventName: 'agent/pre-step' })
    assert(parsed !== null, `stdout is not valid hook JSON: ${echoRun.stdout}`)
    assert(parsed.additionalContext.includes('agent/pre-step'), 'additionalContext mentions the event')
    assert(parsed.additionalContext.includes('hello from the self-test'), 'additionalContext echoes the prompt')
    return 'additionalContext parsed'
  })

  test('echo/exit 0 被判为成功', () => {
    const result = spec.classifyRun(echoRun, { eventName: 'agent/pre-step' })
    assertEqual(result.status, 'ok', 'status')
    return 'ok'
  })

  const blockRun = await runHook(["--block"], JSON.stringify(payload), hookEnv)

  test('echo/exit 2 阻断，stderr 给出原因', () => {
    assertEqual(blockRun.exitCode, 2, 'exit code')
    const result = spec.classifyRun(blockRun, { eventName: 'agent/pre-step' })
    assertEqual(result.status, 'blocked', 'status')
    assert(/blocked/.test(result.reason), 'reason text')
    return result.reason
  })

  const decisionRun = await runHook(["--decision-block"], JSON.stringify(payload), hookEnv)

  test('echo/stdout 的 decision:block 也判为阻断', () => {
    assertEqual(decisionRun.exitCode, 0, 'exit code')
    const result = spec.classifyRun(decisionRun, { eventName: 'agent/pre-step' })
    assertEqual(result.status, 'blocked', 'status')
    assert(/blocked/.test(result.reason), 'reason text')
    return 'blocked via JSON'
  })

  const plainRun = await runHook(["--plain"], JSON.stringify(payload), hookEnv)

  test('echo/纯文本 stdout 当作 additionalContext', () => {
    const result = spec.classifyRun(plainRun, { eventName: 'agent/pre-step' })
    assertEqual(result.status, 'ok', 'status')
    assert(result.additionalContext.includes('agent/pre-step'), 'additionalContext')
    return 'ok'
  })

  const failRun = await runHook(["--fail"], JSON.stringify(payload), hookEnv)

  test('echo/其他退出码判为失败', () => {
    const result = spec.classifyRun(failRun, { eventName: 'agent/pre-step' })
    assertEqual(result.status, 'failed', 'status')
    return 'failed'
  })
} finally {
  rmSync(logDir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// G. 运行记录（lib/runs.js）：计数、环形上限、/hooks 文本
// ---------------------------------------------------------------------------
section('G. 运行记录与 /hooks 文本（lib/runs.js）')
{
  const runs = await import(pathToFileURL(join(ROOT, 'lib', 'runs.js')).href)

  test('runs/计数：ok、blocked、failed 分项', () => {
    const stats = runs.summarize([
      { status: 'ok' },
      { status: 'blocked' },
      { status: 'failed' },
      { status: 'blocked' },
      { status: 'skipped' },
    ])
    assertEqual(stats.runs, 5, 'runs')
    assertEqual(stats.blocked, 2, 'blocked')
    assertEqual(stats.failed, 1, 'failed')
    return '2 blocked / 1 failed'
  })

  test('runs/history 最多保留 50 行', () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({ status: 'ok', index }))
    assertEqual(runs.summarize(rows).history.length, 50, 'history length')
    return '50'
  })

  test('runs/环形缓冲：超出上限丢最旧的，最新在前', () => {
    const log = runs.createRunLog({ limit: 3 })
    const ctx = { sessionId: 's1', turnKey: 's1#1', agentId: 'a1' }
    log.record('agent/pre-step', [{ key: 'a', status: 'ok' }], ctx)
    log.record('agent/turn-stopping', [{ key: 'b', status: 'failed' }], ctx)
    log.record('SessionStart', [{ key: 'c', status: 'blocked' }], ctx)
    log.record('tools/pre-execute', [{ key: 'd', status: 'ok' }], ctx)
    const stats = log.stats()
    assertEqual(stats.runs, 3, 'runs')
    assertEqual(stats.history[0].key, 'd', 'newest first')
    assertEqual(stats.history.at(-1).key, 'b', 'oldest dropped')
    assertEqual(stats.blocked, 1, 'blocked counter')
    return 'trimmed to 3'
  })

  test('runs/turn 作用域：stats() 只读当前轮，session 给累计', () => {
    const log = runs.createRunLog({ limit: 50 })
    const t1 = { sessionId: 's1', turnKey: 's1#1' }
    const t2 = { sessionId: 's1', turnKey: 's1#2' }
    log.record('agent/pre-step', [{ key: 'a', status: 'ok' }], t1)
    log.record('agent/pre-step', [{ key: 'b', status: 'blocked' }], t2)
    log.record('agent/turn-stopping', [{ key: 'c', status: 'ok' }], t2)

    const current = log.stats()
    assertEqual(current.scope, 'turn', 'scope')
    assertEqual(current.turn, 's1#2', 'current turn is the newest')
    assertEqual(current.runs, 2, 'current turn runs')
    assertEqual(current.blocked, 1, 'current turn blocked')
    assertEqual(current.session.runs, 3, 'session totals stay cumulative')
    assertEqual(current.turns.length, 2, 'turn index')

    const older = log.stats({ turn: 's1#1' })
    assertEqual(older.runs, 1, 'older turn runs')
    assertEqual(older.history[0].key, 'a', 'older turn row')

    // A turn this log never saw must read as itself and empty: answering with
    // another turn's numbers is exactly the bug the user hit (a turn whose hooks
    // were untrusted showed the previous turn's nine runs).
    const unknown = log.stats({ turn: 's1#99' })
    assertEqual(unknown.requested, 's1#99', 'request echoed back')
    assertEqual(unknown.resolved, 'missing', 'reported as missing')
    assertEqual(unknown.turn, 's1#99', 'answered for the turn that was asked about')
    assertEqual(unknown.runs, 0, 'and it carries no borrowed runs')
    assertEqual(unknown.history.length, 0, 'no borrowed rows')
    assertEqual(unknown.session.runs, 3, 'session totals still available')

    // The message action row only knows the turn's number, not its key, so a
    // bare label must resolve to that turn instead of falling back.
    const byLabel = log.stats({ turn: '1' })
    assertEqual(byLabel.requested, '1', 'label echoed back as requested')
    assertEqual(byLabel.turn, 's1#1', 'a bare label resolves to its turn key')
    assertEqual(byLabel.runs, 1, 'label-scoped runs')
    return 'turn-scoped'
  })

  test('runs/会话隔离：新会话不显示上个会话的轮次', () => {
    const log = runs.createRunLog({ limit: 50 })
    log.record('agent/pre-step', [{ key: 'a', status: 'ok' }], { sessionId: 'session-A', turnKey: 'session-A#1' })
    log.record('agent/pre-step', [{ key: 'b', status: 'ok' }], { sessionId: 'session-B', turnKey: 'session-B#1' })

    const stats = log.stats()
    assertEqual(stats.sessionId, 'session-B', 'reads the newest session')
    assertEqual(stats.turns.length, 1, 'only this session turns')
    assertEqual(stats.turns[0].turn, 'session-B#1', 'turn belongs to this session')
    assertEqual(stats.session.runs, 1, 'session totals are per session')

    const other = log.stats({ sessionId: 'session-A' })
    assertEqual(other.turn, 'session-A#1', 'explicit session')
    assertEqual(other.runs, 1, 'explicit session runs')
    return 'session-B'
  })

  test('runs/start-finish：运行中可见，完成后落位', () => {
    const log = runs.createRunLog({ limit: 50 })
    const ctx = { sessionId: 's1', turnKey: 's1#7' }
    const hook = { key: 'k', group: 'config', groupLabel: 'From Config', sourceLabel: 'hooks.json', sourcePath: 'C:/x/hooks.json' }
    const rowId = log.start('agent/pre-step', hook, ctx)
    let stats = log.stats()
    assertEqual(stats.running, 1, 'running row counted')
    assertEqual(stats.history[0].status, 'running', 'running status')
    assertEqual(stats.history[0].turn, 's1#7', 'row carries the turn')

    log.finish(rowId, 'agent/pre-step', { key: 'k', status: 'blocked', reason: 'nope', durationMs: 9 }, ctx)
    stats = log.stats()
    assertEqual(stats.running, 0, 'no longer running')
    assertEqual(stats.history[0].status, 'blocked', 'finished status')
    assertEqual(stats.history[0].reason, 'nope', 'reason kept')
    assertEqual(stats.history[0].durationMs, 9, 'duration kept')
    return 'running -> blocked'
  })

  test('runs/turnLabel：取 # 后面的轮次号', () => {
    assertEqual(runs.turnLabel('s1#3'), '3', 'session#turn')
    assertEqual(runs.turnLabel('3'), '3', 'bare number')
    assertEqual(runs.turnLabel(null), '', 'null')
    return '3'
  })

  test('runs/无轮次的事件跟当前标记的轮走，不猜日志里最新的一轮', () => {
    const log = runs.createRunLog({ limit: 50 })
    // 轮 3 跑过钩子，轮 4 没有；工具类 seam 不带轮次，只能靠 markTurn 学到的当前轮。
    log.record('agent/pre-step', [{ key: 'a', status: 'ok' }], { sessionId: 's1', turnKey: 's1#3' })
    log.markTurn('s1', 's1#4')
    log.record('tools/pre-execute', [{ key: 'b', status: 'ok' }], { sessionId: 's1' })

    const stats = log.stats()
    assertEqual(stats.turn, 's1#4', 'current turn comes from markTurn')
    assertEqual(stats.runs, 1, 'the tool run lands in the marked turn, not the newest logged one')
    assertEqual(stats.session.runs, 2, 'session totals')

    // 没有标记过轮次的会话：宁可只进会话累计，也不塞进别人的轮。
    const bare = runs.createRunLog({ limit: 50 })
    bare.record('session/disposed', [{ key: 'c', status: 'ok' }], { sessionId: 's2' })
    const unmarked = bare.stats()
    assertEqual(unmarked.turn, null, 'no turn to attribute')
    assertEqual(unmarked.session.runs, 1, 'session totals keep the row')
    return 'marked turn'
  })

  test('runs/没跑钩子的那一轮：显示它自己的 0，不借用别的轮的数字', () => {
    const log = runs.createRunLog({ limit: 50 })
    log.record('agent/pre-step', [{ key: 'a', status: 'ok' }], { sessionId: 's1', turnKey: 's1#1' })
    // 轮 2 一个钩子都没跑（都被拒绝信任），但它是真实存在的一轮。
    log.markTurn('s1', 's1#2')

    const stats = log.stats({ turn: '2' })
    assertEqual(stats.turn, 's1#2', 'the requested turn is answered')
    assertEqual(stats.runs, 0, 'and it has no runs of its own')
    assertEqual(stats.resolved, 'exact', 'found by number, not by distance')
    assertEqual(stats.session.runs, 1, 'session totals still count the earlier run')
    const listed = stats.turns.find((entry) => entry.turn === 's1#2')
    assertEqual(listed?.runs ?? null, 0, 'the empty turn is listed')
    return 'turn 2 with zero runs'
  })

  test('runs/宿主重启后轮次编号对不上：按距离对齐到正确的那一轮', () => {
    const log = runs.createRunLog({ limit: 50 })
    // The host restarted, so its own counter starts over at 1 and 2 while the
    // conversation keeps numbering: the dialog asks about turn 74, the host only
    // knows turns 1 and 2.
    log.record('agent/pre-step', [{ key: 'a', status: 'ok' }], { sessionId: 's1', turnKey: 's1#1' })
    log.record('agent/pre-step', [{ key: 'b', status: 'ok' }], { sessionId: 's1', turnKey: 's1#2' })

    const newest = log.stats({ turn: '74', delta: 0 })
    assertEqual(newest.resolved, 'offset', 'resolved by distance')
    assertEqual(newest.turn, 's1#2', 'distance 0 is the newest turn')
    assertEqual(newest.runs, 1, 'and it shows that turn only')

    const previous = log.stats({ turn: '73', delta: 1 })
    assertEqual(previous.turn, 's1#1', 'distance 1 is the turn before it')
    assertEqual(previous.runs, 1, 'with its own runs')

    const beyond = log.stats({ turn: '40', delta: 9 })
    assertEqual(beyond.resolved, 'missing', 'a turn further back than the log goes is missing')
    assertEqual(beyond.runs, 0, 'and stays empty')
    return 'offset'
  })

  test('runs/日志里没有的那一轮：空着，不拿别人的数字顶替', () => {
    const log = runs.createRunLog({ limit: 50 })
    log.record('agent/pre-step', [{ key: 'a', status: 'ok' }], { sessionId: 's1', turnKey: 's1#1' })

    const stats = log.stats({ turn: '99' })
    assertEqual(stats.requested, '99', 'the request is echoed back')
    assertEqual(stats.resolved, 'missing', 'reported as missing')
    assertEqual(stats.turn, '99', 'answered for the turn that was asked about')
    assertEqual(stats.runs, 0, 'nothing borrowed from the newest turn')
    assertEqual(stats.label, '99', 'the label is the turn that was asked about')
    return 'missing'
  })

  test('runs/标题优先 statusMessage，其次命令名，最后 key', () => {
    assertEqual(
      runs.hookTitle({ statusMessage: 'lint gate', handler: { command: 'C:/bin/echo-hook.mjs' } }),
      'lint gate',
      'statusMessage wins',
    )
    assertEqual(runs.hookTitle({ handler: { command: 'C:\\tools\\echo-hook.mjs' } }), 'echo-hook', 'basename')
    assertEqual(runs.hookTitle({ key: 'k' }), 'k', 'key fallback')
    return 'echo-hook'
  })

  test('runs//hooks 文本：总数、信任、待审核清单与运行计数', () => {
    const text = runs.hooksCommandText({
      hooks: [
        { eventName: 'agent/pre-step', key: 'a', trust: 'Trusted', enabled: true, group: 'config', sourceLabel: 'hooks.json', handler: { command: 'echo-hook.mjs' } },
        { eventName: 'agent/turn-stopping', key: 'b', trust: 'Untrusted', enabled: true, group: 'projects', sourceLabel: 'D:/w/.dsh/hooks.json', handler: { command: 'stop.mjs' } },
        { eventName: 'SessionStart', key: 'c', trust: 'Trusted', enabled: false, group: 'config', sourceLabel: 'hooks.json' },
      ],
      stats: {
        turn: 's1#2',
        runs: 1,
        blocked: 0,
        failed: 0,
        history: [],
        turns: [],
        session: {
          runs: 2,
          blocked: 1,
          failed: 0,
          history: [
            { eventName: 'agent/pre-step', title: 'echo-hook', sourceLabel: 'hooks.json', status: 'blocked', durationMs: 12, reason: 'nope', turn: 's1#2' },
            { eventName: 'agent/turn-stopping', title: 'stop', source: 'projects', status: 'ok', durationMs: 3, turn: 's1#1' },
          ],
        },
      },
    })
    assert(/3 total/.test(text), `total missing: ${text}`)
    assert(/2 trusted/.test(text), 'trusted count')
    assert(/1 needs review/.test(text), 'review count')
    assert(/1 disabled/.test(text), 'disabled count')
    assert(/Needs review:[\s\S]*agent\/turn-stopping/.test(text), 'review list')
    assert(/2 runs · 1 blocked · 0 failed/.test(text), 'run counters')
    assert(/✕ agent\/pre-step/.test(text), 'blocked row mark')
    return 'ok'
  })

  test('runs//hooks 文本：空目录给出提示而不是空白', () => {
    const text = runs.hooksCommandText({ hooks: [], stats: { runs: 0, blocked: 0, failed: 0, history: [], session: { runs: 0, blocked: 0, failed: 0, history: [] } } })
    assert(/No hooks found/.test(text), text)
    return 'hint'
  })

  test('runs/事件行：按事件聚合，计数生效钩子与待审核数', () => {
    const rows = runs.eventRows([
      { eventName: 'agent/turn-stopping', trust: 'Trusted', enabled: true, runnable: true },
      { eventName: 'agent/pre-step', trust: 'Untrusted', enabled: true, runnable: false },
      { eventName: 'agent/pre-step', trust: 'Modified', enabled: true, runnable: false },
      { eventName: 'agent/pre-step', trust: 'Trusted', enabled: false, runnable: false },
    ])
    assertEqual(rows.length, 2, 'event count')
    // 事件顺序按 EVENT_ORDER：agent/pre-step 在 agent/turn-stopping 之前
    assertEqual(rows[0].eventName, 'agent/pre-step', 'first event')
    assertEqual(rows[0].installed, 3, 'installed')
    assertEqual(rows[0].active, 0, 'active')
    assertEqual(rows[0].needsReview, 2, 'needsReview')
    assertEqual(rows[1].eventName, 'agent/turn-stopping', 'second event')
    assertEqual(rows[1].active, 1, 'active')
    assertEqual(rows[1].needsReview, 0, 'needsReview')
    return '2 events'
  })

  test('runs/事件行：没有钩子时返回空数组', () => {
    assertEqual(runs.eventRows([]).length, 0, 'empty')
    assertEqual(runs.eventRows(undefined).length, 0, 'undefined')
    return 'empty'
  })
}

// ---------------------------------------------------------------------------
// H. 客户端 bundle（client.js）：审核卡片、事件列表、处理器列表、远程调用
// ---------------------------------------------------------------------------
section('H. 客户端 bundle 渲染（test/client-bundle.mjs）')
for (const item of await runClientBundleCheck()) {
  record(item.status, item.name, item.detail)
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------
const passed = results.filter((r) => r.status === 'PASS').length
const failed = results.filter((r) => r.status === 'FAIL')
const skipped = results.filter((r) => r.status === 'SKIP').length

process.stdout.write(`\n---\n${passed} passed, ${failed.length} failed, ${skipped} skipped\n`)
if (failed.length > 0) {
  process.stdout.write('\nFAILURES:\n')
  for (const item of failed) process.stdout.write(`  - [${item.section}] ${item.name}: ${item.detail}\n`)
  process.exit(1)
}
process.exit(0)
