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

  const trigger = registrations.find((entry) => entry.spec.name === 'conversation.input.left')
  const popup = registrations.find((entry) => entry.spec.name === 'conversation.input.overlay')
  const action = registrations.find((entry) => entry.spec.name === 'conversation.chat.assistant-actions')
  const modal = registrations.find((entry) => entry.spec.name === 'shell.overlay')
  const renderTrigger = () => {
    queue = [connection, null, 0]
    return trigger.component({})
  }
  const renderPopup = () => {
    queue = [connection, null, FAKE_DATA, FAKE_REVIEW.hooks, null, null]
    return popup.component({})
  }
  const renderAction = () => {
    queue = [connection, null]
    return action.component({})
  }
  const renderModal = () => {
    queue = [connection, null, FAKE_STATS, null]
    return modal.component({})
  }

  check('client/注册设置段、工具栏按钮、浮层与消息操作', () => {
    if (!popup) throw new Error('overlay slot not registered')
    if (!trigger) throw new Error('composer tool row slot not registered')
    if (!action) throw new Error('assistant action slot not registered')
    if (!modal) throw new Error('shell overlay slot not registered')
    if (!registrations.find((entry) => entry.spec.name === 'settings.section')) {
      throw new Error('settings section not registered')
    }
    return '5 slots'
  })

  check('client/为 /hooks 注册客户端动作', () => {
    if (decorations.length !== 1) throw new Error(`expected 1 decoration, got ${decorations.length}`)
    if (decorations[0].name !== 'hooks') throw new Error('decoration name')
    if (decorations[0].ui.kind !== 'action') throw new Error('decoration is not an action')
    return 'action'
  })

  check('client/输入框工具栏渲染钩子图标按钮', () => {
    const button = findRow(renderTrigger(), '__dh_trigger')
    if (!button) throw new Error('trigger button not rendered')
    if (button.props['aria-label'] !== 'triggerLabel') throw new Error('trigger has no label')
    return 'trigger'
  })

  check('client/未打开时不渲染浮层', () => {
    if (renderPopup() !== null) throw new Error('popup rendered while closed')
    return 'closed'
  })

  check('client/待审核时在浮层里渲染审核列表', () => {
    decorations[0].ui.run()
    const rendered = text(renderPopup()).join(' ')
    for (const needle of ['reviewTitle', 'reviewCount', 'reviewNote', 'trustAllContinue', 'trust']) {
      if (!rendered.includes(needle)) throw new Error(`missing "${needle}" in: ${rendered}`)
    }
    return 'card'
  })

  check('client//hooks 打开事件列表', () => {
    const opened = text(renderPopup()).join(' ')
    for (const needle of ['events', 'UserPromptSubmit', 'Stop']) {
      if (!opened.includes(needle)) throw new Error(`missing "${needle}" in: ${opened}`)
    }
    if (opened.includes('recentRuns')) throw new Error('the popup must not show the run log')
    return 'events'
  })

  check('client/点事件行进入处理器列表', () => {
    const row = findRow(renderPopup(), '__dh_listRowPick')
    if (!row) throw new Error('event row not found')
    row.props.onClick()
    const handlers = text(renderPopup()).join(' ')
    if (!handlers.includes('handlers')) throw new Error(`handlers page missing: ${handlers}`)
    if (!handlers.includes('k1')) throw new Error(`handler row missing: ${handlers}`)
    if (!handlers.includes('hooks.json')) throw new Error(`handler source missing: ${handlers}`)
    return 'handlers'
  })

  check('client/消息操作行渲染钩子按钮，点击打开统计弹窗', () => {
    const button = findRow(renderAction(), '__dh_actionBtn')
    if (!button) throw new Error('message action button not rendered')
    if (button.props['aria-label'] !== 'hookStats') throw new Error('action button has no label')
    button.props.onClick()
    const modalText = text(renderModal()).join(' ')
    for (const needle of ['hookStats', 'runs', 'runHistory', 'UserPromptSubmit']) {
      if (!modalText.includes(needle)) throw new Error(`missing "${needle}" in: ${modalText}`)
    }
    return 'modal'
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
