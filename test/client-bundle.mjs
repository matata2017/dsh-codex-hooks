/**
 * Client bundle check.
 *
 * `client.js` is a browser bundle, so the only way to test it without a
 * browser is to run it in a VM with a fake React, a fake DOM and a fake
 * service scope. The check asserts what the panels render (the review dialog,
 * the hooks browser, the run stats dialog) and which remote methods they call
 * on the host.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

const ROOT = join(import.meta.dirname, '..')

const FAKE_DATA = {
  hooks: [
    {
      key: 'k1',
      eventName: 'agent/pre-step',
      title: 'echo-hook',
      trust: 'Untrusted',
      enabled: true,
      runnable: false,
      sourceLabel: 'hooks.json',
      command: 'echo-hook.mjs',
      description: 'When the user submits a prompt',
    },
    {
      key: 'k2',
      eventName: 'agent/turn-stopping',
      title: 'stop-hook',
      trust: 'Trusted',
      enabled: true,
      runnable: true,
      sourceLabel: 'hooks.json',
      command: 'stop-hook.mjs',
      description: 'Before a turn ends',
    },
  ],
  events: [
    {
      eventName: 'agent/pre-step',
      installed: 1,
      active: 0,
      needsReview: 1,
      description: 'When the user submits a prompt',
    },
    { eventName: 'agent/turn-stopping', installed: 1, active: 1, needsReview: 0, description: 'Before a turn ends' },
  ],
}

const FAKE_STATS = {
  runs: 2,
  blocked: 1,
  failed: 0,
  history: [
    { at: 'now', eventName: 'agent/pre-step', title: 'echo-hook', sourceLabel: 'hooks.json', status: 'blocked', durationMs: 12 },
  ],
}

const FAKE_REVIEW = {
  hooks: [
    {
      key: 'k1',
      eventName: 'agent/pre-step',
      title: 'echo-hook',
      trust: 'Untrusted',
      sourceLabel: 'hooks.json',
      command: 'echo-hook.mjs',
      timeout: 15,
    },
  ],
}

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

function findByText(node, needle) {
  if (node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByText(child, needle)
      if (found) return found
    }
    return null
  }
  if (text(node).join(' ').includes(needle)) return node
  return findByText(node.children, needle)
}

export async function runClientBundleCheck() {
  const items = []
  const push = (status, name, detail) => items.push({ status, name, detail: detail ?? '' })
  const check = async (name, fn) => {
    try {
      const detail = await fn()
      push('PASS', name, typeof detail === 'string' ? detail : '')
    } catch (error) {
      push('FAIL', name, error?.message ?? String(error))
    }
  }

  // A tiny hook runtime: one hook list per component, kept between renders so
  // an async fetch can land in the state before the assertion runs.
  const instances = new Map()
  let current = null
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState: (init) => {
      const inst = current
      const index = inst.cursor++
      if (index >= inst.hooks.length) {
        inst.hooks.push(typeof init === 'function' ? init() : init)
      }
      const setter = (value) => {
        inst.hooks[index] = typeof value === 'function' ? value(inst.hooks[index]) : value
      }
      return [inst.hooks[index], setter]
    },
    useEffect: (fn) => {
      try {
        fn()
      } catch {
        /* effects that need the network are asserted through the recorded calls */
      }
    },
    useCallback: (fn) => fn,
    useRef: (init) => {
      const inst = current
      const index = inst.cursor++
      if (index >= inst.hooks.length) inst.hooks.push({ current: init })
      return inst.hooks[index]
    },
    Fragment: 'Fragment',
  }
  const reactDom = { createPortal: (node) => node }

  function renderComponent(component, props) {
    let inst = instances.get(component)
    if (!inst) {
      inst = { hooks: [], cursor: 0 }
      instances.set(component, inst)
    }
    inst.cursor = 0
    const previous = current
    current = inst
    const rendered = component(props ?? {})
    current = previous
    return rendered
  }

  function renderTree(node) {
    if (node === null || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(renderTree)
    if (typeof node.type === 'function') return renderTree(renderComponent(node.type, node.props))
    return { ...node, children: node.children.map(renderTree) }
  }

  let mod = null
  const window = {
    __ModuleLoader__: {
      load: (spec) => {
        mod = spec.factory((name) => {
          if (name === 'react') return React
          if (name === 'react-dom') return reactDom
          throw new Error(`unknown module ${name}`)
        })
      },
    },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
  }
  const document = {
    createElement: () => ({ textContent: '', remove() {} }),
    head: { append() {} },
    body: {},
    addEventListener() {},
    removeEventListener() {},
  }

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
  const action = registrations.find((entry) => entry.spec.name === 'conversation.chat.assistant-actions')
  const overlay = registrations.find((entry) => entry.spec.name === 'shell.overlay')
  const renderTrigger = () => renderTree(renderComponent(trigger.component, {}))
  const renderAction = () => renderTree(renderComponent(action.component, {}))
  const renderOverlay = () => renderTree(renderComponent(overlay.component, {}))
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  // Mount the panel, let its fetch land, then render again: one pass is not
  // enough because the data arrives after the first paint.
  const settle = async () => {
    await tick()
    renderOverlay()
    await tick()
    renderOverlay()
  }

  await check('client/注册设置段、工具栏按钮、浮层与消息操作', () => {
    if (!trigger) throw new Error('composer tool row slot not registered')
    if (!action) throw new Error('assistant action slot not registered')
    if (!overlay) throw new Error('shell overlay slot not registered')
    if (!registrations.find((entry) => entry.spec.name === 'settings.section')) {
      throw new Error('settings section not registered')
    }
    if (registrations.find((entry) => entry.spec.name === 'conversation.input.overlay')) {
      throw new Error('the composer overlay slot must not be used any more')
    }
    return '4 slots'
  })

  await check('client/为 /hooks 注册客户端动作', () => {
    if (decorations.length !== 1) throw new Error(`expected 1 decoration, got ${decorations.length}`)
    if (decorations[0].name !== 'hooks') throw new Error('decoration name')
    if (decorations[0].ui.kind !== 'action') throw new Error('decoration is not an action')
    return 'action'
  })

  await check('client/输入框工具栏渲染钩子图标按钮', () => {
    const button = findRow(renderTrigger(), '__dh_trigger')
    if (!button) throw new Error('trigger button not rendered')
    if (button.props['aria-label'] !== 'triggerLabel') throw new Error('trigger has no label')
    return 'trigger'
  })

  await check('client/未打开时不渲染任何面板', async () => {
    if (renderOverlay() !== null) throw new Error('overlay rendered while closed')
    return 'closed'
  })

  await tick()

  await check('client/工具栏图标不再显示待审核角标', () => {
    if (findRow(renderTrigger(), '__dh_triggerBadge')) throw new Error('the trigger still renders a count badge')
    return 'no badge'
  })

  await check('client/有待审核钩子时自动打开审查弹窗（Codex 样式）', async () => {
    await settle()
    const rendered = text(renderOverlay()).join(' ')
    for (const needle of ['reviewTitle', 'echo-hook', 'newBadge', 'notNow', 'allowAll', 'allowSelected', 'settingsLink']) {
      if (!rendered.includes(needle)) throw new Error(`missing "${needle}" in: ${rendered}`)
    }
    return 'review'
  })

  await check('client/审查弹窗展开后显示来源/类型/命令/超时', async () => {
    const toggle = findRow(renderOverlay(), '__dh_chevron')
    if (!toggle) throw new Error('chevron not rendered')
    toggle.props.onClick()
    await settle()
    const rendered = text(renderOverlay()).join(' ')
    for (const needle of ['sourceLabel', 'typeLabel', 'commandLabel', 'timeoutLabel']) {
      if (!rendered.includes(needle)) throw new Error(`missing "${needle}" in: ${rendered}`)
    }
    return 'details'
  })

  await check('client/提示里的「设置」链接打开钩子浏览器', async () => {
    const link = findByText(renderOverlay(), 'settingsLink')
    if (!link) throw new Error('settings link not found')
    const button = findRow(link, '__dh_link')
    if (!button) throw new Error('settings link is not a button')
    button.props.onClick()
    await settle()
    const rendered = text(renderOverlay()).join(' ')
    for (const needle of ['events', 'agent/pre-step', 'agent/turn-stopping']) {
      if (!rendered.includes(needle)) throw new Error(`missing "${needle}" in: ${rendered}`)
    }
    if (rendered.includes('recentRuns')) throw new Error('the panels must not show the run log')
    return 'events'
  })

  await check('client/点事件行进入处理器列表', async () => {
    const row = findRow(renderOverlay(), '__dh_listRowPick')
    if (!row) throw new Error('event row not found')
    row.props.onClick()
    await settle()
    const rendered = text(renderOverlay()).join(' ')
    if (!rendered.includes('handlers')) throw new Error(`handlers page missing: ${rendered}`)
    if (!rendered.includes('echo-hook')) throw new Error(`handler row missing: ${rendered}`)
    if (!rendered.includes('hooks.json')) throw new Error(`handler source missing: ${rendered}`)
    return 'handlers'
  })

  await check('client/消息操作行渲染钩子按钮，点击打开统计弹窗', async () => {
    const button = findRow(renderAction(), '__dh_actionBtn')
    if (!button) throw new Error('message action button not rendered')
    if (button.props['aria-label'] !== 'hookStats') throw new Error('action button has no label')
    button.props.onClick()
    await settle()
    const rendered = text(renderOverlay()).join(' ')
    for (const needle of ['hookStats', 'runs', 'blocked', 'failed', 'runHistory', 'agent/pre-step']) {
      if (!rendered.includes(needle)) throw new Error(`missing "${needle}" in: ${rendered}`)
    }
    return 'modal'
  })

  await tick()
  await check('client/调用宿主远程方法', () => {
    for (const expected of ['hooks/list', 'hooks/stats', 'hooks/review']) {
      if (!calls.includes(expected)) throw new Error(`missing ${expected}, got ${calls.join(', ')}`)
    }
    return calls.join(', ')
  })

  return items
}
