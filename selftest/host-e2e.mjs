/**
 * End to end self check for the host plugin (lib/index.js).
 *
 *   node selftest/host-e2e.mjs
 *
 * Runs the plugin against a fake Cordis context and checks the whole chain:
 * discovery → trust state → event execution → stdin payload → remote API.
 * Nothing outside a temporary directory is written.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixture-hook.mjs')

const home = mkdtempSync(join(tmpdir(), 'dsh-hooks-home-'))
const workspace = mkdtempSync(join(tmpdir(), 'dsh-hooks-workspace-'))
process.env.DSH_HOME = home
process.env.DSH_HOOKS_SELFTEST_OUT = join(home, 'payload.json')

const core = await import('../lib/core.js')
const { apply } = await import('../lib/index.js')

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

async function checkAsync(name, run) {
  try {
    await run()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

/* ---------------- fake cordis context ---------------- */

function createCtx() {
  const listeners = new Map()
  const services = new Map()
  const commands = []
  services.set('commands', {
    register(definition) {
      commands.push(definition)
      return () => {
        const index = commands.indexOf(definition)
        if (index >= 0) commands.splice(index, 1)
      }
    },
  })
  return {
    on(name, handler) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(handler)
      return () => {}
    },
    provide(name, value) {
      services.set(name, value)
      return () => services.delete(name)
    },
    get(name) {
      return services.get(name)
    },
    inject(deps, callback) {
      const resolved = deps.map((name) => services.get(name))
      if (resolved.every((value) => value !== undefined)) {
        // cordis hands the plugin body a child context, not the services themselves
        const scope = { get: (name) => services.get(name) }
        for (const [index, name] of deps.entries()) scope[name] = resolved[index]
        callback(scope)
      }
      return () => {}
    },
    effect(run) {
      return run()
    },
    commands,
    services,
    async emit(name, ...args) {
      const handlers = listeners.get(name) ?? []
      let result
      for (const handler of handlers) result = await handler(...args)
      return result
    },
  }
}

/* ---------------- fixtures ---------------- */

const hooksFile = {
  version: 1,
  hooks: {
    'agent/pre-step': [{ command: `node "${fixture}"`, statusMessage: 'selftest hook' }],
    'tools/pre-execute': [
      { matcher: 'Write', command: `node "${fixture}"`, statusMessage: 'selftest tool hook' },
    ],
  },
}
writeFileSync(join(home, 'hooks.json'), JSON.stringify(hooksFile), 'utf8')

const sourceKey = join(home, 'hooks.json')
// Trust the hooks the same way discovery sees them: parse, then hash the parsed row.
const discoveredRows = core.describeHooks(core.parseHooksFile(JSON.stringify(hooksFile)), {
  sourceKey,
  platform: process.platform,
})
const hookKey = discoveredRows.find((row) => row.eventName === 'agent/pre-step').key
const toolHookKey = discoveredRows.find((row) => row.eventName === 'tools/pre-execute').key
core.writeStateFile(
  join(home, 'hooks.state.json'),
  {
    states: Object.fromEntries(
      discoveredRows.map((row) => [row.key, { enabled: true, trustedHash: row.hash }]),
    ),
  },
)

/* ---------------- run the plugin ---------------- */

const ctx = createCtx()
apply(ctx, { profileDir: null })

console.log('plugin wiring')
check('registers the hooksController service', () => {
  assert.ok(ctx.services.has('hooksController'))
})
check('registers the SRC descriptor on the prototype', () => {
  const controller = ctx.services.get('hooksController')
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(controller),
    '@deepseek-ai/dsh-typert-protocol/remote-methods',
  )
  assert.ok(descriptor, 'descriptor missing')
  assert.equal(descriptor.value.version, 1)
  assert.deepEqual(
    descriptor.value.methods.map((entry) => entry.method).sort(),
    ['list', 'review', 'setEnabled', 'setTrusted', 'stats', 'testHook', 'trustAll'],
  )
})
check('registers the /hooks command with the commands service', () => {
  assert.equal(ctx.commands.length, 1, 'exactly one command')
  const [definition] = ctx.commands
  assert.equal(definition.name, 'hooks')
  assert.equal(definition.definitionId, 'dsh-codex-hooks:hooks')
  const outcome = definition.handler()
  assert.equal(outcome.kind, 'success')
  assert.match(outcome.text, /^Hooks: \d+ total/u)
  assert.match(outcome.text, /This session: \d+ runs/u)
})
check('binds the hooks namespace', () => {
  const controller = ctx.services.get('hooksController')
  assert.equal(controller.typertRemote.namespace, 'hooks')
  assert.equal(controller.typertRemote.serviceKey, 'hooksController')
  assert.equal(controller.typertRemote.service, controller)
})
check('remote methods use unique identifier parameters', () => {
  const controller = ctx.services.get('hooksController')
  const proto = Object.getPrototypeOf(controller)
  for (const method of ['list', 'setEnabled', 'setTrusted', 'testHook', 'stats', 'review', 'trustAll']) {
    const names = proto[method].toString().match(/^[^(]*\(([^)]*)\)/)[1]
    for (const name of names.split(',').map((part) => part.trim()).filter(Boolean)) {
      assert.match(name, /^[$A-Z_a-z][$\w]*$/u, `${method}(${name}) is not a plain identifier`)
    }
  }
})

console.log('\nremote api')
let catalog = null
await checkAsync('list() returns the discovered hook', async () => {
  catalog = ctx.services.get('hooksController').list()
  assert.equal(catalog.groups.length, 3)
  const group = catalog.groups.find((entry) => entry.id === 'config')
  assert.ok(group, 'config group missing')
  const hook = group.hooks.find((entry) => entry.key === hookKey)
  assert.ok(hook, 'hook missing')
  assert.equal(hook.trust, 'Trusted')
  assert.equal(hook.enabled, true)
  assert.equal(hook.runnable, true)
})
await checkAsync('setEnabled() writes the state file', async () => {
  const result = ctx.services.get('hooksController').setEnabled(hookKey, false)
  assert.equal(result.ok, true)
  const state = JSON.parse(readFileSync(join(home, 'hooks.state.json'), 'utf8'))
  assert.equal(state.states[hookKey].enabled, false)
  const hook = ctx.services.get('hooksController').list().hooks.find((entry) => entry.key === hookKey)
  assert.equal(hook.enabled, false)
  assert.equal(hook.runnable, false)
})
await checkAsync('setEnabled(true) restores the hook', async () => {
  ctx.services.get('hooksController').setEnabled(hookKey, true)
  const hook = ctx.services.get('hooksController').list().hooks.find((entry) => entry.key === hookKey)
  assert.equal(hook.enabled, true)
})
await checkAsync('setTrusted(false) marks the hook untrusted', async () => {
  const result = ctx.services.get('hooksController').setTrusted(hookKey, false)
  assert.equal(result.ok, true)
  const hook = ctx.services.get('hooksController').list().hooks.find((entry) => entry.key === hookKey)
  assert.equal(hook.trust, 'Untrusted')
  assert.equal(hook.runnable, false)
})
await checkAsync('testHook refuses an untrusted hook', async () => {
  const result = await ctx.services.get('hooksController').testHook(hookKey)
  assert.equal(result.ok, false)
  assert.equal(result.needsReview, true)
})
await checkAsync('setTrusted(true) restores trust', async () => {
  ctx.services.get('hooksController').setTrusted(hookKey, true)
  const hook = ctx.services.get('hooksController').list().hooks.find((entry) => entry.key === hookKey)
  assert.equal(hook.trust, 'Trusted')
})

console.log('\nevent execution')
await checkAsync('agent/pre-step runs the hook and injects the context', async () => {
  const agent = {
    id: 'agent-1',
    type: 'main',
    session: { id: 'session-1', header: { cwd: workspace } },
  }
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'hello hooks' }] }]
  const payload = { agent, messages, turn: { id: 'turn-1' }, step: 1, signal: new AbortController().signal }
  const decision = await ctx.emit('agent/pre-step', payload, async () => ({ kind: 'enter', messages }))
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 2)
  assert.match(decision.messages[1].content[0].text, /selftest additional context/)
})
check('the hook received a DSH shaped payload', () => {
  assert.ok(existsSync(process.env.DSH_HOOKS_SELFTEST_OUT), 'hook did not run')
  const received = JSON.parse(readFileSync(process.env.DSH_HOOKS_SELFTEST_OUT, 'utf8'))
  assert.equal(received.hook_event_name, 'agent/pre-step')
  assert.equal(received.prompt, 'hello hooks')
  assert.equal(received.cwd, workspace)
  assert.equal(received.session_id, 'session-1')
  assert.equal(received.turn_id, 'turn-1')
})
await checkAsync('testHook() runs the hook on demand', async () => {
  const result = await ctx.services.get('hooksController').testHook(hookKey)
  assert.equal(result.ok, true)
  assert.equal(result.status, 'ok')
})
await checkAsync('untrusted hooks are not executed', async () => {
  ctx.services.get('hooksController').setTrusted(hookKey, false)
  const agent = {
    id: 'agent-2',
    type: 'main',
    session: { id: 'session-2', header: { cwd: workspace } },
  }
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'should not run' }] }]
  const decision = await ctx.emit(
    'agent/pre-step',
    { agent, messages, turn: { id: 'turn-2' }, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages }),
  )
  assert.equal(decision.messages.length, 1)
})

/* ---------------- turn scoping (the stats panel bug) ---------------- */

console.log('\nturn scoping')
// Restore trust, then drive two turns: the panel must show one turn at a time
// instead of one session-cumulative blob that never changes between turns.
ctx.services.get('hooksController').setTrusted(hookKey, true)

async function runTurn(turnId, prompt) {
  const agent = {
    id: 'agent-1',
    type: 'main',
    session: { id: 'session-1', header: { cwd: workspace } },
  }
  const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  return ctx.emit(
    'agent/pre-step',
    { agent, messages, turn: { id: turnId }, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages }),
  )
}

await checkAsync('two turns keep separate run logs', async () => {
  await runTurn('turn-a', 'first turn')
  await runTurn('turn-b', 'second turn')

  const controller = ctx.services.get('hooksController')
  const current = controller.stats()
  assert.equal(current.turn, 'turn-b', 'current turn is the latest')
  assert.equal(current.runs, 1, 'current turn has its own run')
  assert.equal(current.session.runs >= 2, true, 'session totals stay cumulative')
  assert.equal(current.turns.length >= 2, true, 'turn index lists both turns')

  const older = controller.stats('turn-a')
  assert.equal(older.turn, 'turn-a', 'older turn selectable')
  assert.equal(older.runs, 1, 'older turn keeps exactly its run')
})

/* The tool seam carries no turn: ToolExecutionInput has callId/name/arguments
 * but nothing about the turn. A run there has to follow the turn the session is
 * actually on, not the turn of the newest row — those differ as soon as a turn
 * runs no hooks of its own, which is exactly what this block sets up. */
await checkAsync('a run from a turn-less seam lands in the session current turn', async () => {
  const controller = ctx.services.get('hooksController')
  const agent = { id: 'agent-1', type: 'main', session: { id: 'session-1', header: { cwd: workspace } } }

  // turn-c: the pre-step hook runs, so the newest row belongs to turn-c.
  await ctx.emit(
    'agent/pre-step',
    {
      agent,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'turn c' }] }],
      turn: { id: 'turn-c' },
      step: 1,
      signal: new AbortController().signal,
    },
    async () => ({ kind: 'enter', messages: [] }),
  )
  // turn-d: no hook is configured on agent/request, so nothing is logged, but the
  // host learns the turn from it.
  await ctx.emit('agent/request', { agent, turn: { id: 'turn-d' }, step: 2 }, async () => ({ ok: true }))

  await ctx.emit(
    'tools/pre-execute',
    { callId: 'call-1', rootCallId: 'call-1', name: 'Write', arguments: { path: 'x' }, agent },
    async () => ({ kind: 'allow' }),
  )

  const current = controller.stats()
  assert.equal(current.turn, 'turn-d', 'follows the marked turn, not the newest row')
  assert.equal(current.runs, 1, 'the tool run is in turn-d')
  assert.equal(current.history[0].eventName, 'tools/pre-execute', 'the row is the tool run')

  const previous = controller.stats('turn-c')
  assert.equal(previous.runs, 1, 'turn-c keeps only its own hook run')
})

/* The remote method has to accept `delta`, not just the log: the client sends
 * it because turn numbers restart when the host does. */
await checkAsync('stats() accepts the delta the client sends', async () => {
  const controller = ctx.services.get('hooksController')
  // What the client sends after the host restarted: a turn number the log has
  // never seen (the counter restarted at 1) plus how far back it is.
  const withDelta = controller.stats('gone', 1)
  assert.equal(withDelta.resolved, 'offset', 'resolved by distance')
  assert.equal(withDelta.turn, 'turn-c', 'one turn back from turn-d')
  assert.equal(withDelta.runs, 1, 'the older turn keeps its run')

  const tooFar = controller.stats('gone', 99)
  assert.equal(tooFar.resolved, 'missing', 'nothing that far back is invented')
  assert.equal(tooFar.runs, 0, 'and it reports no runs rather than borrowing some')
})

console.log('\nstate file hygiene')
/* Revoking trust on a hook that was never approved used to leave a blank entry
 * behind in hooks.state.json, which then looked like a hook somebody had
 * configured but never approved. The state file must record what was approved,
 * not what was clicked. */
await checkAsync('setTrusted(false) on a hook that was never trusted leaves no entry', async () => {
  const controller = ctx.services.get('hooksController')
  const state = JSON.parse(readFileSync(join(home, 'hooks.state.json'), 'utf8'))
  delete state.states[toolHookKey]
  core.writeStateFile(join(home, 'hooks.state.json'), state)

  const result = controller.setTrusted(toolHookKey, false)
  assert.equal(result.ok, true)

  const after = JSON.parse(readFileSync(join(home, 'hooks.state.json'), 'utf8'))
  assert.equal(toolHookKey in after.states, false, 'an empty entry was left behind')
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
