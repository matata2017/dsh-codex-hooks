/**
 * Fixture hook used by selftest/host-e2e.mjs.
 *
 * Writes the received stdin payload to $DSH_HOOKS_SELFTEST_OUT and answers
 * with a Codex shaped JSON output.
 */

import { writeFileSync } from 'node:fs'

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
})
process.stdin.on('end', () => {
  const out = process.env.DSH_HOOKS_SELFTEST_OUT
  if (out) {
    try {
      writeFileSync(out, input, 'utf8')
    } catch {
      /* ignore */
    }
  }
  const eventName = 'UserPromptSubmit'
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: eventName, additionalContext: 'selftest additional context' },
    }),
  )
})
