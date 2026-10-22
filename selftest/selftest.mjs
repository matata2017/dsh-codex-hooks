/**
 * Minimal self check for @local/dsh-hooks.
 *
 *   node selftest/selftest.mjs
 *
 * Asserts the Codex compatible trust hash against the ground truth vectors
 * (CODEX produced them, see codex-rs/config/src/fingerprint.rs and the
 * codex-rs/hooks test module) plus the parsing / matcher / trust / state
 * behaviour of lib/core.js.
 *
 * The vector file lives in the QA owned `test/` directory and is only read.
 * When it is missing the embedded copy of the same vectors is used.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as core from '../lib/core.js'

const here = dirname(fileURLToPath(import.meta.url))
const vectorsPath = join(here, '..', 'test', 'vectors.json')

const EMBEDDED_VECTORS = [
  {
    name: 'codex-user-hooks-user_prompt_submit',
    event: 'UserPromptSubmit',
    matcher: null,
    platform: 'win32',
    handler: {
      type: 'command',
      command: 'node "C:/Users/Admin/.codex/hooks/memos-project-router.cjs" UserPromptSubmit',
      commandWindows: 'node.exe "C:/Users/Admin/.codex/hooks/memos-project-router.cjs" UserPromptSubmit',
      timeout: 60,
      statusMessage: 'Retrieving MemOS memory',
    },
    trustedHash: 'sha256:033537218e7596b56e5e13eb5544e723cfe4421302c4435f4e117016f78b8b10',
  },
  {
    name: 'codex-user-hooks-stop',
    event: 'Stop',
    matcher: null,
    platform: 'win32',
    handler: {
      type: 'command',
      command: 'node "C:/Users/Admin/.codex/hooks/memos-project-router.cjs" Stop',
      commandWindows: 'node.exe "C:/Users/Admin/.codex/hooks/memos-project-router.cjs" Stop',
      timeout: 60,
      statusMessage: 'Retrieving MemOS memory',
    },
    trustedHash: 'sha256:cfaf54cb72820ddac8105b679dfd4dd0d243806b49e7f54af5145e9dd0b2673f',
  },
]

let passed = 0
const failures = []

function check(name, run) {
  try {
    run()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

/* ---------------- fingerprint.rs test vector ---------------- */

console.log('fingerprint (codex-rs/config/src/fingerprint_tests.rs)')
check('version_for_toml vector', () => {
  const toml = { rows: [{ z: 2, a: 1 }, { z: 4, a: 3 }], nested: { z: 'text', a: true } }
  assert.equal(
    core.versionForText(core.stableJson(toml)),
    'sha256:a5e4c8fbdbc75d185b0f2b5291bfb2de10e8c523d6c89248876fd78a97c83176',
  )
})

/* ---------------- ground truth hook hashes ---------------- */

const vectors = existsSync(vectorsPath)
  ? JSON.parse(readFileSync(vectorsPath, 'utf8')).hashVectors ?? []
  : EMBEDDED_VECTORS

console.log(`\ntrust hashes (${vectors.length} vectors${existsSync(vectorsPath) ? ' from test/vectors.json' : ' embedded'})`)
for (const vector of vectors) {
  check(vector.name, () => {
    const hash = core.hookHash({
      eventName: vector.event,
      matcher: vector.matcher ?? null,
      handler: vector.handler,
      platform: vector.platform,
    })
    assert.equal(hash, vector.trustedHash)
    assert.match(hash, /^sha256:[0-9a-f]{64}$/)
  })
}

/* ---------------- parsing ---------------- */

console.log('\nhooks.json parsing')
const sample = {
  description: 'sample',
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo hi' }] }],
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo tool' }] }],
  },
}
check('parses events and matchers', () => {
  const parsed = core.parseHooksFile(JSON.stringify(sample))
  assert.equal(parsed.description, 'sample')
  assert.deepEqual(Object.keys(parsed.events).sort(), ['PreToolUse', 'UserPromptSubmit'])
  assert.equal(parsed.events.PreToolUse[0].matcher, '*')
  assert.equal(parsed.events.UserPromptSubmit[0].matcher, null)
})
check('rejects unknown top level fields', () => {
  assert.throws(() => core.parseHooksFile('{"nope":1}'), /unknown field `nope`/)
})
check('rejects unknown events', () => {
  assert.throws(() => core.parseHooksFile('{"hooks":{"Nope":[]}}'), /unknown field `Nope`/)
})
check('rejects invalid json', () => {
  assert.throws(() => core.parseHooksFile('{'), /hooks file is not valid JSON/)
})
check('describes one row per handler', () => {
  const parsed = core.parseHooksFile(JSON.stringify(sample))
  const rows = core.describeHooks(parsed, { sourceKey: 'C:/tmp/hooks.json', platform: 'linux' })
  assert.equal(rows.length, 2)
  // rows follow the CODEX registry order (PreToolUse before UserPromptSubmit)
  assert.equal(rows[0].key, 'C:/tmp/hooks.json:pre_tool_use:0:0')
  assert.equal(rows[1].key, 'C:/tmp/hooks.json:user_prompt_submit:0:0')
  assert.ok(rows.every((row) => /^sha256:[0-9a-f]{64}$/.test(row.hash)))
})

/* ---------------- matcher ---------------- */

console.log('\nmatcher')
check('matches like codex', () => {
  assert.equal(core.matchMatcher('*', 'Bash'), true)
  assert.equal(core.matchMatcher('Bash', 'Bash'), true)
  assert.equal(core.matchMatcher('Bash', 'bash'), false)
  assert.equal(core.matchMatcher('Bash|Read', 'Read'), true)
  assert.equal(core.matchMatcher('^Bash$', 'BashTool'), false)
})

/* ---------------- trust ---------------- */

console.log('\ntrust')
check('trust status', () => {
  const hash = 'sha256:abc'
  assert.equal(core.trustStatus({ currentHash: hash, trustedHash: hash }), 'Trusted')
  assert.equal(core.trustStatus({ currentHash: hash, trustedHash: 'sha256:other' }), 'Modified')
  assert.equal(core.trustStatus({ currentHash: hash, trustedHash: null }), 'Untrusted')
  assert.equal(core.trustStatus({ currentHash: hash, trustedHash: null, isManaged: true }), 'Managed')
})
check('only trusted and managed run', () => {
  assert.equal(core.isRunnable('Trusted'), true)
  assert.equal(core.isRunnable('Managed'), true)
  assert.equal(core.isRunnable('Modified'), false)
  assert.equal(core.isRunnable('Untrusted'), false)
})
check('enabled defaults to true', () => {
  assert.equal(core.hookEnabled({ state: null }), true)
  assert.equal(core.hookEnabled({ state: { enabled: false } }), false)
  assert.equal(core.hookEnabled({ state: { enabled: true } }), true)
})

/* ---------------- state file ---------------- */

console.log('\nstate file')
const tmp = mkdtempSync(join(tmpdir(), 'dsh-hooks-selftest-'))
const statePath = join(tmp, 'hooks.state.json')
check('writes and reads the state file', () => {
  core.writeStateFile(statePath, { states: { 'probe:stop:0:0': { enabled: false, trustedHash: 'sha256:probe' } } })
  const raw = JSON.parse(readFileSync(statePath, 'utf8'))
  assert.equal(raw.version, 1)
  assert.equal(raw.states['probe:stop:0:0'].enabled, false)
  assert.equal(raw.states['probe:stop:0:0'].trustedHash, 'sha256:probe')
  const state = core.readStateFile(statePath)
  assert.equal(core.stateFor(state, 'probe:stop:0:0').trustedHash, 'sha256:probe')
  assert.equal(core.stateFor(state, 'missing'), null)
})

/* ---------------- output parsing ---------------- */

console.log('\nhook output')
check('classifies a successful run', () => {
  const result = core.classifyRun({ exitCode: 0, stdout: '', stderr: '' }, { eventName: 'UserPromptSubmit' })
  assert.equal(result.status, 'ok')
})
check('classifies plain text as additional context', () => {
  const result = core.classifyRun({ exitCode: 0, stdout: '  hello  ', stderr: '' }, { eventName: 'UserPromptSubmit' })
  assert.equal(result.status, 'ok')
  assert.equal(result.additionalContext, 'hello')
})
check('classifies exit 2 with stderr as blocked', () => {
  const result = core.classifyRun({ exitCode: 2, stdout: '', stderr: 'nope' }, { eventName: 'UserPromptSubmit' })
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, 'nope')
})
check('classifies exit 2 without stderr as failed', () => {
  const result = core.classifyRun({ exitCode: 2, stdout: '', stderr: '' }, { eventName: 'UserPromptSubmit' })
  assert.equal(result.status, 'failed')
})
check('classifies other exit codes as failed', () => {
  const result = core.classifyRun({ exitCode: 3, stdout: '', stderr: 'boom' }, { eventName: 'UserPromptSubmit' })
  assert.equal(result.status, 'failed')
})
check('requires a reason for decision:block', () => {
  const result = core.classifyRun(
    { exitCode: 0, stdout: JSON.stringify({ decision: 'block' }), stderr: '' },
    { eventName: 'UserPromptSubmit' },
  )
  assert.equal(result.status, 'failed')
})
check('rejects unknown output fields', () => {
  assert.equal(core.parseHookOutput(JSON.stringify({ nope: 1 }), { eventName: 'UserPromptSubmit' }), null)
})
check('reads hookSpecificOutput', () => {
  const parsed = core.parseHookOutput(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'ctx' } }),
    { eventName: 'UserPromptSubmit' },
  )
  assert.equal(parsed.additionalContext, 'ctx')
  assert.equal(parsed.continue, true)
})

/* ---------------- summary ---------------- */

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
