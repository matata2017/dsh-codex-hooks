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
 *   A  信任哈希 — 8 real CODEX vectors (read back from the installed Codex CLI state file)
 *   B  hooks.json 解析 — schema, normalization, timeout / additionalContextLimit rules
 *   C  matcher — '*' / 精确 / '|' 多选 / 正则
 *   D  状态文件读写 + 四种信任状态
 *   E  hook 输出 JSON 解析 + 退出码语义
 *   F  examples/echo-hook.mjs 端到端（stdin → stdout → exit 2）
 *   G  插件一致性探针 — 对照 lib/core.js（未实现时 SKIP）
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, openSync, closeSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import * as spec from './spec.mjs'
import { runConformance, runConformanceSelfTest } from './plugin-conformance.mjs'
import { runClientBundleCheck } from './client-bundle.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const ECHO_HOOK = join(ROOT, 'examples', 'echo-hook.mjs')
const QUIET = process.argv.includes('--quiet')

const vectors = JSON.parse(readFileSync(join(HERE, 'vectors.json'), 'utf8'))

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
// A. 信任哈希：与真实 CODEX 向量逐条比对
// ---------------------------------------------------------------------------
section('A. 信任哈希 vs 真实 CODEX 向量')
for (const vector of vectors.hashVectors) {
  test(`hash/${vector.name}`, () => {
    const actual = spec.hookHash({
      eventName: vector.event,
      matcher: vector.matcher,
      handler: vector.handler,
      platform: vector.platform,
    })
    assertEqual(actual, vector.trustedHash, `hash mismatch for ${vector.name}`)
    return actual
  })
}

test('hash/负控：改一个字符即变哈希', () => {
  const vector = vectors.hashVectors[0]
  // mutate the field the platform actually uses, otherwise the change is invisible
  const key = vector.platform === 'win32' && vector.handler.commandWindows ? 'commandWindows' : 'command'
  const mutated = { ...vector.handler, [key]: `${vector.handler[key]} ` }
  const original = spec.hookHash({
    eventName: vector.event,
    matcher: vector.matcher,
    handler: vector.handler,
    platform: vector.platform,
  })
  const changed = spec.hookHash({
    eventName: vector.event,
    matcher: vector.matcher,
    handler: mutated,
    platform: vector.platform,
  })
  assert(original !== changed, `mutating ${key} produced the same hash`)
  return `mutation of ${key} detected`
})

test('hash/负控：平台影响 commandWindows 选择', () => {
  const withWindows = vectors.hashVectors.find((v) => v.handler.commandWindows)
  assert(withWindows, 'no vector with commandWindows')
  const win = spec.hookHash({
    eventName: withWindows.event,
    matcher: withWindows.matcher,
    handler: withWindows.handler,
    platform: 'win32',
  })
  const linux = spec.hookHash({
    eventName: withWindows.event,
    matcher: withWindows.matcher,
    handler: withWindows.handler,
    platform: 'linux',
  })
  assert(win !== linux, 'commandWindows was ignored on win32')
  return 'win32 != linux'
})

test('hash/负控：matcher 参与哈希', () => {
  const vector = vectors.hashVectors.find((v) => v.matcher)
  assert(vector, 'no vector with a matcher')
  const withMatcher = spec.hookHash({
    eventName: vector.event,
    matcher: vector.matcher,
    handler: vector.handler,
    platform: vector.platform,
  })
  const withoutMatcher = spec.hookHash({
    eventName: vector.event,
    matcher: null,
    handler: vector.handler,
    platform: vector.platform,
  })
  assert(withMatcher !== withoutMatcher, 'matcher did not change the hash')
  return 'matcher is part of the identity'
})

test('state-key/格式 <path>:<event>:<group>:<handler>', () => {
  const key = spec.hookStateKey('C:\\Users\\Admin\\.codex\\hooks.json', 'UserPromptSubmit', 0, 0)
  assertEqual(key, 'C:\\Users\\Admin\\.codex\\hooks.json:user_prompt_submit:0:0', 'state key format')
  const vector = vectors.hashVectors[0]
  assertEqual(vector.stateKey, key, 'vector state key mismatch')
  return key
})

// ---------------------------------------------------------------------------
// B. hooks.json 解析
// ---------------------------------------------------------------------------
section('B. hooks.json 解析')

const validDoc = {
  description: 'demo',
  hooks: {
    PreToolUse: [
      {
        matcher: '^Bash$',
        hooks: [
          {
            type: 'command',
            command: 'python3 /tmp/pre.py',
            timeout: 10,
            statusMessage: 'checking',
            additionalContextLimit: 4096,
          },
        ],
      },
    ],
  },
}

test('parse/合法文件（codex-rs/config/src/hooks_tests.rs 向量）', () => {
  const parsed = spec.parseHooksFile(JSON.stringify(validDoc))
  assertEqual(parsed.description, 'demo', 'description')
  const group = parsed.events.PreToolUse[0]
  assertEqual(group.matcher, '^Bash$', 'matcher')
  assertEqual(group.hooks.length, 1, 'handler count')
  assertEqual(group.hooks[0].command, 'python3 /tmp/pre.py', 'command')
  assertEqual(group.hooks[0].timeout, 10, 'timeout')
  assertEqual(group.hooks[0].statusMessage, 'checking', 'statusMessage')
  return 'ok'
})

test('parse/顶层事件键被拒绝（unknown field `PreToolUse`）', () => {
  assertThrows(
    () => spec.parseHooksFile(JSON.stringify({ PreToolUse: validDoc.hooks.PreToolUse })),
    'top-level event key must be rejected',
    /unknown field/,
  )
  return 'rejected'
})

test('parse/未知事件名被拒绝', () => {
  assertThrows(
    () => spec.parseHooksFile(JSON.stringify({ hooks: { NotAnEvent: [] } })),
    'unknown event must be rejected',
    /unknown field/,
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
    () => spec.parseHooksFile(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'wat' }] }] } })),
    'unknown handler type must be rejected',
    /must be one of/,
  )
  return 'rejected'
})

test('parse/command handler 缺 command 被拒绝', () => {
  assertThrows(
    () => spec.parseHooksFile(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command' }] }] } })),
    'command handler without command must be rejected',
    /command/,
  )
  return 'rejected'
})

test('parse/mcp_tool handler 缺 server 被拒绝', () => {
  assertThrows(
    () => spec.parseHooksFile(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'mcp_tool', tool: 'x' }] }] } })),
    'mcp_tool handler without server must be rejected',
    /server/,
  )
  return 'rejected'
})

test('normalize/timeout 默认 600', () => {
  const handler = spec.normalizeHandler({ type: 'command', command: 'x' }, { eventName: 'PreToolUse' })
  assertEqual(handler.timeout, 600, 'default timeout')
  return '600'
})

test('normalize/timeout 下限 1', () => {
  const handler = spec.normalizeHandler({ type: 'command', command: 'x', timeout: 0 }, { eventName: 'PreToolUse' })
  assertEqual(handler.timeout, 1, 'timeout floor')
  return '1'
})

test('normalize/SessionEnd timeout 夹到 [1,3]', () => {
  const high = spec.normalizeHandler({ type: 'command', command: 'x', timeout: 60 }, { eventName: 'SessionEnd' })
  assertEqual(high.timeout, 3, 'SessionEnd upper clamp')
  const low = spec.normalizeHandler({ type: 'command', command: 'x', timeout: 0 }, { eventName: 'SessionEnd' })
  assertEqual(low.timeout, 1, 'SessionEnd lower clamp')
  const none = spec.normalizeHandler({ type: 'command', command: 'x' }, { eventName: 'SessionEnd' })
  assertEqual(none.timeout, 1, 'SessionEnd default')
  return '1..3'
})

test('normalize/Interrupt timeout 夹到 [1,3]', () => {
  const handler = spec.normalizeHandler({ type: 'command', command: 'x', timeout: 30 }, { eventName: 'Interrupt' })
  assertEqual(handler.timeout, 3, 'Interrupt clamp')
  return '3'
})

test('normalize/additionalContextLimit=2500 被丢弃', () => {
  const handler = spec.normalizeHandler(
    { type: 'command', command: 'x', additionalContextLimit: 2500 },
    { eventName: 'PreToolUse' },
  )
  assert(!('additionalContextLimit' in handler), '2500 must be dropped')
  return 'dropped'
})

test('normalize/additionalContextLimit=4096 在允许的事件里保留', () => {
  const handler = spec.normalizeHandler(
    { type: 'command', command: 'x', additionalContextLimit: 4096 },
    { eventName: 'PreToolUse' },
  )
  assertEqual(handler.additionalContextLimit, 4096, 'limit kept')
  return '4096'
})

test('normalize/additionalContextLimit 在非允许事件里丢弃', () => {
  const handler = spec.normalizeHandler(
    { type: 'command', command: 'x', additionalContextLimit: 4096 },
    { eventName: 'Stop' },
  )
  assert(!('additionalContextLimit' in handler), 'limit must be dropped for Stop')
  return 'dropped'
})

test('normalize/win32 优先 commandWindows', () => {
  const handler = spec.normalizeHandler(
    { type: 'command', command: 'node a.js', commandWindows: 'node.exe a.js' },
    { eventName: 'PreToolUse', platform: 'win32' },
  )
  assertEqual(handler.command, 'node.exe a.js', 'win32 command')
  const linux = spec.normalizeHandler(
    { type: 'command', command: 'node a.js', commandWindows: 'node.exe a.js' },
    { eventName: 'PreToolUse', platform: 'linux' },
  )
  assertEqual(linux.command, 'node a.js', 'linux command')
  return 'win32 uses commandWindows'
})

test('normalize/prompt 与 agent 类型不产生哈希', () => {
  assertEqual(spec.normalizeHandler({ type: 'prompt' }, { eventName: 'PreToolUse' }), null, 'prompt')
  assertEqual(spec.normalizeHandler({ type: 'agent' }, { eventName: 'PreToolUse' }), null, 'agent')
  return 'skipped like CODEX'
})

test('describe/遍历顺序与 state key', () => {
  const parsed = spec.parseHooksFile(
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'a' }, { type: 'command', command: 'b' }] }],
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'c' }] }],
      },
    }),
  )
  const entries = spec.describeHooks(parsed, { sourceKey: 'C:/x/hooks.json', platform: 'linux' })
  assertEqual(entries.length, 3, 'entry count')
  assertEqual(entries[0].key, 'C:/x/hooks.json:pre_tool_use:0:0', 'first key')
  assertEqual(entries[1].key, 'C:/x/hooks.json:stop:0:0', 'second key')
  assertEqual(entries[2].key, 'C:/x/hooks.json:stop:0:1', 'third key')
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

test('matcher/非 matcher 事件强制 All', () => {
  const compiled = spec.compileMatcher('Bash')
  assertEqual(compiled.kind, 'exact', 'classification')
  assert(spec.MATCHER_EVENTS.has('PreToolUse'), 'PreToolUse supports matcher')
  assert(!spec.MATCHER_EVENTS.has('UserPromptSubmit'), 'UserPromptSubmit has no matcher')
  assert(!spec.MATCHER_EVENTS.has('Stop'), 'Stop has no matcher')
  assertEqual(spec.MATCHER_EVENTS.size, 9, '9 events support a matcher')
  return '9 matcher events'
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
    { eventName: 'Stop' },
  )
  assertEqual(parsed.continue, false, 'continue')
  assertEqual(parsed.stopReason, 'stopped by hook', 'stopReason')
  assertEqual(parsed.systemMessage, 'heads up', 'systemMessage')
  assertEqual(parsed.suppressOutput, true, 'suppressOutput')
  return 'ok'
})

test('output/缺省值 continue=true suppressOutput=false', () => {
  const parsed = spec.parseHookOutput('{}', { eventName: 'Stop' })
  assertEqual(parsed.continue, true, 'default continue')
  assertEqual(parsed.suppressOutput, false, 'default suppressOutput')
  assertEqual(parsed.decision, null, 'default decision')
  return 'ok'
})

test('output/decision=block 必须带非空 reason', () => {
  const good = spec.parseHookOutput(JSON.stringify({ decision: 'block', reason: 'nope' }), { eventName: 'PreToolUse' })
  assertEqual(good.decision, 'block', 'decision')
  assertEqual(good.invalidReason, null, 'no invalid reason')
  const bad = spec.parseHookOutput(JSON.stringify({ decision: 'block' }), { eventName: 'PreToolUse' })
  assert(bad.invalidReason && /non-empty reason/.test(bad.invalidReason), 'missing reason must be flagged')
  return 'ok'
})

test('output/未知字段 → 解析失败', () => {
  assertEqual(spec.parseHookOutput(JSON.stringify({ nope: 1 }), { eventName: 'Stop' }), null, 'unknown field')
  return 'null'
})

test('output/按事件限定字段（Stop 不接受 hookSpecificOutput）', () => {
  const withSpecific = JSON.stringify({
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'x' },
  })
  assertEqual(spec.parseHookOutput(withSpecific, { eventName: 'Stop' }), null, 'Stop rejects hookSpecificOutput')
  const userPrompt = spec.parseHookOutput(withSpecific, { eventName: 'UserPromptSubmit' })
  assert(userPrompt !== null, 'UserPromptSubmit accepts hookSpecificOutput')
  assertEqual(userPrompt.additionalContext, 'x', 'additionalContext')
  return 'ok'
})

test('output/hookSpecificOutput 必须带 hookEventName', () => {
  const parsed = spec.parseHookOutput(
    JSON.stringify({ hookSpecificOutput: { additionalContext: 'x' } }),
    { eventName: 'UserPromptSubmit' },
  )
  assertEqual(parsed, null, 'missing hookEventName')
  return 'null'
})

test('output/additionalContext 必须是字符串', () => {
  const parsed = spec.parseHookOutput(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 42 } }),
    { eventName: 'UserPromptSubmit' },
  )
  assertEqual(parsed, null, 'non-string additionalContext')
  return 'null'
})

test('output/Interrupt 只接受 systemMessage', () => {
  assertEqual(spec.parseHookOutput(JSON.stringify({ continue: true }), { eventName: 'Interrupt' }), null, 'continue rejected')
  const ok = spec.parseHookOutput(JSON.stringify({ systemMessage: 'hi' }), { eventName: 'Interrupt' })
  assertEqual(ok.systemMessage, 'hi', 'systemMessage')
  return 'ok'
})

test('run/exit 0 + 空 stdout → 成功无操作', () => {
  const result = spec.classifyRun({ exitCode: 0, stdout: '', stderr: '' }, { eventName: 'Stop' })
  assertEqual(result.status, 'ok', 'status')
  assertEqual(result.output, null, 'no output')
  return 'ok'
})

test('run/exit 0 + 纯文本 → 当作 additionalContext', () => {
  const result = spec.classifyRun({ exitCode: 0, stdout: 'hello context', stderr: '' }, { eventName: 'Stop' })
  assertEqual(result.status, 'ok', 'status')
  assertEqual(result.additionalContext, 'hello context', 'additionalContext')
  return 'ok'
})

test('run/exit 0 + JSON → 按 schema 解析', () => {
  const result = spec.classifyRun(
    { exitCode: 0, stdout: JSON.stringify({ systemMessage: 'warn' }), stderr: '' },
    { eventName: 'Stop' },
  )
  assertEqual(result.status, 'ok', 'status')
  assertEqual(result.output.systemMessage, 'warn', 'systemMessage')
  return 'ok'
})

test('run/exit 0 + 非法 JSON → 失败', () => {
  const result = spec.classifyRun({ exitCode: 0, stdout: '{"unknown":1}', stderr: '' }, { eventName: 'Stop' })
  assertEqual(result.status, 'failed', 'status')
  assert(/invalid/.test(result.error), 'error mentions invalid output')
  return 'failed'
})

test('run/exit 2 + stderr 有内容 → 阻断', () => {
  const result = spec.classifyRun({ exitCode: 2, stdout: '', stderr: 'do not commit' }, { eventName: 'PreToolUse' })
  assertEqual(result.status, 'blocked', 'status')
  assertEqual(result.reason, 'do not commit', 'reason')
  return 'blocked'
})

test('run/exit 2 + stderr 为空 → 失败', () => {
  const result = spec.classifyRun({ exitCode: 2, stdout: '', stderr: '  ' }, { eventName: 'PreToolUse' })
  assertEqual(result.status, 'failed', 'status')
  assert(/blocking reason/.test(result.error), 'error mentions missing reason')
  return 'failed'
})

test('run/其他退出码 → 失败', () => {
  const result = spec.classifyRun({ exitCode: 3, stdout: '', stderr: 'boom' }, { eventName: 'Stop' })
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
  hook_event_name: 'UserPromptSubmit',
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
    assertEqual(log.parsedStdin.hook_event_name, 'UserPromptSubmit', 'event name seen by the hook')
    return 'payload delivered on stdin'
  })

  test('echo/stdout 的 JSON 被解析成 additionalContext', () => {
    const parsed = spec.parseHookOutput(echoRun.stdout, { eventName: 'UserPromptSubmit' })
    assert(parsed !== null, `stdout is not valid hook JSON: ${echoRun.stdout}`)
    assert(parsed.additionalContext.includes('UserPromptSubmit'), 'additionalContext mentions the event')
    assert(parsed.additionalContext.includes('hello from the self-test'), 'additionalContext echoes the prompt')
    return 'additionalContext parsed'
  })

  test('echo/exit 0 被判为成功', () => {
    const result = spec.classifyRun(echoRun, { eventName: 'UserPromptSubmit' })
    assertEqual(result.status, 'ok', 'status')
    return 'ok'
  })

  const blockRun = await runHook(["--block"], JSON.stringify(payload), hookEnv)

  test('echo/exit 2 阻断，stderr 给出原因', () => {
    assertEqual(blockRun.exitCode, 2, 'exit code')
    const result = spec.classifyRun(blockRun, { eventName: 'UserPromptSubmit' })
    assertEqual(result.status, 'blocked', 'status')
    assert(/blocked/.test(result.reason), 'reason text')
    return result.reason
  })

  const decisionRun = await runHook(["--decision-block"], JSON.stringify(payload), hookEnv)

  test('echo/stdout 的 decision:block 也判为阻断', () => {
    assertEqual(decisionRun.exitCode, 0, 'exit code')
    const result = spec.classifyRun(decisionRun, { eventName: 'UserPromptSubmit' })
    assertEqual(result.status, 'blocked', 'status')
    assert(/blocked/.test(result.reason), 'reason text')
    return 'blocked via JSON'
  })

  const plainRun = await runHook(["--plain"], JSON.stringify(payload), hookEnv)

  test('echo/纯文本 stdout 当作 additionalContext', () => {
    const result = spec.classifyRun(plainRun, { eventName: 'UserPromptSubmit' })
    assertEqual(result.status, 'ok', 'status')
    assert(/UserPromptSubmit/.test(result.additionalContext), 'additionalContext')
    return 'ok'
  })

  const failRun = await runHook(["--fail"], JSON.stringify(payload), hookEnv)

  test('echo/其他退出码判为失败', () => {
    const result = spec.classifyRun(failRun, { eventName: 'UserPromptSubmit' })
    assertEqual(result.status, 'failed', 'status')
    return 'failed'
  })
} finally {
  rmSync(logDir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// G. 插件一致性探针
// ---------------------------------------------------------------------------
section('G. 插件一致性探针（lib/core.js）')
for (const item of await runConformance({ root: ROOT, spec, vectors })) {
  record(item.status, item.name, item.detail)
}

section('H. 探针自检（证明探针本身能抓错）')
for (const item of await runConformanceSelfTest({ spec, vectors })) {
  record(item.status, item.name, item.detail)
}

// ---------------------------------------------------------------------------
// I. 运行记录（lib/runs.js）：计数、环形上限、/hooks 文本
// ---------------------------------------------------------------------------
section('I. 运行记录与 /hooks 文本（lib/runs.js）')
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
    log.record('UserPromptSubmit', [{ key: 'a', status: 'ok' }])
    log.record('Stop', [{ key: 'b', status: 'failed' }])
    log.record('SessionStart', [{ key: 'c', status: 'blocked' }])
    log.record('PreToolUse', [{ key: 'd', status: 'ok' }])
    const stats = log.stats()
    assertEqual(stats.runs, 3, 'runs')
    assertEqual(stats.history[0].key, 'd', 'newest first')
    assertEqual(stats.history.at(-1).key, 'b', 'oldest dropped')
    assertEqual(stats.blocked, 1, 'blocked counter')
    return 'trimmed to 3'
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
        { eventName: 'UserPromptSubmit', key: 'a', trust: 'Trusted', enabled: true, group: 'config', sourceLabel: 'hooks.json', handler: { command: 'echo-hook.mjs' } },
        { eventName: 'Stop', key: 'b', trust: 'Untrusted', enabled: true, group: 'projects', sourceLabel: 'D:/w/.dsh/hooks.json', handler: { command: 'stop.mjs' } },
        { eventName: 'SessionStart', key: 'c', trust: 'Trusted', enabled: false, group: 'config', sourceLabel: 'hooks.json' },
      ],
      stats: {
        runs: 2,
        blocked: 1,
        failed: 0,
        history: [
          { eventName: 'UserPromptSubmit', title: 'echo-hook', sourceLabel: 'hooks.json', status: 'blocked', durationMs: 12, reason: 'nope' },
          { eventName: 'Stop', title: 'stop', source: 'projects', status: 'ok', durationMs: 3 },
        ],
      },
    })
    assert(/3 total/.test(text), `total missing: ${text}`)
    assert(/2 trusted/.test(text), 'trusted count')
    assert(/1 needs review/.test(text), 'review count')
    assert(/1 disabled/.test(text), 'disabled count')
    assert(/Needs review:[\s\S]*Stop/.test(text), 'review list')
    assert(/2 runs · 1 blocked · 0 failed/.test(text), 'run counters')
    assert(/✕ UserPromptSubmit/.test(text), 'blocked row mark')
    return 'ok'
  })

  test('runs//hooks 文本：空目录给出提示而不是空白', () => {
    const text = runs.hooksCommandText({ hooks: [], stats: { runs: 0, blocked: 0, failed: 0, history: [] } })
    assert(/No hooks found/.test(text), text)
    return 'hint'
  })

  test('runs/事件行：按事件聚合，计数生效钩子与待审核数', () => {
    const rows = runs.eventRows([
      { eventName: 'Stop', trust: 'Trusted', enabled: true, runnable: true },
      { eventName: 'UserPromptSubmit', trust: 'Untrusted', enabled: true, runnable: false },
      { eventName: 'UserPromptSubmit', trust: 'Modified', enabled: true, runnable: false },
      { eventName: 'UserPromptSubmit', trust: 'Trusted', enabled: false, runnable: false },
    ])
    assertEqual(rows.length, 2, 'event count')
    // 事件顺序按 CODEX 事件表：UserPromptSubmit 在 Stop 之前
    assertEqual(rows[0].eventName, 'UserPromptSubmit', 'first event')
    assertEqual(rows[0].installed, 3, 'installed')
    assertEqual(rows[0].active, 0, 'active')
    assertEqual(rows[0].needsReview, 2, 'needsReview')
    assertEqual(rows[1].eventName, 'Stop', 'second event')
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
// J. 客户端 bundle（client.js）：审核卡片、事件列表、处理器列表、远程调用
// ---------------------------------------------------------------------------
section('J. 客户端 bundle 渲染（test/client-bundle.mjs）')
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
