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
  hooks: {
    UserPromptSubmit: [
      {
        hooks: [{ type: 'command', command: `node "${fixture}"`, statusMessage: 'selftest hook' }],
      },
    ],
  },
}
writeFileSync(join(home, 'hooks.json'), JSON.stringify(hooksFile), 'utf8')

const sourceKey = join(home, 'hooks.json')
const stateKey = core.hookStateKey(sourceKey, 'UserPromptSubmit', 0, 0)
const trustedHash = core.hookHash({
  eventName: 'UserPromptSubmit',
  matcher: null,
  handler: hooksFile.hooks.UserPromptSubmit[0].hooks[0],
  platform: process.platform,
})
core.writeStateFile(join(home, 'hooks.state.json'), {
  states: { [stateKey]: { enabled: true, trustedHash } },
})

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
  assert.match(outcome.text, /Recent: \d+ runs/u)
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
  const hook = group.hooks.find((entry) => entry.key === stateKey)
  assert.ok(hook, 'hook missing')
  assert.equal(hook.trust, 'Trusted')
  assert.equal(hook.enabled, true)
  assert.equal(hook.runnable, true)
})
await checkAsync('setEnabled() writes the state file', async () => {
  const result = ctx.services.get('hooksController').setEnabled(stateKey, false)
  assert.equal(result.ok, true)
  const state = JSON.parse(readFileSync(join(home, 'hooks.state.json'), 'utf8'))
  assert.equal(state.states[stateKey].enabled, false)
  const hook = ctx.services.get('hooksController').list().hooks.find((entry) => entry.key === stateKey)
  assert.equal(hook.enabled, false)
  assert.equal(hook.runnable, false)
})
await checkAsync('setEnabled(true) restores the hook', async () => {
  ctx.services.get('hooksController').setEnabled(stateKey, true)
  const hook = ctx.services.get('hooksController').list().hooks.find((entry) => entry.key === stateKey)
  assert.equal(hook.enabled, true)
})
await checkAsync('setTrusted(false) marks the hook untrusted', async () => {
  const result = ctx.services.get('hooksController').setTrusted(stateKey, false)
  assert.equal(result.ok, true)
  const hook = ctx.services.get('hooksController').list().hooks.find((entry) => entry.key === stateKey)
  assert.equal(hook.trust, 'Untrusted')
  assert.equal(hook.runnable, false)
})
await checkAsync('setTrusted(true) restores trust', async () => {
  ctx.services.get('hooksController').setTrusted(stateKey, true)
  const hook = ctx.services.get('hooksController').list().hooks.find((entry) => entry.key === stateKey)
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
check('the hook received a Codex shaped payload', () => {
  assert.ok(existsSync(process.env.DSH_HOOKS_SELFTEST_OUT), 'hook did not run')
  const received = JSON.parse(readFileSync(process.env.DSH_HOOKS_SELFTEST_OUT, 'utf8'))
  assert.equal(received.hook_event_name, 'UserPromptSubmit')
  assert.equal(received.prompt, 'hello hooks')
  assert.equal(received.cwd, workspace)
  assert.equal(received.session_id, 'session-1')
  assert.equal(received.turn_id, 'turn-1')
})
await checkAsync('testHook() runs the hook on demand', async () => {
  const result = await ctx.services.get('hooksController').testHook(stateKey)
  assert.equal(result.ok, true)
  assert.equal(result.status, 'ok')
})
await checkAsync('untrusted hooks are not executed', async () => {
  ctx.services.get('hooksController').setTrusted(stateKey, false)
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

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
