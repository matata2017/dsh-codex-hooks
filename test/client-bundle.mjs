/**
 * Client bundle check.
 *
 * `client.js` is a browser bundle, so the only way to test it without a
 * browser is to run it in a VM with a fake React, a fake DOM and a fake
 * service scope. The check asserts what the composer overlay renders (the
 * review card, the event list, the handler list) and which remote methods it
 * calls on the host.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

const ROOT = join(import.meta.dirname, '..')

const FAKE_DATA = {
  hooks: [
    {
      key: 'k1',
      eventName: 'UserPromptSubmit',
      trust: 'Untrusted',
      enabled: true,
      runnable: false,
      sourceLabel: 'hooks.json',
      handler: { command: 'echo-hook.mjs' },
    },
    {
      key: 'k2',
      eventName: 'Stop',
      trust: 'Trusted',
      enabled: true,
      runnable: true,
      sourceLabel: 'hooks.json',
      handler: { command: 'stop-hook.mjs' },
    },
  ],
  events: [
    { eventName: 'UserPromptSubmit', installed: 1, active: 0, needsReview: 1 },
    { eventName: 'Stop', installed: 1, active: 1, needsReview: 0 },
  ],
}

const FAKE_STATS = {
  runs: 2,
  blocked: 1,
  failed: 0,
  history: [
    { at: 'now', eventName: 'UserPromptSubmit', title: 'echo-hook', sourceLabel: 'hooks.json', status: 'blocked', durationMs: 12 },
  ],
}

const FAKE_REVIEW = { hooks: [{ key: 'k1', eventName: 'UserPromptSubmit', trust: 'Untrusted' }] }

function text(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) text(child, out)
    return out
  }
  if (node.children) text(node.children, out)
  return out
}

function findRow(node, marker) {
  if (node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRow(child, marker)
      if (found) return found
    }
    return null
  }
  if (String(node.props?.className ?? '').includes(marker)) return node
  return findRow(node.children, marker)
}

export async function runClientBundleCheck() {
  const items = []
  const push = (status, name, detail) => items.push({ status, name, detail: detail ?? '' })
  const check = (name, fn) => {
    try {
      const detail = fn()
      push('PASS', name, typeof detail === 'string' ? detail : '')
    } catch (error) {
      push('FAIL', name, error?.message ?? String(error))
    }
  }

  let queue = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState: (init) => [
      queue.length > 0 ? queue.shift() : typeof init === 'function' ? init() : init,
      () => {},
    ],
    useEffect: (fn) => {
      try {
        fn()
      } catch {
        /* effects that need the network are asserted through the recorded calls */
      }
    },
    useCallback: (fn) => fn,
    useRef: () => ({ current: null }),
  }

  let mod = null
  const window = {
    __ModuleLoader__: {
      load: (spec) => {
        mod = spec.factory((name) => {
          if (name === 'react') return React
          throw new Error(`unknown module ${name}`)
        })
      },
    },
  }
  const document = { createElement: () => ({ textContent: '', remove() {} }), head: { append() {} } }

  try {
    vm.runInNewContext(readFileSync(join(ROOT, 'client.js'), 'utf8'), { window, document, console })
  } catch (error) {
    push('FAIL', 'client/加载 bundle', error?.message ?? String(error))
    return items
  }

  const calls = []
  const registrations = []
  const decorations = []
  const connection = {
    rpc: {
      call: async (route, method) => {
        calls.push(method)
        if (method === 'hooks/list') return { ok: true, value: FAKE_DATA }
        if (method === 'hooks/stats') return { ok: true, value: FAKE_STATS }
        if (method === 'hooks/review') return { ok: true, value: FAKE_REVIEW }
        return { ok: true, value: { ok: true } }
      },
    },
  }
  const scope = {
    locale: { bind: () => (key) => key, register: () => {} },
    slots: {
      inject: (name, factory) => registrations.push(factory()),
      register: (spec, component) => ({ spec, component }),
    },
    connection,
    commandUi: {
      decorate: (decoration) => {
        decorations.push(decoration)
        return () => {}
      },
    },
    effect: (run) => run(),
  }

  try {
    mod.apply({ inject: (deps, callback) => callback(scope) })
  } catch (error) {
    push('FAIL', 'client/apply', error?.message ?? String(error))
    return items
  }

  const overlay = registrations.find((entry) => entry.spec.name === 'conversation.input.overlay')
  const render = () => {
    queue = [connection, null, FAKE_DATA, FAKE_STATS, FAKE_REVIEW.hooks, false, null, null]
    return overlay.component({})
  }

  check('client/注册设置段与 composer overlay', () => {
    if (!overlay) throw new Error('overlay slot not registered')
    if (!registrations.find((entry) => entry.spec.name === 'settings.section')) {
      throw new Error('settings section not registered')
    }
    return '2 slots'
  })

  check('client/为 /hooks 注册客户端动作', () => {
    if (decorations.length !== 1) throw new Error(`expected 1 decoration, got ${decorations.length}`)
    if (decorations[0].name !== 'hooks') throw new Error('decoration name')
    if (decorations[0].ui.kind !== 'action') throw new Error('decoration is not an action')
    return 'action'
  })

  check('client/待审核时渲染审核卡片', () => {
    const rendered = text(render()).join(' ')
    for (const needle of ['reviewTitle', 'reviewCount', 'reviewNote', 'reviewHooks', 'trustAllContinue']) {
      if (!rendered.includes(needle)) throw new Error(`missing "${needle}" in: ${rendered}`)
    }
    return 'card'
  })

  check('client//hooks 打开事件列表与运行计数', () => {
    decorations[0].ui.run()
    const opened = text(render()).join(' ')
    for (const needle of ['events', 'UserPromptSubmit', 'Stop', 'runs 2', 'blocked 1']) {
      if (!opened.includes(needle)) throw new Error(`missing "${needle}" in: ${opened}`)
    }
    return 'events'
  })

  check('client/点事件行进入处理器列表', () => {
    const row = findRow(render(), '__dh_listRowPick')
    if (!row) throw new Error('event row not found')
    row.props.onClick()
    const handlers = text(render()).join(' ')
    if (!handlers.includes('handlers')) throw new Error(`handlers page missing: ${handlers}`)
    if (!handlers.includes('echo-hook')) throw new Error(`handler row missing: ${handlers}`)
    return 'handlers'
  })

  await new Promise((resolve) => setTimeout(resolve, 50))
  check('client/调用宿主远程方法', () => {
    for (const expected of ['hooks/list', 'hooks/stats', 'hooks/review']) {
      if (!calls.includes(expected)) throw new Error(`missing ${expected}, got ${calls.join(', ')}`)
    }
    return calls.join(', ')
  })

  return items
}
