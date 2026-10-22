/**
 * test/spec.mjs — CODEX Hooks semantics, transcribed from the Rust implementation.
 *
 * This module is the *executable specification* for the DSH Hooks plugin: every rule
 * below is traceable to a file in the CODEX source tree.
 *
 *   codex-rs/config/src/hook_config.rs        config schema (hooks.json shape, handler fields)
 *   codex-rs/config/src/fingerprint.rs         version_for_toml -> "sha256:<hex>"
 *   codex-rs/hooks/src/engine/discovery.rs     handler normalization, trust status, state key
 *   codex-rs/hooks/src/engine/matcher.rs       matcher forms (all / exact / regex)
 *   codex-rs/hooks/src/engine/output_parser.rs stdout JSON -> typed output
 *   codex-rs/hooks/src/schema.rs               per-event output wire shapes
 *   codex-rs/hooks/src/events/common.rs        which events support a matcher
 *   codex-rs/hooks/src/output_spill.rs         DEFAULT_HOOK_OUTPUT_TOKEN_LIMIT = 2500
 *   codex-rs/hooks/src/lib.rs                  hook_event_key_label / hook_key
 *
 * Zero dependencies, Node built-ins only.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** All 14 CODEX lifecycle events, in registry order. */
export const EVENT_NAMES = [
  'PreModelRequest',
  'PostModelRequest',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Interrupt',
]

/** Event name -> persisted state-key label (codex-rs/hooks/src/lib.rs:100). */
export const EVENT_LABELS = {
  PreModelRequest: 'pre_model_request',
  PostModelRequest: 'post_model_request',
  PreToolUse: 'pre_tool_use',
  PermissionRequest: 'permission_request',
  PostToolUse: 'post_tool_use',
  PreCompact: 'pre_compact',
  PostCompact: 'post_compact',
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  UserPromptSubmit: 'user_prompt_submit',
  SubagentStart: 'subagent_start',
  SubagentStop: 'subagent_stop',
  Stop: 'stop',
  Interrupt: 'interrupt',
}

/** The 9 events whose matcher is meaningful (codex-rs/hooks/src/events/common.rs:114). */
export const MATCHER_EVENTS = new Set([
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SessionStart',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
])

/** Events that may emit `additionalContext` (discovery.rs:580). */
export const ADDITIONAL_CONTEXT_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStart',
])

export const DEFAULT_TIMEOUT_SEC = 600
export const SESSION_END_DEFAULT_TIMEOUT_SEC = 1
export const SESSION_END_MAX_TIMEOUT_SEC = 3
export const DEFAULT_ADDITIONAL_CONTEXT_LIMIT = 2500

/** Handler types CODEX accepts in a hooks.json file. */
export const HANDLER_TYPES = ['command', 'mcp_tool', 'prompt', 'agent']

/** Handler types CODEX can actually execute (prompt/agent are skipped with a warning). */
export const EXECUTABLE_HANDLER_TYPES = ['command', 'mcp_tool']

// ---------------------------------------------------------------------------
// hashing
// ---------------------------------------------------------------------------

/**
 * serde_json-compatible compact serialization with recursively sorted object keys.
 * This is what `json.sort_all_objects()` + `serde_json::to_vec()` produce in CODEX.
 */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** codex-rs/config/src/fingerprint.rs:54 */
export function versionForText(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

/**
 * CODEX hashes the *normalized* identity, not the raw file text.
 * A `None` field is dropped (TOML cannot represent null), so absent fields never
 * appear in the hashed JSON — they are omitted, not emitted as `null`.
 */
function omitNulls(value) {
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && item !== undefined) out[key] = item
  }
  return out
}

/** codex-rs/hooks/src/engine/discovery.rs:841 */
export function normalizeTimeoutSeconds(eventName, timeoutSec) {
  const raw = timeoutSec === null || timeoutSec === undefined ? null : Number(timeoutSec)
  if (eventName === 'SessionEnd' || eventName === 'Interrupt') {
    const value = raw === null ? SESSION_END_DEFAULT_TIMEOUT_SEC : raw
    return Math.min(Math.max(value, 1), SESSION_END_MAX_TIMEOUT_SEC)
  }
  const value = raw === null ? DEFAULT_TIMEOUT_SEC : raw
  return Math.max(value, 1)
}

/**
 * Normalize one handler into the object CODEX hashes.
 * Returns null for handler types CODEX refuses to execute (prompt / agent).
 *
 * @param {object} handler raw handler object as written in hooks.json
 * @param {object} options
 * @param {string} options.eventName CODEX event name
 * @param {string} [options.platform] 'win32' prefers `commandWindows` (discovery.rs:554)
 */
export function normalizeHandler(handler, { eventName, platform = 'linux' }) {
  if (!handler || typeof handler !== 'object') return null
  const type = handler.type
  if (type === 'command') {
    const command = platform === 'win32' ? (handler.commandWindows ?? handler.command) : handler.command
    if (typeof command !== 'string' || command.trim() === '') return null
    const timeout = normalizeTimeoutSeconds(eventName, handler.timeout)
    const additionalContextLimit =
      ADDITIONAL_CONTEXT_EVENTS.has(eventName) &&
      handler.additionalContextLimit !== null &&
      handler.additionalContextLimit !== undefined &&
      Number(handler.additionalContextLimit) !== DEFAULT_ADDITIONAL_CONTEXT_LIMIT
        ? Number(handler.additionalContextLimit)
        : undefined
    return omitNulls({
      type: 'command',
      command,
      timeout,
      async: handler.async === true,
      statusMessage: handler.statusMessage ?? undefined,
      additionalContextLimit,
    })
  }
  if (type === 'mcp_tool') {
    if (typeof handler.server !== 'string' || typeof handler.tool !== 'string') return null
    return omitNulls({
      type: 'mcp_tool',
      server: handler.server,
      tool: handler.tool,
      input: handler.input && typeof handler.input === 'object' ? handler.input : {},
      timeout: normalizeTimeoutSeconds(eventName, handler.timeout),
      statusMessage: handler.statusMessage ?? undefined,
    })
  }
  // prompt / agent: recognized by the parser, never executed, never hashed.
  return null
}

/**
 * Build the normalized identity object that gets hashed.
 * codex-rs/hooks/src/engine/discovery.rs:874 (hook_hash)
 */
export function hookIdentity({ eventName, matcher = null, handler, platform = 'linux' }) {
  const normalized = normalizeHandler(handler, { eventName, platform })
  if (!normalized) return null
  const effectiveMatcher = MATCHER_EVENTS.has(eventName) ? (matcher ?? undefined) : undefined
  return omitNulls({
    event_name: EVENT_LABELS[eventName],
    matcher: effectiveMatcher,
    hooks: [normalized],
  })
}

/** Trust hash of one handler: "sha256:<hex>". */
export function hookHash({ eventName, matcher = null, handler, platform = 'linux' }) {
  const identity = hookIdentity({ eventName, matcher, handler, platform })
  if (!identity) return null
  return versionForText(stableJson(identity))
}

/** codex-rs/hooks/src/lib.rs:120 (hook_key) */
export function hookStateKey(sourceKey, eventName, groupIndex, handlerIndex) {
  return `${sourceKey}:${EVENT_LABELS[eventName]}:${groupIndex}:${handlerIndex}`
}

// ---------------------------------------------------------------------------
// hooks.json parsing
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Parse a CODEX-compatible hooks.json file.
 * codex-rs/config/src/hook_config.rs (HooksFile) — `deny_unknown_fields` at the file
 * level; unknown keys *inside* a handler are ignored (the handler struct is not
 * deny_unknown_fields), but they never contribute to the trust hash.
 *
 * @returns {{description: string|null, events: Record<string, Array<{matcher: string|null, hooks: object[]}>>}}
 */
export function parseHooksFile(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`hooks file is not valid JSON: ${error.message}`)
  }
  if (!isPlainObject(raw)) throw new Error('hooks file must be a JSON object')
  for (const key of Object.keys(raw)) {
    if (key !== 'description' && key !== 'hooks') throw new Error(`unknown field \`${key}\``)
  }
  const events = raw.hooks ?? {}
  if (!isPlainObject(events)) throw new Error('`hooks` must be an object')
  const parsed = {}
  for (const [eventName, groups] of Object.entries(events)) {
    if (!EVENT_NAMES.includes(eventName)) throw new Error(`unknown field \`${eventName}\``)
    if (!Array.isArray(groups)) throw new Error(`\`${eventName}\` must be an array`)
    const parsedGroups = []
    groups.forEach((group, groupIndex) => {
      if (!isPlainObject(group)) throw new Error(`\`${eventName}[${groupIndex}]\` must be an object`)
      const matcher = group.matcher === null || group.matcher === undefined ? null : String(group.matcher)
      const handlers = group.hooks ?? []
      if (!Array.isArray(handlers)) throw new Error(`\`${eventName}[${groupIndex}].hooks\` must be an array`)
      const parsedHandlers = handlers.map((handler, handlerIndex) => {
        if (!isPlainObject(handler)) {
          throw new Error(`\`${eventName}[${groupIndex}].hooks[${handlerIndex}]\` must be an object`)
        }
        if (typeof handler.type !== 'string' || !HANDLER_TYPES.includes(handler.type)) {
          throw new Error(
            `\`${eventName}[${groupIndex}].hooks[${handlerIndex}].type\` must be one of ${HANDLER_TYPES.join('|')}`,
          )
        }
        if (handler.type === 'command' && typeof handler.command !== 'string') {
          throw new Error(`\`${eventName}[${groupIndex}].hooks[${handlerIndex}].command\` is required`)
        }
        if (handler.type === 'mcp_tool' && (typeof handler.server !== 'string' || typeof handler.tool !== 'string')) {
          throw new Error(`\`${eventName}[${groupIndex}].hooks[${handlerIndex}]\` mcp_tool needs \`server\` and \`tool\``)
        }
        return handler
      })
      parsedGroups.push({ matcher, hooks: parsedHandlers })
    })
    parsed[eventName] = parsedGroups
  }
  return { description: typeof raw.description === 'string' ? raw.description : null, events: parsed }
}

/**
 * Flatten a parsed hooks file into one entry per handler, with state key and hash.
 * The iteration order matches CODEX: events in registry order, groups in file order,
 * handlers in file order.
 */
export function describeHooks(parsed, { sourceKey, platform = 'linux' }) {
  const entries = []
  for (const eventName of EVENT_NAMES) {
    const groups = parsed.events?.[eventName]
    if (!groups) continue
    groups.forEach((group, groupIndex) => {
      group.hooks.forEach((handler, handlerIndex) => {
        const hash = hookHash({ eventName, matcher: group.matcher, handler, platform })
        entries.push({
          eventName,
          groupIndex,
          handlerIndex,
          key: hookStateKey(sourceKey, eventName, groupIndex, handlerIndex),
          matcher: group.matcher,
          handler,
          hash,
          executable: EXECUTABLE_HANDLER_TYPES.includes(handler.type),
        })
      })
    })
  }
  return entries
}

// ---------------------------------------------------------------------------
// matcher
// ---------------------------------------------------------------------------

/** codex-rs/hooks/src/engine/matcher.rs:12 */
export function compileMatcher(pattern) {
  const text = pattern === null || pattern === undefined ? '' : String(pattern)
  if (text === '' || text === '*') return { kind: 'all', pattern: text }
  if (/^[A-Za-z0-9_|]+$/.test(text)) return { kind: 'exact', pattern: text }
  return { kind: 'regex', pattern: text, regex: new RegExp(text) }
}

/** codex-rs/hooks/src/engine/matcher.rs:32 */
export function matchMatcher(pattern, input) {
  const matcher = compileMatcher(pattern)
  if (matcher.kind === 'all') return true
  if (input === null || input === undefined) return false
  if (matcher.kind === 'exact') return matcher.pattern.split('|').some((candidate) => candidate === input)
  return matcher.regex.test(String(input))
}

// ---------------------------------------------------------------------------
// trust
// ---------------------------------------------------------------------------

/** codex-rs/hooks/src/engine/discovery.rs:893 */
export function trustStatus({ isManaged = false, isBuiltin = false, currentHash, trustedHash } = {}) {
  if (isBuiltin) return 'Trusted'
  if (isManaged) return 'Managed'
  if (trustedHash === null || trustedHash === undefined) return 'Untrusted'
  return trustedHash === currentHash ? 'Trusted' : 'Modified'
}

/** codex-rs/hooks/src/engine/discovery.rs:912 */
export function hookEnabled({ isManaged = false, isBuiltin = false, state } = {}) {
  if (isBuiltin || isManaged) return true
  return state?.enabled !== false
}

/** Only Trusted / Managed hooks are registered for execution (HANDOFF §3.5). */
export function isRunnable(trust) {
  return trust === 'Trusted' || trust === 'Managed'
}

// ---------------------------------------------------------------------------
// DSH-side state file  (HANDOFF §5.3 — DSH plugin contract, not CODEX)
// ---------------------------------------------------------------------------

/**
 * CODEX keeps hook state in `~/.codex/config.toml` under `[hooks.state."<key>"]`.
 * The DSH plugin keeps the same data in `$DSH_HOME/hooks.state.json`:
 *   { "version": 1, "states": { "<key>": { "enabled": true, "trustedHash": "sha256:..." } } }
 */
export const STATE_FILE_VERSION = 1

export function parseStateFile(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`state file is not valid JSON: ${error.message}`)
  }
  if (!isPlainObject(raw)) throw new Error('state file must be a JSON object')
  const version = raw.version ?? STATE_FILE_VERSION
  if (version !== STATE_FILE_VERSION) throw new Error(`unsupported state file version ${version}`)
  const states = raw.states ?? {}
  if (!isPlainObject(states)) throw new Error('`states` must be an object')
  return { version, states }
}

export function readStateFile(path) {
  if (!existsSync(path)) return { version: STATE_FILE_VERSION, states: {} }
  return parseStateFile(readFileSync(path, 'utf8'))
}

export function writeStateFile(path, state) {
  mkdirSync(dirname(path), { recursive: true })
  const payload = {
    version: state?.version ?? STATE_FILE_VERSION,
    states: state?.states ?? {},
  }
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload
}

/** Look up one hook's state entry (never undefined — absent means "defaults"). */
export function stateFor(state, key) {
  return state?.states?.[key] ?? null
}

// ---------------------------------------------------------------------------
// hook output
// ---------------------------------------------------------------------------

const UNIVERSAL_FIELDS = ['continue', 'stopReason', 'suppressOutput', 'systemMessage']

/** Per-event allowed output fields (codex-rs/hooks/src/schema.rs). */
export const OUTPUT_FIELDS = {
  PreModelRequest: UNIVERSAL_FIELDS,
  PostModelRequest: UNIVERSAL_FIELDS,
  PreCompact: UNIVERSAL_FIELDS,
  PostCompact: UNIVERSAL_FIELDS,
  PreToolUse: [...UNIVERSAL_FIELDS, 'decision', 'reason', 'hookSpecificOutput'],
  PermissionRequest: [...UNIVERSAL_FIELDS, 'hookSpecificOutput'],
  PostToolUse: [...UNIVERSAL_FIELDS, 'decision', 'reason', 'hookSpecificOutput'],
  SessionStart: [...UNIVERSAL_FIELDS, 'hookSpecificOutput'],
  SessionEnd: UNIVERSAL_FIELDS,
  UserPromptSubmit: [...UNIVERSAL_FIELDS, 'decision', 'reason', 'hookSpecificOutput'],
  SubagentStart: [...UNIVERSAL_FIELDS, 'hookSpecificOutput'],
  SubagentStop: [...UNIVERSAL_FIELDS, 'decision', 'reason'],
  Stop: [...UNIVERSAL_FIELDS, 'decision', 'reason'],
  Interrupt: ['systemMessage'],
}

/** codex-rs/hooks/src/engine/output_parser.rs:360 */
export function looksLikeJson(stdout) {
  const trimmed = String(stdout).trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

/**
 * Parse a hook's stdout JSON.
 * Returns null when CODEX would treat the output as unparseable (empty stdout, invalid
 * JSON, non-object, unknown field, wrong type) — output_parser.rs:345 `parse_json`.
 *
 * @returns {null|{continue: boolean, stopReason: string|null, systemMessage: string|null,
 *   suppressOutput: boolean, decision: string|null, reason: string|null,
 *   additionalContext: string|null, invalidReason: string|null}}
 */
export function parseHookOutput(stdout, { eventName } = {}) {
  const trimmed = String(stdout ?? '').trim()
  if (trimmed === '') return null
  let raw
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!isPlainObject(raw)) return null

  const allowed = eventName ? OUTPUT_FIELDS[eventName] : [...new Set(Object.values(OUTPUT_FIELDS).flat())]
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) return null
  }
  if (raw.continue !== undefined && typeof raw.continue !== 'boolean') return null
  if (raw.suppressOutput !== undefined && typeof raw.suppressOutput !== 'boolean') return null
  if (raw.stopReason !== undefined && raw.stopReason !== null && typeof raw.stopReason !== 'string') return null
  if (raw.systemMessage !== undefined && raw.systemMessage !== null && typeof raw.systemMessage !== 'string') return null
  if (raw.decision !== undefined && raw.decision !== null && raw.decision !== 'block') return null
  if (raw.reason !== undefined && raw.reason !== null && typeof raw.reason !== 'string') return null

  let additionalContext = null
  if (raw.hookSpecificOutput !== undefined && raw.hookSpecificOutput !== null) {
    const specific = raw.hookSpecificOutput
    if (!isPlainObject(specific)) return null
    if (typeof specific.hookEventName !== 'string') return null
    if (specific.additionalContext !== undefined && specific.additionalContext !== null) {
      if (typeof specific.additionalContext !== 'string') return null
      additionalContext = specific.additionalContext
    }
  }

  const decision = raw.decision ?? null
  const reason = raw.reason ?? null
  let invalidReason = null
  if (decision === 'block' && (reason === null || reason.trim() === '')) {
    invalidReason = `${eventName ?? 'Hook'} hook returned decision:block without a non-empty reason`
  }

  return {
    continue: raw.continue ?? true,
    stopReason: raw.stopReason ?? null,
    systemMessage: raw.systemMessage ?? null,
    suppressOutput: raw.suppressOutput ?? false,
    decision,
    reason,
    additionalContext,
    invalidReason,
  }
}

/**
 * Classify one hook run by exit code + streams.
 * codex-rs/hooks/src/events/user_prompt_submit.rs:200-259 (same shape for the other events)
 *
 * @returns {{status: 'ok'|'blocked'|'failed', output: object|null,
 *   additionalContext: string|null, reason: string|null, error: string|null}}
 */
export function classifyRun({ exitCode, stdout = '', stderr = '' }, { eventName = 'Hook' } = {}) {
  if (exitCode === 0) {
    const trimmed = String(stdout).trim()
    if (trimmed === '') return { status: 'ok', output: null, additionalContext: null, reason: null, error: null }
    if (looksLikeJson(trimmed)) {
      const parsed = parseHookOutput(trimmed, { eventName })
      if (!parsed) {
        return {
          status: 'failed',
          output: null,
          additionalContext: null,
          reason: null,
          error: `hook returned invalid ${eventName} JSON output`,
        }
      }
      if (parsed.invalidReason) {
        return { status: 'failed', output: parsed, additionalContext: null, reason: null, error: parsed.invalidReason }
      }
      const blocked = parsed.decision === 'block'
      return {
        status: blocked ? 'blocked' : 'ok',
        output: parsed,
        additionalContext: parsed.additionalContext,
        reason: blocked ? parsed.reason : parsed.stopReason,
        error: null,
      }
    }
    // Plain text stdout is treated as additionalContext.
    return { status: 'ok', output: null, additionalContext: trimmed, reason: null, error: null }
  }
  if (exitCode === 2) {
    const reason = String(stderr).trim()
    if (reason !== '') {
      return { status: 'blocked', output: null, additionalContext: null, reason, error: null }
    }
    return {
      status: 'failed',
      output: null,
      additionalContext: null,
      reason: null,
      error: `${eventName} hook exited with code 2 but did not write a blocking reason to stderr`,
    }
  }
  return {
    status: 'failed',
    output: null,
    additionalContext: null,
    reason: null,
    error: `hook exited with code ${exitCode}`,
  }
}
