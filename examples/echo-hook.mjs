#!/usr/bin/env node
/**
 * examples/echo-hook.mjs — a zero-dependency hook script.
 *
 * It proves the three things the DSH Hooks plugin must get right:
 *
 *   1. stdin receives a JSON payload   -> the raw payload is written to the file named by
 *                                          $HOOK_ECHO_LOG (one JSON line per invocation),
 *                                          and echoed back inside additionalContext.
 *   2. stdout is parsed as JSON        -> default mode prints a `hookSpecificOutput`
 *                                          object; `--decision-block` prints
 *                                          `{ "decision": "block", "reason": "..." }`.
 *   3. exit code 2 blocks              -> `--block` writes the reason to stderr and exits 2.
 *
 * Usage (as a hooks.json handler):
 *
 *   node examples/echo-hook.mjs                # JSON on stdout, exit 0
 *   node examples/echo-hook.mjs --block        # reason on stderr, exit 2  (blocking)
 *   node examples/echo-hook.mjs --decision-block  # JSON decision:block on stdout, exit 0
 *   node examples/echo-hook.mjs --plain        # plain text on stdout, exit 0
 *   node examples/echo-hook.mjs --fail         # stderr + exit 3  (hard failure)
 *
 * Environment:
 *   HOOK_ECHO_LOG   optional path; the received payload is appended there as JSON lines.
 *                   Defaults to <tmpdir>/dsh-hooks-echo.log so the evidence trail always
 *                   exists (that file is how you prove the hook really ran).
 *
 * No dependencies, no network, works on Windows/macOS/Linux.
 */

import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => arg.slice(2)))

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    if (process.stdin.isTTY) {
      resolve('')
      return
    }
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

function firstString(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return candidate
  }
  return ''
}

const raw = await readStdin()

let payload = null
let parseError = null
try {
  payload = raw.trim() === '' ? null : JSON.parse(raw)
} catch (error) {
  parseError = error.message
}

const logFile = process.env.HOOK_ECHO_LOG || join(tmpdir(), 'dsh-hooks-echo.log')
if (logFile !== '') {  try {
    appendFileSync(
      logFile,
      `${JSON.stringify({
        time: new Date().toISOString(),
        pid: process.pid,
        argv: process.argv.slice(2),
        rawStdin: raw,
        parsedStdin: payload,
        parseError,
      })}\n`,
      'utf8',
    )
  } catch {
    // logging must never break the hook
  }
}

const eventName =
  firstString(payload?.hook_event_name, payload?.hookEventName, payload?.event, payload?.eventName) || 'Unknown'
const sessionId = firstString(payload?.session_id, payload?.sessionId, payload?.session?.id)
const cwd = firstString(payload?.cwd, payload?.workspace, payload?.session?.cwd)
const prompt = firstString(payload?.prompt, payload?.user_prompt, payload?.input)
const receivedKeys = payload && typeof payload === 'object' ? Object.keys(payload).sort() : []

if (flags.has('block')) {
  process.stderr.write(`echo-hook: blocked ${eventName} on purpose (--block)\n`)
  process.exit(2)
}

if (flags.has('fail')) {
  process.stderr.write(`echo-hook: deliberate failure (--fail)\n`)
  process.exit(3)
}

if (flags.has('decision-block')) {
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason: `echo-hook: blocked ${eventName} via JSON` })}\n`)
  process.exit(0)
}

if (flags.has('plain')) {
  process.stdout.write(`echo-hook: ${eventName} session=${sessionId || '-'} cwd=${cwd || '-'}\n`)
  process.exit(0)
}

const additionalContext = [
  `echo-hook received event=${eventName}`,
  sessionId ? `session=${sessionId}` : null,
  cwd ? `cwd=${cwd}` : null,
  prompt ? `prompt=${prompt.slice(0, 200)}` : null,
  `keys=${receivedKeys.join(',') || '-'}`,
]
  .filter(Boolean)
  .join(' | ')

process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext,
    },
  })}\n`,
)
process.exit(0)
