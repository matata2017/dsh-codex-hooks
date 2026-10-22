/**
 * @local/dsh-hooks — host plugin.
 *
 * Discovers Codex `hooks.json` files, runs the trusted ones on the matching
 * DSH runtime events and exposes the `hooks` remote namespace to the client.
 *
 * Zero bare imports: the plugin only uses Node built-ins and the Cordis
 * services handed to `apply()`.
 */

import { randomUUID } from 'node:crypto'

import * as core from './core.js'
import { EVENT_DESCRIPTIONS, executeHook, hookApplies } from './events.js'
import { RUN_LIMIT, createRunLog, eventRows, hooksCommandText, hookTitle } from './runs.js'

const DESCRIPTOR_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'
const MAX_CONCURRENT_ASYNC = 8

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function sessionCwd(agent) {
  return agent?.session?.header?.cwd ?? agent?.session?.cwd ?? null
}

function sessionId(agent) {
  return agent?.session?.id ?? agent?.session?.header?.id ?? null
}

function agentId(agent) {
  return agent?.id ?? null
}

function agentType(agent) {
  return agent?.type ?? agent?.agentType ?? null
}

function extractPrompt(messages) {
  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    if (message?.role !== 'user') continue
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
      if (text !== '') return text
    }
  }
  return ''
}

function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

function toolOf(execution) {
  if (!execution) return { name: null, input: null, useId: null, response: null }
  return {
    name: execution.name ?? null,
    input: execution.arguments ?? execution.input ?? execution.args ?? null,
    useId: execution.callId ?? execution.id ?? null,
    response: null,
  }
}

/** One executed hook, with the labels the run log and the UI need. */
function runEntry(hook, result) {
  return {
    ...result,
    key: hook.key,
    eventName: hook.eventName,
    title: hookTitle(hook),
    source: hook.group ?? '',
    sourceLabel: hook.sourceLabel ?? '',
  }
}

/* ------------------------------------------------------------------ *
 * Core: discovery, state, execution
 * ------------------------------------------------------------------ */
class HooksCore {
  constructor(ctx, options) {
    this.ctx = ctx
    this.profileDir = options?.profileDir ?? core.profileDirFromModule()
    this.projectDirs = new Set()
    this.log = createRunLog({ limit: RUN_LIMIT })
  }

  /** Remember workspaces so project level hooks.json files are discovered. */
  rememberWorkspace(cwd) {
    if (!cwd || typeof cwd !== 'string') return
    const resolved = cwd
    if (this.projectDirs.has(resolved)) return
    this.projectDirs.add(resolved)
    if (this.projectDirs.size > 32) {
      this.projectDirs.delete(this.projectDirs.values().next().value)
    }
  }

  statePath() {
    return core.stateFilePath()
  }

  readState() {
    try {
      return core.readStateFile(this.statePath())
    } catch (error) {
      return { version: core.STATE_FILE_VERSION, states: {}, error: error.message }
    }
  }

  writeState(state) {
    return core.writeStateFile(this.statePath(), state)
  }

  /** Every discovered hook enriched with trust / enabled state. */
  catalog() {
    const state = this.readState()
    const sources = core.discoverSources({
      cwd: this.projectDirs.size > 0 ? [...this.projectDirs].at(-1) : undefined,
      profileDir: this.profileDir,
      projectDirs: [...this.projectDirs],
    })
    const groups = core.groupSources(sources)
    for (const group of groups) {
      for (const hook of group.hooks) {
        const entry = core.stateFor(state, hook.key)
        hook.trust = core.trustStatus({ currentHash: hook.hash, trustedHash: entry?.trustedHash })
        hook.enabled = core.hookEnabled({ state: entry })
        hook.runnable = hook.executable && hook.enabled && core.isRunnable(hook.trust)
        hook.description = EVENT_DESCRIPTIONS[hook.eventName] ?? ''
        hook.command = typeof hook.handler?.command === 'string' ? hook.handler.command : null
        hook.statusMessage = typeof hook.handler?.statusMessage === 'string' ? hook.handler.statusMessage : null
        hook.sourceKey = hook.key.slice(0, hook.key.length - `:${hook.eventLabel}:${hook.groupIndex}:${hook.handlerIndex}`.length)
      }
    }
    const hooks = groups.flatMap((group) => group.hooks)
    return {
      version: core.STATE_FILE_VERSION,
      home: core.dshHomePath(),
      profileDir: this.profileDir,
      statePath: this.statePath(),
      groups,
      hooks,
      events: eventRows(hooks),
      recent: this.log.stats().history,
    }
  }

  findHook(key) {
    return this.catalog().hooks.find((hook) => hook.key === key) ?? null
  }

  listHooks() {
    return this.catalog()
  }

  setEnabled(key, enabled) {
    const state = this.readState()
    const entry = state.states[key] ?? {}
    entry.enabled = enabled !== false
    state.states[key] = entry
    this.writeState(state)
    return { ok: true, key, enabled: entry.enabled }
  }

  setTrusted(key, trusted) {
    const hook = this.findHook(key)
    if (!hook) return { ok: false, error: `unknown hook key: ${key}` }
    const state = this.readState()
    const entry = state.states[key] ?? {}
    if (trusted === true) entry.trustedHash = hook.hash
    else delete entry.trustedHash
    state.states[key] = entry
    this.writeState(state)
    return { ok: true, key, trusted: trusted === true, hash: hook.hash }
  }

  async testHook(key) {
    const hook = this.findHook(key)
    if (!hook) return { ok: false, error: `unknown hook key: ${key}` }
    const result = await executeHook(hook, {
      cwd: this.projectDirs.size > 0 ? [...this.projectDirs].at(-1) : undefined,
      platform: process.platform,
      prompt: 'test',
    })
    return {
      ok: true,
      key,
      status: result.status,
      reason: result.reason,
      error: result.error,
      additionalContext: result.additionalContext,
      durationMs: result.durationMs,
    }
  }

  /** Hooks of one event that are trusted, enabled and executable. */
  selectHooks(eventName) {
    return this.catalog().hooks.filter(
      (hook) => hook.eventName === eventName && hook.runnable && hook.executable,
    )
  }

  record(eventName, results) {
    if (!results || results.length === 0) return
    this.log.record(eventName, results)
  }

  /** Counters plus the newest run rows, for the settings panel and `/hooks`. */
  stats() {
    return this.log.stats()
  }

  /** Hooks whose fingerprint is unknown or changed since it was trusted. */
  review() {
    return this.catalog().hooks
      .filter((hook) => hook.trust === 'Untrusted' || hook.trust === 'Modified')
      .map((hook) => ({
        key: hook.key,
        eventName: hook.eventName,
        title: hookTitle(hook),
        group: hook.group,
        sourceLabel: hook.sourceLabel,
        trust: hook.trust,
        hash: hook.hash,
        command: hook.command ?? null,
        timeout: hook.handler?.timeout ?? null,
        description: hook.description ?? '',
      }))
  }

  /** Trust every hook that is waiting for review, in one state write. */
  trustAll() {
    const pending = this.review()
    const state = this.readState()
    for (const hook of pending) {
      const entry = state.states[hook.key] ?? {}
      entry.trustedHash = hook.hash
      state.states[hook.key] = entry
    }
    this.writeState(state)
    return { ok: true, trusted: pending.length }
  }

  /** Text body of the `/hooks` command. */
  commandText() {
    return hooksCommandText({ hooks: this.catalog().hooks, stats: this.stats() })
  }

  /** Run every matching hook of one event. */
  async runEvent(eventName, context) {
    const hooks = this.selectHooks(eventName).filter((hook) => hookApplies(hook, eventName, context))
    if (hooks.length === 0) return []
    const settings = { ...context, platform: process.platform }
    const results = []
    const background = []

    for (const hook of hooks) {
      const async = hook.handler?.async === true && eventName !== 'SessionEnd'
      if (async) {
        background.push(hook)
        continue
      }
      const result = await executeHook(hook, settings)
      results.push(runEntry(hook, result))
    }

    if (background.length > 0) this.runBackground(background, settings)
    this.record(eventName, results)
    return results
  }

  /** Fire and forget hooks (`async: true`), at most MAX_CONCURRENT_ASYNC at a time. */
  runBackground(hooks, settings) {
    const queue = [...hooks]
    let active = 0
    const pump = () => {
      while (active < MAX_CONCURRENT_ASYNC && queue.length > 0) {
        const hook = queue.shift()
        active += 1
        executeHook(hook, settings)
          .then((result) => this.record(hook.eventName, [runEntry(hook, result)]))
          .catch(() => {})
          .then(() => {
            active -= 1
            pump()
          })
      }
    }
    pump()
  }
}

/* ------------------------------------------------------------------ *
 * Remote namespace `hooks` (SRC, hand rolled — no typert import)
 * ------------------------------------------------------------------ */

class HooksController {
  constructor(hooks) {
    this.hooks = hooks
    this.typertRemote = Object.freeze({
      service: this,
      serviceKey: 'hooksController',
      namespace: 'hooks',
    })
  }

  list() {
    return this.hooks.listHooks()
  }

  setEnabled(key, enabled) {
    return this.hooks.setEnabled(key, enabled)
  }

  setTrusted(key, trusted) {
    return this.hooks.setTrusted(key, trusted)
  }

  testHook(key) {
    return this.hooks.testHook(key)
  }

  stats() {
    return this.hooks.stats()
  }

  review() {
    return { hooks: this.hooks.review() }
  }

  trustAll() {
    return this.hooks.trustAll()
  }
}

Object.defineProperty(HooksController.prototype, DESCRIPTOR_KEY, {
  value: {
    version: 1,
    methods: [
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'setEnabled', invocation: { kind: 'direct' } },
      { method: 'setTrusted', invocation: { kind: 'direct' } },
      { method: 'testHook', invocation: { kind: 'direct' } },
      { method: 'stats', invocation: { kind: 'direct' } },
      { method: 'review', invocation: { kind: 'direct' } },
      { method: 'trustAll', invocation: { kind: 'direct' } },
    ],
  },
  configurable: true,
})

/* ------------------------------------------------------------------ *
 * Plugin entry point
 * ------------------------------------------------------------------ */

/** Register `/hooks` once the host composes the commands service. */
function registerCommand(ctx, hooks) {
  const definition = {
    definitionId: 'dsh-codex-hooks:hooks',
    name: 'hooks',
    description: 'View and manage lifecycle hooks.',
    handler: () => ({ kind: 'success', text: hooks.commandText() }),
  }
  const register = (commands) => {
    if (!commands || typeof commands.register !== 'function') return
    if (typeof ctx.effect === 'function') ctx.effect(() => commands.register(definition), 'dsh-codex-hooks: /hooks command')
    else commands.register(definition)
  }
  // Wait for the service instead of racing it: plugin load order is not ours to choose.
  // ctx.inject() mounts a child plugin whose body gets a context, not the service.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['commands'], (inner) =>
      register(typeof inner?.register === 'function' ? inner : (inner?.get?.('commands') ?? inner?.commands)),
    )
    return
  }
  register((typeof ctx.get === 'function' ? ctx.get('commands') : undefined) ?? ctx.commands)
}

export function apply(ctx, config) {
  const hooks = new HooksCore(ctx, config ?? {})
  ctx.provide('hooksController', new HooksController(hooks))
  registerCommand(ctx, hooks)

  // UserPromptSubmit — before the model sees the prompt. Can reject the turn.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    const agent = payload?.agent
    const cwd = sessionCwd(agent)
    hooks.rememberWorkspace(cwd)
    const results = await hooks.runEvent('UserPromptSubmit', {
      agent,
      cwd,
      prompt: extractPrompt(payload?.messages),
      messages: payload?.messages,
      turn: payload?.turn,
      step: payload?.step,
      signal: payload?.signal,
      sessionId: sessionId(agent),
      turnId: payload?.turn?.id ?? null,
      agentId: agentId(agent),
      agentType: agentType(agent),
    })
    const blocked = results.find((result) => result.status === 'blocked')
    if (blocked) return { kind: 'reject' }
    const contexts = results.map((result) => result.additionalContext).filter(Boolean)
    if (contexts.length === 0) return decision
    const message = userMessage(contexts.join('\n\n'))
    return {
      ...decision,
      messages: [...(decision?.messages ?? []), message],
    }
  })

  // PreModelRequest — before the model request is sent.
  ctx.on('agent/request', async (payload, next) => {
    const decision = await next()
    const agent = payload?.agent
    const cwd = sessionCwd(agent)
    hooks.rememberWorkspace(cwd)
    await hooks.runEvent('PreModelRequest', {
      agent,
      cwd,
      turn: payload?.turn,
      step: payload?.step,
      signal: payload?.signal,
      sessionId: sessionId(agent),
      turnId: payload?.turn?.id ?? null,
      agentId: agentId(agent),
      agentType: agentType(agent),
    })
    return decision
  })

  // PreToolUse — before a tool call runs. Can deny the call.
  ctx.on('tools/pre-execute', async (execution, next) => {
    const agent = execution?.agent
    const cwd = sessionCwd(agent)
    hooks.rememberWorkspace(cwd)
    const results = await hooks.runEvent('PreToolUse', {
      agent,
      cwd,
      tool: toolOf(execution),
      signal: execution?.signal,
      sessionId: sessionId(agent),
      turnId: execution?.turn?.id ?? null,
      agentId: agentId(agent),
      agentType: agentType(agent),
    })
    const blocked = results.find((result) => result.status === 'blocked')
    if (blocked) {
      return { kind: 'deny', reason: blocked.reason ?? 'blocked by hook' }
    }
    return await next()
  })

  // PostToolUse — after a tool call finished. Can add context / block.
  const handled = new WeakSet()
  ctx.on('tools/post-execute', async (execution, result, next) => {
    const decision = await next()
    if (execution && typeof execution === 'object') handled.add(execution)
    const agent = execution?.agent
    const cwd = sessionCwd(agent)
    hooks.rememberWorkspace(cwd)
    const tool = { ...toolOf(execution), response: result ?? null }
    const results = await hooks.runEvent('PostToolUse', {
      agent,
      cwd,
      tool,
      signal: execution?.signal,
      sessionId: sessionId(agent),
      turnId: execution?.turn?.id ?? null,
      agentId: agentId(agent),
      agentType: agentType(agent),
    })
    const blocked = results.find((entry) => entry.status === 'blocked')
    if (blocked) {
      return { kind: 'block', feedback: [{ type: 'text', text: blocked.reason ?? 'blocked by hook' }] }
    }
    const contexts = results.map((entry) => entry.additionalContext).filter(Boolean)
    if (contexts.length === 0) return decision
    return {
      ...(decision ?? { kind: 'accept' }),
      additionalContexts: [...(decision?.additionalContexts ?? []), userMessage(contexts.join('\n\n'))],
    }
  })

  // Fallback for runtimes without `tools/post-execute`.
  ctx.on('tools/result', async (execution, result) => {
    if (execution && typeof execution === 'object' && handled.has(execution)) return
    const agent = execution?.agent
    const cwd = sessionCwd(agent)
    hooks.rememberWorkspace(cwd)
    await hooks.runEvent('PostToolUse', {
      agent,
      cwd,
      tool: { ...toolOf(execution), response: result ?? null },
      signal: execution?.signal,
      sessionId: sessionId(agent),
      agentId: agentId(agent),
      agentType: agentType(agent),
    })
  })

  // PermissionRequest — before a tool call asks the user for permission.
  ctx.on('approval/request', async (request, next) => {
    const agent = request?.agent
    const cwd = sessionCwd(agent)
    hooks.rememberWorkspace(cwd)
    const results = await hooks.runEvent('PermissionRequest', {
      agent,
      cwd,
      tool: {
        name: request?.toolName ?? null,
        input: request?.arguments ?? request?.args ?? request?.input ?? null,
        useId: request?.callId ?? request?.id ?? null,
        response: null,
      },
      signal: request?.signal,
      sessionId: sessionId(agent),
      agentId: agentId(agent),
      agentType: agentType(agent),
    })
    const blocked = results.find((result) => result.status === 'blocked')
    if (blocked) return 'rejected'
    return await next()
  })

  // SessionStart — when a session starts.
  ctx.on('agent/created', async (payload) => {
    const agent = payload?.agent
    const cwd = sessionCwd(agent)
    hooks.rememberWorkspace(cwd)
    await hooks.runEvent('SessionStart', {
      agent,
      cwd,
      source: typeof payload?.source === 'string' ? payload.source : 'startup',
      signal: payload?.signal,
      sessionId: sessionId(agent),
      agentId: agentId(agent),
      agentType: agentType(agent),
    })
  })

  // Stop — right before the agent ends its turn.
  ctx.on('agent/turn-stopping', async (payload) => {
    const agent = payload?.agent
    const cwd = sessionCwd(agent)
    hooks.rememberWorkspace(cwd)
    await hooks.runEvent('Stop', {
      agent,
      cwd,
      turn: payload?.turn,
      signal: payload?.signal,
      sessionId: sessionId(agent),
      turnId: payload?.turn?.id ?? null,
      agentId: agentId(agent),
      agentType: agentType(agent),
    })
  })

  // SessionEnd — when a session is disposed.
  ctx.on('session/disposed', async (session) => {
    const cwd = session?.header?.cwd ?? session?.cwd ?? null
    hooks.rememberWorkspace(cwd)
    await hooks.runEvent('SessionEnd', {
      cwd,
      reason: 'other',
      sessionId: session?.id ?? null,
    })
  })
}
