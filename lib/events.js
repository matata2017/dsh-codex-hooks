/**
 * @local/dsh-hooks — event descriptions and hook execution.
 *
 * Maps the DSH interception seams onto hook payloads and runs the hook
 * commands.
 */

import { spawn } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_ADDITIONAL_CONTEXT_LIMIT,
  FIRST_STEP_EVENTS,
  classifyRun,
  matchMatcher,
  normalizeHandler,
} from './core.js'

/** One line description for every hook event. */
export const EVENT_DESCRIPTIONS = {
  'agent/pre-step': 'When the user submits a prompt, before the step runs',
  'agent/request': 'Before a request is sent to the model',
  'tools/pre-execute': 'Before a tool call is executed',
  'tools/post-execute': 'After a tool call completed',
  'approval/request': 'When a tool call needs approval',
  'agent/created': 'When a session or subagent is created',
  'agent/turn-stopping': 'Right before the agent ends its turn',
  'session/disposed': 'When a session is disposed',
}

/**
 * Per event behaviour.
 *
 * `mode` is `waterfall` when DSH expects a `next()` call, `emit` otherwise.
 * `blocking` marks events where a handler can veto the current step; the
 * remaining events are observational.
 */
export const EVENT_MAP = {
  'agent/pre-step': { mode: 'waterfall', blocking: true, matchInput: null },
  'agent/request': { mode: 'waterfall', blocking: false, matchInput: null },
  'tools/pre-execute': { mode: 'waterfall', blocking: true, matchInput: 'toolName' },
  'tools/post-execute': { mode: 'waterfall', blocking: true, matchInput: 'toolName' },
  'approval/request': { mode: 'waterfall', blocking: true, matchInput: 'toolName' },
  'agent/created': { mode: 'emit', blocking: false, matchInput: null },
  'agent/turn-stopping': { mode: 'emit', blocking: false, matchInput: null },
  'session/disposed': { mode: 'emit', blocking: false, matchInput: null },
}

const MATCH_INPUT_EXTRACTORS = {
  toolName: (context) => context?.tool?.name ?? null,
}

/** Does the hook apply to the current event payload? */
export function hookApplies(hook, eventName, context) {
  // `firstStepOnly`: skip the later steps of a turn without starting the command at all.
  if (hook.handler?.firstStepOnly === true && FIRST_STEP_EVENTS.has(eventName) && context?.firstStep === false) return false
  const mapping = EVENT_MAP[eventName]
  if (!mapping?.matchInput) return true
  const extractor = MATCH_INPUT_EXTRACTORS[mapping.matchInput]
  if (!extractor) return true
  const input = extractor(context)
  if (input === null || input === undefined) return false
  return matchMatcher(hook.matcher, input)
}

/** Build the JSON payload that is written to the hook's stdin. */
export function buildPayload(eventName, context) {
  const ctx = context ?? {}
  const payload = {
    session_id: ctx.sessionId ?? null,
    turn_id: ctx.turnId ?? null,
    cwd: ctx.cwd ?? null,
    hook_event_name: eventName,
    model: ctx.model ?? null,
    permission_mode: ctx.permissionMode ?? null,
    transcript_path: ctx.transcriptPath ?? null,
  }
  if (ctx.agentId) payload.agent_id = ctx.agentId
  if (ctx.agentType) payload.agent_type = ctx.agentType

  switch (eventName) {
    case 'tools/pre-execute':
      payload.tool_name = ctx.tool?.name ?? null
      payload.tool_input = ctx.tool?.input ?? null
      payload.tool_use_id = ctx.tool?.useId ?? null
      break
    case 'approval/request':
      payload.tool_name = ctx.tool?.name ?? null
      payload.tool_input = ctx.tool?.input ?? null
      break
    case 'tools/post-execute':
      payload.tool_name = ctx.tool?.name ?? null
      payload.tool_input = ctx.tool?.input ?? null
      payload.tool_response = ctx.tool?.response ?? null
      payload.tool_use_id = ctx.tool?.useId ?? null
      break
    case 'agent/created':
      payload.source = ctx.source ?? 'startup'
      break
    case 'session/disposed':
      payload.reason = ctx.reason ?? 'other'
      break
    case 'agent/pre-step':
      payload.prompt = ctx.prompt ?? ''
      break
    case 'agent/turn-stopping':
      payload.stop_hook_active = ctx.stopHookActive === true
      payload.last_assistant_message = ctx.lastAssistantMessage ?? null
      break
    default:
      break
  }
  return payload
}

/* ------------------------------------------------------------------ *
 * Process execution
 * ------------------------------------------------------------------ */

function killTree(child) {
  if (!child || child.killed || child.pid === undefined) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).unref()
    } catch {
      child.kill('SIGKILL')
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

/**
 * Restricted Windows sandboxes refuse named pipes: spawning with piped stdio
 * fails with EPERM. File backed stdio works everywhere.
 */
function isPipeDenied(error) {
  const code = error?.code
  return code === 'EPERM' || code === 'EACCES'
}

function closeQuietly(fd) {
  if (fd === null || fd === undefined) return
  try {
    closeSync(fd)
  } catch {
    /* already closed */
  }
}

/**
 * Run the hook command with regular files as stdin/stdout/stderr. Used as a
 * fallback when the sandbox refuses piped stdio.
 */
function runWithFileStdio(options) {
  const { command, cwd, input, timeoutSec, env, signal } = options
  let dir = null
  let inFd = null
  let outFd = null
  let errFd = null
  let outPath = null
  let errPath = null
  try {
    dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-io-'))
    const inPath = join(dir, 'stdin.json')
    outPath = join(dir, 'stdout.txt')
    errPath = join(dir, 'stderr.txt')
    writeFileSync(inPath, input, 'utf8')
    inFd = openSync(inPath, 'r')
    outFd = openSync(outPath, 'w')
    errFd = openSync(errPath, 'w')
  } catch (error) {
    closeQuietly(inFd)
    closeQuietly(outFd)
    closeQuietly(errFd)
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    return Promise.resolve({ exitCode: null, stdout: '', stderr: String(error?.message ?? error), failed: true })
  }

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, {
        cwd: cwd && cwd.length > 0 ? cwd : undefined,
        shell: true,
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: env ?? process.env,
        stdio: [inFd, outFd, errFd],
      })
    } catch (error) {
      closeQuietly(inFd)
      closeQuietly(outFd)
      closeQuietly(errFd)
      resolve({ exitCode: null, stdout: '', stderr: String(error?.message ?? error), failed: true })
      return
    }

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, Math.max(1, timeoutSec) * 1000)

    const onAbort = () => {
      killTree(child)
    }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    const finish = (exitCode) => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      closeQuietly(inFd)
      closeQuietly(outFd)
      closeQuietly(errFd)
      let stdout = ''
      let stderr = ''
      try {
        stdout = readFileSync(outPath, 'utf8')
      } catch {
        /* ignore */
      }
      try {
        stderr = readFileSync(errPath, 'utf8')
      } catch {
        /* ignore */
      }
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      resolve({ exitCode, stdout, stderr, timedOut })
    }

    child.on('error', (error) => {
      try {
        appendFileSync(errPath, String(error?.message ?? error), 'utf8')
      } catch {
        /* ignore */
      }
      finish(null)
    })
    child.on('close', (code, signalName) => {
      if (signalName) {
        const note = signalName === 'SIGKILL' && timedOut ? 'hook timed out' : `hook killed by ${signalName}`
        try {
          appendFileSync(errPath, note, 'utf8')
        } catch {
          /* ignore */
        }
      }
      finish(code ?? null)
    })
  })
}

/**
 * Run one hook command. Never rejects: infrastructure failures come back as
 * a non zero exit code so the caller can classify them.
 */
export function runCommand(options) {
  const {
    command,
    cwd,
    payload,
    timeoutSec = 600,
    env,
    signal,
  } = options ?? {}

  const input = JSON.stringify(payload ?? {})

  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    let child
    try {
      child = spawn(command, {
        cwd: cwd && cwd.length > 0 ? cwd : undefined,
        shell: true,
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: env ?? process.env,
      })
    } catch (error) {
      if (isPipeDenied(error)) {
        runWithFileStdio({ command, cwd, input, timeoutSec, env, signal }).then(finish)
        return
      }
      finish({ exitCode: null, stdout: '', stderr: String(error?.message ?? error), failed: true })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let fallingBack = false

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, Math.max(1, timeoutSec) * 1000)

    const onAbort = () => {
      killTree(child)
    }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })

    const settle = (exitCode) => {
      if (settled || fallingBack) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      resolve({ exitCode, stdout, stderr, timedOut })
    }

    child.on('error', (error) => {
      if (isPipeDenied(error)) {
        // Piped stdio was refused: retry with file backed stdio.
        fallingBack = true
        clearTimeout(timer)
        signal?.removeEventListener?.('abort', onAbort)
        runWithFileStdio({ command, cwd, input, timeoutSec, env, signal }).then(finish)
        return
      }
      stderr += String(error?.message ?? error)
      settle(null)
    })
    child.on('close', (code, signalName) => {
      if (signalName) {
        stderr += signalName === 'SIGKILL' && timedOut ? 'hook timed out' : `hook killed by ${signalName}`
        settle(code ?? null)
        return
      }
      settle(code ?? null)
    })

    if (child.stdin) {
      child.stdin.on('error', () => {
        /* the hook may exit before reading stdin */
      })
      try {
        child.stdin.write(input)
        child.stdin.end()
      } catch {
        /* ignore broken pipe */
      }
    }
  })
}

/* ------------------------------------------------------------------ *
 * additionalContext handling
 * ------------------------------------------------------------------ */

export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4)
}

/**
 * Codex keeps large additional contexts on disk and injects a preview only.
 * Returns the text that should be injected into the conversation.
 */
export function limitAdditionalContext(text, options) {
  const settings = options ?? {}
  const limit = settings.limit ?? DEFAULT_ADDITIONAL_CONTEXT_LIMIT
  const content = String(text ?? '')
  if (content === '') return { text: '', preview: '', file: null, truncated: false }
  if (estimateTokens(content) <= limit) return { text: content, preview: content, file: null, truncated: false }

  const previewChars = Math.max(400, limit * 4)
  const preview = `${content.slice(0, previewChars)}\n… (truncated)`
  let file = null
  try {
    const dir = join(tmpdir(), 'dsh-hooks')
    mkdirSync(dir, { recursive: true })
    const name = `${(settings.key ?? 'hook').replace(/[^A-Za-z0-9_.-]+/g, '_')}.txt`
    file = join(dir, name)
    writeFileSync(file, content, 'utf8')
  } catch {
    file = null
  }
  return { text: preview, preview, file, truncated: true }
}

/* ------------------------------------------------------------------ *
 * Running one hook
 * ------------------------------------------------------------------ */

/**
 * Execute a single hook row and return a Codex style result.
 * @returns {Promise<{status, reason, error, additionalContext, output, durationMs}>}
 */
export async function executeHook(hook, context) {
  const settings = context ?? {}
  const normalized = normalizeHandler(hook.handler, {
    eventName: hook.eventName,
    platform: settings.platform ?? process.platform,
  })
  if (!normalized || normalized.type !== 'command') {
    return { status: 'skipped', reason: null, error: 'unsupported handler type', additionalContext: null, output: null, durationMs: 0 }
  }

  const payload = buildPayload(hook.eventName, settings)
  const startedAt = Date.now()
  const run = await runCommand({
    command: normalized.command,
    cwd: settings.cwd,
    payload,
    timeoutSec: normalized.timeout,
    signal: settings.signal,
  })
  const durationMs = Date.now() - startedAt
  const result = classifyRun(run, { eventName: hook.eventName })

  if (result.status === 'ok' && result.additionalContext) {
    const limited = limitAdditionalContext(result.additionalContext, { key: hook.key })
    return {
      ...result,
      additionalContext: limited.truncated ? limited.preview : limited.text,
      truncated: limited.truncated,
      contextFile: limited.file,
      durationMs,
    }
  }
  return { ...result, durationMs }
}
