/**
 * @local/dsh-hooks — hooks core.
 *
 * Pure ESM, zero runtime dependencies (Node built-ins only).
 *
 * The hash/normalize/parse semantics mirror OpenAI Codex CLI so that an
 * existing `~/.codex/hooks.json` keeps working byte-for-byte:
 *   - codex-rs/config/src/fingerprint.rs::version_for_toml
 *   - codex-rs/hooks/src/engine/discovery.rs (normalize + hook_hash)
 *   - codex-rs/hooks/src/lib.rs::hook_key
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ------------------------------------------------------------------ *
 * Constants (mirrors codex-rs/hooks/src/registry.rs)
 * ------------------------------------------------------------------ */

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
export const HANDLER_TYPES = ['command', 'mcp_tool', 'prompt', 'agent']
export const EXECUTABLE_HANDLER_TYPES = ['command', 'mcp_tool']
export const STATE_FILE_VERSION = 1

/** Source groups surfaced in the settings UI. */
export const SOURCE_GROUPS = [
  { id: 'config', label: 'From Config' },
  { id: 'plugins', label: 'From Plugins' },
  { id: 'projects', label: 'From Projects' },
]

/* ------------------------------------------------------------------ *
 * Fingerprint helpers (codex-rs/config/src/fingerprint.rs)
 * ------------------------------------------------------------------ */

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const body = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')
    return `{${body}}`
  }
  return JSON.stringify(value)
}

/** `sha256:<hex>` over the UTF-8 bytes of `text`. */
export function versionForText(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

function omitNulls(value) {
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && item !== undefined) out[key] = item
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Normalization + hashing (codex-rs/hooks/src/engine/discovery.rs)
 * ------------------------------------------------------------------ */

export function normalizeTimeoutSeconds(eventName, timeoutSec) {
  const raw = timeoutSec === null || timeoutSec === undefined ? null : Number(timeoutSec)
  const value = Number.isFinite(raw) ? raw : null
  if (eventName === 'SessionEnd' || eventName === 'Interrupt') {
    return Math.min(Math.max(value ?? SESSION_END_DEFAULT_TIMEOUT_SEC, 1), SESSION_END_MAX_TIMEOUT_SEC)
  }
  return Math.max(value ?? DEFAULT_TIMEOUT_SEC, 1)
}

/**
 * Normalize one handler for hashing/execution. Returns `null` for handler
 * types Codex never executes (prompt/agent).
 */
export function normalizeHandler(handler, options) {
  const settings = options ?? {}
  const eventName = settings.eventName
  const platform = settings.platform ?? 'linux'
  if (!handler || typeof handler !== 'object') return null

  if (handler.type === 'command') {
    const raw = platform === 'win32' ? (handler.commandWindows ?? handler.command) : handler.command
    const command = typeof raw === 'string' && raw.trim() !== '' ? raw : null
    if (!command) return null
    const limit = handler.additionalContextLimit
    return omitNulls({
      type: 'command',
      command,
      timeout: normalizeTimeoutSeconds(eventName, handler.timeout),
      async: handler.async === true,
      statusMessage: handler.statusMessage ?? undefined,
      additionalContextLimit:
        limit === null || limit === undefined
          ? undefined
          : ADDITIONAL_CONTEXT_EVENTS.has(eventName) && Number(limit) !== DEFAULT_ADDITIONAL_CONTEXT_LIMIT
            ? limit
            : undefined,
    })
  }

  if (handler.type === 'mcp_tool') {
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

  return null
}

/** The hashed identity of a single handler: `{ event_name, matcher?, hooks: [handler] }`. */
export function hookIdentity(options) {
  const settings = options ?? {}
  const eventName = settings.eventName ?? settings.event
  const matcher = settings.matcher ?? null
  const normalized = normalizeHandler(settings.handler, {
    eventName,
    platform: settings.platform ?? 'linux',
  })
  if (!normalized) return null
  const effectiveMatcher = MATCHER_EVENTS.has(eventName) ? (matcher ?? undefined) : undefined
  return omitNulls({
    event_name: EVENT_LABELS[eventName],
    matcher: effectiveMatcher,
    hooks: [normalized],
  })
}

/** Trust hash of a single handler, `null` when the handler is not executable. */
export function hookHash(options) {
  const identity = hookIdentity(options)
  if (!identity) return null
  return versionForText(stableJson(identity))
}

/** `<source>:<event_label>:<groupIndex>:<handlerIndex>` */
export function hookStateKey(sourceKey, eventName, groupIndex, handlerIndex) {
  return `${sourceKey}:${EVENT_LABELS[eventName]}:${groupIndex}:${handlerIndex}`
}

/* ------------------------------------------------------------------ *
 * hooks.json parsing
 * ------------------------------------------------------------------ */

/**
 * Parse the text of a CODEX `hooks.json` file.
 * Throws with Codex-like messages on malformed input.
 */
export function parseHooksFile(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`hooks file is not valid JSON: ${error.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('hooks file must be a JSON object')
  }
  for (const key of Object.keys(parsed)) {
    if (key !== 'description' && key !== 'hooks') throw new Error(`unknown field \`${key}\``)
  }
  const events = {}
  const source = parsed.hooks
  if (source !== undefined && source !== null) {
    if (typeof source !== 'object' || Array.isArray(source)) throw new Error('`hooks` must be an object')
    for (const [eventName, groups] of Object.entries(source)) {
      if (!EVENT_NAMES.includes(eventName)) throw new Error(`unknown field \`${eventName}\``)
      if (!Array.isArray(groups)) throw new Error(`\`${eventName}\` must be an array`)
      const parsedGroups = []
      groups.forEach((group, index) => {
        if (!group || typeof group !== 'object' || Array.isArray(group)) {
          throw new Error(`\`${eventName}[${index}]\` must be an object`)
        }
        if (!Array.isArray(group.hooks)) throw new Error(`\`${eventName}[${index}].hooks\` must be an array`)
        group.hooks.forEach((handler, handlerIndex) => {
          if (!handler || typeof handler !== 'object' || Array.isArray(handler)) {
            throw new Error(`\`${eventName}[${index}].hooks[${handlerIndex}]\` must be an object`)
          }
          if (!HANDLER_TYPES.includes(handler.type)) {
            throw new Error(
              `\`${eventName}[${index}].hooks[${handlerIndex}].type\` must be one of ${HANDLER_TYPES.join('|')}`,
            )
          }
          if (handler.type === 'command' && typeof handler.command !== 'string') {
            throw new Error(`\`${eventName}[${index}].hooks[${handlerIndex}].command\` is required`)
          }
          if (handler.type === 'mcp_tool' && (typeof handler.server !== 'string' || typeof handler.tool !== 'string')) {
            throw new Error(`\`${eventName}[${index}].hooks[${handlerIndex}]\` mcp_tool needs \`server\` and \`tool\``)
          }
        })
        parsedGroups.push({
          matcher: typeof group.matcher === 'string' ? group.matcher : null,
          hooks: group.hooks,
        })
      })
      events[eventName] = parsedGroups
    }
  }
  return {
    description: typeof parsed.description === 'string' ? parsed.description : null,
    events,
  }
}

/** Flatten a parsed hooks file into one row per handler. */
export function describeHooks(parsed, options) {
  const settings = options ?? {}
  const sourceKey = settings.sourceKey
  const platform = settings.platform ?? 'linux'
  const events = parsed?.events ?? {}
  const rows = []
  for (const eventName of EVENT_NAMES) {
    const groups = events[eventName]
    if (!Array.isArray(groups)) continue
    groups.forEach((group, groupIndex) => {
      const handlers = Array.isArray(group?.hooks) ? group.hooks : []
      handlers.forEach((handler, handlerIndex) => {
        const matcher = typeof group?.matcher === 'string' ? group.matcher : null
        rows.push({
          eventName,
          eventLabel: EVENT_LABELS[eventName],
          groupIndex,
          handlerIndex,
          key: hookStateKey(sourceKey, eventName, groupIndex, handlerIndex),
          matcher,
          handler,
          hash: hookHash({ eventName, matcher, handler, platform }),
          executable: EXECUTABLE_HANDLER_TYPES.includes(handler?.type),
        })
      })
    })
  }
  return rows
}

/* ------------------------------------------------------------------ *
 * Matcher (codex-rs/hooks/src/engine/matcher.rs)
 * ------------------------------------------------------------------ */

export function compileMatcher(pattern) {
  const text = pattern === null || pattern === undefined ? '' : String(pattern)
  if (text === '' || text === '*') return { kind: 'all', pattern: text }
  if (/^[A-Za-z0-9_|]+$/.test(text)) return { kind: 'exact', pattern: text }
  return { kind: 'regex', pattern: text, regex: new RegExp(text) }
}

export function matchMatcher(pattern, input) {
  const compiled = compileMatcher(pattern)
  if (compiled.kind === 'all') return true
  if (input === null || input === undefined) return false
  if (compiled.kind === 'exact') return compiled.pattern.split('|').some((candidate) => candidate === input)
  return compiled.regex.test(String(input))
}

/* ------------------------------------------------------------------ *
 * Trust + state (codex-rs/hooks/src/engine/discovery.rs::hook_trust_status)
 * ------------------------------------------------------------------ */

export function trustStatus(options) {
  const settings = options ?? {}
  const isManaged = settings.isManaged ?? settings.managed ?? false
  const isBuiltin = settings.isBuiltin ?? false
  const currentHash = settings.currentHash ?? settings.hash
  const trustedHash = settings.trustedHash ?? settings.trusted_hash
  if (isBuiltin) return 'Trusted'
  if (isManaged) return 'Managed'
  if (trustedHash === null || trustedHash === undefined) return 'Untrusted'
  if (trustedHash === currentHash) return 'Trusted'
  return 'Modified'
}

export function hookEnabled(options) {
  const settings = options ?? {}
  if (settings.isBuiltin || settings.isManaged) return true
  return settings.state?.enabled !== false
}

export function isRunnable(trust) {
  return trust === 'Trusted' || trust === 'Managed'
}

/* ------------------------------------------------------------------ *
 * State file (`$DSH_HOME/hooks.state.json`)
 * ------------------------------------------------------------------ */

export function parseStateFile(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`state file is not valid JSON: ${error.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('state file must be a JSON object')
  }
  const version = parsed.version ?? STATE_FILE_VERSION
  if (version !== STATE_FILE_VERSION) throw new Error(`unsupported state file version ${version}`)
  const states = parsed.states ?? {}
  if (!states || typeof states !== 'object' || Array.isArray(states)) throw new Error('`states` must be an object')
  return { version, states }
}

export function readStateFile(path) {
  if (!path || !existsSync(path)) return { version: STATE_FILE_VERSION, states: {} }
  return parseStateFile(readFileSync(path, 'utf8'))
}

export function writeStateFile(path, state) {
  const payload = {
    version: state?.version ?? STATE_FILE_VERSION,
    states: state?.states ?? {},
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload
}

export function stateFor(state, key) {
  return state?.states?.[key] ?? null
}

/* ------------------------------------------------------------------ *
 * Hook output (codex-rs/hooks/src/schema.rs + engine/output_parser.rs)
 * ------------------------------------------------------------------ */

const UNIVERSAL_FIELDS = ['continue', 'stopReason', 'suppressOutput', 'systemMessage']

export const OUTPUT_FIELDS = {
  PreModelRequest: UNIVERSAL_FIELDS,
  PostModelRequest: UNIVERSAL_FIELDS,
  PreCompact: UNIVERSAL_FIELDS,
  PostCompact: UNIVERSAL_FIELDS,
  PreToolUse: [...UNIVERSAL_FIELDS, 'decision', 'reason', 'hookSpecificOutput'],
  PostToolUse: [...UNIVERSAL_FIELDS, 'decision', 'reason', 'hookSpecificOutput'],
  UserPromptSubmit: [...UNIVERSAL_FIELDS, 'decision', 'reason', 'hookSpecificOutput'],
  PermissionRequest: [...UNIVERSAL_FIELDS, 'hookSpecificOutput'],
  SessionStart: [...UNIVERSAL_FIELDS, 'hookSpecificOutput'],
  SubagentStart: [...UNIVERSAL_FIELDS, 'hookSpecificOutput'],
  SubagentStop: [...UNIVERSAL_FIELDS, 'decision', 'reason'],
  Stop: [...UNIVERSAL_FIELDS, 'decision', 'reason'],
  Interrupt: ['systemMessage'],
}

export function looksLikeJson(stdout) {
  return typeof stdout === 'string' && /^\s*[\[{]/.test(stdout)
}

/** Parse a hook's stdout into the Codex output shape, `null` when invalid. */
export function parseHookOutput(stdout, options) {
  const eventName = options?.eventName
  if (typeof stdout !== 'string' || stdout.trim() === '') return null
  let raw
  try {
    raw = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const allowed = OUTPUT_FIELDS[eventName] ?? UNIVERSAL_FIELDS
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
    if (typeof specific !== 'object' || Array.isArray(specific)) return null
    if (typeof specific.hookEventName !== 'string') return null
    if (specific.additionalContext !== undefined && typeof specific.additionalContext !== 'string') return null
    additionalContext = specific.additionalContext ?? null
  }

  let invalidReason = null
  if (raw.decision === 'block' && !(typeof raw.reason === 'string' && raw.reason.trim() !== '')) {
    invalidReason = `${eventName ?? 'Hook'} hook returned decision:block without a non-empty reason`
  }

  return {
    continue: raw.continue ?? true,
    stopReason: raw.stopReason ?? null,
    systemMessage: raw.systemMessage ?? null,
    suppressOutput: raw.suppressOutput ?? false,
    decision: raw.decision ?? null,
    reason: raw.reason ?? null,
    additionalContext,
    invalidReason,
  }
}

/** Turn a finished process into a Codex-style result. */
export function classifyRun(run, options) {
  const eventName = options?.eventName ?? 'Hook'
  const exitCode = run?.exitCode
  const stdout = run?.stdout ?? ''
  const stderr = run?.stderr ?? ''
  const base = { output: null, additionalContext: null, reason: null, error: null }

  if (exitCode === 0) {
    if (String(stdout).trim() === '') return { ...base, status: 'ok' }
    if (looksLikeJson(stdout)) {
      const parsed = parseHookOutput(stdout, { eventName })
      if (!parsed) {
        return { ...base, status: 'failed', error: `hook returned invalid ${eventName} JSON output` }
      }
      if (parsed.invalidReason) {
        return { ...base, status: 'failed', output: parsed, error: parsed.invalidReason }
      }
      if (parsed.decision === 'block') {
        return { ...base, status: 'blocked', output: parsed, additionalContext: parsed.additionalContext, reason: parsed.reason }
      }
      return { ...base, status: 'ok', output: parsed, additionalContext: parsed.additionalContext, reason: parsed.stopReason }
    }
    return { ...base, status: 'ok', additionalContext: String(stdout).trim() }
  }

  if (exitCode === 2) {
    if (String(stderr).trim() !== '') {
      return { ...base, status: 'blocked', reason: String(stderr).trim() }
    }
    return { ...base, status: 'failed', error: `${eventName} hook exited with code 2 but did not write a blocking reason to stderr` }
  }

  return { ...base, status: 'failed', error: `hook exited with code ${exitCode}` }
}

/* ------------------------------------------------------------------ *
 * Discovery: where hooks.json files live
 * ------------------------------------------------------------------ */

export function dshHomePath() {
  const override = process.env.DSH_HOME
  if (override && override.trim() !== '') return resolve(override)
  return join(homedir(), '.dsh')
}

export function codexHomePath() {
  const override = process.env.CODEX_HOME
  if (override && override.trim() !== '') return resolve(override)
  return join(homedir(), '.codex')
}

export function stateFilePath(home = dshHomePath()) {
  return join(home, 'hooks.state.json')
}

/** The profile directory this plugin is installed in (…/node_modules/<pkg>/…). */
export function profileDirFromModule(moduleUrl = import.meta.url) {
  let dir = dirname(fileURLToPath(moduleUrl))
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = dirname(dir)
    if (basename(dir) === 'node_modules') return parent
    if (parent === dir) break
    dir = parent
  }
  return null
}

function readHooksFile(path) {
  const text = readFileSync(path, 'utf8')
  const parsed = parseHooksFile(text)
  return { parsed, error: null }
}

/** Every `hooks.json` shipped by a package inside `<profile>/node_modules`. */
export function listPluginConfigFiles(profileDir) {
  if (!profileDir) return []
  const modulesDir = join(profileDir, 'node_modules')
  if (!existsSync(modulesDir)) return []
  const found = []
  const visit = (packageDir) => {
    const candidate = join(packageDir, 'hooks.json')
    if (existsSync(candidate)) found.push(candidate)
  }
  let entries = []
  try {
    entries = readdirSync(modulesDir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = join(modulesDir, entry.name)
    if (entry.name.startsWith('@')) {
      let scoped = []
      try {
        scoped = readdirSync(full, { withFileTypes: true })
      } catch {
        continue
      }
      for (const inner of scoped) {
        if (inner.isDirectory()) visit(join(full, inner.name))
      }
      continue
    }
    visit(full)
  }
  return found
}

/**
 * Codex-style source key: absolute path for loose files, `<pkg>@<pkg>:<rel>`
 * for files shipped inside a package.
 */
export function pluginSourceKey(profileDir, path) {
  const modulesDir = join(profileDir ?? '', 'node_modules')
  const relative = profileDir ? path.slice(modulesDir.length + 1).split(/[\\/]/).join('/') : path
  const parts = relative.split('/')
  const packageName = parts[0].startsWith('@') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]
  const within = parts[0].startsWith('@') && parts.length > 1 ? parts.slice(2).join('/') : parts.slice(1).join('/')
  return `${packageName}@${packageName}:${within}`
}

/**
 * Discover every hooks source.
 *
 * @param options.cwd      project directory of the current session (optional)
 * @param options.profileDir profile root that holds `node_modules` (optional)
 */
export function discoverSources(options) {
  const settings = options ?? {}
  const platform = settings.platform ?? process.platform
  const home = settings.home ?? dshHomePath()
  const profileDir = settings.profileDir ?? null
  const sources = []

  const push = (groupId, id, path, keySource, label) => {
    const entry = {
      id,
      group: groupId,
      path,
      keySource,
      label: label ?? basename(path),
      error: null,
      description: null,
      hooks: [],
    }
    if (existsSync(path)) {
      try {
        const { parsed } = readHooksFile(path)
        entry.description = parsed.description
        entry.hooks = describeHooks(parsed, { sourceKey: keySource, platform })
      } catch (error) {
        entry.error = error.message
      }
    }
    sources.push(entry)
    return entry
  }

  // From Config — the DSH user level file plus the Codex user level file.
  push('config', 'dsh-user', join(home, 'hooks.json'), join(home, 'hooks.json'), 'hooks.json')
  const codexConfig = join(codexHomePath(), 'hooks.json')
  if (resolve(codexConfig) !== resolve(join(home, 'hooks.json'))) {
    push('config', 'codex-user', codexConfig, codexConfig, 'hooks.json')
  }

  // From Plugins — every package inside the profile that ships a hooks.json.
  for (const file of listPluginConfigFiles(profileDir)) {
    const keySource = pluginSourceKey(profileDir, file)
    push('plugins', `plugin:${keySource}`, file, keySource, file)
  }

  // From Projects — <workspace>/.dsh/hooks.json of every known workspace.
  const cwds = new Set()
  if (settings.cwd) cwds.add(resolve(settings.cwd))
  for (const extra of settings.projectDirs ?? []) cwds.add(resolve(extra))
  for (const cwd of cwds) {
    const path = join(cwd, '.dsh', 'hooks.json')
    push('projects', `project:${cwd}`, path, path, path)
  }

  return sources
}

/** Group discovered sources the way the settings UI renders them. */
export function groupSources(sources) {
  return SOURCE_GROUPS.map((group) => {
    const members = sources.filter((source) => source.group === group.id)
    const hooks = members.flatMap((source) =>
      source.hooks.map((hook) => ({
        ...hook,
        group: group.id,
        sourceId: source.id,
        sourcePath: source.path,
        sourceLabel: source.label,
      })),
    )
    return {
      id: group.id,
      label: group.label,
      sources: members,
      hooks,
      count: hooks.length,
      needsReview: hooks.filter((hook) => hook.trust === 'Untrusted' || hook.trust === 'Modified').length,
    }
  })
}
